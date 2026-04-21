/**
 * kalshiProvider.js — Kalshi prediction market data provider.
 *
 * Fetches market data from Kalshi's public REST API (no auth required for reads).
 * Returns normalized prediction market objects for the aggregator.
 *
 * API: https://api.elections.kalshi.com/trade-api/v2
 * Docs: https://docs.kalshi.com
 */

const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2';

// ── Category mapping: Kalshi series tickers → our categories ────────────────
const CATEGORY_MAP = {
  // Federal Reserve / rates
  'FED':        'fed-rates',
  'FOMC':       'fed-rates',
  'RATE':       'fed-rates',
  'FEDFUNDS':   'fed-rates',
  // Inflation / CPI
  'CPI':        'inflation',
  'INFLATION':  'inflation',
  'PCE':        'inflation',
  // Economic
  'GDP':        'economy',
  'RECESSION':  'economy',
  'UNEMP':      'economy',
  'JOBS':       'economy',
  'NONFARM':    'economy',
  // Government / politics
  'SHUTDOWN':   'politics',
  'DEBT':       'politics',
  'SCOTUS':     'politics',
  'PRES':       'politics',
  'CONGRESS':   'politics',
  'ELECT':      'politics',
  // Markets / indices
  'SP500':      'markets',
  'SPX':        'markets',
  'NASDAQ':     'markets',
  'DOW':        'markets',
  // Crypto
  'BTC':        'crypto',
  'ETH':        'crypto',
  'BITCOIN':    'crypto',
  // Tech
  'AI':         'tech',
  'TECH':       'tech',
  // Geopolitics
  'WAR':        'geopolitics',
  'UKRAINE':    'geopolitics',
  'CHINA':      'geopolitics',
  'TARIFF':     'geopolitics',
  'TRADE':      'geopolitics',
};

/**
 * Classify a Kalshi market into one of our categories.
 */
function classifyMarket(ticker, eventTicker, title) {
  const combined = `${ticker} ${eventTicker} ${title}`.toUpperCase();
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (combined.includes(keyword)) return category;
  }
  return 'other';
}

/**
 * Build a Kalshi deep-link URL. Kalshi URLs are case-sensitive and
 * canonical URLs are lowercased. The event page groups all markets
 * within an event; a `#<market_ticker>` anchor scrolls to the specific
 * leg so a user double-clicking a row lands on the right question.
 */
function buildKalshiUrl(eventTicker, marketTicker) {
  const event = (eventTicker || marketTicker || '').toString().toLowerCase();
  if (!event) return 'https://kalshi.com/markets';
  if (marketTicker && eventTicker && marketTicker !== eventTicker) {
    return `https://kalshi.com/markets/${event}#${marketTicker}`;
  }
  return `https://kalshi.com/markets/${event}`;
}

/**
 * Convert Kalshi price in cents (0-100) to probability (0-1).
 * Kalshi prices are in cents where 65¢ = 65% probability.
 */
function centsToProbability(cents) {
  if (cents == null || cents < 0) return null;
  return Math.min(1, Math.max(0, cents / 100));
}

/**
 * Fetch top active markets from Kalshi.
 * @param {Object} opts
 * @param {number} opts.limit - Max markets to return (default 50)
 * @param {string} opts.status - Market status filter: 'open' (default)
 * @returns {Promise<Array>} Normalized prediction market objects
 */
async function fetchMarkets({ limit = 50, status = 'open' } = {}) {
  try {
    const url = `${BASE_URL}/markets?limit=${limit}&status=${status}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Particle-Terminal/1.0',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[Kalshi] API error ${response.status}`);
      return [];
    }

    const data = await response.json();
    const markets = data.markets || [];

    return markets
      .filter(m => m.yes_bid != null || m.last_price != null)
      .map(m => {
        // Best estimate of probability: last trade, or midpoint of bid/ask
        const lastPrice = m.last_price != null ? m.last_price : null;
        const yesBid = m.yes_bid != null ? m.yes_bid : null;
        const yesAsk = m.yes_ask != null ? m.yes_ask : null;
        const midpoint = (yesBid != null && yesAsk != null) ? (yesBid + yesAsk) / 2 : null;
        const priceInCents = lastPrice ?? midpoint ?? yesBid;

        return {
          source: 'kalshi',
          id: m.ticker,
          eventId: m.event_ticker,
          title: m.title || m.subtitle || m.ticker,
          question: m.title || m.subtitle || `Will ${m.ticker} resolve Yes?`,
          probability: centsToProbability(priceInCents),
          yesBid: centsToProbability(yesBid),
          yesAsk: centsToProbability(yesAsk),
          lastPrice: centsToProbability(lastPrice),
          volume24h: m.volume_24h || 0,
          totalVolume: m.volume || 0,
          openInterest: m.open_interest || 0,
          category: classifyMarket(m.ticker, m.event_ticker || '', m.title || ''),
          status: m.status,
          closeTime: m.close_time || m.expiration_time,
          // Kalshi's public URLs are lowercased. Event page groups all markets
          // within an event; the #<market_ticker> anchor scrolls to the
          // specific leg when present. Falls back to the market ticker alone
          // if no event ticker exists (rare).
          url: buildKalshiUrl(m.event_ticker, m.ticker),
          lastUpdated: new Date().toISOString(),
        };
      })
      .filter(m => m.probability != null);
  } catch (err) {
    console.error('[Kalshi] Fetch error:', err.message);
    return [];
  }
}

/**
 * Fetch a specific market by ticker.
 */
async function fetchMarket(ticker) {
  try {
    const response = await fetch(`${BASE_URL}/markets/${ticker}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Particle-Terminal/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const m = data.market;
    if (!m) return null;

    const priceInCents = m.last_price ?? m.yes_bid;
    return {
      source: 'kalshi',
      id: m.ticker,
      eventId: m.event_ticker,
      title: m.title || m.ticker,
      question: m.title || `Will ${m.ticker} resolve Yes?`,
      probability: centsToProbability(priceInCents),
      volume24h: m.volume_24h || 0,
      totalVolume: m.volume || 0,
      category: classifyMarket(m.ticker, m.event_ticker || '', m.title || ''),
      status: m.status,
      closeTime: m.close_time,
      url: buildKalshiUrl(m.event_ticker, m.ticker),
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[Kalshi] Fetch market ${ticker} error:`, err.message);
    return null;
  }
}

module.exports = { fetchMarkets, fetchMarket, classifyMarket, buildKalshiUrl };
