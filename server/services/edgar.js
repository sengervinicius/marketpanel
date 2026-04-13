/**
 * services/edgar.js — SEC EDGAR Financial Data Integration
 *
 * Free API (no auth required) that provides:
 *   - Recent filings (10-K, 10-Q, 8-K, 4 forms)
 *   - Insider transactions
 *   - Company financial facts (revenue, net income, EPS, assets)
 *
 * Design:
 *   - All requests include User-Agent header (required by SEC)
 *   - Simple TTL-based in-memory cache with automatic cleanup
 *   - Graceful degradation: EDGAR failures don't crash the chat flow
 *   - Non-blocking: results are best-effort enrichments
 */

const fetch = require('node-fetch');
const logger = require('../utils/logger');

// SEC User-Agent header (required by EDGAR)
const SEC_USER_AGENT = 'TheParticle/1.0 (vinicius@arccapital.com.br)';

// ── In-memory cache with TTL ──────────────────────────────────────────────────
const _cache = new Map();

class CacheEntry {
  constructor(data, ttlMs) {
    this.data = data;
    this.expiry = Date.now() + ttlMs;
  }

  isExpired() {
    return Date.now() > this.expiry;
  }
}

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (entry.isExpired()) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  // Evict expired entries periodically to prevent memory leak
  if (_cache.size > 500) {
    const now = Date.now();
    for (const [k, e] of _cache) {
      if (now > e.expiry) _cache.delete(k);
    }
  }
  _cache.set(key, new CacheEntry(data, ttlMs));
}

// ── Company Tickers Cache (24h TTL) ───────────────────────────────────────────
let _companyTickersData = null;
let _companyTickersExpiry = 0;

/**
 * Fetch and cache the SEC company tickers JSON.
 * Maps CIK → ticker, company name, exchange.
 * TTL: 24 hours
 */
async function getCompanyTickersData() {
  const now = Date.now();
  if (_companyTickersData && now < _companyTickersExpiry) {
    return _companyTickersData;
  }

  try {
    const response = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': SEC_USER_AGENT },
      timeout: 10000,
    });

    if (!response.ok) {
      console.warn(`[EDGAR] Failed to fetch company tickers: ${response.status}`);
      return null;
    }

    const data = await response.json();
    _companyTickersData = data;
    _companyTickersExpiry = now + (24 * 60 * 60 * 1000); // 24h
    return data;
  } catch (err) {
    console.warn(`[EDGAR] Error fetching company tickers:`, err.message);
    return null;
  }
}

/**
 * Resolve ticker → CIK via the company tickers cache.
 * @param {string} ticker — e.g., 'AAPL'
 * @returns {string|null} — CIK without leading zeros, or null
 */
async function tickerToCik(ticker) {
  const tickersData = await getCompanyTickersData();
  if (!tickersData) return null;

  const upperTicker = ticker.toUpperCase();
  for (const [, company] of Object.entries(tickersData)) {
    if (company.ticker && company.ticker.toUpperCase() === upperTicker) {
      return String(company.cik_str);
    }
  }
  return null;
}

// ── Function 1: Get Recent Filings ────────────────────────────────────────────

/**
 * Fetch recent SEC filings for a ticker.
 * Returns: array of { type, date, title, url, accessionNumber }
 * Cache: 1 hour per ticker
 *
 * @param {string} ticker — e.g., 'AAPL'
 * @param {string[]} types — e.g., ['10-K', '10-Q', '8-K', '4']
 * @param {number} limit — max results to return
 * @returns {Promise<Array>}
 */
async function getRecentFilings(ticker, types = ['10-K', '10-Q', '8-K', '4'], limit = 10) {
  const cacheKey = `edgar:filings:${ticker.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const cik = await tickerToCik(ticker);
    if (!cik) {
      console.warn(`[EDGAR] Could not resolve ticker to CIK: ${ticker}`);
      return [];
    }

    // Build the EDGAR full-text search URL
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const formsList = types.join(',');

    const url = `https://efts.sec.gov/LATEST/search-index?q="${ticker.toUpperCase()}"&forms=${formsList}&dateRange=custom&startdt=${thirtyDaysAgo}&enddt=${today}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': SEC_USER_AGENT },
      timeout: 10000,
    });

    if (!response.ok) {
      console.warn(`[EDGAR] Failed to fetch filings for ${ticker}: ${response.status}`);
      return [];
    }

    const html = await response.text();

    // Simple regex parsing of the HTML response
    // EDGAR returns HTML with filing links in a specific format
    const filingRegex = /<a[^>]*href="([^"]*?\/cgi-bin\/browse-edgar[^"]*?)"\s*>[^<]*?(\d{4}-\d{2}-\d{2})[^<]*<\/a>/g;
    const results = [];
    let match;

    while ((match = filingRegex.exec(html)) !== null && results.length < limit) {
      const url = match[1];
      const date = match[2];

      // Extract form type from the URL
      let formType = null;
      const formMatch = url.match(/type=([^&]+)/);
      if (formMatch) {
        formType = decodeURIComponent(formMatch[1]);
      }

      // Extract accession number
      let accessionNumber = null;
      const accMatch = url.match(/acc-no=([^&]+)/);
      if (accMatch) {
        accessionNumber = decodeURIComponent(accMatch[1]);
      }

      if (formType && types.some(t => t === formType)) {
        results.push({
          type: formType,
          date,
          title: `SEC Filing ${formType} filed ${date}`,
          url: `https://www.sec.gov${url}`,
          accessionNumber: accessionNumber || 'unknown',
        });
      }
    }

    cacheSet(cacheKey, results, 60 * 60 * 1000); // 1 hour
    return results;
  } catch (err) {
    console.error(`[EDGAR] Error fetching filings for ${ticker}:`, err.message);
    return [];
  }
}

// ── Function 2: Get Insider Transactions ──────────────────────────────────────

/**
 * Fetch recent Form 4 (insider transaction) filings for a ticker.
 * Returns: array of { filerName, transactionType, shares, pricePerShare, date, url }
 * Cache: 2 hours per ticker
 *
 * @param {string} ticker — e.g., 'AAPL'
 * @param {number} limit — max results to return
 * @returns {Promise<Array>}
 */
async function getInsiderTransactions(ticker, limit = 5) {
  const cacheKey = `edgar:insiders:${ticker.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const cik = await tickerToCik(ticker);
    if (!cik) {
      console.warn(`[EDGAR] Could not resolve ticker to CIK for insiders: ${ticker}`);
      return [];
    }

    // Fetch Form 4 filings from last 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    const url = `https://efts.sec.gov/LATEST/search-index?q="${ticker.toUpperCase()}"&forms=4&dateRange=custom&startdt=${ninetyDaysAgo}&enddt=${today}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': SEC_USER_AGENT },
      timeout: 10000,
    });

    if (!response.ok) {
      console.warn(`[EDGAR] Failed to fetch insider transactions for ${ticker}: ${response.status}`);
      return [];
    }

    const html = await response.text();

    // Extract Form 4 filings
    const filingRegex = /<a[^>]*href="([^"]*?\/cgi-bin\/browse-edgar[^"]*?type=4[^"]*?)"\s*>[^<]*?(\d{4}-\d{2}-\d{2})[^<]*<\/a>/g;
    const results = [];
    let match;

    while ((match = filingRegex.exec(html)) !== null && results.length < limit) {
      const filingUrl = match[1];
      const date = match[2];

      // For now, return basic transaction info from the filing list
      // Note: a full implementation would parse the XML document inside each filing
      results.push({
        filerName: 'Officer/Director (see filing)',
        transactionType: 'Unknown (see filing)',
        shares: 0,
        pricePerShare: 0,
        date,
        url: `https://www.sec.gov${filingUrl}`,
      });
    }

    cacheSet(cacheKey, results, 2 * 60 * 60 * 1000); // 2 hours
    return results;
  } catch (err) {
    console.error(`[EDGAR] Error fetching insider transactions for ${ticker}:`, err.message);
    return [];
  }
}

// ── Function 3: Get Company Facts ─────────────────────────────────────────────

/**
 * Fetch company financial facts from the XBRL API.
 * Returns: { revenue, netIncome, eps, totalAssets } with latest values
 * Cache: 4 hours per CIK
 *
 * @param {string} cik — Central Index Key, e.g., '0000789019' or '789019'
 * @returns {Promise<Object>}
 */
async function getCompanyFacts(cik) {
  // Normalize CIK to 10-digit padded format for URL
  const paddedCik = String(cik).padStart(10, '0');
  const cacheKey = `edgar:facts:${paddedCik}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;

    const response = await fetch(url, {
      headers: { 'User-Agent': SEC_USER_AGENT },
      timeout: 10000,
    });

    if (!response.ok) {
      console.warn(`[EDGAR] Failed to fetch company facts for CIK ${paddedCik}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Extract key metrics from the companyfacts JSON
    // Structure: data.facts.us-gaap.{AccountingMetric} contains filing periods
    const facts = data.facts['us-gaap'] || {};
    const result = {
      revenue: null,
      netIncome: null,
      eps: null,
      totalAssets: null,
      asOfDate: null,
    };

    // Revenue (Revenues or NetRevenue)
    const revenueMetrics = facts.Revenues || facts.NetRevenue;
    if (revenueMetrics?.units?.USD) {
      const latest = revenueMetrics.units.USD.sort((a, b) =>
        new Date(b.end) - new Date(a.end)
      )[0];
      if (latest) {
        result.revenue = latest.val;
        result.asOfDate = latest.end;
      }
    }

    // Net Income
    const netIncomeMetric = facts.NetIncomeLoss;
    if (netIncomeMetric?.units?.USD) {
      const latest = netIncomeMetric.units.USD.sort((a, b) =>
        new Date(b.end) - new Date(a.end)
      )[0];
      if (latest) result.netIncome = latest.val;
    }

    // EPS (Earnings Per Share - basic)
    const epsMetric = facts.EarningsPerShareBasic;
    if (epsMetric?.units?.USD) {
      const latest = epsMetric.units.USD.sort((a, b) =>
        new Date(b.end) - new Date(a.end)
      )[0];
      if (latest) result.eps = latest.val;
    }

    // Total Assets
    const assetsMetric = facts.Assets;
    if (assetsMetric?.units?.USD) {
      const latest = assetsMetric.units.USD.sort((a, b) =>
        new Date(b.end) - new Date(a.end)
      )[0];
      if (latest) result.totalAssets = latest.val;
    }

    cacheSet(cacheKey, result, 4 * 60 * 60 * 1000); // 4 hours
    return result;
  } catch (err) {
    console.error(`[EDGAR] Error fetching company facts for CIK ${paddedCik}:`, err.message);
    return null;
  }
}

// ── Function 4: Format for AI Context ─────────────────────────────────────────

/**
 * Combines recent filings + insider transactions + facts into a concise string
 * suitable for injection into the AI prompt.
 *
 * Format: "SEC FILINGS (AAPL): Recent 8-K filed 2024-03-15 re: earnings release.
 *          Insider: Tim Cook sold 50K shares at $182 on 2024-03-10.
 *          Latest 10-Q revenue: $94.8B (+2.1% YoY)."
 *
 * @param {string} ticker — e.g., 'AAPL'
 * @returns {Promise<string>} — formatted context string (empty if no data)
 */
async function formatForContext(ticker) {
  try {
    const [filings, insiders, cik] = await Promise.all([
      getRecentFilings(ticker, ['10-K', '10-Q', '8-K', '4'], 3),
      getInsiderTransactions(ticker, 2),
      tickerToCik(ticker),
    ]);

    if (!filings.length && !insiders.length && !cik) {
      return ''; // No SEC data available
    }

    const lines = [`SEC FILINGS (${ticker.toUpperCase()}):`];

    // Add recent filings
    if (filings.length > 0) {
      const recentFiling = filings[0];
      lines.push(`Recent ${recentFiling.type} filed ${recentFiling.date}.`);
    }

    // Add insider transactions
    if (insiders.length > 0) {
      const insider = insiders[0];
      if (insider.shares > 0) {
        lines.push(
          `Insider: ${insider.filerName} ${insider.transactionType} ` +
          `${insider.shares.toLocaleString()} shares at $${insider.pricePerShare} on ${insider.date}.`
        );
      }
    }

    // Add financial facts
    if (cik) {
      const facts = await getCompanyFacts(cik);
      if (facts && facts.revenue) {
        const revenueB = (facts.revenue / 1e9).toFixed(1);
        lines.push(`Latest revenue: $${revenueB}B as of ${facts.asOfDate}.`);
      }
    }

    return lines.join(' ');
  } catch (err) {
    console.error(`[EDGAR] Error formatting context for ${ticker}:`, err.message);
    return ''; // Graceful degradation
  }
}

// ── Cache Management ──────────────────────────────────────────────────────────

/**
 * Get current cache stats for debugging.
 */
function getCacheStats() {
  return {
    entries: _cache.size,
    companyTickersCached: _companyTickersData !== null,
  };
}

/**
 * Clear all caches (useful for testing or manual cache resets).
 */
function clearCache() {
  _cache.clear();
  _companyTickersData = null;
  _companyTickersExpiry = 0;
  console.log('[EDGAR] Cache cleared');
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  getRecentFilings,
  getInsiderTransactions,
  getCompanyFacts,
  formatForContext,
  tickerToCik,
  getCacheStats,
  clearCache,
};
