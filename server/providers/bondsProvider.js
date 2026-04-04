/**
 * providers/bondsProvider.js
 * Real bond/yield data provider — Eulerpool PRIMARY, FRED/Treasury/ECB fallbacks.
 *
 * Fallback chain:
 *   1. Eulerpool API (getYieldCurve, getSovereignBonds, getCorpBonds, getBondDetail)
 *   2. FRED CSV (US only — no API key needed, public CSV endpoint)
 *   3. US Treasury XML (daily yield curve)
 *   4. ECB SDW (EU yield curves)
 *   5. Static stubs (last resort, marked stub:true)
 */

'use strict';

const fetch = require('node-fetch');
const euler = require('./eulerpool');

// ── FRED CSV (no API key) ──────────────────────────────────────────────────
// FRED public CSV: https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10
const FRED_SERIES = {
  '1M': 'DGS1MO', '3M': 'DGS3MO', '6M': 'DGS6MO',
  '1Y': 'DGS1', '2Y': 'DGS2', '3Y': 'DGS3',
  '5Y': 'DGS5', '7Y': 'DGS7', '10Y': 'DGS10',
  '20Y': 'DGS20', '30Y': 'DGS30',
};

const _fredCache = new Map();
const FRED_TTL = 600_000; // 10 min

async function fredYield(tenor) {
  const seriesId = FRED_SERIES[tenor];
  if (!seriesId) return null;

  const ck = `fred:${seriesId}`;
  const cached = _fredCache.get(ck);
  if (cached && Date.now() < cached.exp) return cached.v;

  try {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${daysAgo(7)}`;
    const res = await fetch(url, { timeout: 8000 });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split('\n').filter(l => !l.startsWith('DATE'));
    if (lines.length === 0) return null;

    // Parse last two values for change calc
    const last = parseFredLine(lines[lines.length - 1]);
    const prev = lines.length > 1 ? parseFredLine(lines[lines.length - 2]) : null;

    if (last?.value == null) return null;
    const result = {
      yield: last.value,
      change: prev?.value != null ? +(last.value - prev.value).toFixed(3) : null,
      asOf: last.date,
      source: 'FRED',
    };
    _fredCache.set(ck, { v: result, exp: Date.now() + FRED_TTL });
    return result;
  } catch (e) {
    console.warn(`[bondsProvider] FRED ${tenor} failed:`, e.message);
    return null;
  }
}

function parseFredLine(line) {
  const [date, val] = line.split(',');
  const value = parseFloat(val);
  if (isNaN(value) || val === '.') return { date, value: null };
  return { date, value };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── US Treasury XML ──────────────────────────────────────────────────────────
async function treasuryYieldCurve() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${now.getFullYear()}${month}`;

  try {
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) return null;
    const text = await res.text();
    // Simple XML parse — extract latest entry
    const entries = text.split('<entry>').slice(1);
    if (entries.length === 0) return null;
    const latest = entries[entries.length - 1];

    const tenors = ['1M', '2M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'];
    const xmlKeys = ['BC_1MONTH', 'BC_2MONTH', 'BC_3MONTH', 'BC_6MONTH', 'BC_1YEAR', 'BC_2YEAR', 'BC_3YEAR', 'BC_5YEAR', 'BC_7YEAR', 'BC_10YEAR', 'BC_20YEAR', 'BC_30YEAR'];

    const curve = [];
    for (let i = 0; i < tenors.length; i++) {
      const match = latest.match(new RegExp(`<d:${xmlKeys[i]}>([\\d.]+)</d:${xmlKeys[i]}>`));
      if (match) {
        curve.push({ tenor: tenors[i], yield: parseFloat(match[1]) });
      }
    }
    return curve.length > 0 ? { country: 'US', currency: 'USD', curve, source: 'US Treasury' } : null;
  } catch (e) {
    console.warn('[bondsProvider] Treasury XML failed:', e.message);
    return null;
  }
}

// ── ECB yield curve (EU/DE) ──────────────────────────────────────────────────
async function ecbYieldCurve() {
  try {
    const url = 'https://sdw-wsrest.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM?format=jsondata&lastNObservations=1';
    const res = await fetch(url, { timeout: 10000, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();

    const ds = data?.dataSets?.[0]?.series;
    if (!ds) return null;

    const curve = [];
    const dims = data?.structure?.dimensions?.series || [];
    // Extract maturity dimension
    for (const [key, series] of Object.entries(ds)) {
      const obs = series?.observations;
      if (!obs) continue;
      const val = Object.values(obs)?.[0]?.[0];
      if (val == null) continue;
      // Key encodes maturity position
      const parts = key.split(':');
      const matIdx = parseInt(parts[5] || '0');
      const matDim = dims[5]?.values?.[matIdx];
      if (matDim) {
        curve.push({ tenor: matDim.name || matDim.id, yield: parseFloat(val) });
      }
    }
    return curve.length > 0 ? { country: 'EU', currency: 'EUR', curve, source: 'ECB' } : null;
  } catch (e) {
    console.warn('[bondsProvider] ECB yield curve failed:', e.message);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the latest yield for a specific country and tenor.
 * Fallback: Eulerpool → FRED (US) → null
 */
async function getYield(countryCode, tenor) {
  // Try Eulerpool sovereign bonds first
  if (euler.isConfigured()) {
    try {
      const bonds = await euler.getSovereignBonds(countryCode);
      if (Array.isArray(bonds)) {
        const match = bonds.find(b =>
          (b.tenor === tenor || b.maturity === tenor || b.name?.includes(tenor))
        );
        if (match?.yield != null) {
          return {
            yield: match.yield,
            change: match.change ?? null,
            asOf: match.asOf ?? match.date ?? Date.now(),
            source: 'eulerpool',
          };
        }
      }
    } catch (e) {
      console.warn(`[bondsProvider] Eulerpool sovereign failed for ${countryCode} ${tenor}:`, e.message);
    }
  }

  // FRED fallback (US only)
  if (countryCode === 'US') {
    const fred = await fredYield(tenor);
    if (fred) return fred;
  }

  return null;
}

/**
 * Get a full yield curve for a country.
 * Fallback: Eulerpool → FRED/Treasury (US) → ECB (EU) → null
 */
async function getYieldCurve(countryCode) {
  // Try Eulerpool first
  if (euler.isConfigured()) {
    try {
      const data = await euler.getYieldCurve(countryCode);
      if (data?.curve || Array.isArray(data)) {
        return {
          country: countryCode,
          curve: data.curve ?? data,
          source: 'eulerpool',
        };
      }
    } catch (e) {
      console.warn(`[bondsProvider] Eulerpool yield curve failed for ${countryCode}:`, e.message);
    }
  }

  // US fallbacks
  if (countryCode === 'US') {
    // Try Treasury XML
    const treasury = await treasuryYieldCurve();
    if (treasury) return treasury;

    // Try FRED individual series
    const tenors = Object.keys(FRED_SERIES);
    const results = await Promise.allSettled(tenors.map(t => fredYield(t)));
    const curve = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value?.yield != null) {
        curve.push({ tenor: tenors[i], yield: r.value.yield, change: r.value.change });
      }
    });
    if (curve.length > 0) return { country: 'US', currency: 'USD', curve, source: 'FRED' };
  }

  // EU/DE fallback
  if (countryCode === 'EU' || countryCode === 'DE') {
    const ecb = await ecbYieldCurve();
    if (ecb) return ecb;
  }

  return null;
}

/**
 * Get corporate bonds, optionally filtered.
 */
async function getCorpBonds(opts = {}) {
  if (euler.isConfigured()) {
    try {
      return await euler.getCorpBonds(opts);
    } catch (e) {
      console.warn('[bondsProvider] Eulerpool corp bonds failed:', e.message);
    }
  }
  return [];
}

/**
 * Get detailed bond info by ISIN.
 */
async function getBondDetail(isin) {
  if (euler.isConfigured()) {
    try {
      return await euler.getBondDetail(isin);
    } catch (e) {
      console.warn(`[bondsProvider] Eulerpool bond detail failed for ${isin}:`, e.message);
    }
  }
  return null;
}

/**
 * Get sovereign bonds for a country.
 */
async function getSovereignBonds(countryCode) {
  if (euler.isConfigured()) {
    try {
      return await euler.getSovereignBonds(countryCode);
    } catch (e) {
      console.warn(`[bondsProvider] Eulerpool sovereign failed for ${countryCode}:`, e.message);
    }
  }
  return [];
}

module.exports = { getYield, getYieldCurve, getCorpBonds, getBondDetail, getSovereignBonds };
