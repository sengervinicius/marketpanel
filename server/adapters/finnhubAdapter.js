/**
 * server/adapters/finnhubAdapter.js
 * ─────────────────────────────────────────────────────────────────────
 * Wave 2 / WS1-continued — Finnhub adapter.
 *
 * Why Finnhub now: Polygon (WS1 golden path) covers US equities, FX,
 * crypto and US options at high confidence but does NOT cover KRX (Korea),
 * TSE (Japan), HKEX (Hong Kong), B3 (Brazil), or pan-EU equities with the
 * same fidelity. Finnhub's strength is exactly that gap — plus macro and
 * earnings calendars that the product currently cobbles together from
 * three different fallback shims.
 *
 * This adapter replaces the legacy finnhubQuote() shim in
 * server/routes/market/lib/providers.js. That function throws strings,
 * uses string-matched error prefixes, and has no provenance — all three
 * are sins under the Wave 1 contract.
 *
 * Upstream: Finnhub REST API
 *   https://finnhub.io/api/v1/quote?symbol=X                (last trade)
 *   https://finnhub.io/api/v1/stock/candle?symbol=X&...     (OHLC bars)
 *   https://finnhub.io/api/v1/stock/profile2?symbol=X       (company profile)
 *   https://finnhub.io/api/v1/stock/earnings?symbol=X       (eps history)
 *   https://finnhub.io/api/v1/calendar/earnings?from&to     (earnings calendar)
 *   https://finnhub.io/api/v1/calendar/economic?from&to     (macro calendar)
 *   https://finnhub.io/api/v1/news?category=general         (market news)
 *
 * Env: FINNHUB_API_KEY (required, or describe() reports AUTH)
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

const fetch = require('node-fetch');
const { ok, err, makeProviderError, makeProvenance } = require('./contract');

const NAME = 'finnhub';
const VERSION = '1.0.0';

// Declared coverage — the router uses this to dispatch. Order intentional:
// markets where Finnhub is first-choice list 'high'; US equities list
// 'medium' because Polygon is the golden path for US.
const DECLARATION = Object.freeze({
  name: NAME,
  version: VERSION,
  capabilities: Object.freeze([
    'quote',
    'candles',
    'fundamentals',
    'news',
    'calendar',
    'health',
  ]),
  coverageCells: Object.freeze([
    // Asia — Finnhub is our primary
    { market: 'KRX',  assetClass: 'equity',   capability: 'quote',    confidence: 'high'   },
    { market: 'KRX',  assetClass: 'equity',   capability: 'candles',  confidence: 'high'   },
    { market: 'TSE',  assetClass: 'equity',   capability: 'quote',    confidence: 'high'   },
    { market: 'TSE',  assetClass: 'equity',   capability: 'candles',  confidence: 'high'   },
    { market: 'HKEX', assetClass: 'equity',   capability: 'quote',    confidence: 'high'   },
    { market: 'HKEX', assetClass: 'equity',   capability: 'candles',  confidence: 'high'   },
    // Singapore — added W6.1 (e.g. D05.SI)
    { market: 'SGX',  assetClass: 'equity',   capability: 'quote',    confidence: 'medium' },
    { market: 'SGX',  assetClass: 'equity',   capability: 'candles',  confidence: 'medium' },
    // Brazil — Finnhub is primary until a native B3 adapter lands
    { market: 'B3',   assetClass: 'equity',   capability: 'quote',    confidence: 'high'   },
    { market: 'B3',   assetClass: 'equity',   capability: 'candles',  confidence: 'medium' },
    // EU equities — Finnhub is primary for panel coverage
    { market: 'EU',   assetClass: 'equity',   capability: 'quote',    confidence: 'high'   },
    { market: 'EU',   assetClass: 'equity',   capability: 'candles',  confidence: 'high'   },
    // US equities — Finnhub is fallback to Polygon
    { market: 'US',   assetClass: 'equity',   capability: 'quote',    confidence: 'medium' },
    { market: 'US',   assetClass: 'equity',   capability: 'candles',  confidence: 'medium' },
    // Fundamentals + calendars — Finnhub has the cleanest global coverage
    { market: 'GLOBAL', assetClass: 'equity', capability: 'fundamentals', confidence: 'high' },
    { market: 'GLOBAL', assetClass: 'calendar', capability: 'calendar',   confidence: 'high' },
    { market: 'GLOBAL', assetClass: 'news',     capability: 'news',       confidence: 'medium' },
  ]),
  latencyP95TargetMs: 1500,
  freshnessSlaSec: 120, // Finnhub quotes are ~15s delayed on free tier
  rateLimit: { requestsPerSec: 30, burst: 60 }, // Finnhub free tier
  requiredEnvVars: ['FINNHUB_API_KEY'],
});

const BASE_URL = 'https://finnhub.io/api/v1';
const DEFAULT_TIMEOUT_MS = 3000;

function getApiKey() {
  return process.env.FINNHUB_API_KEY || null;
}

function httpError(status) {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500 && status < 600) return 'UPSTREAM_5XX';
  if (status >= 400 && status < 500) return 'UPSTREAM_4XX';
  return 'UNKNOWN';
}

/**
 * Finnhub accepts Yahoo-style suffixed symbols for international
 * exchanges: 005930.KS (Samsung KRX), 7203.T (Toyota TSE), 0700.HK
 * (Tencent HKEX), PETR4.SA (Petrobras B3), SAP.DE (Xetra), ASML.AS
 * (Euronext Amsterdam), SHEL.L (LSE). We pass through unchanged — the
 * router is responsible for normalising on ingress, not the adapter.
 * Callers that have legacy symbol formats should use
 * utils/tickerNormalize.toYahooFormat() before invoking.
 */
function validateSymbol(symbol) {
  if (typeof symbol !== 'string' || symbol.trim().length === 0) {
    return { ok: false, reason: 'symbol must be a non-empty string' };
  }
  // Finnhub rejects symbols containing whitespace or special chars beyond
  // the usual alnum + dot + hyphen + underscore + colon set.
  if (!/^[A-Za-z0-9._\-:^]+$/.test(symbol)) {
    return { ok: false, reason: `symbol contains invalid characters: ${symbol}` };
  }
  return { ok: true };
}

async function finnhubFetch(urlPath, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      error: makeProviderError('AUTH', NAME, { message: 'FINNHUB_API_KEY not set' }),
    };
  }
  const u = new URL(BASE_URL + urlPath);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, v);
  }
  u.searchParams.set('token', apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(u.toString(), { signal: controller.signal });
    if (!res.ok) {
      const code = httpError(res.status);
      // Finnhub signals symbol-not-found via 200 with empty body sometimes,
      // but also via 400. Treat 400 with no body as INVALID_SYMBOL rather
      // than UPSTREAM_4XX so callers can branch on it.
      let body = null;
      try { body = await res.json(); } catch { /* no body */ }
      const msg = body && body.error ? String(body.error) : `${urlPath} returned ${res.status}`;
      const mappedCode = (res.status === 400 && /symbol|unknown|not.*found/i.test(msg))
        ? 'INVALID_SYMBOL'
        : code;
      return {
        ok: false,
        status: res.status,
        error: makeProviderError(mappedCode, NAME, {
          upstream: String(res.status),
          message: msg,
          retryAfterMs: code === 'RATE_LIMITED' ? 2000 : undefined,
        }),
      };
    }
    const body = await res.json();
    return { ok: true, status: res.status, body };
  } catch (e) {
    if (e.name === 'AbortError') {
      return {
        ok: false,
        status: 0,
        error: makeProviderError('TIMEOUT', NAME, { message: `${urlPath} timed out after ${timeoutMs}ms` }),
      };
    }
    return {
      ok: false,
      status: 0,
      error: makeProviderError('UNKNOWN', NAME, { message: e.message, meta: { name: e.name } }),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Finnhub response shape for /quote:
 *   { c: currentPrice, d: change, dp: percentChange, h: dayHigh,
 *     l: dayLow, o: dayOpen, pc: previousClose, t: unixTs }
 *
 * Finnhub returns c=0 and t=0 when the symbol is unknown — detect this
 * and return INVALID_SYMBOL rather than letting schema-mismatch branch
 * swallow it.
 */
function isEmptyQuotePayload(body) {
  if (!body) return true;
  const allZero = [body.c, body.d, body.dp, body.h, body.l, body.o, body.pc, body.t]
    .every(v => v === 0 || v === null || v === undefined);
  return allZero;
}

// ── describe ─────────────────────────────────────────────────────────
function describe() {
  return DECLARATION;
}

// ── quote ────────────────────────────────────────────────────────────
async function quote(symbol, opts = {}) {
  const t0 = Date.now();
  const validation = validateSymbol(symbol);
  if (!validation.ok) {
    return err(
      makeProviderError('INVALID_SYMBOL', NAME, { message: validation.reason }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME] }),
    );
  }

  const res = await finnhubFetch('/quote', { symbol });
  if (!res.ok) {
    return err(
      res.error,
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }),
    );
  }

  const body = res.body || {};
  if (isEmptyQuotePayload(body)) {
    return err(
      makeProviderError('INVALID_SYMBOL', NAME, {
        message: `Finnhub returned empty payload for ${symbol} — likely not covered`,
      }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }),
    );
  }

  if (typeof body.c !== 'number') {
    return err(
      makeProviderError('SCHEMA_MISMATCH', NAME, { message: 'quote response missing numeric .c field' }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }),
    );
  }

  const tsSec = body.t || Math.floor(Date.now() / 1000);
  const tsMs = tsSec * 1000;
  const freshnessMs = Math.max(0, Date.now() - tsMs);
  const warnings = [];
  if (freshnessMs > DECLARATION.freshnessSlaSec * 1000) warnings.push('stale_data');

  return ok(
    {
      symbol,
      last: body.c,
      change: body.d != null ? body.d : null,
      changePercent: body.dp != null ? body.dp : null,
      open: body.o != null ? body.o : null,
      high: body.h != null ? body.h : null,
      low: body.l != null ? body.l : null,
      previousClose: body.pc != null ? body.pc : null,
      bid: null, // Finnhub /quote doesn't expose NBBO
      ask: null,
      volume: null, // /quote doesn't carry volume; use /stock/candle for that
      timestamp: new Date(tsMs).toISOString(),
      currency: opts.currency || null, // router can backfill from coverage matrix
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

// ── candles ──────────────────────────────────────────────────────────
// Finnhub resolutions: 1, 5, 15, 30, 60, D, W, M
function resolutionFromOpts(opts = {}) {
  if (opts.resolution) return String(opts.resolution);
  const timespan = (opts.timespan || 'day').toLowerCase();
  const m = opts.multiplier || 1;
  if (timespan === 'minute') return String(m);
  if (timespan === 'hour') return String(60 * m);
  if (timespan === 'day') return 'D';
  if (timespan === 'week') return 'W';
  if (timespan === 'month') return 'M';
  return 'D';
}

async function candles(symbol, opts = {}) {
  const t0 = Date.now();
  const validation = validateSymbol(symbol);
  if (!validation.ok) {
    return err(
      makeProviderError('INVALID_SYMBOL', NAME, { message: validation.reason }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME] }),
    );
  }

  const resolution = resolutionFromOpts(opts);
  const fromSec = opts.fromUnix || Math.floor((opts.from ? new Date(opts.from).getTime() : Date.now() - 30 * 86400000) / 1000);
  const toSec   = opts.toUnix   || Math.floor((opts.to   ? new Date(opts.to).getTime()   : Date.now()) / 1000);

  const res = await finnhubFetch('/stock/candle', {
    symbol,
    resolution,
    from: fromSec,
    to: toSec,
  });
  if (!res.ok) {
    return err(
      res.error,
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }),
    );
  }

  const body = res.body || {};
  // Finnhub uses s: 'ok' | 'no_data' | 'error' as status envelope
  if (body.s === 'no_data') {
    return ok([], makeProvenance({
      source: NAME,
      confidence: 'medium',
      adapterChain: [NAME],
      warnings: ['no_data'],
      latencyMs: Date.now() - t0,
    }));
  }
  if (body.s !== 'ok' || !Array.isArray(body.t)) {
    return err(
      makeProviderError('SCHEMA_MISMATCH', NAME, {
        message: `candles response had status ${body.s} or missing .t array`,
      }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }),
    );
  }

  const bars = body.t.map((ts, i) => ({
    t: ts * 1000,
    o: body.o && body.o[i],
    h: body.h && body.h[i],
    l: body.l && body.l[i],
    c: body.c && body.c[i],
    v: body.v && body.v[i],
  }));

  return ok(bars, makeProvenance({
    source: NAME,
    freshnessMs: 0,
    confidence: 'high',
    adapterChain: [NAME],
    latencyMs: Date.now() - t0,
  }));
}

// ── fundamentals ─────────────────────────────────────────────────────
// Finnhub /stock/metric returns a large flat metrics object; we project
// the canonical Wave 1 FinancialStatement shape from it. Callers that
// need the full metric dump can pass opts.raw=true.
async function fundamentals(symbol, period = 'annual', statement = 'summary', opts = {}) {
  const t0 = Date.now();
  const validation = validateSymbol(symbol);
  if (!validation.ok) {
    return err(
      makeProviderError('INVALID_SYMBOL', NAME, { message: validation.reason }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME] }),
    );
  }

  const res = await finnhubFetch('/stock/metric', { symbol, metric: 'all' });
  if (!res.ok) {
    return err(
      res.error,
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }),
    );
  }

  const body = res.body || {};
  const m = body.metric || {};
  if (Object.keys(m).length === 0) {
    return err(
      makeProviderError('SCHEMA_MISMATCH', NAME, { message: 'fundamentals response missing .metric' }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }),
    );
  }

  const projected = {
    symbol,
    period,
    statement,
    // Valuation
    pe: m.peTTM != null ? m.peTTM : (m.peExclExtraTTM != null ? m.peExclExtraTTM : null),
    eps: m.epsTTM != null ? m.epsTTM : null,
    marketCap: m.marketCapitalization != null ? m.marketCapitalization * 1e6 : null, // Finnhub returns in millions
    // Margins (all 0-1 in Finnhub; caller responsible for formatting)
    grossMargin: m.grossMarginTTM != null ? m.grossMarginTTM : null,
    operatingMargin: m.operatingMarginTTM != null ? m.operatingMarginTTM : null,
    netMargin: m.netProfitMarginTTM != null ? m.netProfitMarginTTM : null,
    // Returns
    roe: m.roeTTM != null ? m.roeTTM : null,
    roa: m.roaTTM != null ? m.roaTTM : null,
    // Risk
    beta: m.beta != null ? m.beta : null,
    // Dividends
    dividendYield: m.currentDividendYieldTTM != null ? m.currentDividendYieldTTM : null,
    // Size
    revenue: m.revenuePerShareTTM != null && m.enterpriseValue != null ? null : null, // revenue not exposed cleanly; use /financials-reported for statements
    sharesOutstanding: m.shareOutstanding != null ? m.shareOutstanding * 1e6 : null,
  };

  if (opts.raw) projected._raw = m;

  return ok(projected, makeProvenance({
    source: NAME,
    fetchedAt: new Date().toISOString(),
    freshnessMs: 0,
    confidence: 'medium',
    adapterChain: [NAME],
    latencyMs: Date.now() - t0,
  }));
}

// ── news ─────────────────────────────────────────────────────────────
async function news(query, opts = {}) {
  const t0 = Date.now();
  // Finnhub has two news endpoints:
  //   /news?category=general (market news feed, no query)
  //   /company-news?symbol=X&from=...&to=... (per-ticker)
  // When a ticker is supplied, use the company-news endpoint.
  const ticker = opts.ticker || (query && query.match(/^[A-Z.]{1,10}$/) ? query : null);

  let res;
  if (ticker) {
    const today = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    res = await finnhubFetch('/company-news', {
      symbol: ticker,
      from: opts.from || fmt(thirtyDaysAgo),
      to:   opts.to   || fmt(today),
    });
  } else {
    res = await finnhubFetch('/news', { category: opts.category || 'general' });
  }

  if (!res.ok) {
    return err(
      res.error,
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }),
    );
  }

  // WS5.2: project raw Finnhub items through the canonical parser so
  // every news consumer sees the same typed NewsEvent shape (and the
  // "NO MATERIAL NEWS FOUND" sentinel discipline stays exactly one
  // place, over in the Perplexity parser).
  const { parseFinnhubResponse } = require('../parsers/newsParser');
  const rows = Array.isArray(res.body) ? res.body.slice(0, opts.limit || 20) : [];
  const items = parseFinnhubResponse(rows, ticker);

  return ok(items, makeProvenance({
    source: NAME,
    freshnessMs: 0,
    confidence: ticker ? 'high' : 'medium',
    adapterChain: [NAME],
    latencyMs: Date.now() - t0,
  }));
}

// ── calendar ─────────────────────────────────────────────────────────
// Supports { kind: 'earnings' | 'economic', from, to }
async function calendar(dateRange = {}, opts = {}) {
  const t0 = Date.now();
  const kind = (opts.kind || dateRange.kind || 'economic').toLowerCase();
  const today = new Date();
  const weekAhead = new Date(Date.now() + 7 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const from = dateRange.from || fmt(today);
  const to   = dateRange.to   || fmt(weekAhead);

  let endpoint;
  if (kind === 'earnings') endpoint = '/calendar/earnings';
  else if (kind === 'economic' || kind === 'macro') endpoint = '/calendar/economic';
  else if (kind === 'ipo') endpoint = '/calendar/ipo';
  else {
    return err(
      makeProviderError('NOT_IN_COVERAGE', NAME, { message: `Unsupported calendar kind: ${kind}` }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME] }),
    );
  }

  const res = await finnhubFetch(endpoint, { from, to });
  if (!res.ok) {
    return err(
      res.error,
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }),
    );
  }

  const body = res.body || {};
  const rows = (body.economicCalendar || body.earningsCalendar || body.ipoCalendar || []);
  const items = rows.map(row => {
    if (kind === 'earnings') {
      return {
        kind: 'earnings',
        date: row.date,
        time: row.hour,
        symbol: row.symbol,
        epsActual: row.epsActual,
        epsEstimate: row.epsEstimate,
        revenueActual: row.revenueActual,
        revenueEstimate: row.revenueEstimate,
        quarter: row.quarter,
        year: row.year,
      };
    }
    if (kind === 'ipo') {
      return {
        kind: 'ipo',
        date: row.date,
        symbol: row.symbol,
        name: row.name,
        exchange: row.exchange,
        priceRange: row.price,
        numberOfShares: row.numberOfShares,
      };
    }
    // economic
    return {
      kind: 'economic',
      country: row.country,
      event: row.event,
      time: row.time,
      actual: row.actual,
      prev: row.prev,
      estimate: row.estimate,
      impact: row.impact,
      unit: row.unit,
    };
  });

  return ok(items, makeProvenance({
    source: NAME,
    freshnessMs: 0,
    confidence: 'high',
    adapterChain: [NAME],
    latencyMs: Date.now() - t0,
  }));
}

// ── health ───────────────────────────────────────────────────────────
async function health() {
  const t0 = Date.now();
  if (!getApiKey()) {
    const latencyMs = Date.now() - t0;
    return err(
      makeProviderError('AUTH', NAME, { message: 'FINNHUB_API_KEY not set' }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs }),
    );
  }
  // Cheapest public endpoint: /quote for a guaranteed-covered symbol.
  const res = await finnhubFetch('/quote', { symbol: 'AAPL' }, 1500);
  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    return err(res.error, makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs }));
  }
  return ok(
    {
      adapter: NAME,
      observedLatencyMs: latencyMs,
      checkedAt: new Date().toISOString(),
      upstreamStatus: isEmptyQuotePayload(res.body) ? 'degraded' : 'ok',
    },
    makeProvenance({ source: NAME, confidence: 'high', adapterChain: [NAME], latencyMs }),
  );
}

module.exports = {
  describe,
  quote,
  candles,
  fundamentals,
  news,
  calendar,
  health,
  // Test-only hooks
  _internal: { isEmptyQuotePayload, validateSymbol, resolutionFromOpts, httpError },
};
