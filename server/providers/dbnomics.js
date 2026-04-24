/**
 * providers/dbnomics.js — R1.1 DBnomics macro aggregator.
 *
 * DBnomics (https://db.nomics.world) federates 250+ central banks and
 * statistical agencies (ECB, Fed, BoE, BoJ, OECD, IMF, World Bank, BIS,
 * INSEE, Eurostat, many national NSOs). Single uniform JSON API, no key
 * required.
 *
 * Docs: https://db.nomics.world/docs/web-api/
 *
 * Series identifier tuple:
 *   { provider_code, dataset_code, series_code }
 * e.g. ECB / EXR / M.USD.EUR.SP00.A   — monthly USD/EUR exchange rate.
 *
 * Use from the MCP registry: tool `macro.lookup_series_global`.
 *
 * Cache: in-process 1 h (macro series are daily / monthly; 1 h is fine).
 *
 * This adapter does NOT shadow BCB (Brazil) or FRED (US) — they stay on
 * their dedicated providers because they have Particle-specific
 * tuning (BCB PTAX, FRED rate-limit-friendly CSV endpoint). DBnomics
 * is the fallback for every country they don't cover.
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const BASE = 'https://api.db.nomics.world/v22/series';
const TIMEOUT_MS = 10000;
const TTL_MS = 60 * 60 * 1000; // 1 hour

const _cache = new Map();
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v) {
  _cache.set(k, { v, exp: Date.now() + TTL_MS });
}

/**
 * Fetch a single series from DBnomics.
 *
 * @param {object} args
 * @param {string} args.providerCode  DBnomics provider code (e.g. "ECB", "OECD", "IMF")
 * @param {string} args.datasetCode   Dataset code within the provider (e.g. "EXR", "MEI")
 * @param {string} args.seriesCode    Series code within the dataset
 * @returns {Promise<object>} Normalised series shape, see README.
 */
async function lookupSeries({ providerCode, datasetCode, seriesCode }) {
  if (!providerCode || !datasetCode || !seriesCode) {
    return { error: 'dbnomics: providerCode, datasetCode and seriesCode are required' };
  }
  const key = `${providerCode}/${datasetCode}/${seriesCode}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${BASE}/${encodeURIComponent(providerCode)}/${encodeURIComponent(datasetCode)}/${encodeURIComponent(seriesCode)}?observations=1`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        'user-agent': 'particle-dbnomics/1.0',
        'accept': 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `dbnomics ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = await res.json();
    const series = (json && json.series && Array.isArray(json.series.docs) && json.series.docs[0]) || null;
    if (!series) {
      return { error: 'dbnomics: series not found', key };
    }
    // Normalise observations: parallel arrays → [{ t, v }, ...]
    const periods = series.period || [];
    const values  = series.value || [];
    const observations = [];
    const n = Math.min(periods.length, values.length);
    for (let i = 0; i < n; i++) {
      const v = values[i];
      // DBnomics uses "NA" and null to mark missing; drop them.
      if (v == null || v === 'NA') continue;
      const num = Number(v);
      if (!Number.isFinite(num)) continue;
      observations.push({ t: String(periods[i]), v: num });
    }
    // Keep the tail — older observations bloat the context budget and
    // the MCP tool payload cap would truncate anyway.
    const tail = observations.slice(-240);

    const result = {
      key,
      provider: providerCode,
      dataset: datasetCode,
      series: seriesCode,
      title: series.series_name || series.name || seriesCode,
      units: series['unit.name'] || series.unit || null,
      frequency: series['@frequency'] || series.frequency || null,
      last_updated: series.indexed_at || null,
      source_url: `https://db.nomics.world/${providerCode}/${datasetCode}/${seriesCode}`,
      observations_count: tail.length,
      first_observation: tail[0] || null,
      last_observation: tail[tail.length - 1] || null,
      observations: tail,
    };
    cacheSet(key, result);
    return result;
  } catch (e) {
    logger.warn('dbnomics', 'lookupSeries failed', { key, error: e.message });
    return { error: `dbnomics: ${e.message}`, key };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { lookupSeries, _cache };
