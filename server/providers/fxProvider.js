/**
 * providers/fxProvider.js
 * FX spot provider with correct semantics for Brazilian users:
 *
 *   - BCB PTAX is the OFFICIAL Brazilian reference rate. It is published
 *     a few times per day (09:10, 10:10, 11:10, 12:10, 13:10 BRT) and a
 *     closing PTAX is struck at end of day. That closing PTAX is what
 *     contracts, tax calculations, and regulatory filings reference.
 *     It is NOT a live market price — there is a delay and the final
 *     print lags the market.
 *
 *   - Twelve Data (and Yahoo fallback) provide the LIVE market mid
 *     during cash-market hours. This is the number the tape shows.
 *
 * For BRL pairs we return BOTH and label them clearly so the AI can
 * explain the difference. For non-BRL pairs we return live only (PTAX
 * does not apply).
 *
 * Fallback chain:
 *   - BRL pair: BCB PTAX (primary, official) + TD live (secondary, market)
 *              — if TD not configured, fall back to Yahoo FX
 *   - non-BRL: TD live → Yahoo FX
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

// ── Caching ──────────────────────────────────────────────────────────
const _cache = new Map();
const TTL = {
  live: 60 * 1000,        // 60s — live market mid
  ptax: 15 * 60 * 1000,   // 15m — PTAX only changes ~5x per day
};
function cget(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cset(k, v, ttl) { _cache.set(k, { v, exp: Date.now() + ttl }); }

// ── Currency validation ──────────────────────────────────────────────
// ISO-4217 codes we recognise. Not exhaustive — covers everything a CIO
// reasonably asks about.
const ISO_CODES = new Set([
  'USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD',
  'BRL','ARS','MXN','CLP','COP','PEN','UYU',
  'CNY','CNH','HKD','TWD','KRW','SGD','THB','IDR','PHP','INR','MYR','VND',
  'ZAR','TRY','NOK','SEK','DKK','PLN','CZK','HUF','RUB','ILS','AED','SAR',
]);

// PTAX currencies — the set BCB actually publishes.
const PTAX_CURRENCIES = new Set([
  'USD','EUR','GBP','JPY','CHF','CAD','AUD','ARS','DKK','NOK','SEK','CNY',
]);

/**
 * Normalise pair input into { base, quote }.
 * Accepts:
 *   "USDBRL", "USD/BRL", "USD-BRL", "usd brl", "USD BRL"
 *   "EUR/USD", "EURUSD"
 */
function parsePair(input) {
  if (!input) return null;
  let s = String(input).toUpperCase().replace(/[\/\-_\s]/g, '').trim();
  // Remove Yahoo "=X" suffix if the model echoed one back
  s = s.replace(/=X$/, '');
  if (s.length < 6) return null;
  const base = s.slice(0, 3);
  const quote = s.slice(3, 6);
  if (!ISO_CODES.has(base) || !ISO_CODES.has(quote)) return null;
  return { base, quote };
}

function pairLabel(base, quote) { return `${base}/${quote}`; }

// ── BCB PTAX ─────────────────────────────────────────────────────────
// Public OData endpoint, no key required.
// Docs: https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/aplicacao
// Window query returns the last N business days of PTAX bulletins; we
// take the most recent row and expose its `cotacaoVenda` (ask) as the
// canonical PTAX, plus compra (bid), boletim type, and timestamp.

function fmtBCBDate(d) {
  // BCB requires MM-DD-YYYY surrounded by single-quotes.
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}-${d.getFullYear()}`;
}

async function fetchPtax(currencyVsBRL) {
  const cur = currencyVsBRL.toUpperCase();
  if (!PTAX_CURRENCIES.has(cur)) return null;

  const ck = `ptax:${cur}`;
  const cached = cget(ck);
  if (cached) return cached;

  // Pull last 10 calendar days so we survive weekends/holidays.
  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 86400 * 1000);
  const start = fmtBCBDate(tenDaysAgo);
  const end = fmtBCBDate(now);

  const url =
    `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` +
    `CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@moeda='${cur}'&@dataInicial='${start}'&@dataFinalCotacao='${end}'&$format=json`;

  try {
    const res = await fetch(url, { timeout: 6000 });
    if (!res.ok) {
      logger?.warn?.('fxProvider', `BCB PTAX ${cur} http ${res.status}`);
      return null;
    }
    const data = await res.json();
    const rows = Array.isArray(data?.value) ? data.value : [];
    if (rows.length === 0) return null;
    const last = rows[rows.length - 1];

    const result = {
      currency: cur,
      pair: `${cur}/BRL`,
      bid: Number(last.cotacaoCompra) || null,   // compra (buy)
      ask: Number(last.cotacaoVenda) || null,    // venda (sell) — canonical PTAX
      mid: null,
      bulletin: last.tipoBoletim || null,        // "Fechamento" = closing PTAX
      asOf: last.dataHoraCotacao || null,
      source: 'BCB PTAX',
    };
    if (result.bid != null && result.ask != null) {
      result.mid = +((result.bid + result.ask) / 2).toFixed(6);
    }
    cset(ck, result, TTL.ptax);
    return result;
  } catch (e) {
    logger?.warn?.('fxProvider', `BCB PTAX ${cur} failed: ${e.message}`);
    return null;
  }
}

// ── Twelve Data live FX ──────────────────────────────────────────────
async function fetchTwelveDataFx(base, quote) {
  if (!process.env.TWELVEDATA_API_KEY) return null;

  const ck = `td:fx:${base}${quote}`;
  const cached = cget(ck);
  if (cached) return cached;

  const symbol = `${base}/${quote}`;
  const url =
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}` +
    `&apikey=${process.env.TWELVEDATA_API_KEY}`;

  try {
    const res = await fetch(url, { timeout: 5000 });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.status === 'error' || !data?.close) return null;

    const price = parseFloat(data.close) || parseFloat(data.previous_close) || null;
    if (price == null) return null;

    const result = {
      pair: symbol,
      price,
      open: parseFloat(data.open) || null,
      high: parseFloat(data.high) || null,
      low: parseFloat(data.low) || null,
      prevClose: parseFloat(data.previous_close) || null,
      change: parseFloat(data.change) || null,
      changePct: parseFloat(data.percent_change) || null,
      asOf: data.datetime || new Date().toISOString(),
      source: 'Twelve Data (live)',
    };
    cset(ck, result, TTL.live);
    return result;
  } catch (e) {
    logger?.warn?.('fxProvider', `Twelve Data FX ${base}${quote} failed: ${e.message}`);
    return null;
  }
}

// ── Yahoo FX fallback ────────────────────────────────────────────────
async function fetchYahooFx(base, quote) {
  const ck = `yf:fx:${base}${quote}`;
  const cached = cget(ck);
  if (cached) return cached;

  // Yahoo FX symbols: EURUSD=X, USDJPY=X, USDBRL=X
  const symbol = `${base}${quote}=X`;
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;

  try {
    const res = await fetch(url, {
      timeout: 5000,
      headers: {
        // Yahoo often 403s empty UA
        'User-Agent': 'Mozilla/5.0 (compatible; Particle/1.0)',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const q = data?.quoteResponse?.result?.[0];
    if (!q || q.regularMarketPrice == null) return null;

    const result = {
      pair: `${base}/${quote}`,
      price: q.regularMarketPrice,
      open: q.regularMarketOpen ?? null,
      high: q.regularMarketDayHigh ?? null,
      low: q.regularMarketDayLow ?? null,
      prevClose: q.regularMarketPreviousClose ?? null,
      change: q.regularMarketChange ?? null,
      changePct: q.regularMarketChangePercent ?? null,
      asOf: q.regularMarketTime
        ? new Date(q.regularMarketTime * 1000).toISOString()
        : new Date().toISOString(),
      source: 'Yahoo Finance (live)',
    };
    cset(ck, result, TTL.live);
    return result;
  } catch (e) {
    logger?.warn?.('fxProvider', `Yahoo FX ${base}${quote} failed: ${e.message}`);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────
/**
 * getFxQuote(pairInput)
 *
 * Returns a composite response:
 *   {
 *     pair: "USD/BRL", base, quote,
 *     live:   { source, price, change, changePct, asOf, ... } | null,
 *     ptax:   { source, bulletin, bid, ask, mid, asOf } | null,
 *     note?:  "PTAX is the official BCB closing rate; live is Twelve Data."
 *   }
 *
 * At least one of `live` or `ptax` will be populated on success. If
 * neither can be fetched, returns { error }.
 */
async function getFxQuote(pairInput) {
  const parsed = parsePair(pairInput);
  if (!parsed) {
    return { error: `Unrecognised FX pair: "${pairInput}". Use ISO-4217 codes like USDBRL, EUR/USD.` };
  }
  const { base, quote } = parsed;

  const isBrlPair = base === 'BRL' || quote === 'BRL';
  const liveTasks = [fetchTwelveDataFx(base, quote), fetchYahooFx(base, quote)];

  // For BRL pairs, pull PTAX in parallel. PTAX is always quoted vs BRL so if
  // the user asked EURBRL we fetch PTAX(EUR); if they asked BRLUSD we fetch
  // PTAX(USD) and flag that we inverted it.
  let ptaxPromise = null;
  let ptaxInverted = false;
  if (isBrlPair) {
    const foreign = base === 'BRL' ? quote : base;
    ptaxPromise = fetchPtax(foreign);
    ptaxInverted = base === 'BRL'; // BRL/USD means we invert the USD→BRL PTAX
  }

  const [tdRes, yfRes, ptaxRes] = await Promise.all([
    ...liveTasks,
    ptaxPromise || Promise.resolve(null),
  ]);

  const live = tdRes || yfRes || null;

  let ptax = null;
  if (ptaxRes) {
    if (!ptaxInverted) {
      ptax = { ...ptaxRes, pair: `${base}/${quote}` };
    } else {
      // Invert: BRL/USD = 1 / USD/BRL
      ptax = {
        currency: ptaxRes.currency,
        pair: `${base}/${quote}`,
        bid: ptaxRes.ask ? +(1 / ptaxRes.ask).toFixed(6) : null,  // inverse of ask
        ask: ptaxRes.bid ? +(1 / ptaxRes.bid).toFixed(6) : null,
        mid: ptaxRes.mid ? +(1 / ptaxRes.mid).toFixed(6) : null,
        bulletin: ptaxRes.bulletin,
        asOf: ptaxRes.asOf,
        source: 'BCB PTAX (inverted)',
        note: `Quoted as ${base}/${quote}, inverted from official ${ptaxRes.pair}.`,
      };
    }
  }

  if (!live && !ptax) {
    return {
      pair: pairLabel(base, quote), base, quote,
      error: 'No FX data available from Twelve Data, Yahoo, or BCB.',
    };
  }

  const out = {
    pair: pairLabel(base, quote),
    base, quote,
    live,
    ptax,
  };
  if (isBrlPair) {
    out.note =
      'PTAX is the official BCB rate (updated a few times per day, with a final closing print at end of day). ' +
      'Live is the intraday market mid from Twelve Data or Yahoo. They will differ — PTAX lags the market.';
  }
  return out;
}

/**
 * Convenience: list the PTAX currencies the provider can return.
 */
function supportedPtaxCurrencies() {
  return Array.from(PTAX_CURRENCIES);
}

module.exports = {
  getFxQuote,
  parsePair,
  supportedPtaxCurrencies,
  // internals for testing
  _internal: { fetchPtax, fetchTwelveDataFx, fetchYahooFx },
};
