/**
 * providers/edgarProvider.js — SEC EDGAR free API integration.
 *
 * Endpoints (no API key needed, just a User-Agent header):
 *   /cik-lookup-data.txt          — CIK lookup by company name
 *   /submissions/CIK{cik}.json   — Recent filings for a company
 *   /api/xbrl/companyfacts/CIK{cik}.json — Financial facts (XBRL)
 *
 * For 13F institutional holdings:
 *   /cgi-bin/browse-edgar?action=getcompany&type=13-F&dateb=&owner=include&count=10&search_text=&action=getcompany
 *
 * Rate limit: 10 requests/second per IP (must include User-Agent with contact email).
 * Docs: https://www.sec.gov/edgar/sec-api-documentation
 */

'use strict';

const fetch = require('node-fetch');

const BASE = 'https://data.sec.gov';
const EFTS_BASE = 'https://efts.sec.gov/LATEST';
const UA = 'TheParticle/1.0 (support@the-particle.com)';
const TIMEOUT = 12000;

// ── Cache ────────────────────────────────────────────────────────────────────
const _cache = new Map();
const TTL = {
  submissions: 1800_000,  // 30 min
  facts:       3600_000,  // 1 hour
  search:      3600_000,  // 1 hour
  cik:         86400_000, // 24 hours
};

function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v, ttl) { _cache.set(k, { v, exp: Date.now() + ttl }); }

async function edgarFetch(url) {
  const res = await fetch(url, {
    timeout: TIMEOUT,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    console.warn(`[EDGAR] ${res.status} for ${url}`);
    return null;
  }
  return res.json();
}

// ── Ticker → CIK mapping ────────────────────────────────────────────────────
let _tickerMap = null;
let _tickerMapExp = 0;

async function loadTickerMap() {
  if (_tickerMap && Date.now() < _tickerMapExp) return _tickerMap;
  try {
    const data = await edgarFetch('https://www.sec.gov/files/company_tickers.json');
    if (!data) return _tickerMap || {};
    const map = {};
    for (const entry of Object.values(data)) {
      if (entry.ticker) {
        map[entry.ticker.toUpperCase()] = {
          cik: String(entry.cik_str).padStart(10, '0'),
          name: entry.title,
        };
      }
    }
    _tickerMap = map;
    _tickerMapExp = Date.now() + TTL.cik;
    return map;
  } catch (e) {
    console.warn('[EDGAR] Failed to load ticker map:', e.message);
    return _tickerMap || {};
  }
}

async function tickerToCik(ticker) {
  const map = await loadTickerMap();
  const entry = map[ticker.toUpperCase()];
  return entry ? entry.cik : null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get recent filings for a ticker. Returns the latest 20 filings with type, date, URL.
 */
async function getRecentFilings(ticker, limit = 20) {
  const cik = await tickerToCik(ticker);
  if (!cik) return [];

  const ck = `edgar:filings:${cik}`;
  const cached = cacheGet(ck);
  if (cached) return cached.slice(0, limit);

  const data = await edgarFetch(`${BASE}/submissions/CIK${cik}.json`);
  if (!data?.filings?.recent) return [];

  const recent = data.filings.recent;
  const filings = [];
  const count = Math.min(recent.form?.length || 0, 40);

  for (let i = 0; i < count; i++) {
    filings.push({
      form: recent.form[i],
      filingDate: recent.filingDate[i],
      accessionNumber: recent.accessionNumber[i],
      primaryDocument: recent.primaryDocument[i],
      description: recent.primaryDocDescription?.[i] || '',
      url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${recent.accessionNumber[i].replace(/-/g, '')}/${recent.primaryDocument[i]}`,
    });
  }

  cacheSet(ck, filings, TTL.submissions);
  return filings.slice(0, limit);
}

/**
 * Get recent 8-K filings (material events) for a ticker.
 */
async function get8KFilings(ticker, limit = 10) {
  const all = await getRecentFilings(ticker, 40);
  return all.filter(f => f.form === '8-K').slice(0, limit);
}

/**
 * Get recent 10-K and 10-Q filings for a ticker.
 */
async function getAnnualQuarterly(ticker, limit = 10) {
  const all = await getRecentFilings(ticker, 40);
  return all.filter(f => ['10-K', '10-Q'].includes(f.form)).slice(0, limit);
}

/**
 * Get recent 13F filings (institutional holdings disclosure).
 */
async function get13FFilings(ticker, limit = 5) {
  const all = await getRecentFilings(ticker, 40);
  return all.filter(f => f.form.startsWith('13F')).slice(0, limit);
}

/**
 * Get insider transaction filings (Form 4).
 */
async function getInsiderFilings(ticker, limit = 10) {
  const all = await getRecentFilings(ticker, 40);
  return all.filter(f => f.form === '4' || f.form === '3' || f.form === '5').slice(0, limit);
}

/**
 * Get XBRL company facts — financial data extracted from filings.
 * Returns key metrics: revenue, net income, EPS, assets, etc.
 */
async function getCompanyFacts(ticker) {
  const cik = await tickerToCik(ticker);
  if (!cik) return null;

  const ck = `edgar:facts:${cik}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const data = await edgarFetch(`${BASE}/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!data?.facts) return null;

  const usGaap = data.facts['us-gaap'] || {};

  // Extract key financial metrics (most recent values)
  function getLatest(concept) {
    const units = usGaap[concept]?.units;
    if (!units) return null;
    const values = units.USD || units['USD/shares'] || Object.values(units)[0];
    if (!values || values.length === 0) return null;
    // Get the most recent annual (10-K) filing
    const annual = values.filter(v => v.form === '10-K').sort((a, b) => b.end?.localeCompare(a.end));
    if (annual.length > 0) return { value: annual[0].val, period: annual[0].end, form: '10-K' };
    // Fallback to quarterly
    const quarterly = values.filter(v => v.form === '10-Q').sort((a, b) => b.end?.localeCompare(a.end));
    if (quarterly.length > 0) return { value: quarterly[0].val, period: quarterly[0].end, form: '10-Q' };
    return null;
  }

  const result = {
    entityName: data.entityName,
    cik: data.cik,
    revenue: getLatest('Revenues') || getLatest('RevenueFromContractWithCustomerExcludingAssessedTax'),
    netIncome: getLatest('NetIncomeLoss'),
    eps: getLatest('EarningsPerShareBasic'),
    epsDiluted: getLatest('EarningsPerShareDiluted'),
    totalAssets: getLatest('Assets'),
    totalLiabilities: getLatest('Liabilities'),
    stockholdersEquity: getLatest('StockholdersEquity'),
    operatingIncome: getLatest('OperatingIncomeLoss'),
    cashAndEquivalents: getLatest('CashAndCashEquivalentsAtCarryingValue'),
    longTermDebt: getLatest('LongTermDebt') || getLatest('LongTermDebtNoncurrent'),
    commonSharesOutstanding: getLatest('CommonStockSharesOutstanding'),
  };

  cacheSet(ck, result, TTL.facts);
  return result;
}

/**
 * Full-text search across EDGAR filings.
 * Uses the EFTS (full-text search) endpoint.
 */
async function searchFilings(query, dateRange, forms, limit = 10) {
  const ck = `edgar:search:${query}:${forms}:${limit}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const params = new URLSearchParams({
    q: query,
    dateRange: dateRange || 'custom',
    startdt: dateRange ? '' : new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10),
    enddt: new Date().toISOString().slice(0, 10),
    forms: forms || '',
  });

  const data = await edgarFetch(`${EFTS_BASE}/search-index?${params}`);
  if (!data?.hits?.hits) return [];

  const results = data.hits.hits.slice(0, limit).map(h => ({
    entityName: h._source?.entity_name,
    ticker: h._source?.tickers?.[0],
    form: h._source?.form_type,
    filingDate: h._source?.file_date,
    description: h._source?.file_description || '',
    url: h._source?.file_url ? `https://www.sec.gov${h._source.file_url}` : null,
  }));

  cacheSet(ck, results, TTL.search);
  return results;
}

module.exports = {
  getRecentFilings,
  get8KFilings,
  getAnnualQuarterly,
  get13FFilings,
  getInsiderFilings,
  getCompanyFacts,
  searchFilings,
  tickerToCik,
};
