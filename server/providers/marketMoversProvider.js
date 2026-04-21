/**
 * providers/marketMoversProvider.js
 *
 * Top movers (gainers / losers / most-active) for US equities.
 *
 * Why this exists
 * ---------------
 * Before this module, "rank the top 5 S&P500 gainers today" had no wired
 * tool — the AI either hallucinated a list from training data or declined.
 * The audit called this a P1 gap worth +0.5 on the CIO rating. Polygon
 * already exposes the raw data we need through the snapshot endpoints and
 * we already pay for that key; this provider is a thin, cached wrapper so
 * the toolbox can expose it to the model as `list_market_movers`.
 *
 * Coverage
 * --------
 *   - US equities only (Polygon's /v2/snapshot/locale/us/markets/stocks/*).
 *   - "gainers" / "losers" → native endpoints, cheap, already used by the
 *     /market/movers/:direction route.
 *   - "actives" → not a native Polygon direction, so we pull the full
 *     snapshot and sort by session volume. Heavier — cached 2 minutes.
 *
 * Output shape:
 *   {
 *     direction: 'gainers' | 'losers' | 'actives',
 *     count: number,
 *     movers: [
 *       { symbol, price, change, changePct, volume, prevClose? },
 *       ...
 *     ],
 *     source: 'polygon',
 *     asOf: ISO-8601,
 *     coverage_note?: string   // present for markets we DON'T cover
 *   }
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

// ── Config ───────────────────────────────────────────────────────────
const POLYGON_BASE = 'https://api.polygon.io';
function apiKey() { return process.env.POLYGON_API_KEY; }

// ── Cache ────────────────────────────────────────────────────────────
// Movers shift minute-to-minute but our users don't need tick-level
// precision for "rank today's top 5" — a short cache avoids hammering
// Polygon during chatty sessions.
const _cache = new Map();
const TTL_MS = {
  gainers: 60 * 1000,
  losers:  60 * 1000,
  actives: 2 * 60 * 1000,
};
function cget(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cset(k, v, ttl) { _cache.set(k, { v, exp: Date.now() + ttl }); }

// ── Helpers ──────────────────────────────────────────────────────────
function isConfigured() { return !!apiKey(); }

async function polyFetch(path) {
  const key = apiKey();
  if (!key) throw new Error('POLYGON_API_KEY not configured');
  const sep = path.includes('?') ? '&' : '?';
  const url = `${POLYGON_BASE}${path}${sep}apiKey=${key}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`polygon ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Shape a single Polygon snapshot ticker into our canonical row.
// Polygon's gainers/losers payload nests current session data under
// `day`, and lastTrade holds the most recent trade. Be tolerant of
// either being absent.
function normalizeRow(t) {
  const price = (t?.day?.c != null ? t.day.c : null)
             ?? (t?.lastTrade?.p != null ? t.lastTrade.p : null);
  return {
    symbol:    t?.ticker || null,
    price,
    change:    t?.todaysChange ?? null,
    changePct: t?.todaysChangePerc ?? null,
    volume:    t?.day?.v ?? null,
    prevClose: t?.prevDay?.c ?? null,
  };
}

// ── Native gainers / losers ──────────────────────────────────────────
async function fetchNativeDirection(direction) {
  const raw = await polyFetch(
    `/v2/snapshot/locale/us/markets/stocks/${direction}`,
  );
  const tickers = Array.isArray(raw?.tickers) ? raw.tickers : [];
  return tickers.map(normalizeRow).filter(r => r.symbol);
}

// ── Actives (by session volume) ──────────────────────────────────────
// Polygon has no "actives" endpoint, so pull the full snapshot and sort
// descending by `day.v`. The full snapshot is large (~8000 tickers) so
// we cache aggressively.
async function fetchActives() {
  const raw = await polyFetch(`/v2/snapshot/locale/us/markets/stocks/tickers`);
  const tickers = Array.isArray(raw?.tickers) ? raw.tickers : [];
  return tickers
    .map(normalizeRow)
    .filter(r => r.symbol && r.volume != null)
    .sort((a, b) => (b.volume || 0) - (a.volume || 0));
}

// ── Public API ───────────────────────────────────────────────────────
/**
 * Get the top N movers in a given direction for US equities.
 *
 * @param {Object} opts
 * @param {'gainers'|'losers'|'actives'} opts.direction
 * @param {number} [opts.limit=10]  1..50
 * @param {string} [opts.market='US']  Only 'US' supported today; others
 *   return a coverage_note instead of throwing so the AI can narrate the
 *   gap without refusing the whole query.
 */
async function getMarketMovers({ direction = 'gainers', limit = 10, market = 'US' } = {}) {
  const dir = String(direction).toLowerCase();
  if (!['gainers', 'losers', 'actives'].includes(dir)) {
    return {
      direction: dir,
      movers: [],
      count: 0,
      coverage_note: `Unsupported direction "${direction}". Use gainers | losers | actives.`,
    };
  }

  const mk = String(market || 'US').toUpperCase();
  if (mk !== 'US') {
    // Explicit declared gap — the audit called this out for B3, HK, etc.
    // Don't let the model fake it.
    return {
      direction: dir,
      market: mk,
      movers: [],
      count: 0,
      coverage_note:
        `Market movers are only wired for US equities today. ` +
        `${mk} coverage (B3, HK, SHSE, SZSE, Nifty) is not in the terminal ` +
        `— tell the user plainly rather than guessing.`,
    };
  }

  if (!isConfigured()) {
    return {
      direction: dir,
      movers: [],
      count: 0,
      error: 'POLYGON_API_KEY not configured',
    };
  }

  const cap = Math.max(1, Math.min(50, Number(limit) || 10));
  const cacheKey = `movers:${dir}`;

  let rows = cget(cacheKey);
  if (!rows) {
    try {
      rows = dir === 'actives'
        ? await fetchActives()
        : await fetchNativeDirection(dir);
      cset(cacheKey, rows, TTL_MS[dir]);
    } catch (e) {
      logger.warn('marketMoversProvider', 'fetch failed', {
        direction: dir, error: e.message,
      });
      return { direction: dir, movers: [], count: 0, error: e.message };
    }
  }

  const sliced = (rows || []).slice(0, cap);
  return {
    direction: dir,
    market: 'US',
    count: sliced.length,
    movers: sliced,
    source: 'polygon',
    asOf: new Date().toISOString(),
  };
}

module.exports = {
  getMarketMovers,
  isConfigured,
  // test hook
  _normalizeRow: normalizeRow,
};
