/**
 * providers/coingeckoProvider.js — CoinGecko free API integration.
 *
 * Endpoints used (all free, no key required):
 *   /coins/markets          — top coins by market cap (price, mcap, volume, sparkline)
 *   /search/trending        — trending coins (past 24h searches)
 *   /global                 — total market cap, BTC dominance, active coins
 *   /global/decentralized_finance_defi — DeFi TVL, top DeFi coins
 *   /coins/{id}             — detailed coin data (description, links, dev stats)
 *   /simple/price           — quick price lookup for multiple coins
 *
 * Rate limit: ~30 req/min on free tier. We cache aggressively (5-10 min).
 * Docs: https://docs.coingecko.com/reference/introduction
 */

'use strict';

const fetch = require('node-fetch');

const BASE = 'https://api.coingecko.com/api/v3';
const TIMEOUT = 10000;

// ── Cache ────────────────────────────────────────────────────────────────────
const _cache = new Map();
const TTL = {
  markets:   300_000,  // 5 min
  trending:  600_000,  // 10 min
  global:    300_000,  // 5 min
  defi:      600_000,  // 10 min
  coinDetail: 600_000, // 10 min
};

function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v, ttl) { _cache.set(k, { v, exp: Date.now() + ttl }); }

async function cgFetch(path) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    timeout: TIMEOUT,
    headers: { Accept: 'application/json' },
  });
  if (res.status === 429) {
    console.warn('[CoinGecko] Rate limited');
    return null;
  }
  if (!res.ok) {
    console.warn(`[CoinGecko] ${res.status} for ${path}`);
    return null;
  }
  return res.json();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Top coins by market cap. Returns up to 50 coins with price, mcap, volume, 24h change.
 */
async function getTopCoins(limit = 50) {
  const ck = `cg:markets:${limit}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const data = await cgFetch(`/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=1h,24h,7d`);
  if (!data || !Array.isArray(data)) return [];

  const result = data.map(c => ({
    id: c.id,
    symbol: c.symbol?.toUpperCase(),
    name: c.name,
    price: c.current_price,
    marketCap: c.market_cap,
    volume24h: c.total_volume,
    changePct1h: c.price_change_percentage_1h_in_currency,
    changePct24h: c.price_change_percentage_24h_in_currency,
    changePct7d: c.price_change_percentage_7d_in_currency,
    rank: c.market_cap_rank,
    high24h: c.high_24h,
    low24h: c.low_24h,
    ath: c.ath,
    athChangePct: c.ath_change_percentage,
    circulatingSupply: c.circulating_supply,
    totalSupply: c.total_supply,
    maxSupply: c.max_supply,
    image: c.image,
  }));

  cacheSet(ck, result, TTL.markets);
  return result;
}

/**
 * Trending coins (top 7 by search volume in past 24h).
 */
async function getTrending() {
  const ck = 'cg:trending';
  const cached = cacheGet(ck);
  if (cached) return cached;

  const data = await cgFetch('/search/trending');
  if (!data?.coins) return [];

  const result = data.coins.map(c => ({
    id: c.item.id,
    symbol: c.item.symbol?.toUpperCase(),
    name: c.item.name,
    rank: c.item.market_cap_rank,
    score: c.item.score,
    priceBtc: c.item.price_btc,
    image: c.item.small,
  }));

  cacheSet(ck, result, TTL.trending);
  return result;
}

/**
 * Global crypto market stats: total market cap, BTC dominance, active coins.
 */
async function getGlobalStats() {
  const ck = 'cg:global';
  const cached = cacheGet(ck);
  if (cached) return cached;

  const data = await cgFetch('/global');
  if (!data?.data) return null;

  const d = data.data;
  const result = {
    totalMarketCapUSD: d.total_market_cap?.usd,
    totalVolume24hUSD: d.total_volume?.usd,
    btcDominancePct: d.market_cap_percentage?.btc,
    ethDominancePct: d.market_cap_percentage?.eth,
    activeCryptocurrencies: d.active_cryptocurrencies,
    markets: d.markets,
    marketCapChangePct24h: d.market_cap_change_percentage_24h_usd,
  };

  cacheSet(ck, result, TTL.global);
  return result;
}

/**
 * DeFi market stats: total DeFi TVL, top DeFi coin, DeFi dominance.
 */
async function getDefiStats() {
  const ck = 'cg:defi';
  const cached = cacheGet(ck);
  if (cached) return cached;

  const data = await cgFetch('/global/decentralized_finance_defi');
  if (!data?.data) return null;

  const d = data.data;
  const result = {
    defiMarketCapUSD: parseFloat(d.defi_market_cap) || null,
    ethMarketCapUSD: parseFloat(d.eth_market_cap) || null,
    defiToEthRatio: parseFloat(d.defi_to_eth_ratio) || null,
    tradingVolume24hUSD: parseFloat(d.trading_volume_24h) || null,
    defiDominancePct: parseFloat(d.defi_dominance) || null,
    topCoinName: d.top_coin_name,
    topCoinDefiDominancePct: parseFloat(d.top_coin_defi_dominance) || null,
  };

  cacheSet(ck, result, TTL.defi);
  return result;
}

/**
 * Detailed coin data by CoinGecko ID (e.g., 'bitcoin', 'ethereum').
 */
async function getCoinDetail(coinId) {
  const ck = `cg:coin:${coinId}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const data = await cgFetch(`/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=true&sparkline=false`);
  if (!data) return null;

  const md = data.market_data || {};
  const result = {
    id: data.id,
    symbol: data.symbol?.toUpperCase(),
    name: data.name,
    description: data.description?.en?.slice(0, 500) || '',
    categories: data.categories || [],
    links: {
      homepage: data.links?.homepage?.[0],
      blockchain: data.links?.blockchain_site?.filter(Boolean).slice(0, 3),
      reddit: data.links?.subreddit_url,
      twitter: data.links?.twitter_screen_name,
      github: data.links?.repos_url?.github?.[0],
    },
    marketData: {
      price: md.current_price?.usd,
      marketCap: md.market_cap?.usd,
      volume24h: md.total_volume?.usd,
      changePct24h: md.price_change_percentage_24h,
      changePct7d: md.price_change_percentage_7d,
      changePct30d: md.price_change_percentage_30d,
      ath: md.ath?.usd,
      athChangePct: md.ath_change_percentage?.usd,
      athDate: md.ath_date?.usd,
      atl: md.atl?.usd,
      circulatingSupply: md.circulating_supply,
      totalSupply: md.total_supply,
      maxSupply: md.max_supply,
      fullyDilutedValuation: md.fully_diluted_valuation?.usd,
    },
    communityData: {
      twitterFollowers: data.community_data?.twitter_followers,
      redditSubscribers: data.community_data?.reddit_subscribers,
    },
    developerData: {
      stars: data.developer_data?.stars,
      forks: data.developer_data?.forks,
      subscribers: data.developer_data?.subscribers,
      totalIssues: data.developer_data?.total_issues,
      closedIssues: data.developer_data?.closed_issues,
      commits4w: data.developer_data?.commit_count_4_weeks,
    },
    genesisDate: data.genesis_date,
    sentimentUpPct: data.sentiment_votes_up_percentage,
    sentimentDownPct: data.sentiment_votes_down_percentage,
  };

  cacheSet(ck, result, TTL.coinDetail);
  return result;
}

// ── Symbol → CoinGecko ID mapping ───────────────────────────────────────────
const SYMBOL_TO_ID = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple',
  BNB: 'binancecoin', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', MATIC: 'matic-network', LINK: 'chainlink', UNI: 'uniswap',
  SHIB: 'shiba-inu', LTC: 'litecoin', ATOM: 'cosmos', NEAR: 'near',
  APT: 'aptos', ARB: 'arbitrum', OP: 'optimism', SUI: 'sui',
};

function symbolToId(symbol) {
  const clean = symbol.replace(/USD$/, '').toUpperCase();
  return SYMBOL_TO_ID[clean] || clean.toLowerCase();
}

module.exports = {
  getTopCoins,
  getTrending,
  getGlobalStats,
  getDefiStats,
  getCoinDetail,
  symbolToId,
  SYMBOL_TO_ID,
};
