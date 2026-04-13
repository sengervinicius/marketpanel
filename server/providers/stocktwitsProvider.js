/**
 * providers/stocktwitsProvider.js — StockTwits social sentiment API.
 *
 * Endpoints (free, no key required):
 *   /api/2/streams/symbol/{symbol}.json — Recent messages for a ticker
 *   /api/2/streams/trending.json        — Trending tickers
 *   /api/2/streams/home.json            — General feed
 *
 * Rate limit: 200 req/hour (IP-based). We cache 5-10 min.
 * Docs: https://api.stocktwits.com/developers/docs
 */

'use strict';

const fetch = require('node-fetch');

const BASE = 'https://api.stocktwits.com/api/2';
const TIMEOUT = 8000;

// ── Cache ────────────────────────────────────────────────────────────────────
const _cache = new Map();
const TTL = {
  sentiment: 300_000,  // 5 min
  trending:  600_000,  // 10 min
  messages:  300_000,  // 5 min
};

function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v, ttl) { _cache.set(k, { v, exp: Date.now() + ttl }); }

async function stFetch(path) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    timeout: TIMEOUT,
    headers: { Accept: 'application/json' },
  });
  if (res.status === 429) {
    console.warn('[StockTwits] Rate limited');
    return null;
  }
  if (!res.ok) {
    console.warn(`[StockTwits] ${res.status} for ${path}`);
    return null;
  }
  return res.json();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get sentiment and recent messages for a ticker.
 * Returns { bullish, bearish, totalMessages, sentimentScore, messages[] }
 */
async function getTickerSentiment(ticker) {
  const sym = ticker.toUpperCase().replace(/[^A-Z]/g, '');
  const ck = `st:sentiment:${sym}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const data = await stFetch(`/streams/symbol/${sym}.json?filter=top`);
  if (!data?.messages) return null;

  let bullish = 0;
  let bearish = 0;
  const messages = [];

  for (const msg of data.messages.slice(0, 30)) {
    if (msg.entities?.sentiment) {
      if (msg.entities.sentiment.basic === 'Bullish') bullish++;
      if (msg.entities.sentiment.basic === 'Bearish') bearish++;
    }
    messages.push({
      id: msg.id,
      body: msg.body?.slice(0, 280) || '',
      sentiment: msg.entities?.sentiment?.basic || null,
      username: msg.user?.username,
      followers: msg.user?.followers,
      createdAt: msg.created_at,
      likes: msg.likes?.total || 0,
    });
  }

  const total = bullish + bearish;
  const result = {
    ticker: sym,
    bullish,
    bearish,
    totalMessages: data.messages.length,
    sentimentScore: total > 0 ? +(bullish / total).toFixed(2) : 0.5, // 0=full bear, 1=full bull
    sentimentLabel: total < 3 ? 'neutral' : (bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral'),
    messages: messages.slice(0, 15),
    watchlistCount: data.symbol?.watchlist_count || null,
  };

  cacheSet(ck, result, TTL.sentiment);
  return result;
}

/**
 * Get trending tickers from StockTwits.
 * Returns [{ symbol, title, watchlistCount }]
 */
async function getTrending() {
  const ck = 'st:trending';
  const cached = cacheGet(ck);
  if (cached) return cached;

  const data = await stFetch('/trending/symbols.json');
  if (!data?.symbols) return [];

  const result = data.symbols.map(s => ({
    symbol: s.symbol,
    title: s.title,
    watchlistCount: s.watchlist_count,
  }));

  cacheSet(ck, result, TTL.trending);
  return result;
}

/**
 * Get social volume — message count over recent period for a ticker.
 */
async function getSocialVolume(ticker) {
  const sentiment = await getTickerSentiment(ticker);
  if (!sentiment) return null;
  return {
    ticker: sentiment.ticker,
    messageCount: sentiment.totalMessages,
    sentimentScore: sentiment.sentimentScore,
    sentimentLabel: sentiment.sentimentLabel,
    bullishPct: sentiment.bullish + sentiment.bearish > 0
      ? +((sentiment.bullish / (sentiment.bullish + sentiment.bearish)) * 100).toFixed(1)
      : 50,
    watchlistCount: sentiment.watchlistCount,
  };
}

module.exports = {
  getTickerSentiment,
  getTrending,
  getSocialVolume,
};
