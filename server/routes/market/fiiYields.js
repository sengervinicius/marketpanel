/**
 * routes/market/fiiYields.js — Phase S W1 item 3: FII dividend yields.
 *
 *   GET /market/fii-yields?symbols=HGLG11,KNRI11,...
 *
 * The FII investor's number: trailing DY% per fundo imobiliário, from
 * brapi.dev fundamentals (defaultKeyStatistics.dividendYield). Yahoo
 * carries B3 FII prices but not their yields, so this rides the existing
 * brapi provider credentials (BRAPI_API_KEY, optional — free tier works).
 *
 * Response contract:
 *   { ok: true, source: 'brapi',
 *     data: { 'HGLG11': { dy: 8.9|null, name: 'CSHG Logística ...'|null } },
 *     asOf: ISO-8601 }
 *
 * dy is a PERCENT (8.9 = 8.9%): brapi mirrors Yahoo modules, which serve
 * dividendYield sometimes as a fraction (0.089) and sometimes as a
 * percent (8.9) — values < 1 are normalized to percent. Missing yields
 * stay null (client renders an em-dash).
 *
 * Cached 12h per (sorted) symbol set — trailing yields move monthly.
 * ok:false only on total failure; failures never cached.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet } = require('./lib/cache');
const { fetch } = require('./lib/providers');
const { sanitizeText } = require('../../utils/validate');
const logger = require('../../utils/logger');

const TTL_12H = 12 * 60 * 60 * 1000;
const MAX_SYMBOLS = 20;
const BRAPI_BASE = 'https://brapi.dev/api';
// B3 tickers: 4 letters + 1-2 digits (+ optional fractional suffix). We
// accept the Yahoo-style .SA suffix and strip it — brapi wants bare form.
const B3_TICKER_RE = /^[A-Z]{4}\d{1,2}[A-Z]?$/;

function normalizeSymbols(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const s = part.trim().toUpperCase().replace(/\.SA$/, '');
    if (!s || !B3_TICKER_RE.test(s)) continue;
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

/**
 * dividendYield normalization: percent in, percent out; fraction in
 * (0 < v < 1), percent out. Garbage in, null out.
 */
function normalizeDy(v) {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const pct = v < 1 ? v * 100 : v;
  return pct > 100 ? null : Number(pct.toFixed(2)); // >100% DY = bad data
}

async function fetchBrapiYields(symbols) {
  const url = new URL(`${BRAPI_BASE}/quote/${encodeURIComponent(symbols.join(','))}`);
  url.searchParams.set('modules', 'defaultKeyStatistics');
  const tk = process.env.BRAPI_API_KEY || '';
  if (tk) url.searchParams.set('token', tk);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`brapi HTTP ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json?.results) ? json.results : [];

    const data = {};
    for (const sym of symbols) data[sym] = { dy: null, name: null };
    for (const row of rows) {
      const sym = String(row?.symbol || '').toUpperCase();
      if (!data[sym]) continue;
      data[sym] = {
        dy: normalizeDy(row?.defaultKeyStatistics?.dividendYield ?? row?.dividendYield ?? null),
        name: row?.shortName || row?.longName || null,
      };
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

router.get('/market/fii-yields', async (req, res) => {
  try {
    const symbols = normalizeSymbols(req.query.symbols);
    if (!symbols.length) {
      return res.status(400).json({ ok: false, error: 'symbols query param required (comma-separated B3 tickers)' });
    }
    if (symbols.length > MAX_SYMBOLS) {
      return res.status(400).json({ ok: false, error: `Too many symbols: ${symbols.length} (max ${MAX_SYMBOLS})` });
    }

    const cacheKey = `market:fii-yields:${[...symbols].sort().join(',')}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const data = await fetchBrapiYields(symbols);
    const payload = { ok: true, source: 'brapi', data, asOf: new Date().toISOString() };
    cacheSet(cacheKey, payload, TTL_12H);
    return res.json(payload);
  } catch (e) {
    logger.warn('fiiYields', `GET /market/fii-yields degraded: ${sanitizeText(e.message, 200)}`);
    return res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
// Test hooks
module.exports._normalizeSymbols = normalizeSymbols;
module.exports._normalizeDy = normalizeDy;
module.exports._fetchBrapiYields = fetchBrapiYields;
