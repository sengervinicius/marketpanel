/**
 * routes/market/sectorLookup.js — FEAT-3: per-symbol sector buckets for
 * the watchlist EQUITIES sub-grouping.
 *
 *   GET /market/sectors?symbols=AAPL,JPM,PETR4.SA
 *
 * Provider cascade per symbol:
 *   1. Yahoo quoteSummary assetProfile.sector   (providers/yahooFinance)
 *   2. ".SA" → brapi quote?modules=summaryProfile sector (if available)
 *   3. Finnhub /stock/profile2 finnhubIndustry  (plain US tickers)
 * Raw strings are mapped to GICS-ish buckets; unknown → "Other".
 * Hits cached 7 days, misses 1 hour (transient provider failures retry).
 *
 * Response: { ok, sectors: { SYM: { bucket, raw, source } }, asOf }
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet } = require('./lib/cache');
const { fetch } = require('./lib/providers');
const yahooProfile = require('../../providers/yahooFinance');
const logger = require('../../utils/logger');

const SECTOR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const MISS_TTL_MS   = 60 * 60 * 1000;          // 1h
const MAX_SYMBOLS   = 60;
const CONCURRENCY   = 8;
const SYMBOL_RE     = /^[A-Z0-9.\-^=:]{1,15}$/;

// GICS-ish buckets used by the watchlist sub-headers. Order matters for
// the keyword mapping below (first match wins) — NOT for the response.
const RULES = [
  ['RE',              /real estate|reit/i],
  ['Healthcare',      /health|pharma|biotech|medical|life science|diagnostics|hospital/i],
  ['Tech',            /^tech|technology|software|semiconductor|computer|it services|electronic|internet content|information/i],
  ['Energy',          /energy|oil|gas|coal|pipeline|drilling|petroleum/i],
  ['Utilities',       /utilit|electric power|water supply/i],
  ['Comms',           /communication|telecom|media|entertainment|broadcast|publishing|wireless/i],
  ['Materials',       /material|chemical|mining|metal|steel|paper|packaging|gold|copper/i],
  ['Industrials',     /industrial|aerospace|defense|machinery|airline|air freight|transport|logistic|construction|building|electrical equipment|engineering|railroads?|commercial services/i],
  ['Financials',      /bank|financ|insurance|capital market|asset manage|credit|exchange|brokerage/i],
  ['Retail/Consumer', /retail|consumer|food|beverage|apparel|luxury|restaurant|hotel|leisure|automobile|auto |household|tobacco|textile|department store|e-?commerce|staples|discretionary/i],
];

/**
 * mapSectorToBucket(raw) — pure; maps a Yahoo sector / Finnhub industry /
 * brapi sector string to one of the 11 watchlist buckets.
 */
function mapSectorToBucket(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Other';
  for (const [bucket, re] of RULES) {
    if (re.test(s)) return bucket;
  }
  return 'Other';
}

async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function brapiSector(sym) {
  const t = sym.replace(/\.SA$/i, '');
  const url = new URL(`https://brapi.dev/api/quote/${encodeURIComponent(t)}`);
  url.searchParams.set('modules', 'summaryProfile');
  const tk = process.env.BRAPI_API_KEY || '';
  if (tk) url.searchParams.set('token', tk);
  const r = await fetchWithTimeout(url.toString());
  if (!r.ok) return null;
  const json = await r.json();
  const row = Array.isArray(json.results) ? json.results[0] : null;
  return row?.summaryProfile?.sector || null;
}

async function finnhubIndustry(sym) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) return null;
  const json = await r.json();
  return json?.finnhubIndustry || null;
}

async function lookupOne(sym) {
  const ck = `sector-bucket:v1:${sym}`;
  const hit = cacheGet(ck);
  if (hit) return hit;

  // Non-equity shapes (crypto/FX/commodity prefixes) are never sector-mapped.
  if (/^(X:|C:|I:)/.test(sym) || sym.startsWith('^') || sym.includes('=')) {
    const val = { bucket: 'Other', raw: null, source: 'class' };
    cacheSet(ck, val, SECTOR_TTL_MS);
    return val;
  }

  let raw = null;
  let source = null;
  const isBR = /\.SA$/i.test(sym);

  try {
    const q = await yahooProfile.getQuote(sym);
    if (q && !q.error && q.sector) { raw = q.sector; source = 'yahoo'; }
  } catch (e) { logger.warn('sectorLookup', 'yahoo failed', { sym, error: e.message }); }

  if (!raw && isBR) {
    try {
      const s = await brapiSector(sym);
      if (s) { raw = s; source = 'brapi'; }
    } catch (e) { logger.warn('sectorLookup', 'brapi failed', { sym, error: e.message }); }
  }

  if (!raw && !isBR && !sym.includes('.')) {
    try {
      const s = await finnhubIndustry(sym);
      if (s) { raw = s; source = 'finnhub'; }
    } catch (e) { logger.warn('sectorLookup', 'finnhub failed', { sym, error: e.message }); }
  }

  const val = { bucket: mapSectorToBucket(raw), raw: raw || null, source: raw ? source : null };
  cacheSet(ck, val, raw ? SECTOR_TTL_MS : MISS_TTL_MS);
  return val;
}

router.get('/market/sectors', async (req, res) => {
  const requested = String(req.query.symbols || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  const symbols = [...new Set(requested)].slice(0, MAX_SYMBOLS).filter(s => SYMBOL_RE.test(s));

  if (symbols.length === 0) {
    return res.status(400).json({ ok: false, error: 'symbols query param required (comma-separated, max 60)' });
  }

  const out = {};
  // Small concurrency pool — first hit on a big watchlist fans out to
  // providers; cached lookups (7d) return instantly afterwards.
  let idx = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, async () => {
    while (idx < symbols.length) {
      const sym = symbols[idx++];
      try {
        out[sym] = await lookupOne(sym);
      } catch (e) {
        out[sym] = { bucket: 'Other', raw: null, source: null };
      }
    }
  });
  await Promise.all(workers);

  res.json({ ok: true, sectors: out, asOf: new Date().toISOString() });
});

module.exports = router;
module.exports.mapSectorToBucket = mapSectorToBucket;
