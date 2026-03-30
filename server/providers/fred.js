/**
 * providers/fred.js
 *
 * Federal Reserve Economic Data (FRED) — free public API.
 * https://fred.stlouisfed.org/docs/api/fred/
 *
 * No API key required for the CSV endpoint.
 * Optional: set FRED_API_KEY env var for JSON API (higher rate limits).
 *
 * Data updates: once per business day (5 PM ET).
 * Cache TTL: 30 minutes (safe for intraday use).
 *
 * Series used:
 *   US Treasury curve:  DGS1MO DGS3MO DGS6MO DGS1 DGS2 DGS5 DGS7 DGS10 DGS20 DGS30
 *   US credit spreads:  BAMLH0A0HYM2 (HY OAS), BAMLC0A0CM (IG OAS)
 *   Euro credit spreads:BAMLHE00EHYIOAS (Euro HY), BAMLHE4BHEC4OAS (Euro IG)
 *   EM spreads:         BAMLEMCBPIOAS
 *   US curve spreads:   T10Y2Y (10Y-2Y), T10Y3M (10Y-3M)
 */

const fetch = require('node-fetch');

const CSV_BASE  = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const JSON_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const TIMEOUT_MS = 8000;

function fredKey() {
  return process.env.FRED_API_KEY || null;
}

// ── Cache ─────────────────────────────────────────────────────────────────────
const _cache = new Map();
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v, ttlMs) {
  _cache.set(k, { v, exp: Date.now() + ttlMs });
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch via FRED JSON API (requires API key or uses public rate-limited endpoint)
 */
async function fetchJson(seriesId) {
  const apiKey = fredKey();
  const url = apiKey
    ? `${JSON_BASE}?series_id=${seriesId}&file_type=json&sort_order=desc&limit=10&api_key=${apiKey}`
    : `${JSON_BASE}?series_id=${seriesId}&file_type=json&sort_order=desc&limit=10&api_key=abcdefghijklmnopqrstuvwxyz123456`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // Find most recent non-"." value
    const obs = (json?.observations ?? []).find(o => o.value !== '.');
    return obs ? parseFloat(obs.value) : null;
  } catch (e) {
    throw new Error(`[FRED JSON] ${seriesId}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch via FRED public CSV endpoint (no auth required, but limited rate).
 * CSV format: DATE,VALUE\n2024-01-01,4.25\n...
 */
async function fetchCsv(seriesId) {
  const url = `${CSV_BASE}?id=${seriesId}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // Parse CSV: skip header, find last non-empty value
    const lines = text.trim().split('\n').slice(1); // skip header row
    // Iterate from last to first to find most recent non-"." value
    for (let i = lines.length - 1; i >= 0; i--) {
      const parts = lines[i].split(',');
      if (parts.length >= 2 && parts[1] !== '.' && parts[1].trim() !== '') {
        const val = parseFloat(parts[1]);
        if (!isNaN(val)) return val;
      }
    }
    return null;
  } catch (e) {
    throw new Error(`[FRED CSV] ${seriesId}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a FRED series — uses JSON API if key available, else CSV
 */
async function fetchSeries(seriesId) {
  const ck = `fred:${seriesId}`;
  const cached = cacheGet(ck);
  if (cached !== null) return cached;

  try {
    const val = fredKey()
      ? await fetchJson(seriesId)
      : await fetchCsv(seriesId);
    if (val !== null) cacheSet(ck, val, TTL_MS);
    return val;
  } catch (e) {
    console.warn('[FRED]', e.message);
    return null;
  }
}

/**
 * Fetch multiple FRED series in parallel.
 * Returns { [seriesId]: value (number|null) }
 */
async function fetchMultiple(seriesIds) {
  const ck = `fred:multi:${seriesIds.join(',')}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const results = await Promise.all(seriesIds.map(id => fetchSeries(id)));
  const out = {};
  seriesIds.forEach((id, i) => { out[id] = results[i]; });
  cacheSet(ck, out, TTL_MS);
  return out;
}

// ── High-level helpers ────────────────────────────────────────────────────────

const US_CURVE_SERIES = {
  '1M':  'DGS1MO',
  '3M':  'DGS3MO',
  '6M':  'DGS6MO',
  '1Y':  'DGS1',
  '2Y':  'DGS2',
  '5Y':  'DGS5',
  '7Y':  'DGS7',
  '10Y': 'DGS10',
  '20Y': 'DGS20',
  '30Y': 'DGS30',
};

const CREDIT_SERIES = {
  // ICE BofA OAS indices (all in basis points)
  'US_HY':  'BAMLH0A0HYM2',       // US High Yield OAS
  'US_IG':  'BAMLC0A0CM',         // US Corporate IG OAS
  'EU_HY':  'BAMLHE00EHYIOAS',    // Euro High Yield OAS
  'EU_IG':  'BAMLHE4BHEC4OAS',    // Euro IG OAS
  'EM':     'BAMLEMCBPIOAS',      // EM Corporate+ OAS
  // Curve spreads (in percentage points, convert × 100 to bps)
  'US_10S2':'T10Y2Y',             // 10Y-2Y (already in %-points)
  'US_10S3M':'T10Y3M',            // 10Y-3M
};

/**
 * Get the full US Treasury yield curve.
 * Returns array: [{ tenor, yield, seriesId }]
 */
async function getUSTreasuryCurve() {
  const ck = 'fred:us_curve';
  const cached = cacheGet(ck);
  if (cached) return cached;

  const seriesIds = Object.values(US_CURVE_SERIES);
  const data = await fetchMultiple(seriesIds);

  const points = Object.entries(US_CURVE_SERIES)
    .map(([tenor, sid]) => ({
      tenor,
      yield: data[sid],
      seriesId: sid,
    }))
    .filter(p => p.yield !== null);

  if (points.length > 0) cacheSet(ck, points, TTL_MS);
  return points;
}

/**
 * Get credit spread indexes.
 * Returns array: [{ id, name, spread, spreadBps, change }]
 */
async function getCreditSpreads() {
  const ck = 'fred:credit_spreads';
  const cached = cacheGet(ck);
  if (cached) return cached;

  const seriesIds = Object.values(CREDIT_SERIES);
  const data = await fetchMultiple(seriesIds);

  const LABELS = {
    'US_HY':   { name: 'US HY OAS',          bpsMultiplier: 1   },
    'US_IG':   { name: 'US IG OAS',           bpsMultiplier: 1   },
    'EU_HY':   { name: 'Euro HY OAS',         bpsMultiplier: 1   },
    'EU_IG':   { name: 'Euro IG OAS',         bpsMultiplier: 1   },
    'EM':      { name: 'EM Corp+ OAS',        bpsMultiplier: 1   },
    'US_10S2': { name: 'US 10Y-2Y Spread',    bpsMultiplier: 100 }, // %-pt → bps
    'US_10S3M':{ name: 'US 10Y-3M Spread',    bpsMultiplier: 100 },
  };

  const spreads = Object.entries(CREDIT_SERIES)
    .map(([id, sid]) => {
      const raw = data[sid];
      if (raw == null) return null;
      const meta = LABELS[id] || { name: id, bpsMultiplier: 1 };
      const bps  = Math.round(raw * meta.bpsMultiplier);
      return {
        id,
        name:       meta.name,
        spread:     bps,
        spreadBps:  true,
        currency:   id.startsWith('EU') ? 'EUR' : id === 'EM' ? 'USD' : 'USD',
        rawValue:   raw,
        seriesId:   sid,
        source:     'fred',
      };
    })
    .filter(Boolean);

  if (spreads.length > 0) cacheSet(ck, spreads, TTL_MS);
  return spreads;
}

/**
 * Get a single series value (generic utility)
 */
async function getValue(seriesId) {
  return fetchSeries(seriesId);
}

module.exports = {
  fetchSeries,
  fetchMultiple,
  getUSTreasuryCurve,
  getCreditSpreads,
  getValue,
  US_CURVE_SERIES,
  CREDIT_SERIES,
};
