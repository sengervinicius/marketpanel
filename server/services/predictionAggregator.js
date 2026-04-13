/**
 * predictionAggregator.js — Unified prediction market aggregator.
 *
 * Combines Kalshi and Polymarket data into a single normalized feed.
 * Provides caching, category filtering, and relevance matching for AI context.
 *
 * Exports:
 *   init()               — Start background polling
 *   getTopMarkets(opts)   — Get top markets, optionally filtered
 *   getByCategory(cat)    — Get markets by category
 *   getForQuery(query)    — Get markets relevant to a user query (for AI injection)
 *   getCategories()       — Get available categories with counts
 *   refresh()             — Force immediate refresh
 */

const kalshi = require('./kalshiProvider');
const polymarket = require('./polymarketProvider');

// ── In-memory cache ─────────────────────────────────────────────────────────
let _markets = [];            // All markets, sorted by volume
let _byCategory = {};         // { category: [...] }
let _lastRefresh = 0;
let _refreshing = false;
let _pollTimer = null;

const CACHE_TTL = 2 * 60 * 1000;      // 2 min cache
const POLL_INTERVAL = 2 * 60 * 1000;   // Poll every 2 min
const MAX_MARKETS = 200;                // Keep top 200

// ── Category definitions ────────────────────────────────────────────────────
const CATEGORIES = {
  'fed-rates':   { label: 'Fed / Rates',    icon: '🏦', priority: 1 },
  'inflation':   { label: 'Inflation / CPI', icon: '📈', priority: 2 },
  'economy':     { label: 'Economy',         icon: '💼', priority: 3 },
  'markets':     { label: 'Markets',         icon: '📊', priority: 4 },
  'crypto':      { label: 'Crypto',          icon: '₿',  priority: 5 },
  'politics':    { label: 'Politics',        icon: '🏛',  priority: 6 },
  'geopolitics': { label: 'Geopolitics',     icon: '🌍', priority: 7 },
  'tech':        { label: 'Tech',            icon: '🤖', priority: 8 },
  'other':       { label: 'Other',           icon: '📌', priority: 9 },
};

// ── Query → category relevance mapping (for AI context injection) ───────────
const QUERY_CATEGORY_MAP = [
  { pattern: /\b(fed|fomc|rate\s*cut|rate\s*hike|interest\s*rate|powell|monetary\s*policy)\b/i, categories: ['fed-rates', 'economy'] },
  { pattern: /\b(cpi|inflation|pce|consumer\s*price|deflation)\b/i, categories: ['inflation', 'economy'] },
  { pattern: /\b(gdp|recession|unemployment|jobs|labor|nonfarm|payroll|economy)\b/i, categories: ['economy'] },
  { pattern: /\b(bitcoin|btc|ethereum|eth|crypto|solana|sol|defi|blockchain|altcoin)\b/i, categories: ['crypto'] },
  { pattern: /\b(election|trump|biden|congress|senate|vote|president|democrat|republican|gop)\b/i, categories: ['politics'] },
  { pattern: /\b(war|ukraine|china|taiwan|tariff|nato|russia|sanctions|geopolit)\b/i, categories: ['geopolitics'] },
  { pattern: /\b(s&p|spy|nasdaq|qqq|dow|dia|stock\s*market|bull|bear|rally|crash)\b/i, categories: ['markets'] },
  { pattern: /\b(ai|openai|chatgpt|apple|google|meta|nvidia|tesla|ipo|tech)\b/i, categories: ['tech'] },
];

/**
 * Refresh all markets from both providers.
 */
async function refresh() {
  if (_refreshing) return;
  _refreshing = true;

  try {
    // Fetch from both sources in parallel
    const [kalshiMarkets, polymarketMarkets] = await Promise.allSettled([
      kalshi.fetchMarkets({ limit: 100, status: 'open' }),
      polymarket.fetchMarkets({ limit: 100 }),
    ]);

    const allMarkets = [];

    if (kalshiMarkets.status === 'fulfilled') {
      allMarkets.push(...kalshiMarkets.value);
    } else {
      console.warn('[PredictionAggregator] Kalshi fetch failed:', kalshiMarkets.reason?.message);
    }

    if (polymarketMarkets.status === 'fulfilled') {
      allMarkets.push(...polymarketMarkets.value);
    } else {
      console.warn('[PredictionAggregator] Polymarket fetch failed:', polymarketMarkets.reason?.message);
    }

    // Sort by 24h volume descending, take top N
    allMarkets.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    _markets = allMarkets.slice(0, MAX_MARKETS);

    // Index by category
    _byCategory = {};
    for (const m of _markets) {
      const cat = m.category || 'other';
      if (!_byCategory[cat]) _byCategory[cat] = [];
      _byCategory[cat].push(m);
    }

    _lastRefresh = Date.now();
    console.log(`[PredictionAggregator] Refreshed: ${_markets.length} markets (K:${kalshiMarkets.status === 'fulfilled' ? kalshiMarkets.value.length : 0} P:${polymarketMarkets.status === 'fulfilled' ? polymarketMarkets.value.length : 0})`);
  } catch (err) {
    console.error('[PredictionAggregator] Refresh error:', err.message);
  } finally {
    _refreshing = false;
  }
}

/**
 * Start background polling.
 */
function init() {
  console.log('[PredictionAggregator] Initializing...');
  // Initial fetch
  refresh();
  // Poll on interval
  _pollTimer = setInterval(refresh, POLL_INTERVAL);
}

/**
 * Stop polling (for graceful shutdown).
 */
function stop() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

/**
 * Ensure cache is fresh, refresh if stale.
 */
async function ensureFresh() {
  if (Date.now() - _lastRefresh > CACHE_TTL && !_refreshing) {
    await refresh();
  }
}

/**
 * Get top markets, optionally filtered.
 * @param {Object} opts
 * @param {number} opts.limit - Max results (default 20)
 * @param {string} opts.category - Filter by category
 * @param {string} opts.source - Filter by source ('kalshi' or 'polymarket')
 * @returns {Array}
 */
function getTopMarkets({ limit = 20, category, source } = {}) {
  let results = _markets;
  if (category) results = results.filter(m => m.category === category);
  if (source) results = results.filter(m => m.source === source);
  return results.slice(0, limit);
}

/**
 * Get markets by category.
 */
function getByCategory(category) {
  return _byCategory[category] || [];
}

/**
 * Get markets relevant to a user query — for AI context injection.
 * Returns up to 8 markets most relevant to the query intent.
 */
function getForQuery(query) {
  if (!query || _markets.length === 0) return [];

  // Determine relevant categories based on query
  const relevantCats = new Set();
  for (const { pattern, categories } of QUERY_CATEGORY_MAP) {
    if (pattern.test(query)) {
      categories.forEach(c => relevantCats.add(c));
    }
  }

  // If no specific category matched, return top markets across all categories
  if (relevantCats.size === 0) {
    return _markets.slice(0, 5);
  }

  // Get markets from relevant categories, sorted by volume
  const relevant = _markets
    .filter(m => relevantCats.has(m.category))
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
    .slice(0, 8);

  // If we got fewer than 3, pad with top overall markets
  if (relevant.length < 3) {
    const ids = new Set(relevant.map(m => m.id));
    for (const m of _markets) {
      if (!ids.has(m.id)) {
        relevant.push(m);
        if (relevant.length >= 5) break;
      }
    }
  }

  return relevant;
}

/**
 * Get available categories with counts.
 */
function getCategories() {
  const result = [];
  for (const [id, meta] of Object.entries(CATEGORIES)) {
    const markets = _byCategory[id] || [];
    if (markets.length > 0) {
      result.push({
        id,
        label: meta.label,
        icon: meta.icon,
        count: markets.length,
        priority: meta.priority,
      });
    }
  }
  return result.sort((a, b) => a.priority - b.priority);
}

/**
 * Format markets for AI context string.
 * Returns a human-readable summary for injection into system prompts.
 */
function formatForAI(markets) {
  if (!markets || markets.length === 0) return '';

  const lines = markets.map(m => {
    const pct = m.probability != null ? `${Math.round(m.probability * 100)}%` : '?%';
    const src = m.source === 'kalshi' ? 'Kalshi' : 'Polymarket';
    const vol = m.volume24h > 1000000
      ? `$${(m.volume24h / 1000000).toFixed(1)}M`
      : m.volume24h > 1000
        ? `$${(m.volume24h / 1000).toFixed(0)}K`
        : `$${Math.round(m.volume24h)}`;
    return `• ${m.title}: ${pct} yes (${src}, ${vol} 24h vol)`;
  });

  return lines.join('\n');
}

/**
 * Get summary stats for the prediction market landscape.
 */
function getSummary() {
  return {
    totalMarkets: _markets.length,
    kalshiCount: _markets.filter(m => m.source === 'kalshi').length,
    polymarketCount: _markets.filter(m => m.source === 'polymarket').length,
    categories: getCategories(),
    lastRefresh: _lastRefresh ? new Date(_lastRefresh).toISOString() : null,
    stale: Date.now() - _lastRefresh > CACHE_TTL * 2,
  };
}

module.exports = {
  init,
  stop,
  refresh,
  getTopMarkets,
  getByCategory,
  getForQuery,
  getCategories,
  formatForAI,
  getSummary,
  ensureFresh,
};
