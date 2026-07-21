/**
 * fundamentalsCascade.js — resilient fundamentals for /api/fundamentals/:symbol
 * (fix/bug-wave3 BUG 3: "AI Insight Unavailable" for obvious names).
 *
 * The route was Yahoo-quoteSummary-only: a Yahoo crumb/auth hiccup or a
 * symbol Yahoo serves thinly (e.g. MA) made the route 404/500, the AI
 * Fundamentals context lost ALL real data, and the detail screen degraded
 * to "AI insight unavailable" without ever trying the other providers this
 * codebase already ships.
 *
 * Cascade order (first source with core data wins):
 *   1. yahoo       — injected fetcher (quoteSummary lives in the route,
 *                    it needs the shared crumb/cookie machinery)
 *   2. twelvedata  — /statistics + /profile via providers/twelvedata
 *   3. fmp         — Financial Modeling Prep /profile + /quote (key-gated)
 *
 * Every result carries `source`; `null` only when ALL sources fail — the
 * caller may then honestly say fundamentals are unavailable.
 *
 * All numeric ratio fields use Yahoo conventions (fractions for yields/
 * margins) since that's what routes/search.js and the client already read.
 */
'use strict';

const fetch = require('node-fetch');
const twelvedata = require('./twelvedata');
const logger = require('../utils/logger');

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const FMP_TIMEOUT_MS = 8000;

function fmpKey() {
  return process.env.FMP_API_KEY || process.env.FINANCIAL_MODELING_PREP_API_KEY || '';
}

/** A payload counts as served when at least one core field resolved. */
function hasCoreData(d) {
  if (!d || typeof d !== 'object') return false;
  return [d.marketCap, d.peRatio, d.eps, d.totalRevenue, d.sector]
    .some(v => v != null);
}

const num = v => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};
/** TD serves percents where Yahoo serves fractions. */
const pctToFrac = v => { const n = num(v); return n == null ? null : n / 100; };

// ── 2. TwelveData /statistics (+ /profile for sector/industry) ─────────────
async function fromTwelveData(symbol) {
  if (typeof twelvedata.isConfigured === 'function' && !twelvedata.isConfigured()) {
    return null;
  }
  const [stats, profile] = await Promise.all([
    twelvedata.getStatistics(symbol),
    Promise.resolve(twelvedata.getProfile(symbol)).catch(() => null),
  ]);
  if (!stats && !profile) return null;

  // getStatistics may return the raw envelope ({ statistics: {…} }) or the
  // statistics object itself depending on plan/endpoint version.
  const s  = (stats && (stats.statistics || stats)) || {};
  const vm = s.valuations_metrics   || {};
  const fi = s.financials           || {};
  const bs = fi.balance_sheet       || {};
  const sp = s.stock_price_summary  || s.stock_price || {};
  const ds = s.dividends_and_splits || {};
  const ss = s.stock_statistics     || {};

  const out = {
    marketCap:         num(vm.market_capitalization),
    enterpriseValue:   num(vm.enterprise_value),
    peRatio:           num(vm.trailing_pe),
    forwardPE:         num(vm.forward_pe),
    pegRatio:          num(vm.peg_ratio),
    priceToBook:       num(vm.price_to_book ?? vm.price_to_book_mrq),
    priceToSales:      num(vm.price_to_sales ?? vm.price_to_sales_ttm),
    eps:               num(fi.diluted_eps ?? fi.diluted_eps_ttm),
    forwardEps:        null,
    earningsDate:      null,
    dividendYield:     pctToFrac(ds.forward_annual_dividend_yield ?? ds.trailing_annual_dividend_yield),
    dividendRate:      num(ds.forward_annual_dividend_rate ?? ds.trailing_annual_dividend_rate),
    payoutRatio:       pctToFrac(ds.payout_ratio),
    totalRevenue:      num(fi.revenue ?? (fi.income_statement && fi.income_statement.revenue_ttm)),
    revenueGrowth:     pctToFrac(fi.revenue_growth ?? fi.quarterly_revenue_growth),
    ebitda:            num(fi.ebitda ?? (fi.income_statement && fi.income_statement.ebitda)),
    grossMargins:      pctToFrac(fi.gross_margin),
    operatingMargins:  pctToFrac(fi.operating_margin),
    profitMargins:     pctToFrac(fi.profit_margin),
    totalCash:         num(bs.total_cash ?? bs.total_cash_mrq),
    totalDebt:         num(bs.total_debt ?? bs.total_debt_mrq),
    returnOnEquity:    pctToFrac(fi.return_on_equity ?? fi.return_on_equity_ttm),
    returnOnAssets:    pctToFrac(fi.return_on_assets ?? fi.return_on_assets_ttm),
    beta:              num(sp.beta ?? vm.beta),
    sharesOutstanding: num(ss.shares_outstanding),
    shortPercentFloat: pctToFrac(ss.short_percent_of_float),
    fiftyTwoWeekHigh:  num(sp['52_week_high'] ?? sp.fifty_two_week_high),
    fiftyTwoWeekLow:   num(sp['52_week_low'] ?? sp.fifty_two_week_low),
    fiftyTwoWeekChange: null,
    sector:            profile?.sector || null,
    industry:          profile?.industry || null,
    employees:         num(profile?.employees),
    website:           profile?.website || null,
    description:       profile?.description || null,
  };
  return hasCoreData(out) ? out : null;
}

// ── 3. FMP /profile + /quote ────────────────────────────────────────────────
async function fmpFetch(path, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FMP_TIMEOUT_MS);
  try {
    const res = await fetchImpl(
      `${FMP_BASE}${path}${path.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(fmpKey())}`,
      { signal: ctrl.signal, headers: { Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fromFmp(symbol, fetchImpl = fetch) {
  if (!fmpKey()) return null;
  const sym = symbol.replace(/^\$/, '');
  const [profileArr, quoteArr] = await Promise.all([
    fmpFetch(`/profile/${encodeURIComponent(sym)}`, fetchImpl).catch(() => null),
    fmpFetch(`/quote/${encodeURIComponent(sym)}`, fetchImpl).catch(() => null),
  ]);
  const p = Array.isArray(profileArr) ? profileArr[0] : null;
  const q = Array.isArray(quoteArr) ? quoteArr[0] : null;
  if (!p && !q) return null;

  const price = num(q?.price ?? p?.price);
  const lastDiv = num(p?.lastDiv);
  const out = {
    marketCap:         num(q?.marketCap ?? p?.mktCap),
    enterpriseValue:   null,
    peRatio:           num(q?.pe),
    forwardPE:         null,
    pegRatio:          null,
    priceToBook:       null,
    priceToSales:      null,
    eps:               num(q?.eps),
    forwardEps:        null,
    earningsDate:      q?.earningsAnnouncement ? String(q.earningsAnnouncement).slice(0, 10) : null,
    dividendYield:     lastDiv != null && price ? lastDiv / price : null,
    dividendRate:      lastDiv,
    payoutRatio:       null,
    totalRevenue:      null,
    revenueGrowth:     null,
    ebitda:            null,
    grossMargins:      null,
    operatingMargins:  null,
    profitMargins:     null,
    totalCash:         null,
    totalDebt:         null,
    returnOnEquity:    null,
    returnOnAssets:    null,
    beta:              num(p?.beta),
    sharesOutstanding: num(q?.sharesOutstanding),
    shortPercentFloat: null,
    fiftyTwoWeekHigh:  num(q?.yearHigh),
    fiftyTwoWeekLow:   num(q?.yearLow),
    fiftyTwoWeekChange: null,
    sector:            p?.sector || null,
    industry:          p?.industry || null,
    employees:         num(p?.fullTimeEmployees),
    website:           p?.website || null,
    description:       p?.description || null,
  };
  return hasCoreData(out) ? out : null;
}

/**
 * Run the cascade.
 *
 * @param {string} symbol
 * @param {object} opts
 * @param {function} opts.yahooFn   async () => canonical-shape object | null
 *                                  (throws on provider error)
 * @param {function} [opts.fetchImpl] fetch override (tests)
 * @returns {{ data: object, source: 'yahoo'|'twelvedata'|'fmp', attempts: string[] } | null}
 */
async function getFundamentalsCascade(symbol, { yahooFn, fetchImpl = fetch } = {}) {
  const attempts = [];

  if (typeof yahooFn === 'function') {
    try {
      const y = await yahooFn();
      if (hasCoreData(y)) return { data: y, source: 'yahoo', attempts };
      attempts.push('yahoo: no core data');
    } catch (e) {
      attempts.push(`yahoo: ${e.message}`);
    }
  } else {
    attempts.push('yahoo: not attempted');
  }

  try {
    const t = await fromTwelveData(symbol);
    if (t) return { data: t, source: 'twelvedata', attempts };
    attempts.push('twelvedata: no core data or not configured');
  } catch (e) {
    attempts.push(`twelvedata: ${e.message}`);
  }

  try {
    const f = await fromFmp(symbol, fetchImpl);
    if (f) return { data: f, source: 'fmp', attempts };
    attempts.push(fmpKey() ? 'fmp: no core data' : 'fmp: no API key');
  } catch (e) {
    attempts.push(`fmp: ${e.message}`);
  }

  try {
    logger.warn('fundamentalsCascade', `all sources failed for ${symbol}`, { attempts });
  } catch { /* logger signature varies — never let logging break the route */ }
  return null;
}

module.exports = { getFundamentalsCascade, hasCoreData };
