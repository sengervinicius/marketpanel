/**
 * routes/market/movers.js — H2 Wave 1: Movers home panel endpoint.
 *
 *   GET /market/movers?tab=gainers|losers|actives&exchange=US|BR&limit=20
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
const { getMarketMovers } = require('../../providers/marketMoversProvider');
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
  const ck = 'home-movers:br:rows';
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
  const rows = out.flat()
    .filter(q => q && q.regularMarketPrice != null)
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

  if (rows.length) cacheSet(ck, rows, 60_000);
  return rows;
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

    if (exchange === 'BR') {
      const rows = await fetchBrazilRows();
      const data = sortBrazil(rows, tab).slice(0, limit);
      return res.json({
        ok: true, tab, exchange, count: data.length, data,
        source: 'yahoo', asOf: new Date().toISOString(),
      });
    }

    // US — provider owns caching + Polygon plumbing.
    const result = await getMarketMovers({ direction: tab, limit, market: 'US' });
    const data = (result.movers || []).map(m => ({
      symbol:    m.symbol,
      price:     m.price ?? null,
      change:    m.change ?? null,
      changePct: m.changePct ?? null,
      volume:    m.volume ?? null,
    }));
    return res.json({
      ok: true, tab, exchange, count: data.length, data,
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

module.exports = router;
