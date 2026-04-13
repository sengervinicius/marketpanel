/**
 * services/earnings.js — Finnhub Earnings Calendar integration
 *
 * Provides earnings calendar data with intelligent caching and formatting.
 * - getEarningsCalendar(from, to) — full calendar for date range
 * - getEarningsForTicker(symbol) — next/recent earnings for ticker
 * - getUpcomingForWatchlist(symbols) — batch check for watchlist tickers
 * - formatForContext(symbols) — format for AI prompt injection
 */

'use strict';

const fetch = require('node-fetch');

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// In-memory cache: key → { value, exp }
const _cache = new Map();

/**
 * Check if FINNHUB_API_KEY is configured
 */
function isConfigured() {
  return !!process.env.FINNHUB_API_KEY;
}

/**
 * Internal cache helper
 */
function getCached(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value, ttl = CACHE_TTL) {
  _cache.set(key, { value, exp: Date.now() + ttl });
  // Evict old entries if cache gets large
  if (_cache.size > 500) {
    const now = Date.now();
    for (const [k, e] of _cache) {
      if (now > e.exp) _cache.delete(k);
    }
  }
}

/**
 * Fetch earnings calendar for a date range
 * @param {string} from - YYYY-MM-DD
 * @param {string} to - YYYY-MM-DD
 * @returns {Promise<Array>} array of { symbol, date, epsEstimate, epsActual, revenueEstimate, revenueActual, hour }
 */
async function getEarningsCalendar(from, to) {
  if (!isConfigured()) {
    console.warn('[Earnings] FINNHUB_API_KEY not configured');
    return [];
  }

  const cacheKey = `earnings_calendar_${from}_${to}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const url = `${FINNHUB_BASE_URL}/calendar/earnings?from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`;
    const response = await fetch(url, { timeout: 10000 });

    if (!response.ok) {
      console.error(`[Earnings] Finnhub error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map((item) => ({
      symbol: item.symbol || '',
      date: item.date || '',
      epsEstimate: item.epsEstimate,
      epsActual: item.epsActual,
      revenueEstimate: item.revenueEstimate,
      revenueActual: item.revenueActual,
      hour: item.hour || 'bmo', // bmo, amc, dmh (before market open, after market close, during market hours)
    }));

    setCached(cacheKey, results);
    return results;
  } catch (err) {
    console.error('[Earnings/Calendar] Fetch error:', err.message);
    return [];
  }
}

/**
 * Get next/recent earnings for a specific ticker
 * @param {string} symbol - ticker symbol (e.g., 'AAPL')
 * @returns {Promise<Object>} { nextEarningsDate, daysUntilEarnings, lastEarnings: { date, epsEstimate, epsActual, surprise, revenueEstimate, revenueActual } }
 */
async function getEarningsForTicker(symbol) {
  if (!isConfigured()) {
    return {
      nextEarningsDate: null,
      daysUntilEarnings: null,
      lastEarnings: null,
    };
  }

  const cacheKey = `earnings_ticker_${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Query 30 days in the past and 30 days in the future
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    const url = `${FINNHUB_BASE_URL}/calendar/earnings?symbol=${symbol}&from=${fromStr}&to=${toStr}&token=${process.env.FINNHUB_API_KEY}`;
    const response = await fetch(url, { timeout: 10000 });

    if (!response.ok) {
      console.error(`[Earnings] Finnhub error for ${symbol}: ${response.status}`);
      return {
        nextEarningsDate: null,
        daysUntilEarnings: null,
        lastEarnings: null,
      };
    }

    const data = await response.json();
    const earnings = data.data || [];

    // Sort by date
    earnings.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Find next earnings (today or future)
    const todayStr = now.toISOString().split('T')[0];
    let nextEarnings = null;
    let lastEarnings = null;

    for (const e of earnings) {
      if (e.date >= todayStr && !nextEarnings) {
        nextEarnings = e;
      }
      if (e.date < todayStr) {
        lastEarnings = e;
      }
    }

    let daysUntilEarnings = null;
    if (nextEarnings) {
      const earningsDate = new Date(nextEarnings.date);
      const diffMs = earningsDate.getTime() - now.getTime();
      daysUntilEarnings = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    }

    const result = {
      nextEarningsDate: nextEarnings?.date || null,
      daysUntilEarnings,
      lastEarnings: lastEarnings ? {
        date: lastEarnings.date,
        epsEstimate: lastEarnings.epsEstimate,
        epsActual: lastEarnings.epsActual,
        surprise: lastEarnings.epsActual && lastEarnings.epsEstimate
          ? ((lastEarnings.epsActual - lastEarnings.epsEstimate) / Math.abs(lastEarnings.epsEstimate) * 100).toFixed(1)
          : null,
        revenueEstimate: lastEarnings.revenueEstimate,
        revenueActual: lastEarnings.revenueActual,
      } : null,
    };

    setCached(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[Earnings/Ticker] Fetch error for ${symbol}:`, err.message);
    return {
      nextEarningsDate: null,
      daysUntilEarnings: null,
      lastEarnings: null,
    };
  }
}

/**
 * Get upcoming earnings for watchlist tickers in the next 14 days
 * @param {Array<string>} symbols - array of ticker symbols
 * @returns {Promise<Array>} array of { symbol, date, daysUntil, hour }
 */
async function getUpcomingForWatchlist(symbols) {
  if (!isConfigured() || !symbols || symbols.length === 0) {
    return [];
  }

  try {
    const now = new Date();
    const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const fromStr = now.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    // Fetch calendar for the 14-day window
    const calendar = await getEarningsCalendar(fromStr, toStr);

    // Filter to symbols in watchlist
    const symbolSet = new Set(symbols.map(s => s.toUpperCase()));
    const upcoming = calendar
      .filter(e => symbolSet.has(e.symbol.toUpperCase()))
      .map(e => {
        const earningsDate = new Date(e.date);
        const diffMs = earningsDate.getTime() - now.getTime();
        const daysUntil = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
        return {
          symbol: e.symbol,
          date: e.date,
          daysUntil,
          hour: e.hour || 'bmo',
        };
      })
      .sort((a, b) => a.daysUntil - b.daysUntil);

    return upcoming;
  } catch (err) {
    console.error('[Earnings/Watchlist] Fetch error:', err.message);
    return [];
  }
}

/**
 * Format earnings data for AI prompt injection
 * Example output:
 * "EARNINGS CALENDAR: $AAPL reports in 3 days (Apr 16 AMC, est. EPS $1.52). $MSFT reported yesterday (beat by +5.2%)."
 *
 * @param {Array<string>} symbols - ticker symbols to include
 * @returns {Promise<string>} formatted earnings context
 */
async function formatForContext(symbols) {
  if (!isConfigured() || !symbols || symbols.length === 0) {
    return '';
  }

  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const parts = [];

    for (const symbol of symbols) {
      const earnings = await getEarningsForTicker(symbol);

      if (earnings.nextEarningsDate) {
        const date = new Date(earnings.nextEarningsDate);
        const month = date.toLocaleString('en-US', { month: 'short' });
        const day = date.getDate();
        const daysStr = earnings.daysUntilEarnings === 0 ? 'today' : `in ${earnings.daysUntilEarnings} days`;
        const epsStr = earnings.nextEarningsDate && earnings.nextEarningsDate.epsEstimate
          ? `est. EPS $${earnings.nextEarningsDate.epsEstimate}`
          : '';
        parts.push(`$${symbol} reports ${daysStr} (${month} ${day} ${earnings.hour === 'amc' ? 'AMC' : 'BMO'}${epsStr ? ', ' + epsStr : ''})`);
      } else if (earnings.lastEarnings) {
        const surprise = earnings.lastEarnings.surprise
          ? `${earnings.lastEarnings.surprise > 0 ? 'beat' : 'missed'} by ${Math.abs(earnings.lastEarnings.surprise)}%`
          : 'no surprise data';
        parts.push(`$${symbol} reported recently (${surprise})`);
      }
    }

    if (parts.length === 0) {
      return '';
    }

    return `EARNINGS CALENDAR: ${parts.join('. ')}.`;
  } catch (err) {
    console.error('[Earnings/Format] Error:', err.message);
    return '';
  }
}

/**
 * Clear cache (for testing or manual refresh)
 */
function clearCache() {
  _cache.clear();
}

/**
 * Get cache stats (for debugging)
 */
function getCacheStats() {
  return {
    entries: _cache.size,
    ttlMinutes: CACHE_TTL / (60 * 1000),
  };
}

module.exports = {
  isConfigured,
  getEarningsCalendar,
  getEarningsForTicker,
  getUpcomingForWatchlist,
  formatForContext,
  clearCache,
  getCacheStats,
};
