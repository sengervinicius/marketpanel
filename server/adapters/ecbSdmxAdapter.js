/**
 * server/adapters/ecbSdmxAdapter.js
 * ─────────────────────────────────────────────────────────────────────
 * Wave 6 / W6.2 — ECB SDMX adapter for EU sovereign yield curves.
 *
 * Why this adapter:
 *   The ECB Statistical Data Warehouse publishes the daily euro-area
 *   AAA-rated spot-rate zero-coupon curve (dataflow YC) as a public,
 *   no-authentication REST feed. Our `debt.js` route had hard-coded
 *   Yahoo yields for DE/GB/JP that silently fell back to null on the
 *   non-US tenors, and the audit flagged "EU sovereign coverage" as
 *   a gap. This adapter gives the registry a real, provenance-tracked
 *   source for the euro-area curve — the UI can finally render "last
 *   published at <timestamp> from data-api.ecb.europa.eu".
 *
 * Why SDMX-JSON and not CSV:
 *   - SDMX-JSON is the first-class format. CSV/XML still work but
 *     SDMX-JSON keeps dimension metadata alongside observations so we
 *     can trust the maturity labels without hard-coding parsing order.
 *   - Response is stable over years. Schema hasn't shifted since 2018.
 *
 * Dataflow: YC (Euro area yield curves)
 *   Key template: B.U2.EUR.4F.G_N_A.SV_C_YM.SR_{maturity}
 *     B        — daily frequency (business days)
 *     U2       — euro area reference area
 *     EUR      — currency
 *     4F       — financial markets sector
 *     G_N_A    — government, nominal, AAA-rated all-bonds basket
 *     SV_C_YM  — spot rate, per annum yield
 *     SR_{M}   — maturity (e.g. SR_3M, SR_1Y, SR_10Y, SR_30Y)
 *
 *   Full URL:
 *     https://data-api.ecb.europa.eu/service/data/YC/
 *       B.U2.EUR.4F.G_N_A.SV_C_YM.SR_3M+SR_6M+SR_1Y+...SR_30Y
 *     ?lastNObservations=1&format=jsondata
 *
 * Out-of-scope (future work):
 *   - Per-country sovereign curves (DE/FR/IT/ES spreads vs Bund).
 *     ECB's FM dataflow has the raw yields but requires a separate
 *     per-issuer key; W6.2 ships the euro-area curve first so the UI
 *     has at least ONE non-US sovereign source.
 *   - Historical curve pulls (for term-structure charts). This adapter
 *     only returns the most recent observation per maturity.
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

const nodeFetch = require('node-fetch');
const { ok, err, makeProviderError, makeProvenance } = require('./contract');

const NAME = 'ecb-sdmx';
const VERSION = '1.0.0';

// Coverage declaration written into coverage_matrix at boot.
const DECLARATION = Object.freeze({
  name: NAME,
  version: VERSION,
  capabilities: ['curve', 'health'],
  coverageCells: Object.freeze([
    // Euro area aggregate sovereign curve — the only issuer ECB publishes
    // as a ready-made AAA curve. Per-country curves are future work.
    { market: 'EU', assetClass: 'curve', capability: 'curve', confidence: 'high' },
  ]),
  latencyP95TargetMs: 2500,
  // ECB publishes once per business day around 17:15 CET. A 26-hour
  // freshness SLA covers weekends + a generous late-publish buffer.
  freshnessSlaSec: 26 * 3600,
  rateLimit: { requestsPerSec: 5, burst: 10 },
  // No API key required — ECB SDW is open. Listed explicitly so the
  // harness doesn't flag this adapter as "auth-skipped" on fresh boxes.
  requiredEnvVars: [],
});

const BASE_URL = 'https://data-api.ecb.europa.eu';
const DEFAULT_TIMEOUT_MS = 5000;

// Canonical maturity buckets we request. Kept in declaration order so
// the returned curve is monotonic (short → long) without a post-sort.
// SR_ prefix is the ECB DATA_TYPE_FM code for "spot rate".
const MATURITIES = Object.freeze([
  { code: 'SR_3M',  maturity: '3M',  years: 0.25 },
  { code: 'SR_6M',  maturity: '6M',  years: 0.5 },
  { code: 'SR_1Y',  maturity: '1Y',  years: 1 },
  { code: 'SR_2Y',  maturity: '2Y',  years: 2 },
  { code: 'SR_3Y',  maturity: '3Y',  years: 3 },
  { code: 'SR_5Y',  maturity: '5Y',  years: 5 },
  { code: 'SR_7Y',  maturity: '7Y',  years: 7 },
  { code: 'SR_10Y', maturity: '10Y', years: 10 },
  { code: 'SR_20Y', maturity: '20Y', years: 20 },
  { code: 'SR_30Y', maturity: '30Y', years: 30 },
]);

// ── HTTP wrapper ────────────────────────────────────────────────────
// Injectable fetch so tests feed canned SDMX-JSON without monkey-patching
// node-fetch. Default is real node-fetch.
function httpStatusToCode(status) {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500 && status < 600) return 'UPSTREAM_5XX';
  if (status >= 400 && status < 500) return 'UPSTREAM_4XX';
  return 'UNKNOWN';
}

async function ecbFetch(urlPath, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = {}) {
  const fetchFn = fetchImpl || nodeFetch;
  const url = BASE_URL + urlPath;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        // SDMX-JSON has its own content-type that some proxies munge;
        // application/json is the safest Accept header.
        Accept: 'application/json, application/vnd.sdmx.data+json',
      },
    });
    if (!res.ok) {
      const code = httpStatusToCode(res.status);
      return {
        ok: false,
        status: res.status,
        error: makeProviderError(code, NAME, {
          upstream: String(res.status),
          message: `${urlPath} returned ${res.status}`,
        }),
      };
    }
    const body = await res.json();
    return { ok: true, status: res.status, body };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return {
        ok: false,
        status: 0,
        error: makeProviderError('TIMEOUT', NAME, {
          message: `${urlPath} timed out after ${timeoutMs}ms`,
        }),
      };
    }
    return {
      ok: false,
      status: 0,
      error: makeProviderError('UNKNOWN', NAME, { message: e && e.message ? e.message : String(e) }),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── SDMX-JSON parser ─────────────────────────────────────────────────
// The SDMX-JSON shape is stable but dense. We walk structure.dimensions.series
// to know which dimension index is DATA_TYPE_FM (the maturity code), then
// for each dataSets[0].series[<indexKey>] pull the latest observation and
// map the key back to a human-friendly maturity label.
//
// We deliberately don't trust positional assumptions — ECB can (and does)
// reorder dimensions in unrelated dataflows, and hard-coding index 6 would
// break silently on schema shifts.

/**
 * Find the position of DATA_TYPE_FM in structure.dimensions.series.
 * Returns -1 if missing (schema mismatch).
 */
function findMaturityDimIndex(structure) {
  const seriesDims = structure && structure.dimensions && structure.dimensions.series;
  if (!Array.isArray(seriesDims)) return -1;
  return seriesDims.findIndex(d => d && d.id === 'DATA_TYPE_FM');
}

/**
 * Map a maturity CODE ('SR_10Y') to our curated maturity metadata.
 * Returns null if the code isn't in our MATURITIES list (i.e. ECB
 * returned a tenor we didn't request — should never happen but we
 * don't want to emit a mystery row either).
 */
function maturityMetaForCode(code) {
  return MATURITIES.find(m => m.code === code) || null;
}

/**
 * Extract the latest observation period from structure.dimensions.observation.
 * Returns the highest TIME_PERIOD value (ISO date string) or null.
 */
function latestObservationDate(structure) {
  const obsDims = structure && structure.dimensions && structure.dimensions.observation;
  if (!Array.isArray(obsDims) || obsDims.length === 0) return null;
  const time = obsDims.find(d => d && d.id === 'TIME_PERIOD');
  if (!time || !Array.isArray(time.values) || time.values.length === 0) return null;
  // Values appear in chronological order; last is newest.
  return time.values[time.values.length - 1].id || null;
}

/**
 * Parse an SDMX-JSON body into a Curve.
 * Returns { ok: true, curve } or { ok: false, code, message }.
 *
 * @param {Object} body — SDMX-JSON response
 * @returns {{ok: true, curve: {points: Array<{maturity, maturityYears, yieldPct}>, asOf: string}} |
 *          {ok: false, code: string, message: string}}
 */
function parseYieldCurveBody(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, code: 'SCHEMA_MISMATCH', message: 'empty body' };
  }
  const structure = body.structure || (Array.isArray(body.data) && body.data[0] && body.data[0].structure) || body;
  const dataSets = body.dataSets || (body.data && body.data.dataSets);
  if (!Array.isArray(dataSets) || dataSets.length === 0) {
    return { ok: false, code: 'SCHEMA_MISMATCH', message: 'dataSets missing' };
  }
  const matDimIdx = findMaturityDimIndex(structure);
  if (matDimIdx < 0) {
    return { ok: false, code: 'SCHEMA_MISMATCH', message: 'DATA_TYPE_FM dimension missing' };
  }
  const matDimValues = structure.dimensions.series[matDimIdx].values || [];
  const asOf = latestObservationDate(structure);

  const series = dataSets[0].series || {};
  const points = [];
  for (const seriesKey of Object.keys(series)) {
    const s = series[seriesKey];
    // seriesKey is "0:0:0:0:0:0:0:N" — colon-separated dimension indices.
    const parts = seriesKey.split(':').map(Number);
    const matValueIdx = parts[matDimIdx];
    const matCode = matDimValues[matValueIdx] && matDimValues[matValueIdx].id;
    if (!matCode) continue;
    const meta = maturityMetaForCode(matCode);
    if (!meta) continue;

    // Latest observation: keys in s.observations are ordered by TIME_PERIOD
    // index as strings; we want the highest.
    const obsKeys = Object.keys(s.observations || {});
    if (obsKeys.length === 0) continue;
    const newest = obsKeys.reduce((best, k) => (Number(k) > Number(best) ? k : best), obsKeys[0]);
    const obs = s.observations[newest];
    // Observations are arrays — first element is the numeric value.
    const raw = Array.isArray(obs) ? obs[0] : obs;
    const yieldPct = Number(raw);
    if (!Number.isFinite(yieldPct)) continue;

    points.push({
      maturity: meta.maturity,
      maturityYears: meta.years,
      yieldPct,
    });
  }

  if (points.length === 0) {
    return { ok: false, code: 'SCHEMA_MISMATCH', message: 'no usable observations' };
  }

  // Sort monotonically by maturity for downstream chart code.
  points.sort((a, b) => a.maturityYears - b.maturityYears);

  return {
    ok: true,
    curve: { points, asOf },
  };
}

// ── Public API ──────────────────────────────────────────────────────

function describe() {
  return DECLARATION;
}

/**
 * curve(issuer, opts?) — returns the AAA euro-area sovereign zero-coupon curve.
 *
 * @param {string} issuer — 'EU' or 'EA' (euro area). Anything else → NOT_IN_COVERAGE.
 * @param {{ fetchImpl?: Function, timeoutMs?: number }} [opts]
 * @returns {Promise<Result<{issuer, currency, asOf, points}>>}
 */
async function curve(issuer, opts = {}) {
  const t0 = Date.now();
  const normalized = String(issuer || '').toUpperCase();
  if (normalized !== 'EU' && normalized !== 'EA') {
    return err(
      makeProviderError('NOT_IN_COVERAGE', NAME, {
        message: `ecb-sdmx only covers 'EU' (euro area), got '${issuer}'`,
      }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME] }),
    );
  }

  const keyBody = `B.U2.EUR.4F.G_N_A.SV_C_YM.${MATURITIES.map(m => m.code).join('+')}`;
  const urlPath = `/service/data/YC/${keyBody}?lastNObservations=1&format=jsondata`;

  const res = await ecbFetch(urlPath, {
    timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    fetchImpl: opts.fetchImpl,
  });
  if (!res.ok) {
    return err(res.error, makeProvenance({
      source: NAME,
      confidence: 'unverified',
      adapterChain: [NAME],
      latencyMs: Date.now() - t0,
    }));
  }

  const parsed = parseYieldCurveBody(res.body);
  if (!parsed.ok) {
    return err(
      makeProviderError(parsed.code, NAME, { message: parsed.message }),
      makeProvenance({
        source: NAME,
        confidence: 'unverified',
        adapterChain: [NAME],
        latencyMs: Date.now() - t0,
      }),
    );
  }

  const asOfMs = parsed.curve.asOf ? Date.parse(parsed.curve.asOf) : NaN;
  const freshnessMs = Number.isFinite(asOfMs) ? Math.max(0, Date.now() - asOfMs) : 0;
  const warnings = [];
  if (freshnessMs > DECLARATION.freshnessSlaSec * 1000) warnings.push('stale_data');

  return ok(
    {
      issuer: 'EU',
      currency: 'EUR',
      asOf: parsed.curve.asOf,
      points: parsed.curve.points,
    },
    makeProvenance({
      source: NAME,
      fetchedAt: new Date().toISOString(),
      freshnessMs,
      confidence: warnings.length ? 'low' : 'high',
      adapterChain: [NAME],
      warnings,
      latencyMs: Date.now() - t0,
    }),
  );
}

/**
 * health() — liveness ping. Requests the smallest possible slice (SR_10Y
 * only, last 1 observation) and returns ok if ECB responds with a parseable
 * body. Used by the adapter quality harness.
 */
async function health(opts = {}) {
  const t0 = Date.now();
  const urlPath = '/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?lastNObservations=1&format=jsondata';
  const res = await ecbFetch(urlPath, {
    timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    fetchImpl: opts.fetchImpl,
  });
  if (!res.ok) {
    return err(res.error, makeProvenance({
      source: NAME,
      confidence: 'unverified',
      adapterChain: [NAME],
      latencyMs: Date.now() - t0,
    }));
  }
  return ok(
    { healthy: true, latencyMs: Date.now() - t0 },
    makeProvenance({
      source: NAME,
      confidence: 'high',
      adapterChain: [NAME],
      latencyMs: Date.now() - t0,
    }),
  );
}

module.exports = {
  describe,
  curve,
  health,
  // Exposed for tests and for operators who want a named list of the
  // tenors we request.
  _internal: {
    MATURITIES,
    parseYieldCurveBody,
    findMaturityDimIndex,
    maturityMetaForCode,
    latestObservationDate,
    ecbFetch,
    BASE_URL,
  },
};
