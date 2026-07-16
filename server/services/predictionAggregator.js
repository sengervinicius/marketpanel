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
 *   getForYouMarkets(opts) — Finance/macro-relevance ranked feed (sports excluded)
 *   isSportsMarket(m)      — True when a market is sports (category or title)
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
  // Sports live ONLY behind their own explicit tab — they are excluded from
  // FOR YOU / default feeds (see isSportsMarket / getForYouMarkets below).
  'sports':      { label: 'Sports',          icon: '🏟️', priority: 10 },
};

// ── Finance/macro relevance model (FOR YOU ranking) ─────────────────────────
//
// The default "FOR YOU" feed is a *market terminal* feed: it must surface
// fed/rates/inflation/macro/commodities/geopolitics markets, never the
// World Cup. Two pieces:
//   isSportsMarket()       — hard exclusion (category OR title keywords, so
//                            sports misclassified as 'other' are still caught)
//   scoreFinanceRelevance() — category base weight + finance keyword hits
const SPORTS_TITLE_RE = new RegExp(
  [
    'world\\s*cup', 'fifa', 'uefa', 'premier\\s*league', 'champions\\s*league',
    'la\\s*liga', 'serie\\s*a', 'bundesliga', 'ligue\\s*1', 'soccer', 'football',
    'nfl', 'nba', 'mlb', 'nhl', 'wnba', 'ncaa', 'march\\s*madness',
    'super\\s*bowl', 'superbowl', 'stanley\\s*cup', 'world\\s*series',
    'tennis', 'wimbledon', 'grand\\s*slam', 'olympic', 'olympics',
    'ufc', 'mma', 'boxing', 'formula\\s*1', 'grand\\s*prix', 'nascar',
    'pga', 'golf', 'cricket', 'rugby', 'heisman', "ballon\\s*d'or",
    'basketball', 'baseball', 'touchdown', 'playoffs?', 'esports',
  ].map(k => `\\b(?:${k})\\b`).join('|'),
  'i',
);

/**
 * True when a market is a sports market — by category (providers classify
 * known sports tags/tickers) or by title keywords (catches sports markets
 * that fell through to 'other').
 * @param {Object} m normalized market
 * @returns {boolean}
 */
function isSportsMarket(m) {
  if (!m) return false;
  if (m.category === 'sports') return true;
  return SPORTS_TITLE_RE.test(String(m.title || ''));
}

// Category → base finance/macro relevance weight.
const CATEGORY_FINANCE_WEIGHT = {
  'fed-rates':   10,
  'inflation':    9,
  'economy':      8,
  'markets':      8,
  'crypto':       6,
  'geopolitics':  5,
  'politics':     4,
  'tech':         4,
  'other':        0,
};

// Finance keyword boosts applied to the market title.
const FINANCE_KEYWORDS = [
  { re: /(fed|fomc|powell|rate\s*(?:cut|hike)s?|interest\s*rates?|central\s*bank|ecb|boj|boe|copom|selic|monetary\s*policy)/i, weight: 5 },
  { re: /(inflation|cpi|pce|deflation)/i, weight: 5 },
  { re: /(gdp|recession|unemployment|payrolls?|nonfarm|jobs\s*report)/i, weight: 4 },
  { re: /(oil|crude|brent|wti|opec|natural\s*gas|gold)/i, weight: 4 },
  { re: /(tariffs?|trade\s*war|sanctions?)/i, weight: 4 },
  { re: /(treasur(?:y|ies)|yields?|s&p|sp500|nasdaq|dow|stock\s*market|ipo)/i, weight: 4 },
  { re: /(elections?|president(?:ial)?|congress|senate|shutdown|debt\s*ceiling)/i, weight: 3 },
  { re: /(currenc(?:y|ies)|dollar|euro|yen|yuan|exchange\s*rate|devaluation)/i, weight: 3 },
  { re: /(crypto\s*etf|etf\s*approval|bitcoin|btc|ethereum|eth|stablecoin)/i, weight: 3 },
];

/**
 * Finance/macro relevance score for a market. Sports score -Infinity so
 * they can never outrank anything even if a caller forgets to filter.
 * @param {Object} m normalized market
 * @returns {number}
 */
function scoreFinanceRelevance(m) {
  if (!m) return 0;
  if (isSportsMarket(m)) return -Infinity;
  let score = CATEGORY_FINANCE_WEIGHT[m.category] || 0;
  const title = String(m.title || '');
  for (const { re, weight } of FINANCE_KEYWORDS) {
    if (re.test(title)) score += weight;
  }
  return score;
}

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
 *
 * Phase 10.3 — CIO reported "predictions is all Polymarket, where's
 * Kalshi?". Root cause: Polymarket volume24h is reported in USD
 * ($M typical), Kalshi volume_24h is reported in contract *count*
 * (thousands typical). A naive volume-desc sort therefore pushes every
 * Kalshi row below every Polymarket row, and the Predictions panel
 * showing top 30 displays all POLY.
 *
 * Fix: sort within each source by volume, then INTERLEAVE by source
 * before taking the top N. That way a top-20 query gets ~10 of each,
 * ranked by each source's own liquidity.
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

    const kalshiList = kalshiMarkets.status === 'fulfilled' ? kalshiMarkets.value : [];
    const polyList   = polymarketMarkets.status === 'fulfilled' ? polymarketMarkets.value : [];

    if (kalshiMarkets.status !== 'fulfilled') {
      console.warn('[PredictionAggregator] Kalshi fetch failed:', kalshiMarkets.reason?.message);
    }
    if (polymarketMarkets.status !== 'fulfilled') {
      console.warn('[PredictionAggregator] Polymarket fetch failed:', polymarketMarkets.reason?.message);
    }

    // Rank within each source by that source's own volume first.
    kalshiList.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    polyList.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));

    // Round-robin interleave so top-N slices contain both sources.
    const interleaved = [];
    const maxLen = Math.max(kalshiList.length, polyList.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < polyList.length) interleaved.push(polyList[i]);
      if (i < kalshiList.length) interleaved.push(kalshiList[i]);
    }
    _markets = interleaved.slice(0, MAX_MARKETS);

    // Index by category
    _byCategory = {};
    for (const m of _markets) {
      const cat = m.category || 'other';
      if (!_byCategory[cat]) _byCategory[cat] = [];
      _byCategory[cat].push(m);
    }

    _lastRefresh = Date.now();
    console.log(
      `[PredictionAggregator] Refreshed: ${_markets.length} markets ` +
      `(K:${kalshiList.length} P:${polyList.length}, interleaved)`,
    );
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
function getTopMarkets({ limit = 20, category, source, includeSports = false } = {}) {
  let results = _markets;
  if (category) {
    results = results.filter(m => m.category === category);
  } else if (!includeSports) {
    // No explicit category → default/ALL feed: sports are only visible
    // behind the explicit SPORTS tab (category === 'sports'), never here.
    results = results.filter(m => !isSportsMarket(m));
  }
  if (source) results = results.filter(m => m.source === source);
  return results.slice(0, limit);
}

/**
 * FOR YOU default feed — markets ranked by finance/macro relevance
 * (category weight + finance keyword hits), volume as tie-breaker.
 * Sports markets are hard-excluded.
 * @param {Object} opts
 * @param {number} opts.limit - Max results (default 8)
 * @returns {Array}
 */
function getForYouMarkets({ limit = 8 } = {}) {
  return _markets
    .filter(m => !isSportsMarket(m))
    .map(m => ({ m, score: scoreFinanceRelevance(m) }))
    .sort((a, b) => (b.score - a.score) || ((b.m.volume24h || 0) - (a.m.volume24h || 0)))
    .slice(0, Math.max(1, limit))
    .map(x => x.m);
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

  // If no specific category matched, return top non-sports markets
  if (relevantCats.size === 0) {
    return _markets.filter(m => !isSportsMarket(m)).slice(0, 5);
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

/**
 * TEST-ONLY seam: replace the in-memory market cache with a fixture list
 * and mark it fresh so ensureFresh() doesn't hit the network. Never call
 * from production code.
 * @param {Array} markets
 */
function __setMarketsForTest(markets) {
  _markets = Array.isArray(markets) ? [...markets] : [];
  _byCategory = {};
  for (const m of _markets) {
    const cat = m.category || 'other';
    if (!_byCategory[cat]) _byCategory[cat] = [];
    _byCategory[cat].push(m);
  }
  _lastRefresh = Date.now();
}

module.exports = {
  init,
  stop,
  refresh,
  getTopMarkets,
  getForYouMarkets,
  getByCategory,
  getForQuery,
  getCategories,
  formatForAI,
  getSummary,
  ensureFresh,
  isSportsMarket,
  scoreFinanceRelevance,
  __setMarketsForTest,
};
