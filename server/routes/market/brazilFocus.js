/**
 * routes/market/brazilFocus.js — H2b item 4: BCB Focus survey strip.
 *
 *   GET /market/brazil-focus
 *
 * Market expectations (Focus/BCB) for the BrazilPanel strip: Selic, IPCA,
 * PIB Total and Câmbio for the current + next calendar year, from the
 * keyless BCB Olinda OData API (ExpectativasMercadoAnuais). We take the
 * most recent survey row (Data desc) per indicator/year, baseCalculo 0
 * (full respondent sample), and expose the Mediana (falling back to
 * Media when Mediana is absent).
 *
 * Response contract:
 *   {
 *     ok: true,
 *     source: 'bcb-focus',
 *     referenceDate: 'YYYY-MM-DD',        // latest survey date seen
 *     years: {
 *       '2026': { selic, ipca, pib, fx }, // numbers | null per field
 *       '2027': { ... },
 *     },
 *     asOf: ISO-8601,
 *   }
 * Failure → { ok:false, error } (client hides the strip). Cached 6h on
 * success only.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet } = require('./lib/cache');
const { fetch } = require('./lib/providers');
const logger = require('../../utils/logger');

const CACHE_KEY = 'market:brazil-focus';
const TTL_6H = 6 * 60 * 60 * 1000;
const OLINDA_BASE = 'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais';

// Olinda indicator name → payload field
const INDICATORS = {
  'Selic':      'selic',
  'IPCA':       'ipca',
  'PIB Total':  'pib',
  'Câmbio':     'fx',
};

function buildUrl(years) {
  const indicatorFilter = Object.keys(INDICATORS)
    .map(n => `Indicador eq '${n}'`)
    .join(' or ');
  const yearFilter = years.map(y => `DataReferencia eq '${y}'`).join(' or ');
  const filter = `(${indicatorFilter}) and (${yearFilter}) and baseCalculo eq 0`;
  const params = new URLSearchParams({
    '$top': '400',
    '$filter': filter,
    '$orderby': 'Data desc',
    '$select': 'Indicador,Data,DataReferencia,Media,Mediana,baseCalculo',
    '$format': 'json',
  });
  return `${OLINDA_BASE}?${params.toString()}`;
}

// Same timeout convention as the other outbound market fetches (8s abort).
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { 'Accept': 'application/json' },
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function buildFocus(now = new Date()) {
  const y0 = now.getFullYear();
  const years = [String(y0), String(y0 + 1)];

  const res = await fetchWithTimeout(buildUrl(years));
  if (!res.ok) throw new Error(`Olinda HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json?.value) ? json.value : [];
  if (!rows.length) throw new Error('Olinda returned no rows');

  // Rows come Data-desc; keep the FIRST hit per (indicator, year).
  const out = {};
  for (const y of years) out[y] = { selic: null, ipca: null, pib: null, fx: null };
  let referenceDate = null;

  for (const row of rows) {
    const field = INDICATORS[row.Indicador];
    const year = String(row.DataReferencia || '');
    if (!field || !out[year] || out[year][field] != null) continue;
    const val = row.Mediana != null ? Number(row.Mediana)
      : row.Media != null ? Number(row.Media) : null;
    if (val == null || !Number.isFinite(val)) continue;
    out[year][field] = val;
    if (!referenceDate || String(row.Data) > referenceDate) referenceDate = String(row.Data);
  }

  const any = years.some(y => Object.values(out[y]).some(v => v != null));
  if (!any) throw new Error('Olinda rows did not match expected indicators');

  return {
    ok: true,
    source: 'bcb-focus',
    referenceDate,
    years: out,
    asOf: new Date().toISOString(),
  };
}

router.get('/market/brazil-focus', async (req, res) => {
  try {
    const cached = cacheGet(CACHE_KEY);
    if (cached) return res.json(cached);

    const payload = await buildFocus();
    cacheSet(CACHE_KEY, payload, TTL_6H);
    return res.json(payload);
  } catch (e) {
    // The strip is decorative context — degrade quietly, never 5xx spam.
    logger.warn('brazilFocus', `GET /market/brazil-focus degraded: ${e.message}`);
    return res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
// Test hook — deterministic date injection without waiting on the route cache.
module.exports._buildFocus = buildFocus;
module.exports._buildUrl = buildUrl;
