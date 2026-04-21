/**
 * providers/commoditiesProvider.js
 *
 * Commodities spot/futures provider for the Particle AI toolbox.
 *
 * Why this exists
 * ---------------
 * Before this module, the terminal had NO commodity tool. When a user asked
 * "what's oil doing" or "onde está o minério de ferro", the AI fell back to
 * the TRAINING-DATA FALLBACK rule and either refused or quoted a stale
 * anecdote. We already pay for Twelve Data, which covers the liquid WTI/
 * Brent/metals/grains futures, and Yahoo Finance backfills anything TD
 * misses. This provider exposes that coverage through a single call.
 *
 * Design
 * ------
 *   - Map plain-language names ("oil", "gold", "iron ore", "boi gordo") to
 *     canonical Yahoo futures symbols (CL=F, GC=F, TIO=F, BGI=F...).
 *   - Try Twelve Data first (we pay for it — 30 credits/min pro plan).
 *   - Fall back to Yahoo Finance (free, public endpoint).
 *   - Return a normalized quote + metadata so the model sees both the
 *     number and what it represents.
 *   - Be honest about coverage gaps: SGX iron ore (TIO/FEF) is thin on
 *     retail data feeds; B3 local ag futures (soy, corn, live cattle) are
 *     spotty. The `coverage_note` tells the model to caveat.
 *
 * Output shape:
 *   {
 *     query: "oil",
 *     symbol: "CL=F",
 *     name: "Crude Oil WTI Futures",
 *     exchange: "NYMEX",
 *     currency: "USD",
 *     unit: "per barrel",
 *     price: 81.23,
 *     change: +0.45,
 *     changePct: +0.56,
 *     open, high, low, prevClose, volume,
 *     asOf: "2026-04-21T15:00:00Z",
 *     source: "Twelve Data" | "Yahoo Finance",
 *     coverage_note?: "SGX iron ore data is delayed and often sparse..."
 *   }
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

// ── Caching ──────────────────────────────────────────────────────────
const _cache = new Map();
const TTL = 60 * 1000; // 60s — commodity futures move tick by tick but
                       // a 1-min cache is fine for a chat tool.
function cget(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cset(k, v, ttl = TTL) { _cache.set(k, { v, exp: Date.now() + ttl }); }

// ── Canonical commodity registry ─────────────────────────────────────
// name: plain-language handle
// aliases: everything we expect the model or a Brazilian user to type
// symbol: canonical Yahoo futures code (works in TD after =F stripping,
//         and in Yahoo natively)
// unit/exchange/currency: display metadata so the model can frame the number
// coverage_note: optional caveat for thin data
const COMMODITIES = [
  // ── Energy ──────────────────────────────────────────────────────
  { key: 'wti',        aliases: ['oil','crude','crude oil','wti','petroleo','petróleo'],
    symbol: 'CL=F', name: 'Crude Oil WTI Futures', exchange: 'NYMEX',
    currency: 'USD', unit: 'per barrel', category: 'energy' },
  { key: 'brent',      aliases: ['brent','brent crude','brent oil'],
    symbol: 'BZ=F', name: 'Brent Crude Oil Futures', exchange: 'ICE',
    currency: 'USD', unit: 'per barrel', category: 'energy' },
  { key: 'natgas',     aliases: ['natgas','natural gas','gas natural','ng','henry hub'],
    symbol: 'NG=F', name: 'Natural Gas Futures (Henry Hub)', exchange: 'NYMEX',
    currency: 'USD', unit: 'per MMBtu', category: 'energy' },
  { key: 'gasoline',   aliases: ['gasoline','rbob'],
    symbol: 'RB=F', name: 'RBOB Gasoline Futures', exchange: 'NYMEX',
    currency: 'USD', unit: 'per gallon', category: 'energy' },
  { key: 'heating_oil',aliases: ['heating oil','ho'],
    symbol: 'HO=F', name: 'Heating Oil Futures', exchange: 'NYMEX',
    currency: 'USD', unit: 'per gallon', category: 'energy' },

  // ── Precious metals ────────────────────────────────────────────
  { key: 'gold',       aliases: ['gold','ouro','xau','au'],
    symbol: 'GC=F', name: 'Gold Futures', exchange: 'COMEX',
    currency: 'USD', unit: 'per troy oz', category: 'precious_metal' },
  { key: 'silver',     aliases: ['silver','prata','xag','ag'],
    symbol: 'SI=F', name: 'Silver Futures', exchange: 'COMEX',
    currency: 'USD', unit: 'per troy oz', category: 'precious_metal' },
  { key: 'platinum',   aliases: ['platinum','platina','xpt'],
    symbol: 'PL=F', name: 'Platinum Futures', exchange: 'NYMEX',
    currency: 'USD', unit: 'per troy oz', category: 'precious_metal' },
  { key: 'palladium',  aliases: ['palladium','paládio','paladio','xpd'],
    symbol: 'PA=F', name: 'Palladium Futures', exchange: 'NYMEX',
    currency: 'USD', unit: 'per troy oz', category: 'precious_metal' },

  // ── Base metals ────────────────────────────────────────────────
  { key: 'copper',     aliases: ['copper','cobre','hg'],
    symbol: 'HG=F', name: 'Copper Futures', exchange: 'COMEX',
    currency: 'USD', unit: 'per lb', category: 'base_metal' },
  // Iron ore: SGX TSI 62% Fe (TIO=F on Yahoo). Thin on retail feeds; we
  // try it anyway and caveat if we get nothing.
  { key: 'iron_ore',   aliases: ['iron ore','minerio','minério','minério de ferro','minerio de ferro','fef','tsi','iron-ore','tio'],
    symbol: 'TIO=F', name: 'SGX TSI Iron Ore CFR China 62% Fe Futures', exchange: 'SGX',
    currency: 'USD', unit: 'per metric ton', category: 'base_metal',
    coverage_note: 'Iron ore (SGX TIO/TSI 62% Fe) data can be delayed or sparse on retail feeds. If no quote is returned, this is a known gap — the authoritative source is SGX or Platts, which we do not directly integrate.' },

  // ── Grains / oilseeds ──────────────────────────────────────────
  { key: 'corn',       aliases: ['corn','milho','zc'],
    symbol: 'ZC=F', name: 'Corn Futures', exchange: 'CBOT',
    currency: 'USD cents', unit: 'per bushel', category: 'grain' },
  { key: 'soybeans',   aliases: ['soy','soybean','soybeans','soja','zs'],
    symbol: 'ZS=F', name: 'Soybean Futures', exchange: 'CBOT',
    currency: 'USD cents', unit: 'per bushel', category: 'grain' },
  { key: 'soy_meal',   aliases: ['soy meal','soymeal','farelo de soja','zm'],
    symbol: 'ZM=F', name: 'Soybean Meal Futures', exchange: 'CBOT',
    currency: 'USD', unit: 'per short ton', category: 'grain' },
  { key: 'soy_oil',    aliases: ['soy oil','soybean oil','óleo de soja','oleo de soja','zl'],
    symbol: 'ZL=F', name: 'Soybean Oil Futures', exchange: 'CBOT',
    currency: 'USD cents', unit: 'per lb', category: 'grain' },
  { key: 'wheat',      aliases: ['wheat','trigo','zw'],
    symbol: 'ZW=F', name: 'Wheat Futures (CBOT)', exchange: 'CBOT',
    currency: 'USD cents', unit: 'per bushel', category: 'grain' },
  { key: 'oats',       aliases: ['oats','aveia','zo'],
    symbol: 'ZO=F', name: 'Oats Futures', exchange: 'CBOT',
    currency: 'USD cents', unit: 'per bushel', category: 'grain' },

  // ── Softs ──────────────────────────────────────────────────────
  { key: 'coffee',     aliases: ['coffee','café','cafe','kc'],
    symbol: 'KC=F', name: 'Coffee Futures (Arabica)', exchange: 'ICE',
    currency: 'USD cents', unit: 'per lb', category: 'soft' },
  { key: 'sugar',      aliases: ['sugar','açúcar','acucar','sb'],
    symbol: 'SB=F', name: 'Sugar #11 Futures', exchange: 'ICE',
    currency: 'USD cents', unit: 'per lb', category: 'soft' },
  { key: 'cocoa',      aliases: ['cocoa','cacau','cc'],
    symbol: 'CC=F', name: 'Cocoa Futures', exchange: 'ICE',
    currency: 'USD', unit: 'per metric ton', category: 'soft' },
  { key: 'cotton',     aliases: ['cotton','algodão','algodao','ct'],
    symbol: 'CT=F', name: 'Cotton Futures', exchange: 'ICE',
    currency: 'USD cents', unit: 'per lb', category: 'soft' },
  { key: 'orange_juice',aliases:['orange juice','oj','suco de laranja'],
    symbol: 'OJ=F', name: 'Orange Juice Futures', exchange: 'ICE',
    currency: 'USD cents', unit: 'per lb', category: 'soft' },

  // ── Livestock ──────────────────────────────────────────────────
  { key: 'live_cattle',aliases:['live cattle','cattle','boi','boi gordo','le'],
    symbol: 'LE=F', name: 'Live Cattle Futures (CME)', exchange: 'CME',
    currency: 'USD cents', unit: 'per lb', category: 'livestock',
    coverage_note: 'For Brazilian boi gordo (B3/BMF), use local cash index CEPEA. CME LE=F is the US proxy.' },
  { key: 'lean_hogs',  aliases: ['lean hogs','hogs','he','suínos','suinos'],
    symbol: 'HE=F', name: 'Lean Hogs Futures', exchange: 'CME',
    currency: 'USD cents', unit: 'per lb', category: 'livestock' },
  { key: 'feeder_cattle', aliases: ['feeder cattle','feeder','gf'],
    symbol: 'GF=F', name: 'Feeder Cattle Futures', exchange: 'CME',
    currency: 'USD cents', unit: 'per lb', category: 'livestock' },
];

// ── Resolver ─────────────────────────────────────────────────────────
/**
 * resolve(input) → one of the COMMODITIES entries, or null.
 * Accepts:
 *   - canonical futures symbol ("CL=F", "GC=F")
 *   - bare futures root ("CL", "GC")
 *   - plain name / alias ("oil", "ouro", "iron ore", "minério de ferro")
 */
function resolve(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();

  // Exact symbol match (CL=F)
  const bySymbol = COMMODITIES.find(c => c.symbol.toUpperCase() === upper);
  if (bySymbol) return bySymbol;

  // Bare futures root (CL, GC, ZC)
  const rootMatch = COMMODITIES.find(c =>
    c.symbol.toUpperCase().replace(/=F$/, '') === upper,
  );
  if (rootMatch) return rootMatch;

  // Alias / key match (case-insensitive, accents preserved — we store both
  // accented and unaccented variants in aliases above).
  const byAlias = COMMODITIES.find(c =>
    c.key === lower || c.aliases.some(a => a.toLowerCase() === lower),
  );
  if (byAlias) return byAlias;

  // Loose contains — last resort, e.g. user says "iron ore futures" and we
  // still want to catch it. Prefer longer aliases first so "soy oil"
  // outranks "soy".
  const needle = lower;
  const fuzzy = COMMODITIES
    .flatMap(c => c.aliases.map(a => ({ c, a: a.toLowerCase() })))
    .filter(({ a }) => needle.includes(a) || a.includes(needle))
    .sort((x, y) => y.a.length - x.a.length)[0];
  if (fuzzy) return fuzzy.c;

  return null;
}

// ── Live fetchers ────────────────────────────────────────────────────
// Twelve Data: strip =F suffix (TD uses "CL" not "CL=F").
async function fetchTwelveDataCommodity(sym) {
  if (!process.env.TWELVEDATA_API_KEY) return null;
  const root = sym.replace(/=F$/i, '');

  const ck = `td:commodity:${root}`;
  const cached = cget(ck);
  if (cached) return cached;

  const url =
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(root)}` +
    `&apikey=${process.env.TWELVEDATA_API_KEY}`;

  try {
    const res = await fetch(url, { timeout: 5000 });
    if (!res.ok) return null;
    const d = await res.json();
    if (d?.status === 'error' || !d?.close) return null;
    const price = parseFloat(d.close) || parseFloat(d.previous_close);
    if (!Number.isFinite(price)) return null;

    const result = {
      price,
      open:      parseFloat(d.open)            || null,
      high:      parseFloat(d.high)            || null,
      low:       parseFloat(d.low)             || null,
      prevClose: parseFloat(d.previous_close)  || null,
      change:    parseFloat(d.change)          || null,
      changePct: parseFloat(d.percent_change)  || null,
      volume:    parseInt(d.volume) || null,
      asOf: d.datetime || new Date().toISOString(),
      source: 'Twelve Data',
    };
    cset(ck, result);
    return result;
  } catch (e) {
    logger?.warn?.('commoditiesProvider', `TD ${root} failed: ${e.message}`);
    return null;
  }
}

// Yahoo: keep the =F suffix — Yahoo handles futures natively.
async function fetchYahooCommodity(sym) {
  const ck = `yf:commodity:${sym}`;
  const cached = cget(ck);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`;
  try {
    const res = await fetch(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Particle/1.0)' },
    });
    if (!res.ok) return null;
    const d = await res.json();
    const q = d?.quoteResponse?.result?.[0];
    if (!q || q.regularMarketPrice == null) return null;

    const result = {
      price:     q.regularMarketPrice,
      open:      q.regularMarketOpen            ?? null,
      high:      q.regularMarketDayHigh         ?? null,
      low:       q.regularMarketDayLow          ?? null,
      prevClose: q.regularMarketPreviousClose   ?? null,
      change:    q.regularMarketChange          ?? null,
      changePct: q.regularMarketChangePercent   ?? null,
      volume:    q.regularMarketVolume          ?? null,
      asOf: q.regularMarketTime
        ? new Date(q.regularMarketTime * 1000).toISOString()
        : new Date().toISOString(),
      source: 'Yahoo Finance',
    };
    cset(ck, result);
    return result;
  } catch (e) {
    logger?.warn?.('commoditiesProvider', `Yahoo ${sym} failed: ${e.message}`);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────
/**
 * getCommodityQuote(input)
 *
 * Look up a commodity by plain name or futures symbol. Returns a
 * normalized quote with metadata, or { error } if nothing resolves
 * or all data sources fail.
 */
async function getCommodityQuote(input) {
  const spec = resolve(input);
  if (!spec) {
    return {
      error: `Unrecognised commodity: "${input}". Supported: ${
        COMMODITIES.map(c => c.key).sort().join(', ')
      }.`,
    };
  }

  // Try TD first (we pay for it), then Yahoo.
  const quote =
    (await fetchTwelveDataCommodity(spec.symbol)) ||
    (await fetchYahooCommodity(spec.symbol));

  if (!quote) {
    return {
      query: input,
      symbol: spec.symbol,
      name: spec.name,
      exchange: spec.exchange,
      category: spec.category,
      error: 'No data from Twelve Data or Yahoo Finance for this commodity.',
      ...(spec.coverage_note ? { coverage_note: spec.coverage_note } : {}),
    };
  }

  const out = {
    query: input,
    symbol: spec.symbol,
    name: spec.name,
    exchange: spec.exchange,
    currency: spec.currency,
    unit: spec.unit,
    category: spec.category,
    ...quote,
  };
  if (spec.coverage_note) out.coverage_note = spec.coverage_note;
  return out;
}

/**
 * listCommodities() — returns the registry (for discovery/debugging).
 */
function listCommodities() {
  return COMMODITIES.map(c => ({
    key: c.key,
    symbol: c.symbol,
    name: c.name,
    category: c.category,
    exchange: c.exchange,
    aliases: c.aliases,
  }));
}

module.exports = {
  getCommodityQuote,
  listCommodities,
  // internals for testing
  _internal: { resolve, fetchTwelveDataCommodity, fetchYahooCommodity, COMMODITIES },
};
