/**
 * server/adapters/polygonAdapter.js
 * ─────────────────────────────────────────────────────────────────────
 * Wave 1 / WS1 — Polygon adapter (golden path).
 *
 * The first adapter to migrate to the Data Adapter Contract. Proves the
 * contract handles our most mature vendor integration. Every subsequent
 * adapter (Finnhub, Twelvedata, Eulerpool, Unusual Whales, Perplexity
 * Sonar, ECB SDMX, FRED) copies this template.
 *
 * Upstream: Polygon.io REST API
 *   https://api.polygon.io/v2/last/trade/{symbol}         (stocks last trade)
 *   https://api.polygon.io/v2/aggs/ticker/.../prev         (previous close for bid/ask proxy)
 *   https://api.polygon.io/v2/last/nbbo/{symbol}          (best bid/ask)
 *
 * Env: POLYGON_API_KEY (required, or returns AUTH error in describe())
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

const fetch = require('node-fetch');
const { ok, err, makeProviderError, makeProvenance } = require('./contract');

const NAME = 'polygon';
const VERSION = '1.0.0';

// Declared coverage — syncs to the coverage_matrix table at boot.
const DECLARATION = Object.freeze({
  name: NAME,
  version: VERSION,
  capabilities: ['quote', 'candles', 'news', 'chain', 'health'],
  coverageCells: Object.freeze([
    { market: 'US',     assetClass: 'equity',  capability: 'quote',   confidence: 'high' },
    { market: 'US',     assetClass: 'equity',  capability: 'candles', confidence: 'high' },
    { market: 'US',     assetClass: 'equity',  capability: 'news',    confidence: 'medium' },
    { market: 'US',     assetClass: 'options', capability: 'chain',   confidence: 'high' },
    { market: 'FX',     assetClass: 'fx',      capability: 'quote',   confidence: 'high' },
    { market: 'CRYPTO', assetClass: 'crypto',  capability: 'quote',   confidence: 'high' },
  ]),
  latencyP95TargetMs: 900,
  freshnessSlaSec: 60,
  rateLimit: { requestsPerSec: 100, burst: 150 },
  requiredEnvVars: ['POLYGON_API_KEY'],
});

const BASE_URL = 'https://api.polygon.io';
const DEFAULT_TIMEOUT_MS = 2000;

function getApiKey() {
  return process.env.POLYGON_API_KEY || null;
}

function httpError(status) {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500 && status < 600) return 'UPSTREAM_5XX';
  if (status >= 400 && status < 500) return 'UPSTREAM_4XX';
  return 'UNKNOWN';
}

async function polygonFetch(urlPath, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      error: makeProviderError('AUTH', NAME, { message: 'POLYGON_API_KEY not set' }),
    };
  }
  const u = new URL(BASE_URL + urlPath);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('apiKey', apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(u.toString(), { signal: controller.signal });
    if (!res.ok) {
      const code = httpError(res.status);
      return {
        ok: false,
        status: res.status,
        error: makeProviderError(code, NAME, {
          upstream: String(res.status),
          message: `${urlPath} returned ${res.status}`,
          retryAfterMs: code === 'RATE_LIMITED' ? 1000 : undefined,
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
      error: makeProviderError('UNKNOWN', NAME, { message: e.message }),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * describe() — returns the CoverageDeclaration. Also used at boot to
 * seed coverage_matrix.
 */
function describe() {
  return DECLARATION;
}

/**
 * quote(symbol, opts) — returns last-trade snapshot with best bid/ask.
 * Polygon exposes /v2/last/trade for the trade and /v2/last/nbbo for
 * NBBO. We call trade first (cheaper) and enrich with NBBO when the
 * caller requests depth.
 */
async function quote(symbol, opts = {}) {
  const t0 = Date.now();
  if (!symbol || typeof symbol !== 'string') {
    return err(
      makeProviderError('INVALID_SYMBOL', NAME, { message: 'symbol must be a non-empty string' }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME] }),
    );
  }

  const tradeRes = await polygonFetch(`/v2/last/trade/${encodeURIComponent(symbol)}`);
  if (!tradeRes.ok) {
    return err(
      tradeRes.error,
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }),
    );
  }

  const trade = tradeRes.body && tradeRes.body.results;
  if (!trade || typeof trade.p !== 'number') {
    return err(
      makeProviderError('SCHEMA_MISMATCH', NAME, { message: 'trade response missing results.p' }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }),
    );
  }

  let bid = null, ask = null;
  if (opts.includeNbbo !== false) {
    const nbboRes = await polygonFetch(`/v2/last/nbbo/${encodeURIComponent(symbol)}`, {}, DEFAULT_TIMEOUT_MS);
    if (nbboRes.ok && nbboRes.body && nbboRes.body.results) {
      bid = nbboRes.body.results.p || null;
      ask = nbboRes.body.results.P || null;
    }
  }

  const ts = trade.t || Date.now();
  const freshnessMs = Math.max(0, Date.now() - ts);
  const warnings = [];
  if (freshnessMs > DECLARATION.freshnessSlaSec * 1000) warnings.push('stale_data');

  return ok(
    {
      symbol,
      bid,
      ask,
      last: trade.p,
      volume: trade.s || null,
      timestamp: new Date(ts).toISOString(),
      currency: 'USD',
      exchange: trade.x != null ? String(trade.x) : 'US',
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
 * candles(symbol, opts) — OHLC bars.
 *   opts: { from, to, multiplier, timespan }
 */
async function candles(symbol, opts = {}) {
  const t0 = Date.now();
  const mult = opts.multiplier || 1;
  const timespan = opts.timespan || 'day';
  const from = opts.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to   = opts.to   || new Date().toISOString().slice(0, 10);
  const url  = `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${mult}/${timespan}/${from}/${to}`;
  const res  = await polygonFetch(url, { adjusted: 'true', sort: 'asc', limit: 5000 });
  if (!res.ok) {
    return err(res.error, makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }));
  }
  const rows = (res.body && res.body.results) || [];
  const bars = rows.map(r => ({ t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
  return ok(bars, makeProvenance({
    source: NAME,
    freshnessMs: 0,
    confidence: 'high',
    adapterChain: [NAME],
    latencyMs: Date.now() - t0,
  }));
}

/**
 * news(query, opts)
 *   opts: { limit, ticker }
 */
async function news(query, opts = {}) {
  const t0 = Date.now();
  const params = { limit: opts.limit || 20 };
  if (opts.ticker) params.ticker = opts.ticker;
  if (query) params['search'] = query;
  const res = await polygonFetch('/v2/reference/news', params);
  if (!res.ok) return err(res.error, makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }));
  const items = ((res.body && res.body.results) || []).map(n => ({
    id: n.id,
    title: n.title,
    publisher: n.publisher && n.publisher.name,
    url: n.article_url,
    publishedAt: n.published_utc,
    tickers: n.tickers || [],
    sentiment: n.insights || null,
  }));
  return ok(items, makeProvenance({
    source: NAME,
    freshnessMs: 0,
    confidence: 'medium',
    adapterChain: [NAME],
    latencyMs: Date.now() - t0,
  }));
}

/**
 * chain(underlying, expiry, opts) — options chain
 */
async function chain(underlying, expiry, opts = {}) {
  const t0 = Date.now();
  const params = {
    underlying_ticker: underlying,
    limit: opts.limit || 250,
  };
  if (expiry) params.expiration_date = expiry;
  const res = await polygonFetch('/v3/reference/options/contracts', params);
  if (!res.ok) return err(res.error, makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs: Date.now() - t0 }));
  const contracts = ((res.body && res.body.results) || []).map(c => ({
    ticker: c.ticker,
    strike: c.strike_price,
    type: c.contract_type,
    expiration: c.expiration_date,
  }));
  return ok(contracts, makeProvenance({
    source: NAME,
    freshnessMs: 0,
    confidence: 'high',
    adapterChain: [NAME],
    latencyMs: Date.now() - t0,
  }));
}

/**
 * health() — lightweight reachability check + rate-limit headroom.
 */
async function health() {
  const t0 = Date.now();
  // market-status is a very cheap endpoint; use as heartbeat.
  const res = await polygonFetch('/v1/marketstatus/now', {}, 1500);
  const latencyMs = Date.now() - t0;
  if (!res.ok) return err(res.error, makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME], latencyMs }));
  return ok(
    {
      adapter: NAME,
      upstreamStatus: res.body && res.body.market,
      observedLatencyMs: latencyMs,
      checkedAt: new Date().toISOString(),
    },
    makeProvenance({ source: NAME, confidence: 'high', adapterChain: [NAME], latencyMs }),
  );
}

module.exports = {
  describe,
  quote,
  candles,
  news,
  chain,
  health,
};
