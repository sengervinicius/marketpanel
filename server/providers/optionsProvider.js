/**
 * providers/optionsProvider.js
 *
 * Options chain data provider with Eulerpool primary + Yahoo Finance fallback.
 *
 * Exports:
 *   getOptionsChain(symbol, opts)      → normalized chain payload
 *   getAvailableOptionExpiries(symbol)  → string[]
 *   getOptionContractDetail(contract)   → single contract detail
 *
 * Caching: in-memory, TTL 90s, keyed by symbol+expiry.
 */

'use strict';

const fetch = require('node-fetch');
const { findBySymbol } = require('../stores/instrumentStore');

// ── Configuration ────────────────────────────────────────────────────────────
const EULER_BASE = 'https://api.eulerpool.com/api/1';
const EULER_TIMEOUT = 12000;
const YAHOO_TIMEOUT = 10000;

const CACHE_TTL = 90_000;  // 90 seconds
const MAX_CACHE = 200;

// ── In-memory cache ──────────────────────────────────────────────────────────
const _cache = new Map();

function cacheKey(symbol, expiry) {
  return `${symbol}|${expiry || 'all'}`;
}

function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}

function cacheSet(k, v) {
  // Evict oldest when at capacity
  if (_cache.size >= MAX_CACHE) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(k, { v, exp: Date.now() + CACHE_TTL });
}

// ── Eulerpool options chain ──────────────────────────────────────────────────

function eulerKey() {
  return process.env.EULERPOOL_API_KEY;
}

async function eulerOptionsChain(isin) {
  if (!eulerKey()) return null;

  const params = new URLSearchParams({ token: eulerKey() });
  const url = `${EULER_BASE}/equity-extended/options-chain/${encodeURIComponent(isin)}?${params}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EULER_TIMEOUT);

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'SengerMarketTerminal/1.0' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function normalizeEulerChain(raw, symbol, requestedExpiry) {
  if (!raw) return null;

  const data = raw.data ?? raw;
  if (!data) return null;

  // Extract underlying info
  const underlying = {
    symbol,
    price: data.underlyingPrice ?? data.price ?? null,
    currency: data.currency ?? 'USD',
    asOf: data.asOf ?? new Date().toISOString(),
  };

  // Extract unique expiries
  const allContracts = [
    ...(data.calls ?? []),
    ...(data.puts ?? []),
  ];

  const expirySet = new Set();
  for (const c of allContracts) {
    if (c.expiry || c.expirationDate) expirySet.add(c.expiry || c.expirationDate);
  }
  const expiries = [...expirySet].sort();

  // Pick expiry
  const selectedExpiry = requestedExpiry && expiries.includes(requestedExpiry)
    ? requestedExpiry
    : expiries[0] ?? null;

  // Filter and normalize contracts
  const normalizeContract = (c) => {
    const bid = c.bid ?? null;
    const ask = c.ask ?? null;
    return {
      contractSymbol: c.contractSymbol ?? c.symbol ?? null,
      expiry: c.expiry ?? c.expirationDate ?? null,
      strike: c.strike ?? null,
      bid,
      ask,
      last: c.last ?? c.lastPrice ?? null,
      mid: (bid != null && ask != null) ? +((bid + ask) / 2).toFixed(4) : null,
      change: c.change ?? null,
      changePct: c.changePct ?? c.changePercent ?? null,
      volume: c.volume ?? null,
      openInterest: c.openInterest ?? c.oi ?? null,
      impliedVol: c.impliedVolatility ?? c.iv ?? c.impliedVol ?? null,
      delta: c.delta ?? null,
      gamma: c.gamma ?? null,
      theta: c.theta ?? null,
      vega: c.vega ?? null,
      inTheMoney: c.inTheMoney ?? null,
    };
  };

  const calls = (data.calls ?? [])
    .filter(c => (c.expiry || c.expirationDate) === selectedExpiry)
    .map(normalizeContract)
    .sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));

  const puts = (data.puts ?? [])
    .filter(c => (c.expiry || c.expirationDate) === selectedExpiry)
    .map(normalizeContract)
    .sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));

  const strikes = [...new Set([...calls, ...puts].map(c => c.strike).filter(Boolean))].sort((a, b) => a - b);

  return { underlying, expiries, selectedExpiry, strikes, calls, puts };
}

// ── Yahoo Finance options chain (fallback) ───────────────────────────────────

async function yahooOptionsChain(symbol, expiry) {
  try {
    // Resolve Yahoo symbol
    const inst = findBySymbol(symbol);
    const yahooSym = inst?.identifiers?.vendor?.yahoo ?? symbol;

    let url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(yahooSym)}`;
    if (expiry) {
      // Yahoo expects epoch seconds
      const epochDate = Math.floor(new Date(expiry + 'T16:00:00Z').getTime() / 1000);
      url += `?date=${epochDate}`;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), YAHOO_TIMEOUT);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 MarketPanel/1.0' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();
    return data?.optionChain?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

function normalizeYahooChain(raw, symbol, requestedExpiry) {
  if (!raw) return null;

  const quote = raw.quote ?? {};
  const underlying = {
    symbol,
    price: quote.regularMarketPrice ?? null,
    currency: quote.currency ?? 'USD',
    asOf: new Date().toISOString(),
  };

  // All expiry dates (epoch → ISO date)
  const expiries = (raw.expirationDates ?? []).map(epoch => {
    const d = new Date(epoch * 1000);
    return d.toISOString().split('T')[0];
  }).sort();

  // Determine selected expiry
  const selectedExpiry = requestedExpiry && expiries.includes(requestedExpiry)
    ? requestedExpiry
    : expiries[0] ?? null;

  // Parse contracts from options array
  const optionsData = raw.options?.[0] ?? {};

  const normalizeContract = (c) => {
    const bid = c.bid ?? null;
    const ask = c.ask ?? null;
    const spot = underlying.price;
    return {
      contractSymbol: c.contractSymbol ?? null,
      expiry: c.expiration ? new Date(c.expiration * 1000).toISOString().split('T')[0] : selectedExpiry,
      strike: c.strike ?? null,
      bid,
      ask,
      last: c.lastPrice ?? null,
      mid: (bid != null && ask != null) ? +((bid + ask) / 2).toFixed(4) : null,
      change: c.change ?? null,
      changePct: c.percentChange ?? null,
      volume: c.volume ?? null,
      openInterest: c.openInterest ?? null,
      impliedVol: c.impliedVolatility ?? null,
      delta: null,   // Yahoo doesn't provide Greeks
      gamma: null,
      theta: null,
      vega: null,
      inTheMoney: c.inTheMoney ?? null,
    };
  };

  const calls = (optionsData.calls ?? []).map(normalizeContract).sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));
  const puts = (optionsData.puts ?? []).map(normalizeContract).sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));
  const strikes = [...new Set([...calls, ...puts].map(c => c.strike).filter(Boolean))].sort((a, b) => a - b);

  return { underlying, expiries, selectedExpiry, strikes, calls, puts };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch options chain for a symbol.
 * @param {string} symbol  e.g. 'AAPL', 'MSFT'
 * @param {object} opts
 * @param {string} [opts.expiry]  YYYY-MM-DD
 * @returns {object|null} Normalized chain or null
 */
async function getOptionsChain(symbol, opts = {}) {
  const sym = symbol.toUpperCase().replace('.SA', '');
  const expiry = opts.expiry || null;
  const ck = cacheKey(sym, expiry);

  const cached = cacheGet(ck);
  if (cached) return cached;

  // 1. Try Eulerpool (ISIN-based)
  const inst = findBySymbol(sym);
  const isin = inst?.identifiers?.isin;
  if (isin && eulerKey()) {
    try {
      const raw = await eulerOptionsChain(isin);
      const result = normalizeEulerChain(raw, sym, expiry);
      if (result && result.calls.length > 0) {
        cacheSet(ck, result);
        return result;
      }
    } catch (e) {
      console.warn(`[optionsProvider] Eulerpool options chain failed for ${sym}:`, e.message);
    }
  }

  // 2. Fallback to Yahoo Finance
  try {
    const raw = await yahooOptionsChain(sym, expiry);
    const result = normalizeYahooChain(raw, sym, expiry);
    if (result && (result.calls.length > 0 || result.puts.length > 0)) {
      cacheSet(ck, result);
      return result;
    }
  } catch (e) {
    console.warn(`[optionsProvider] Yahoo options chain failed for ${sym}:`, e.message);
  }

  return null;
}

/**
 * Get available expiry dates for a symbol's options.
 * @param {string} symbol
 * @returns {string[]|null}
 */
async function getAvailableOptionExpiries(symbol) {
  const sym = symbol.toUpperCase().replace('.SA', '');

  // Try cache first (any cached chain will have expiries)
  const ck = cacheKey(sym, null);
  const cached = cacheGet(ck);
  if (cached) return cached.expiries;

  // Fetch full chain (first expiry) which returns all available expiries
  const chain = await getOptionsChain(sym);
  return chain?.expiries ?? null;
}

/**
 * Get a single option contract detail.
 * @param {string} contractSymbol  e.g. 'AAPL260412C00210000'
 * @returns {object|null}
 */
async function getOptionContractDetail(contractSymbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(contractSymbol)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), YAHOO_TIMEOUT);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 MarketPanel/1.0' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();
    const quote = data?.optionChain?.result?.[0]?.quote ?? null;
    return quote;
  } catch {
    return null;
  }
}

module.exports = { getOptionsChain, getAvailableOptionExpiries, getOptionContractDetail };
