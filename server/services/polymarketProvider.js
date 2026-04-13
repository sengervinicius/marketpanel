/**
 * polymarketProvider.js — Polymarket prediction market data provider.
 *
 * Fetches market data from Polymarket's Gamma API (no auth required).
 * Returns normalized prediction market objects for the aggregator.
 *
 * Gamma API: https://gamma-api.polymarket.com
 * CLOB API: https://clob.polymarket.com (live prices)
 * Docs: https://docs.polymarket.com
 */

const GAMMA_URL = 'https://gamma-api.polymarket.com';
const CLOB_URL = 'https://clob.polymarket.com';

// ── Tag ID mapping: Polymarket tag IDs → our categories ─────────────────────
const TAG_CATEGORY_MAP = {
  // Finance / Markets
  '120':    'markets',
  'finance': 'markets',
  // Crypto
  '21':     'crypto',
  'crypto': 'crypto',
  'bitcoin': 'crypto',
  'ethereum': 'crypto',
  // Tech
  '1401':   'tech',
  'tech':   'tech',
  'ai':     'tech',
  // Geopolitics
  '100265': 'geopolitics',
  'geopolitics': 'geopolitics',
  'war':    'geopolitics',
  'china':  'geopolitics',
  // Politics
  'politics': 'politics',
  'elections': 'politics',
  'congress': 'politics',
  'president': 'politics',
  // Economy
  'economy': 'economy',
  'fed':     'fed-rates',
  'inflation': 'inflation',
  'recession': 'economy',
  'gdp':     'economy',
  'jobs':    'economy',
};

/**
 * Classify a Polymarket market based on its tags and title.
 */
function classifyMarket(tags, title) {
  // Check tags first
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      const tagLower = String(tag).toLowerCase();
      if (TAG_CATEGORY_MAP[tagLower]) return TAG_CATEGORY_MAP[tagLower];
    }
  }

  // Fallback: keyword match on title
  const titleLower = (title || '').toLowerCase();
  const keywordMap = {
    'fed': 'fed-rates', 'rate cut': 'fed-rates', 'rate hike': 'fed-rates', 'fomc': 'fed-rates',
    'cpi': 'inflation', 'inflation': 'inflation', 'pce': 'inflation',
    'gdp': 'economy', 'recession': 'economy', 'unemployment': 'economy', 'jobs': 'economy',
    'bitcoin': 'crypto', 'btc': 'crypto', 'ethereum': 'crypto', 'eth': 'crypto', 'crypto': 'crypto', 'solana': 'crypto',
    'trump': 'politics', 'biden': 'politics', 'election': 'politics', 'congress': 'politics', 'senate': 'politics',
    'war': 'geopolitics', 'ukraine': 'geopolitics', 'china': 'geopolitics', 'tariff': 'geopolitics', 'nato': 'geopolitics',
    's&p': 'markets', 'nasdaq': 'markets', 'dow': 'markets', 'stock': 'markets', 'ipo': 'markets',
    'ai': 'tech', 'openai': 'tech', 'apple': 'tech', 'google': 'tech', 'tesla': 'tech',
  };

  for (const [keyword, category] of Object.entries(keywordMap)) {
    if (titleLower.includes(keyword)) return category;
  }

  return 'other';
}

/**
 * Parse Polymarket outcomePrices.
 * outcomePrices is a JSON string like '["0.65","0.35"]' where [0] = yes, [1] = no.
 */
function parseOutcomePrices(outcomePrices) {
  try {
    if (!outcomePrices) return null;
    const parsed = typeof outcomePrices === 'string' ? JSON.parse(outcomePrices) : outcomePrices;
    if (Array.isArray(parsed) && parsed.length >= 1) {
      return parseFloat(parsed[0]); // yes price = probability
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch active markets from Polymarket Gamma API.
 * @param {Object} opts
 * @param {number} opts.limit - Max markets to return (default 50)
 * @param {boolean} opts.active - Only active markets (default true)
 * @param {string} opts.order - Sort order: 'volume24hr' (default), 'liquidity', 'startDate'
 * @returns {Promise<Array>} Normalized prediction market objects
 */
async function fetchMarkets({ limit = 50, active = true, order = 'volume24hr' } = {}) {
  try {
    const params = new URLSearchParams({
      limit: String(limit),
      active: String(active),
      closed: 'false',
      order,
      ascending: 'false',
    });

    const url = `${GAMMA_URL}/markets?${params}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Particle-Terminal/1.0',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[Polymarket] Gamma API error ${response.status}`);
      return [];
    }

    const markets = await response.json();

    if (!Array.isArray(markets)) {
      console.warn('[Polymarket] Unexpected response format');
      return [];
    }

    return markets
      .map(m => {
        const probability = parseOutcomePrices(m.outcomePrices);
        if (probability == null) return null;

        return {
          source: 'polymarket',
          id: m.id || m.conditionId,
          eventId: m.groupItemTitle || null,
          title: m.question || m.title || 'Untitled market',
          question: m.question || m.title || 'Untitled market',
          probability,
          volume24h: parseFloat(m.volume24hr) || 0,
          totalVolume: parseFloat(m.volume) || 0,
          liquidity: parseFloat(m.liquidity) || 0,
          category: classifyMarket(m.tags || [], m.question || m.title || ''),
          status: m.active ? 'open' : 'closed',
          closeTime: m.endDate || null,
          url: m.slug ? `https://polymarket.com/event/${m.slug}` : 'https://polymarket.com',
          lastUpdated: new Date().toISOString(),
          outcomes: m.outcomes || ['Yes', 'No'],
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.error('[Polymarket] Fetch error:', err.message);
    return [];
  }
}

/**
 * Fetch events from Polymarket (grouped markets).
 */
async function fetchEvents({ limit = 20, active = true } = {}) {
  try {
    const params = new URLSearchParams({
      limit: String(limit),
      active: String(active),
      closed: 'false',
      order: 'volume24hr',
      ascending: 'false',
    });

    const response = await fetch(`${GAMMA_URL}/events?${params}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Particle-Terminal/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];
    const events = await response.json();
    return Array.isArray(events) ? events : [];
  } catch (err) {
    console.error('[Polymarket] Fetch events error:', err.message);
    return [];
  }
}

module.exports = { fetchMarkets, fetchEvents, classifyMarket, parseOutcomePrices };
