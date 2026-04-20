/**
 * server/adapters/asianRssAdapter.js
 * ─────────────────────────────────────────────────────────────────────
 * Wave 7 / W7.2 audit-corrective — canonical NewsEvent parsers for the
 * three APAC wires the CIO v2 audit flagged as missing: Nikkei Asia
 * (Japan), South China Morning Post (Hong Kong), and Korea Economic
 * Daily / KED Global (South Korea).
 *
 * Why RSS and not vendor feeds:
 *   Finnhub covers APAC quotes but its news endpoint is US-centric.
 *   Each outlet here publishes a public, stable RSS feed; we funnel
 *   them through the same typed NewsEvent[] contract every other
 *   adapter emits, so newsRouter's dedupe + noMaterialNews logic
 *   applies identically to Asian news.
 *
 * Per-market feed choice:
 *   - TSE  → Nikkei Asia English  (broader than Nikkei JP; indexes cross-
 *            sector Japanese corporate news in the language our AI layer
 *            synthesises in).
 *   - HKEX → South China Morning Post Business  (primary English-language
 *            wire for HK + mainland-listed names).
 *   - KRX  → KED Global / Korea Economic Daily  (English bureau of 매일경제).
 *
 * Shape:
 *   describe()            → DECLARATION (coverage cells, SLA, env)
 *   news(symbol, opts?)   → Result<NewsEvent[]>
 *   health(opts?)         → Result<{healthy:true, latencyMs}>
 *
 * All three markets share one implementation: fetch the RSS XML, hand
 * it to newsParser.parseRssDocument, tag each event with the regional
 * source name, filter by symbol (case-insensitive substring on title +
 * summary — RSS feeds don't ship tickers).
 *
 * Feed URLs are overridable via env so ops can swap them without a
 * redeploy. Defaults are the URLs documented by each outlet as of the
 * adapter's ship date; if an outlet changes its feed path, adapter
 * health turns red BEFORE a user sees an empty news panel.
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

const nodeFetch = require('node-fetch');
const { ok, err, makeProviderError, makeProvenance } = require('./contract');
const { parseRssDocument } = require('../parsers/newsParser');

const NAME = 'asian-rss';
const VERSION = '1.0.0';

// Canonical feed catalog. Per-outlet env overrides keep the adapter
// operable even if an outlet rotates its feed URL. `sourceName` is
// what ends up in NewsEvent.source — kept human-readable so UIs that
// render "Source: <name>" show 'Nikkei Asia' instead of a URL slug.
const FEEDS = Object.freeze([
  {
    market: 'TSE',
    assetClass: 'equity',
    sourceName: 'Nikkei Asia',
    envVar: 'NIKKEI_ASIA_RSS_URL',
    defaultUrl: 'https://asia.nikkei.com/rss/feed/nar',
  },
  {
    market: 'HKEX',
    assetClass: 'equity',
    sourceName: 'South China Morning Post',
    envVar: 'SCMP_RSS_URL',
    defaultUrl: 'https://www.scmp.com/rss/91/feed', // SCMP Business
  },
  {
    market: 'KRX',
    assetClass: 'equity',
    sourceName: 'Korea Economic Daily',
    envVar: 'KED_GLOBAL_RSS_URL',
    defaultUrl: 'https://english.kedglobal.com/rss/allArticle.xml',
  },
]);

function feedUrlFor(market) {
  const feed = FEEDS.find((f) => f.market === market);
  if (!feed) return null;
  return process.env[feed.envVar] || feed.defaultUrl;
}

const DECLARATION = Object.freeze({
  name: NAME,
  version: VERSION,
  capabilities: ['news', 'health'],
  coverageCells: Object.freeze([
    { market: 'TSE',  assetClass: 'equity', capability: 'news', confidence: 'medium' },
    { market: 'HKEX', assetClass: 'equity', capability: 'news', confidence: 'medium' },
    { market: 'KRX',  assetClass: 'equity', capability: 'news', confidence: 'medium' },
  ]),
  // RSS feeds are not real-time — we aim for a 15-minute P95.
  latencyP95TargetMs: 4000,
  // Most APAC outlets publish every 1-2 hours on market days; a 6h
  // freshness window is generous enough to survive weekends + holiday
  // gaps without demoting confidence on otherwise-healthy markets.
  freshnessSlaSec: 6 * 3600,
  rateLimit: { requestsPerSec: 2, burst: 4 },
  // No auth — RSS is public. Listed empty so the harness doesn't flag
  // as "auth-skipped".
  requiredEnvVars: [],
});

const DEFAULT_TIMEOUT_MS = 6000;

// ── HTTP wrapper ────────────────────────────────────────────────────

function httpStatusToCode(status) {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500 && status < 600) return 'UPSTREAM_5XX';
  if (status >= 400 && status < 500) return 'UPSTREAM_4XX';
  return 'UNKNOWN';
}

async function fetchRss(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = {}) {
  const fetchFn = fetchImpl || nodeFetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        // Some outlets 403 on curl-like UAs; a vanilla accept header
        // is enough for the feeds we care about.
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'Particle/1.0 (+https://particle.app)',
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: makeProviderError(httpStatusToCode(res.status), NAME, {
          upstream: String(res.status),
          message: `${url} returned ${res.status}`,
        }),
      };
    }
    const body = await res.text();
    return { ok: true, status: res.status, body };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return {
        ok: false,
        status: 0,
        error: makeProviderError('TIMEOUT', NAME, {
          message: `${url} timed out after ${timeoutMs}ms`,
        }),
      };
    }
    return {
      ok: false,
      status: 0,
      error: makeProviderError('UNKNOWN', NAME, {
        message: e && e.message ? e.message : String(e),
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Market discovery from ticker ────────────────────────────────────
// APAC tickers in Finnhub/Yahoo format:
//   005930.KS  → KRX (Korea)
//   7203.T     → TSE (Japan)
//   0700.HK    → HKEX (Hong Kong)
//   D05.SI     → SGX (Singapore) — not covered by this adapter yet
//
// Returns null for US/EU/BR — caller should route elsewhere.

function marketForSymbol(symbol) {
  if (typeof symbol !== 'string') return null;
  const s = symbol.trim().toUpperCase();
  if (s.endsWith('.KS') || s.endsWith('.KQ')) return 'KRX';
  if (s.endsWith('.T')  || s.endsWith('.TO')) return 'TSE';
  if (s.endsWith('.HK')) return 'HKEX';
  return null;
}

// ── Relevance filter ────────────────────────────────────────────────
// RSS feeds don't tag tickers. We filter loosely — an item is relevant
// if the symbol's LEFT part (e.g. "7203" for "7203.T") or its declared
// company name (optional) appears in the headline or summary. A blank
// symbol matches everything (market-wide news feed).

function stripExchangeSuffix(symbol) {
  return String(symbol || '').toUpperCase().replace(/\.(KS|KQ|T|TO|HK|SI|SA|DE|L)$/, '');
}

function itemMatchesSymbol(event, symbol) {
  if (!symbol) return true;
  const needle = stripExchangeSuffix(symbol);
  if (!needle || needle.length < 2) return false;
  const haystack = `${event.headline || ''} ${event.summary || ''}`.toUpperCase();
  return haystack.includes(needle);
}

// ── Public API ──────────────────────────────────────────────────────

function describe() {
  return DECLARATION;
}

/**
 * news(symbol, opts?) — fetch regional news relevant to an APAC ticker.
 *
 * Strategy: resolve the ticker to a market → fetch the market's
 * canonical RSS → run it through parseRssDocument → filter items that
 * mention the symbol (or the whole feed if no symbol). Returns
 * NOT_IN_COVERAGE for non-APAC symbols so the chain walker can move on.
 *
 * @param {string} symbol — e.g. '005930.KS', '7203.T', '0700.HK'
 * @param {{ fetchImpl?: Function, timeoutMs?: number, marketOverride?: string }} [opts]
 * @returns {Promise<Result<NewsEvent[]>>}
 */
async function news(symbol, opts = {}) {
  const t0 = Date.now();
  const market = opts.marketOverride || marketForSymbol(symbol);
  if (!market) {
    return err(
      makeProviderError('NOT_IN_COVERAGE', NAME, {
        message: `asian-rss only covers TSE/HKEX/KRX tickers, got '${symbol}'`,
      }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME] }),
    );
  }

  const url = feedUrlFor(market);
  if (!url) {
    // Unreachable in practice (market came from marketForSymbol which
    // only returns covered markets), but defensive.
    return err(
      makeProviderError('NOT_IN_COVERAGE', NAME, {
        message: `No feed configured for market '${market}'`,
      }),
      makeProvenance({ source: NAME, confidence: 'unverified', adapterChain: [NAME] }),
    );
  }

  const res = await fetchRss(url, {
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

  const feed = FEEDS.find((f) => f.market === market);
  const events = parseRssDocument(res.body, feed.sourceName);

  // Apply symbol relevance filter and tag tickers so the chat layer can
  // dedupe against the symbol the user actually asked about.
  const needle = stripExchangeSuffix(symbol);
  const filtered = [];
  for (const ev of events) {
    if (!itemMatchesSymbol(ev, symbol)) continue;
    filtered.push({
      ...ev,
      // RSS items don't carry tickers; we stamp the canonical symbol
      // so downstream consumers have a join key. NewsEvent is a frozen
      // object, so we rebuild — makeNewsEvent already ran once inside
      // parseRssDocument and produced the immutable shape, but the
      // spread into a plain object here is fine because newsRouter's
      // dedupe only reads .id / .url.
      tickers: symbol ? [String(symbol).toUpperCase()] : [],
    });
  }

  // freshness = "this feed was fetched now"; we don't have a reliable
  // per-item `asOf` because RSS pubDate can lag. confidence = medium
  // because RSS ticker-tagging is a heuristic, not authoritative.
  return ok(filtered, makeProvenance({
    source: NAME,
    fetchedAt: new Date().toISOString(),
    freshnessMs: 0, // fetched just now
    confidence: filtered.length > 0 ? 'medium' : 'low',
    adapterChain: [NAME],
    latencyMs: Date.now() - t0,
  }));
}

/**
 * health() — ping the Nikkei Asia feed (canonical APAC outlet). A 200
 * with at least one parseable <item> is treated as healthy; anything
 * else is red. We intentionally probe just one outlet — if Nikkei is
 * up but SCMP is down, per-market degradation will show up in the
 * harness's cell-level probes, not the adapter-level health check.
 */
async function health(opts = {}) {
  const t0 = Date.now();
  const url = feedUrlFor('TSE');
  const res = await fetchRss(url, {
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
  const events = parseRssDocument(res.body, 'Nikkei Asia');
  if (events.length === 0) {
    return err(
      makeProviderError('SCHEMA_MISMATCH', NAME, {
        message: 'Nikkei RSS returned 200 but produced zero parseable items',
      }),
      makeProvenance({
        source: NAME,
        confidence: 'unverified',
        adapterChain: [NAME],
        latencyMs: Date.now() - t0,
      }),
    );
  }
  return ok(
    { healthy: true, latencyMs: Date.now() - t0, items: events.length },
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
  news,
  health,
  // Exposed for tests / operator tooling.
  _internal: {
    FEEDS,
    feedUrlFor,
    marketForSymbol,
    stripExchangeSuffix,
    itemMatchesSymbol,
    fetchRss,
  },
};
