/**
 * lib/newsRouter.js — Wave 2 (WS5.3) — Registry-backed news dispatcher.
 *
 * Companion to quoteRouter.js. Dispatches a news request through the
 * typed AdapterRegistry and returns a merged NewsEvent[] with
 * provenance. The canonical shape — headline/source/url/publishedAt/
 * tickers/confidence — is defined in server/adapters/contract.js and
 * enforced by server/parsers/newsParser.js.
 *
 * Unlike quotes, news is a *collection* — multiple adapters can
 * contribute complementary items for the same query (e.g. Polygon for
 * US tickers, Finnhub for the market-wide feed, and eventually RSS
 * fallbacks for Bloomberg/FT/Reuters). To reflect that, this module:
 *
 *   1. Classifies the target (ticker → (market, assetClass=equity);
 *      no-ticker keyword/query → (US, equity) default feed).
 *   2. Walks every adapter in the chain (not just first-ok, like
 *      executeChain does for singleton Results) and concatenates
 *      their NewsEvent[] outputs, dedupes by URL, and sorts most-
 *      recent-first.
 *   3. Records the full adapterChain in provenance so the UI can
 *      render "3 items from Polygon, 2 from Finnhub" attribution.
 *
 * Sentinel handling: the Perplexity sentinel lives in parser-land
 * (parsePerplexityResponse). When a future Sonar adapter joins the
 * chain, its news() wrapper is responsible for short-circuiting on
 * noMaterialNews; this router stays focused on merging real items.
 *
 * Strangler-fig pattern: legacy callers in providers.js / search.js
 * can wrap this with their existing fallback chains (RSS, Alpha
 * Vantage news) until the registry coverage expands. WS5.4 threads
 * the typed events into the chat synthesis prompt.
 */

'use strict';

const logger = require('../../../utils/logger');

// ── Classification helper ────────────────────────────────────────────
// Same suffix/prefix taxonomy as quoteRouter.classifyForRegistry, but
// news coverage is much thinner: Polygon covers US-equity news
// medium-confidence; Finnhub covers global-equity news (implicitly
// via /news?category=general). Everything else returns null and
// falls back to the caller's legacy path.

const { classifyForRegistry } = require('./quoteRouter');

// ── Dedupe + merge helpers ───────────────────────────────────────────

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    // Drop tracking params so Bloomberg?utm_source=x and
    // Bloomberg?utm_source=y dedupe to the same item.
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.startsWith('utm_') || key === 'cmpid' || key === 'srnd') {
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

/**
 * Merge multiple NewsEvent[] arrays into one deduped, time-sorted
 * array. Dedupe key is canonicalized URL; when two providers return
 * the same URL, the higher-confidence item wins, breaking ties by
 * earliest adapterChain position (upstream-most provider).
 *
 * @param {Array<{source: string, events: import('../../../adapters/contract').NewsEvent[]}>} batches
 * @returns {import('../../../adapters/contract').NewsEvent[]}
 */
function mergeDedupe(batches) {
  const confRank = { high: 3, medium: 2, low: 1, unverified: 0 };
  const map = new Map(); // normalizedUrl -> {event, rank, order}
  batches.forEach((batch, order) => {
    for (const ev of batch.events || []) {
      if (!ev || !ev.url) continue;
      const key = normalizeUrl(ev.url);
      const incomingRank = confRank[ev.confidence] || 0;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { event: ev, rank: incomingRank, order });
        continue;
      }
      // Higher confidence wins; on tie, earlier chain wins.
      if (incomingRank > existing.rank ||
          (incomingRank === existing.rank && order < existing.order)) {
        map.set(key, { event: ev, rank: incomingRank, order });
      }
    }
  });
  const merged = Array.from(map.values()).map(v => v.event);
  // Most recent first (parsers guarantee ISO 8601 timestamps).
  merged.sort((a, b) => {
    const ta = Date.parse(a.publishedAt) || 0;
    const tb = Date.parse(b.publishedAt) || 0;
    return tb - ta;
  });
  return merged;
}

// ── fetchNewsRouted ──────────────────────────────────────────────────

/**
 * Dispatch a news request through the registry. Unlike quote
 * dispatch (first-ok short-circuits), every adapter in the chain is
 * asked; results are merged, deduped, sorted.
 *
 * Returns one of:
 *   - { ok: true, data: NewsEvent[], sources: string[],
 *       provenance: { adapterChain, ... } }
 *       — at least one adapter returned items (or empty array)
 *   - { ok: false, reason: 'no_coverage', market, assetClass }
 *       — no adapter declares news coverage for the classified cell
 *   - { ok: false, reason: 'chain_failed', errors, provenance }
 *       — every adapter in the chain errored
 *   - null — target unclassifiable (currently unreachable; keeps
 *       shape parity with quoteRouter)
 *
 * @param {Object} opts
 * @param {string} [opts.ticker] — explicit ticker (preferred)
 * @param {string} [opts.query]  — free-text query; used when ticker absent
 * @param {number} [opts.limit]  — per-adapter cap
 * @param {string[]} [opts.skip] — adapter names to exclude from the chain
 * @returns {Promise<Object|null>}
 */
async function fetchNewsRouted(opts = {}) {
  const { ticker, query, limit, skip } = opts;

  // Classification: prefer ticker; fall back to US-equity feed for
  // free-text queries so Finnhub's market-wide news is reachable.
  let classification;
  if (ticker) {
    classification = classifyForRegistry(ticker);
  }
  if (!classification) {
    classification = { market: 'US', assetClass: 'equity' };
  }

  const { getRegistry } = require('../../../adapters/registry');
  const registry = getRegistry();
  let chain = registry.route(classification.market, classification.assetClass, 'news');

  if (Array.isArray(skip) && skip.length > 0) {
    const skipSet = new Set(skip.map(s => String(s).toLowerCase()));
    chain = chain.filter(a => {
      const n = (a.describe && a.describe().name) || '';
      return !skipSet.has(String(n).toLowerCase());
    });
  }

  if (!chain || chain.length === 0) {
    return {
      ok: false,
      reason: 'no_coverage',
      market: classification.market,
      assetClass: classification.assetClass,
    };
  }

  const t0 = Date.now();
  const attempted = [];
  const batches = [];
  const errors = [];

  for (const adapter of chain) {
    const decl = typeof adapter.describe === 'function' ? adapter.describe() : { name: 'unknown' };
    attempted.push(decl.name);
    if (typeof adapter.news !== 'function') {
      errors.push({ adapter: decl.name, code: 'NOT_IN_COVERAGE', message: 'news method missing' });
      continue;
    }
    try {
      // Prefer the explicit ticker-scoped call (confidence='high'
      // items from Finnhub/Polygon). Fall back to the free-text
      // query when no ticker is provided.
      const adapterArg = ticker ? '' : (query || '');
      const adapterOpts = { limit: limit || 20 };
      if (ticker) adapterOpts.ticker = ticker;
      const r = await adapter.news(adapterArg, adapterOpts);
      if (r && r.ok) {
        batches.push({ source: decl.name, events: r.data || [] });
      } else if (r && r.error) {
        errors.push({ adapter: decl.name, code: r.error.code, message: r.error.message });
      }
    } catch (e) {
      errors.push({ adapter: decl.name, code: 'UNKNOWN', message: e && e.message ? e.message : String(e) });
    }
  }

  const latencyMs = Date.now() - t0;
  if (batches.length === 0) {
    logger.warn('newsRouter', `all news adapters failed for ${ticker || query || '(no target)'}`, {
      market: classification.market,
      chain: attempted,
      errors,
    });
    return {
      ok: false,
      reason: 'chain_failed',
      errors,
      provenance: {
        source: 'newsRouter',
        adapterChain: attempted,
        latencyMs,
      },
    };
  }

  const merged = mergeDedupe(batches);
  const sources = batches.map(b => b.source);
  logger.info('newsRouter', `routed news for ${ticker || query || '(feed)'}`, {
    market: classification.market,
    chain: attempted,
    itemCount: merged.length,
    sources,
    latencyMs,
  });
  return {
    ok: true,
    data: merged,
    sources,
    provenance: {
      source: 'newsRouter',
      adapterChain: attempted,
      itemCount: merged.length,
      latencyMs,
      market: classification.market,
      assetClass: classification.assetClass,
    },
  };
}

module.exports = {
  fetchNewsRouted,
  // Exposed for tests.
  _mergeDedupe: mergeDedupe,
  _normalizeUrl: normalizeUrl,
};
