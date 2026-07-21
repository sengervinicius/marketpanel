/**
 * routes/market/movers.js — H2 Wave 1: Movers home panel endpoint.
 *
 *   GET /market/movers?tab=gainers|losers|actives&exchange=US|BR&limit=20&quality=strict|all
 *
 *   quality=strict (default) applies institutional-grade universe
 *   filters before ranking (US: price >= $5, day dollar-volume >= $50M
 *   for gainers/losers / >= $100M for actives, prevClose > 0; BR:
 *   price >= 1 BRL). quality=all serves the raw universe.
 *
 * US  — thin HTTP wrapper over providers/marketMoversProvider (Polygon
 *       snapshot gainers/losers/actives). The provider carries its own
 *       cache (60s directions / 2min actives), so this route adds none.
 * BR  — no Polygon coverage for B3; we rank the same universe that
 *       /snapshot/brazil serves (core blue-chips + b3Metadata.json)
 *       by changePct (gainers/losers) or volume (actives) from Yahoo
 *       batch quotes. Raw rows cached 60s here to match the snapshot's
 *       cadence.
 *
 * NOTE: distinct from the legacy GET /market/movers/:direction in
 * data.js (AI toolbox era) — Express matches the exact /market/movers
 * path here before the parameterized route.
 *
 * Response contract:
 *   {
 *     ok: true,
 *     tab: 'gainers' | 'losers' | 'actives',
 *     exchange: 'US' | 'BR',
 *     count: number,
 *     data: [ { symbol, name?, price, change, changePct, volume } ],
 *     source: 'polygon' | 'yahoo',
 *     asOf: ISO-8601,
 *     error?: string            // present when a provider is down/unconfigured
 *   }
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet } = require('./lib/cache');
const { yahooQuote, sendError } = require('./lib/providers');
const { getMarketMovers, getMarketBreadth } = require('../../providers/marketMoversProvider');
const logger = require('../../utils/logger');

const TABS = ['gainers', 'losers', 'actives'];

// ── B3 universe — mirrors stocks.js /snapshot/brazil ─────────────────
const BRAZIL_CORE_TICKERS = [
  'VALE3','PETR4','PETR3','ITUB4','BBDC4','BBAS3',
  'ABEV3','WEGE3','RENT3','RDOR3','B3SA3','EQTL3',
  'CSAN3','PRIO3','BPAC11','HAPV3','CMIG4','VIVT3','BOVA11',
];
let B3_METADATA = {};
try {
  const raw = require('../../data/b3Metadata.json');
  // eslint-disable-next-line no-unused-vars
  const { _schema, ...rest } = raw;
  B3_METADATA = rest || {};
} catch (e) {
  logger.warn('movers', 'b3Metadata.json failed to load: ' + e.message);
}

function buildBrazilUniverse() {
  const set = new Set(BRAZIL_CORE_TICKERS);
  for (const key of Object.keys(B3_METADATA)) set.add(key);
  return Array.from(set);
}

// Fetch + normalize the whole B3 board once, cache 60s; sorting per tab
// happens on the cached rows so switching tabs is free.
async function fetchBrazilRows() {
  const ck = 'home-movers:br:payload';
  const cached = cacheGet(ck);
  if (cached) return cached;

  const universe = buildBrazilUniverse();
  const tickers = universe.map(t => `${t}.SA`);
  const BATCH = 50;
  const batches = [];
  for (let i = 0; i < tickers.length; i += BATCH) {
    batches.push(tickers.slice(i, i + BATCH));
  }
  const out = await Promise.all(batches.map(b => yahooQuote(b.join(','))));
  const quotes = out.flat().filter(q => q && q.regularMarketPrice != null);
  const rows = quotes
    .map(q => {
      const symbol = String(q.symbol || '').replace(/\.SA$/i, '').trim();
      if (!symbol) return null;
      return {
        symbol,
        name:      (q.shortName || q.longName || symbol).substring(0, 18),
        price:     q.regularMarketPrice,
        change:    q.regularMarketChange ?? null,
        changePct: q.regularMarketChangePercent ?? null,
        volume:    q.regularMarketVolume ?? null,
      };
    })
    .filter(Boolean);

  // Polish W2 item 4 — session awareness. Yahoo keeps serving the last
  // session's change%/volume after the B3 close, so the DATA is already
  // "last session" — label it. marketState !== REGULAR on every quote
  // means the exchange is closed; regularMarketTime stamps the session.
  let session = 'live';
  let sessionLabel = null;
  const anyLive = quotes.some(q => String(q.marketState || '').toUpperCase() === 'REGULAR');
  if (!anyLive && rows.length) {
    const t = quotes.map(q => q.regularMarketTime).find(v => Number.isFinite(v) && v > 0);
    if (t) {
      const dow = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo', weekday: 'short',
      }).format(new Date(t * 1000)).toUpperCase();
      session = 'last';
      sessionLabel = `LAST SESSION · ${dow}`;
    }
  }

  const payload = { rows, session, sessionLabel };
  if (rows.length) cacheSet(ck, payload, 60_000);
  return payload;
}

// Data-quality: the B3 universe is already curated (blue-chips +
// b3Metadata), so the only strict-mode gate is price >= 1 BRL — drops
// penny leftovers without needing US-style dollar-volume thresholds.
const BR_MIN_PRICE = 1;

// ── US company names (wave-nov item 1) ───────────────────────────────────
// Polygon snapshot rows carry no company name (see provider
// normalizeRow), so US movers rendered nameless. Resolve names via the
// same Yahoo batch-quote path the BR board uses, memoized process-wide —
// listing names are effectively static, so one quote per symbol per
// process is enough.
const US_NAME_CACHE_MAX = 4000;
const usNameCache = new Map(); // SYMBOL -> name | null (null = known miss)

async function resolveUsNames(symbols) {
  const wanted = Array.from(new Set(
    symbols.map(s => String(s || '').toUpperCase()).filter(Boolean)
  ));
  const missing = wanted.filter(s => !usNameCache.has(s));
  if (missing.length) {
    try {
      const quotes = await yahooQuote(missing.join(','));
      for (const q of quotes || []) {
        if (!q || !q.symbol) continue;
        const name = String(q.shortName || q.longName || '').substring(0, 24).trim() || null;
        usNameCache.set(String(q.symbol).toUpperCase(), name);
      }
      // Cache the misses too (delisted/OTC oddballs) so we don't re-query
      // Yahoo for them on every 60s refresh — but only on a SUCCESSFUL
      // batch; a provider outage must stay retryable.
      for (const s of missing) if (!usNameCache.has(s)) usNameCache.set(s, null);
      if (usNameCache.size > US_NAME_CACHE_MAX) {
        // crude eviction: drop the oldest half (insertion order)
        const keys = Array.from(usNameCache.keys()).slice(0, Math.floor(usNameCache.size / 2));
        for (const k of keys) usNameCache.delete(k);
      }
    } catch (e) {
      logger.warn('movers', 'US movers name resolve failed: ' + e.message);
    }
  }
  const map = {};
  for (const s of wanted) map[s] = usNameCache.get(s) ?? null;
  return map;
}

function sortBrazil(rows, tab) {
  const arr = [...rows];
  if (tab === 'actives') {
    return arr
      .filter(r => r.volume != null)
      .sort((a, b) => (b.volume || 0) - (a.volume || 0));
  }
  const withPct = arr.filter(r => r.changePct != null);
  withPct.sort((a, b) => tab === 'losers'
    ? a.changePct - b.changePct
    : b.changePct - a.changePct);
  return withPct;
}

router.get('/market/movers', async (req, res) => {
  try {
    const tab = TABS.includes(String(req.query.tab || '').toLowerCase())
      ? String(req.query.tab).toLowerCase()
      : 'gainers';
    const exchange = String(req.query.exchange || 'US').toUpperCase() === 'BR' ? 'BR' : 'US';
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
    // ?quality=all bypasses the institutional-grade universe filters
    // (US: price >= $5, dollar-volume >= $50M/$100M; BR: price >= 1 BRL).
    // Default is strict.
    const quality = String(req.query.quality || 'strict').toLowerCase() === 'all' ? 'all' : 'strict';

    if (exchange === 'BR') {
      const { rows, session, sessionLabel } = await fetchBrazilRows();
      const eligible = quality === 'strict'
        ? rows.filter(r => r.price != null && Number.isFinite(r.price) && r.price >= BR_MIN_PRICE)
        : rows;
      const data = sortBrazil(eligible, tab).slice(0, limit);
      return res.json({
        ok: true, tab, exchange, count: data.length, data, quality,
        session: session || 'live',
        ...(sessionLabel ? { sessionLabel } : {}),
        source: 'yahoo', asOf: new Date().toISOString(),
      });
    }

    // US — provider owns caching + Polygon plumbing (incl. quality gate).
    const result = await getMarketMovers({ direction: tab, limit, market: 'US', quality });
    const movers = result.movers || [];
    // wave-nov item 1 — merge company names (Polygon snapshots have none).
    const names = await resolveUsNames(movers.map(m => m.symbol));
    const data = movers.map(m => ({
      symbol:    m.symbol,
      name:      m.name ?? names[String(m.symbol || '').toUpperCase()] ?? null,
      price:     m.price ?? null,
      change:    m.change ?? null,
      changePct: m.changePct ?? null,
      volume:    m.volume ?? null,
    }));
    return res.json({
      ok: true, tab, exchange, count: data.length, data, quality,
      ...(result.filters ? { filters: result.filters } : {}),
      session: result.session || 'live',
      ...(result.sessionLabel ? { sessionLabel: result.sessionLabel } : {}),
      source: result.source || 'polygon',
      asOf: result.asOf || new Date().toISOString(),
      ...(result.error ? { error: result.error } : {}),
      ...(result.coverage_note ? { note: result.coverage_note } : {}),
    });
  } catch (e) {
    logger.error('movers', `GET /market/movers error: ${e.message}`);
    sendError(res, e, '/market/movers');
  }
});

// ── GET /market/breadth — H2b item 2 ─────────────────────────────────
// Advancers / decliners / unchanged / pctAbovePrevClose from the same
// Polygon full-market snapshot the actives tab pulls (provider computes
// and caches breadth on that cadence — 2 min). Degrades to
// { ok:false, error } when Polygon is unconfigured or down.
router.get('/market/breadth', async (req, res) => {
  try {
    const breadth = await getMarketBreadth();
    if (!breadth || breadth.error) {
      return res.json({ ok: false, error: breadth?.error || 'breadth unavailable' });
    }
    return res.json({ ok: true, ...breadth });
  } catch (e) {
    logger.error('movers', `GET /market/breadth error: ${e.message}`);
    sendError(res, e, '/market/breadth');
  }
});

module.exports = router;
