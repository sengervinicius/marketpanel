/**
 * routes/market/brazilMacro.js — Phase S W1 item 3: Brazil desk tape macro cells.
 *
 *   GET /market/brazil-macro
 *
 * The three policy/inflation numbers of the BrazilPanel header tape, from
 * the keyless BCB SGS API (same source the debt routes already use):
 *
 *   selic   — SGS 432   Selic target rate (% a.a.)
 *   cdi     — SGS 4389  CDI annualized (% a.a.)
 *   ipca12m — SGS 13522 IPCA accumulated over 12 months (%)
 *
 * Response contract:
 *   { ok: true, source: 'bcb-sgs',
 *     selic: n|null, cdi: n|null, ipca12m: n|null,
 *     dates: { selic, cdi, ipca12m },   // 'dd/mm/yyyy' per SGS, or null
 *     asOf: ISO-8601 }
 *
 * Per-field degrade: a failed series stays null (client renders an
 * em-dash). ok:false only when EVERY series failed — and failures are
 * never cached. Success cached 6h (these series move daily at most).
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet } = require('./lib/cache');
const { fetch } = require('./lib/providers');
const logger = require('../../utils/logger');

const CACHE_KEY = 'market:brazil-macro';
const TTL_6H = 6 * 60 * 60 * 1000;

const SGS_SERIES = {
  selic:   432,    // Selic target (% a.a.)
  cdi:     4389,   // CDI annualized (% a.a.)
  ipca12m: 13522,  // IPCA 12-month accumulated (%)
};

const sgsUrl = (id) =>
  `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${id}/dados/ultimos/1?formato=json`;

// Same 8s-abort convention as the other outbound market fetches.
async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSeries(id) {
  const res = await fetchWithTimeout(sgsUrl(id));
  if (!res.ok) throw new Error(`SGS ${id} HTTP ${res.status}`);
  const json = await res.json();
  const row = Array.isArray(json) ? json[0] : null;
  const val = row ? parseFloat(row.valor) : NaN;
  if (!Number.isFinite(val)) throw new Error(`SGS ${id} returned no numeric value`);
  return { value: val, date: row.data || null };
}

async function buildMacro() {
  const keys = Object.keys(SGS_SERIES);
  const settled = await Promise.allSettled(keys.map(k => fetchSeries(SGS_SERIES[k])));

  const payload = { ok: true, source: 'bcb-sgs', dates: {}, asOf: new Date().toISOString() };
  let anyOk = false;
  keys.forEach((k, i) => {
    if (settled[i].status === 'fulfilled') {
      payload[k] = settled[i].value.value;
      payload.dates[k] = settled[i].value.date;
      anyOk = true;
    } else {
      payload[k] = null;
      payload.dates[k] = null;
      logger.warn('brazilMacro', `SGS ${SGS_SERIES[k]} (${k}) failed: ${settled[i].reason?.message}`);
    }
  });

  if (!anyOk) throw new Error('all BCB SGS series failed');
  return payload;
}

router.get('/market/brazil-macro', async (req, res) => {
  try {
    const cached = cacheGet(CACHE_KEY);
    if (cached) return res.json(cached);

    const payload = await buildMacro();
    cacheSet(CACHE_KEY, payload, TTL_6H);
    return res.json(payload);
  } catch (e) {
    // Tape cells are context — degrade quietly, never 5xx spam.
    logger.warn('brazilMacro', `GET /market/brazil-macro degraded: ${e.message}`);
    return res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
// Test hooks
module.exports._buildMacro = buildMacro;
module.exports._sgsUrl = sgsUrl;
module.exports._SGS_SERIES = SGS_SERIES;
