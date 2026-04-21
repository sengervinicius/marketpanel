/**
 * providers/macroBrProvider.js
 *
 * Brazilian macro series via BCB SGS (Sistema Gerenciador de Séries
 * Temporais). Public API, no key required.
 *
 * Why this exists
 * ---------------
 * The audit called out "BCB / Brazilian macro" as a P1 gap. Before
 * this, questions like "Selic history", "onde está a IPCA", "IGP-M
 * trend" were routed to Perplexity — narrative-only, no series, no
 * chart, not alertable. macroProvider.js returns a snapshot-level
 * view (one row per country) with Brazil backed by static stubs;
 * this module adds the time-series dimension specifically for the
 * BR names a LatAm CIO asks about every morning.
 *
 * Covered series (SGS IDs):
 *   - selic        → 11     (Selic diária, daily overnight, % a.a.)
 *   - selic_meta   → 432    (Meta Selic, policy target set by Copom)
 *   - ipca         → 433    (IPCA mensal, % mensal)
 *   - ipca_12m     → 13522  (IPCA acumulado 12 meses, % a.a.)
 *   - igpm         → 189    (IGP-M mensal, % mensal)
 *   - ibc_br       → 24363  (IBC-Br, index 2002=100, GDP proxy)
 *   - ptax_venda   → 1      (PTAX USD venda, R$/USD)
 *   - desemprego   → 24369  (Taxa de desocupação, PNAD Contínua, %)
 *
 * Endpoint:
 *   https://api.bcb.gov.br/dados/serie/bcdata.sgs.{id}/dados
 *     ?formato=json&dataInicial=DD/MM/YYYY&dataFinal=DD/MM/YYYY
 *
 * Output shape:
 *   {
 *     series: 'selic',
 *     seriesId: 11,
 *     name: 'Selic diária (% a.a.)',
 *     latest: { date: '2026-04-21', value: 10.25 },
 *     history: [{ date, value }, ...],   // only when history=true
 *     source: 'BCB SGS',
 *     asOf: ISO-8601,
 *   }
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

// ── Canonical series registry ────────────────────────────────────────
const SERIES = {
  selic:       { id: 11,    name: 'Selic diária (% a.a.)',                unit: '% a.a.'  },
  selic_meta:  { id: 432,   name: 'Meta Selic (Copom, % a.a.)',           unit: '% a.a.'  },
  ipca:        { id: 433,   name: 'IPCA mensal (% m/m)',                  unit: '% m/m'   },
  ipca_12m:    { id: 13522, name: 'IPCA acumulado 12 meses (% a.a.)',     unit: '% a.a.'  },
  igpm:        { id: 189,   name: 'IGP-M mensal (% m/m)',                 unit: '% m/m'   },
  ibc_br:      { id: 24363, name: 'IBC-Br (índice 2002=100)',             unit: 'índice'  },
  ptax_venda:  { id: 1,     name: 'PTAX USD venda (R$ / USD)',            unit: 'R$/USD'  },
  desemprego:  { id: 24369, name: 'Taxa de desocupação (PNAD, %)',        unit: '%'       },
};

// Accepted aliases → canonical key. Kept loose so the AI can pass
// what the user said without us having to add another dispatch hop.
const ALIASES = {
  'selic':            'selic',
  'selic_diaria':     'selic',
  'selic diária':     'selic',
  'meta_selic':       'selic_meta',
  'meta selic':       'selic_meta',
  'copom':            'selic_meta',
  'ipca':             'ipca',
  'ipca mensal':      'ipca',
  'ipca_mensal':      'ipca',
  'ipca 12m':         'ipca_12m',
  'ipca_12m':         'ipca_12m',
  'ipca acumulado':   'ipca_12m',
  'igpm':             'igpm',
  'igp-m':            'igpm',
  'igp m':            'igpm',
  'ibc':              'ibc_br',
  'ibc-br':           'ibc_br',
  'ibc_br':           'ibc_br',
  'ibcbr':            'ibc_br',
  'ptax':             'ptax_venda',
  'ptax venda':       'ptax_venda',
  'ptax_venda':       'ptax_venda',
  'cambio':           'ptax_venda',
  'câmbio':           'ptax_venda',
  'dolar':            'ptax_venda',
  'dólar':            'ptax_venda',
  'desemprego':       'desemprego',
  'unemployment_br':  'desemprego',
};

function resolveSeries(input) {
  if (!input) return null;
  const norm = String(input).toLowerCase().trim().replace(/\s+/g, ' ');
  const key = ALIASES[norm] || (SERIES[norm] ? norm : null);
  if (!key) return null;
  return { key, ...SERIES[key] };
}

function listSeries() {
  return Object.entries(SERIES).map(([key, meta]) => ({ key, ...meta }));
}

// ── Cache ────────────────────────────────────────────────────────────
const _cache = new Map();
// BCB publishes most macro series daily or slower. 30 min latest /
// 12 hr history is plenty for chat-time use.
const TTL_LATEST_MS  = 30 * 60 * 1000;
const TTL_HISTORY_MS = 12 * 60 * 60 * 1000;
function cget(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cset(k, v, ttl) { _cache.set(k, { v, exp: Date.now() + ttl }); }

// ── BCB date formatting ──────────────────────────────────────────────
// SGS wants DD/MM/YYYY (unlike the Olinda PTAX endpoint which wants
// MM-DD-YYYY in single-quotes — different team, different API).
function fmtSGSDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// BCB rows: { data: "21/04/2026", valor: "10.25" }
function parseRow(r) {
  if (!r || typeof r !== 'object') return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(r.data || ''));
  if (!m) return null;
  const value = Number(r.valor);
  if (!Number.isFinite(value)) return null;
  return { date: `${m[3]}-${m[2]}-${m[1]}`, value };
}

async function fetchSeriesRows(seriesId, { months = 24 } = {}) {
  const now = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - Math.max(1, Math.min(240, Number(months) || 24)));

  const url =
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesId}/dados` +
    `?formato=json&dataInicial=${fmtSGSDate(start)}&dataFinal=${fmtSGSDate(now)}`;

  const res = await fetch(url, { timeout: 8000, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BCB SGS ${seriesId} ${res.status}: ${body.slice(0, 120)}`);
  }
  const raw = await res.json();
  if (!Array.isArray(raw)) return [];
  return raw.map(parseRow).filter(Boolean);
}

// ── Public API ───────────────────────────────────────────────────────
/**
 * Fetch a Brazilian macro series by name.
 *
 * @param {Object} opts
 * @param {string} opts.series     Alias or canonical key (e.g. "Selic", "ipca_12m").
 * @param {boolean} [opts.history=false]  If true, include the history window.
 * @param {number}  [opts.months=24]      How many months of history (1..240).
 */
async function getBrazilMacro({ series, history = false, months = 24 } = {}) {
  const resolved = resolveSeries(series);
  if (!resolved) {
    return {
      series,
      error: `Unknown Brazilian macro series "${series}".`,
      available: Object.keys(SERIES),
    };
  }

  const win = Math.max(1, Math.min(240, Number(months) || 24));
  const cacheKey = history
    ? `macroBr:hist:${resolved.key}:${win}`
    : `macroBr:latest:${resolved.key}`;
  const cached = cget(cacheKey);
  if (cached) return cached;

  try {
    const rows = await fetchSeriesRows(resolved.id, { months: win });
    if (!rows.length) {
      const miss = {
        series: resolved.key,
        seriesId: resolved.id,
        name: resolved.name,
        unit: resolved.unit,
        error: 'BCB SGS returned no rows for this window.',
        source: 'BCB SGS',
      };
      cset(cacheKey, miss, TTL_LATEST_MS);
      return miss;
    }
    // BCB returns rows in ascending date order; keep that order for
    // history, pluck last for latest.
    const latest = rows[rows.length - 1];
    const out = {
      series: resolved.key,
      seriesId: resolved.id,
      name: resolved.name,
      unit: resolved.unit,
      latest,
      source: 'BCB SGS',
      asOf: new Date().toISOString(),
    };
    if (history) {
      // Cap to avoid blowing the payload budget — 24 monthly points or
      // ~300 daily points is plenty for a chat-time chart.
      out.history = rows.slice(-300);
      out.historyCount = out.history.length;
    }
    cset(cacheKey, out, history ? TTL_HISTORY_MS : TTL_LATEST_MS);
    return out;
  } catch (e) {
    logger.warn('macroBrProvider', 'BCB SGS fetch failed', {
      seriesId: resolved.id, error: e.message,
    });
    return {
      series: resolved.key,
      seriesId: resolved.id,
      name: resolved.name,
      error: e.message,
      source: 'BCB SGS',
    };
  }
}

module.exports = {
  getBrazilMacro,
  listSeries,
  // test hooks
  _resolveSeries: resolveSeries,
  _parseRow: parseRow,
  _fmtSGSDate: fmtSGSDate,
};
