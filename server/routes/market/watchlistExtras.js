/**
 * routes/market/watchlistExtras.js — H2b item 3: watchlist depth columns.
 *
 *   GET /market/next-earnings?symbols=AAPL,MSFT   — next earnings date per symbol
 *   GET /market/rec-trends?symbols=AAPL,MSFT      — analyst recommendation trend
 *
 * Both are Finnhub-backed batch endpoints for the WatchlistPanel's
 * optional EARN / REC columns:
 *   next-earnings — services/earnings.getEarningsForTicker (Finnhub
 *                   /calendar/earnings, ±30d window, 1h provider cache).
 *   rec-trends    — Finnhub /stock/recommendation (latest month row).
 *
 * Contracts (both):
 *   { ok: true, configured: boolean, source: 'finnhub',
 *     data: { SYM: {...} | null }, asOf: ISO-8601 }
 *
 * When FINNHUB_API_KEY is missing → ok:true, configured:false, data
 * all-null; the client renders "—" instead of erroring. Route responses
 * cached 12h per symbol set (earnings/recs move on daily cadence at most).
 * Per-symbol failures land as null — never fail the batch.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const fetch   = require('node-fetch');
const { cacheGet, cacheSet } = require('./lib/cache');
const { sendError } = require('./lib/providers');
const logger = require('../../utils/logger');

const TTL_12H = 12 * 60 * 60 * 1000;
const MAX_SYMBOLS = 30;
const SYMBOL_RE = /^[A-Z0-9.^=-]{1,15}$/;

function parseSymbols(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const seen = new Set();
  const out = [];
  for (const part of raw.split(',')) {
    const s = part.trim().toUpperCase();
    if (!s || !SYMBOL_RE.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out.length ? out : null;
}

function finnhubConfigured() {
  return !!process.env.FINNHUB_API_KEY;
}

// ── GET /market/next-earnings ────────────────────────────────────────
router.get('/market/next-earnings', async (req, res) => {
  try {
    const symbols = parseSymbols(req.query.symbols);
    if (!symbols) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'symbols query param required (comma-separated)' });
    }

    if (!finnhubConfigured()) {
      return res.json({
        ok: true, configured: false, source: 'finnhub',
        data: Object.fromEntries(symbols.map(s => [s, null])),
        asOf: new Date().toISOString(),
      });
    }

    const ck = `wl:next-earnings:${symbols.slice().sort().join(',')}`;
    const cached = cacheGet(ck);
    if (cached) return res.json(cached);

    const { getEarningsForTicker } = require('../../services/earnings');
    const settled = await Promise.allSettled(symbols.map(s => getEarningsForTicker(s)));

    const data = {};
    symbols.forEach((sym, i) => {
      const r = settled[i].status === 'fulfilled' ? settled[i].value : null;
      data[sym] = r && r.nextEarningsDate
        ? { date: r.nextEarningsDate, daysUntil: r.daysUntilEarnings ?? null }
        : null;
    });

    const resp = { ok: true, configured: true, source: 'finnhub', data, asOf: new Date().toISOString() };
    cacheSet(ck, resp, TTL_12H);
    return res.json(resp);
  } catch (e) {
    logger.error('watchlistExtras', `GET /market/next-earnings error: ${e.message}`);
    sendError(res, e, '/market/next-earnings');
  }
});

// ── GET /market/rec-trends ───────────────────────────────────────────
// Finnhub /stock/recommendation returns monthly rows sorted most recent
// first: [{ period, strongBuy, buy, hold, sell, strongSell }, ...].
async function fetchRecTrend(symbol) {
  const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`finnhub ${r.status}`);
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const latest = rows[0];
    const buy  = (latest.strongBuy || 0) + (latest.buy || 0);
    const hold = latest.hold || 0;
    const sell = (latest.sell || 0) + (latest.strongSell || 0);
    if (buy + hold + sell === 0) return null;
    return {
      period: latest.period || null,
      buy, hold, sell,
      strongBuy:  latest.strongBuy  || 0,
      strongSell: latest.strongSell || 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

router.get('/market/rec-trends', async (req, res) => {
  try {
    const symbols = parseSymbols(req.query.symbols);
    if (!symbols) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'symbols query param required (comma-separated)' });
    }

    if (!finnhubConfigured()) {
      return res.json({
        ok: true, configured: false, source: 'finnhub',
        data: Object.fromEntries(symbols.map(s => [s, null])),
        asOf: new Date().toISOString(),
      });
    }

    const ck = `wl:rec-trends:${symbols.slice().sort().join(',')}`;
    const cached = cacheGet(ck);
    if (cached) return res.json(cached);

    const settled = await Promise.allSettled(symbols.map(s => fetchRecTrend(s)));
    const data = {};
    symbols.forEach((sym, i) => {
      data[sym] = settled[i].status === 'fulfilled' ? settled[i].value : null;
    });

    const resp = { ok: true, configured: true, source: 'finnhub', data, asOf: new Date().toISOString() };
    cacheSet(ck, resp, TTL_12H);
    return res.json(resp);
  } catch (e) {
    logger.error('watchlistExtras', `GET /market/rec-trends error: ${e.message}`);
    sendError(res, e, '/market/rec-trends');
  }
});

module.exports = router;
