/**
 * providers/analystEstimatesProvider.js
 *
 * Forward (street) estimates for US equities via Financial Modeling Prep
 * /analyst-estimates. Powers Particle AI's `forward_estimates` tool —
 * answers "what's the street modelling for NVDA next year?" with the
 * actual EPS / revenue / EBITDA consensus instead of a Perplexity
 * narrative summary.
 *
 * Why this exists
 * ---------------
 * The P2 audit flagged forward estimates as a +0.2 gap. We already cover
 * *trailing* fundamentals (price, earnings history, filings) but a CIO
 * making a multi-year allocation call needs the street estimate curve:
 * what does consensus think FY+1, FY+2, FY+3 EPS looks like, how wide is
 * the analyst range, and is the estimate being walked up or down over
 * time. Without this the AI was either hallucinating numbers or routing
 * through Perplexity — neither acceptable for a position-sizing
 * conversation.
 *
 * Data source
 * -----------
 * FMP v3 analyst-estimates:
 *
 *     GET https://financialmodelingprep.com/api/v3/analyst-estimates/{SYMBOL}
 *       ?period={annual|quarter}&limit={1..30}&apikey={key}
 *
 * Returns an array of per-period rows with consensus averages and
 * high/low bands across the estimate set:
 *
 *     [{
 *       symbol, date, estimatedRevenueLow, estimatedRevenueHigh,
 *       estimatedRevenueAvg, estimatedEbitdaLow, estimatedEbitdaHigh,
 *       estimatedEbitdaAvg, estimatedEbitLow, estimatedEbitHigh,
 *       estimatedEbitAvg, estimatedNetIncomeLow, estimatedNetIncomeHigh,
 *       estimatedNetIncomeAvg, estimatedSgaExpenseLow, ...,
 *       estimatedEpsAvg, estimatedEpsLow, estimatedEpsHigh,
 *       numberAnalystEstimatedRevenue, numberAnalystsEstimatedEps
 *     }, ...]
 *
 * We prune to the fields an analyst actually reads at a glance — eps,
 * revenue, ebitda, analyst count — and drop the long tail of less-used
 * cuts (SGA, capex, etc.) to keep the payload inside the tool budget.
 *
 * Output shape
 * ------------
 *     {
 *       symbol: 'NVDA',
 *       period: 'annual',           // 'annual' | 'quarter'
 *       estimates: [{
 *         date: '2027-01-31',       // fiscal period end
 *         fiscalYear: 2027,         // derived year label
 *         eps:      { low, high, avg },
 *         revenue:  { low, high, avg, unit: 'USD' },
 *         ebitda:   { low, high, avg, unit: 'USD' },
 *         netIncome:{ low, high, avg, unit: 'USD' },
 *         analystCount: {
 *           eps: 40,
 *           revenue: 42,
 *         },
 *       }, ...],
 *       count: 5,
 *       source: 'Financial Modeling Prep',
 *       asOf: ISO-8601,
 *     }
 *
 * If FMP_API_KEY is unset or the API fails we return { error } rather
 * than throwing so the AI can say "I don't have that" instead of the
 * user seeing a stack trace.
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const DEFAULT_TIMEOUT_MS = 8000;

// ── Cache ────────────────────────────────────────────────────────────
// Analyst estimates get revised weekly-ish — cheap 30-minute cache is
// plenty to soak up re-asks in the same chat session without hitting
// FMP's per-minute quota.
const _cache = new Map();
const TTL_MS = 30 * 60 * 1000;
function cget(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cset(k, v) { _cache.set(k, { v, exp: Date.now() + TTL_MS }); }

function apiKey() {
  return process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || '';
}

// Strip the rows down to what actually matters in a chat answer — eps,
// revenue, ebitda, net income, analyst counts. High / low bands stay so
// the AI can phrase "consensus X, bull case Y, bear case Z".
function normaliseRow(row) {
  if (!row || typeof row !== 'object') return null;
  const date = String(row.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  return {
    date,
    fiscalYear: Number(date.slice(0, 4)),
    eps: {
      low:  num(row.estimatedEpsLow),
      high: num(row.estimatedEpsHigh),
      avg:  num(row.estimatedEpsAvg),
    },
    revenue: {
      low:  num(row.estimatedRevenueLow),
      high: num(row.estimatedRevenueHigh),
      avg:  num(row.estimatedRevenueAvg),
      unit: 'USD',
    },
    ebitda: {
      low:  num(row.estimatedEbitdaLow),
      high: num(row.estimatedEbitdaHigh),
      avg:  num(row.estimatedEbitdaAvg),
      unit: 'USD',
    },
    netIncome: {
      low:  num(row.estimatedNetIncomeLow),
      high: num(row.estimatedNetIncomeHigh),
      avg:  num(row.estimatedNetIncomeAvg),
      unit: 'USD',
    },
    analystCount: {
      eps:     num(row.numberAnalystsEstimatedEps),
      revenue: num(row.numberAnalystEstimatedRevenue),
    },
  };
}

function resolvePeriod(input) {
  if (!input) return 'annual';
  const v = String(input).toLowerCase().trim();
  if (v === 'quarter' || v === 'quarterly' || v === 'q') return 'quarter';
  if (v === 'annual'  || v === 'fy' || v === 'yearly' || v === 'y') return 'annual';
  return 'annual';
}

function resolveSymbol(input) {
  if (!input) return null;
  const s = String(input).trim().toUpperCase();
  // FMP uses plain tickers for US names; strip leading $ if the user
  // pasted one. We don't transform Brazilian .SA tickers — FMP coverage
  // there is thin and will just return an empty array, which we surface
  // as a "no coverage" error below.
  return s.replace(/^\$/, '');
}

/**
 * Fetch forward estimates for a symbol.
 *
 * @param {Object} opts
 * @param {string} opts.symbol   Ticker (e.g. "NVDA", "AAPL", "$MSFT").
 * @param {string} [opts.period='annual']  'annual' | 'quarter'.
 * @param {number} [opts.limit=5]  How many forward periods to return (1..15).
 */
async function getForwardEstimates({ symbol, period = 'annual', limit = 5 } = {}) {
  const sym = resolveSymbol(symbol);
  if (!sym) return { error: 'symbol is required' };

  const key = apiKey();
  if (!key) {
    return {
      symbol: sym,
      error: 'FMP_API_KEY not configured — forward estimates unavailable',
      source: 'Financial Modeling Prep',
    };
  }

  const per = resolvePeriod(period);
  const cap = Math.max(1, Math.min(15, Number(limit) || 5));
  const cacheKey = `est:${sym}:${per}:${cap}`;
  const cached = cget(cacheKey);
  if (cached) return cached;

  // FMP returns rows in descending date order — we request more than
  // `cap` so that after we prune to strictly-future periods we still
  // have `cap` rows left. Worst case is a newly-covered name with only
  // one forward row, in which case we return what's there.
  const url =
    `${FMP_BASE}/analyst-estimates/${encodeURIComponent(sym)}` +
    `?period=${per}&limit=${Math.min(30, cap * 3)}&apikey=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      timeout: DEFAULT_TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn('analystEstimatesProvider', 'FMP non-OK', {
        symbol: sym, status: res.status, body: body.slice(0, 120),
      });
      return {
        symbol: sym,
        error: `FMP ${res.status}`,
        source: 'Financial Modeling Prep',
      };
    }
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) {
      const miss = {
        symbol: sym,
        period: per,
        estimates: [],
        count: 0,
        error: 'no estimates available',
        source: 'Financial Modeling Prep',
        asOf: new Date().toISOString(),
      };
      cset(cacheKey, miss);
      return miss;
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = raw
      .map(normaliseRow)
      .filter(Boolean)
      // Strictly forward-looking. Historical rows (date < today) aren't
      // "estimates" anymore — they are the actual reported prints or
      // stale pre-report numbers that confuse the model.
      .filter(r => r.date >= today)
      // Nearest period first so the AI reads FY+1 before FY+5.
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, cap);

    const out = {
      symbol: sym,
      period: per,
      estimates: rows,
      count: rows.length,
      source: 'Financial Modeling Prep',
      asOf: new Date().toISOString(),
    };
    cset(cacheKey, out);
    return out;
  } catch (e) {
    logger.warn('analystEstimatesProvider', 'fetch failed', {
      symbol: sym, error: e.message,
    });
    return {
      symbol: sym,
      error: e.message || 'fetch failed',
      source: 'Financial Modeling Prep',
    };
  }
}

module.exports = {
  getForwardEstimates,
  // Exposed for unit tests.
  _internal: { normaliseRow, resolvePeriod, resolveSymbol },
};
