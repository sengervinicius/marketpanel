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
  breadth: 2 * 60 * 1000, // H2b — aligned with actives (same snapshot pull)
  lastSession: 30 * 60 * 1000, // Polish W2 — grouped-aggs fallback, session is over
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
//
// Data-quality fix: Polygon zeroes `day.c` outside regular hours (and
// truncated sub-$1 prices then rendered as "0.00" in the client). Treat
// 0 / negative as missing and walk a fallback chain: last trade → last
// minute bar → prevClose + todaysChange.
function firstPositive(...vals) {
  for (const v of vals) {
    if (v != null && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

function normalizeRow(t) {
  const reconstructed = (t?.prevDay?.c != null && t?.todaysChange != null)
    ? t.prevDay.c + t.todaysChange
    : null;
  const price = firstPositive(t?.day?.c, t?.lastTrade?.p, t?.min?.c, reconstructed);
  return {
    symbol:    t?.ticker || null,
    price,
    change:    t?.todaysChange ?? null,
    changePct: t?.todaysChangePerc ?? null,
    volume:    t?.day?.v ?? null,
    prevClose: t?.prevDay?.c ?? null,
  };
}

// ── Quality filters (institutional-grade universe) ───────────────────
// The raw Polygon snapshot universe is dominated by illiquid penny-stock
// pump junk (sub-$1 names printing +400% on a few thousand dollars of
// volume). Filter BEFORE ranking so the panel shows names an institution
// can actually trade:
//   - price >= $5
//   - day dollar-volume (price * volume) >= $50M (gainers/losers)
//     or >= $100M (actives)
//   - prevClose must exist and be > 0 (no ghosts / fresh listings with
//     broken reference data)
// Bypass with quality: 'all' (exposed as ?quality=all on the route).
const QUALITY = {
  minPrice: 5,
  minDollarVolume: {
    gainers: 50e6,
    losers:  50e6,
    actives: 100e6,
  },
};

function passesQuality(row, direction) {
  if (row.price == null || !Number.isFinite(row.price) || row.price < QUALITY.minPrice) return false;
  if (row.prevClose == null || !Number.isFinite(row.prevClose) || row.prevClose <= 0) return false;
  if (row.volume == null || !Number.isFinite(row.volume)) return false;
  const minDv = QUALITY.minDollarVolume[direction] ?? QUALITY.minDollarVolume.gainers;
  return (row.price * row.volume) >= minDv;
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
  const rows = tickers.map(normalizeRow).filter(r => r.symbol);

  // H2b — the full snapshot (~8k tickers) used to be discarded after the
  // volume sort. Compute market breadth here, while we have it, and cache
  // it on the same cadence so /market/breadth never triggers a second
  // full-snapshot pull inside the actives window.
  cset('breadth', {
    ...computeBreadth(rows),
    source: 'polygon',
    asOf: new Date().toISOString(),
  }, TTL_MS.breadth);

  return rows
    .filter(r => r.volume != null)
    .sort((a, b) => (b.volume || 0) - (a.volume || 0));
}

// ── Market breadth (H2b) ─────────────────────────────────────────────
// Advancers / decliners / unchanged from todaysChangePerc, plus the
// share of tickers trading above previous close. Rows lacking the
// relevant fields are excluded from that specific ratio (not zeroed).
function computeBreadth(rows) {
  let advancers = 0, decliners = 0, unchanged = 0;
  let above = 0, withPrev = 0;
  for (const r of rows) {
    if (r.changePct != null) {
      if (r.changePct > 0) advancers++;
      else if (r.changePct < 0) decliners++;
      else unchanged++;
    }
    if (r.price != null && r.prevClose != null) {
      withPrev++;
      if (r.price > r.prevClose) above++;
    }
  }
  const total = advancers + decliners + unchanged;
  return {
    advancers,
    decliners,
    unchanged,
    total,
    pctAdvancers:      total > 0    ? parseFloat((advancers / total * 100).toFixed(1)) : null,
    pctAbovePrevClose: withPrev > 0 ? parseFloat((above / withPrev * 100).toFixed(1))  : null,
    sample: rows.length,
  };
}

/**
 * Get market breadth for US equities (H2b).
 * Piggybacks on the actives full-snapshot pull; cache aligned (2 min).
 * Returns { advancers, decliners, unchanged, total, pctAdvancers,
 * pctAbovePrevClose, sample, source, asOf } or { error } when Polygon is
 * unconfigured / down.
 */
async function getMarketBreadth() {
  const cached = cget('breadth');
  if (cached) return cached;

  if (!isConfigured()) {
    return { error: 'POLYGON_API_KEY not configured' };
  }

  try {
    const rows = await fetchActives(); // side effect: csets 'breadth'
    cset('movers:actives', rows, TTL_MS.actives); // don't waste the pull
    return cget('breadth') || { error: 'breadth computation failed' };
  } catch (e) {
    logger.warn('marketMoversProvider', 'breadth fetch failed', { error: e.message });
    return { error: e.message };
  }
}

// ── Last-session fallback (Polish W2 item 4) ─────────────────────────
// Outside US RTH Polygon zeroes the live snapshot's day.* fields, the
// quality gate then drops every row and the home panel sat on NO DATA
// all evening / weekend. When the live pull yields zero eligible rows,
// serve the last COMPLETED session instead: grouped daily aggs for the
// two most recent trading days give close-over-close change + session
// volume for the whole tape. Tagged { session:'last', sessionLabel }.

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function isoDateInET(now = new Date()) {
  // en-CA gives YYYY-MM-DD directly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}
function shiftIsoDate(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function isoWeekday(iso) { return new Date(`${iso}T12:00:00Z`).getUTCDay(); }

async function fetchGroupedDay(date) {
  const raw = await polyFetch(`/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`);
  return Array.isArray(raw?.results) ? raw.results : [];
}

// Resolve the two most recent completed trading days (skips weekends and
// empty holiday tapes) and build canonical rows with close-over-close
// change. Cached 30 min — the session it describes is immutable.
async function fetchLastSessionRows() {
  const cached = cget('movers:lastSession');
  if (cached) return cached;

  let date = isoDateInET();
  const days = [];
  for (let i = 0; i < 10 && days.length < 2; i++) {
    date = shiftIsoDate(date, -1);
    const dow = isoWeekday(date);
    if (dow === 0 || dow === 6) continue;
    const results = await fetchGroupedDay(date);
    if (results.length) days.push({ date, results });
  }
  if (days.length < 2) throw new Error('grouped daily aggs unavailable for last session');

  const [last, prior] = days;
  const prevClose = new Map();
  for (const r of prior.results) {
    if (r.T && Number.isFinite(r.c) && r.c > 0) prevClose.set(r.T, r.c);
  }

  const rows = [];
  for (const r of last.results) {
    const pc = prevClose.get(r.T);
    if (!r.T || !Number.isFinite(r.c) || r.c <= 0 || !pc) continue;
    rows.push({
      symbol:    r.T,
      price:     r.c,
      change:    parseFloat((r.c - pc).toFixed(4)),
      changePct: parseFloat((((r.c - pc) / pc) * 100).toFixed(2)),
      volume:    Number.isFinite(r.v) ? r.v : null,
      prevClose: pc,
    });
  }

  const payload = {
    date: last.date,
    label: `LAST SESSION · ${DOW[isoWeekday(last.date)]}`,
    rows,
  };
  cset('movers:lastSession', payload, TTL_MS.lastSession);
  return payload;
}

function rankByDirection(rows, dir) {
  if (dir === 'actives') {
    return rows.filter(r => r.volume != null).sort((a, b) => (b.volume || 0) - (a.volume || 0));
  }
  return rows
    .filter(r => r.changePct != null)
    .sort((a, b) => (dir === 'losers' ? a.changePct - b.changePct : b.changePct - a.changePct));
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
async function getMarketMovers({ direction = 'gainers', limit = 10, market = 'US', quality = 'strict' } = {}) {
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

  // Quality gate — raw rows are cached unfiltered so ?quality=all shares
  // the same snapshot pull; filtering is applied per request.
  const strict = String(quality).toLowerCase() !== 'all';
  let eligible = strict
    ? (rows || []).filter(r => passesQuality(r, dir))
    : (rows || []);

  // Session-aware fallback (Polish W2 item 4): a healthy live pull that
  // yields ZERO eligible rows means the session snapshot is reset/zeroed
  // (overnight, weekend, holiday) — serve last completed session instead.
  let session = 'live';
  let sessionLabel = null;
  let asOf = new Date().toISOString();
  if (eligible.length === 0) {
    try {
      const lastSess = await fetchLastSessionRows();
      const ranked = rankByDirection(lastSess.rows, dir);
      const gated = strict ? ranked.filter(r => passesQuality(r, dir)) : ranked;
      if (gated.length) {
        eligible = gated;
        session = 'last';
        sessionLabel = lastSess.label;
        asOf = `${lastSess.date}T21:00:00.000Z`; // US close of that session
      }
    } catch (e) {
      logger.warn('marketMoversProvider', 'last-session fallback failed', {
        direction: dir, error: e.message,
      });
    }
  }

  const sliced = eligible.slice(0, cap);
  return {
    direction: dir,
    market: 'US',
    count: sliced.length,
    movers: sliced,
    quality: strict ? 'strict' : 'all',
    ...(strict ? {
      filters: {
        minPrice: QUALITY.minPrice,
        minDollarVolume: QUALITY.minDollarVolume[dir] ?? QUALITY.minDollarVolume.gainers,
      },
    } : {}),
    session,
    ...(sessionLabel ? { sessionLabel } : {}),
    source: 'polygon',
    asOf,
  };
}

module.exports = {
  getMarketMovers,
  getMarketBreadth,
  isConfigured,
  // test hooks
  _normalizeRow: normalizeRow,
  _passesQuality: passesQuality,
  _QUALITY: QUALITY,
  _fetchLastSessionRows: fetchLastSessionRows,
  _rankByDirection: rankByDirection,
};
