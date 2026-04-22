/**
 * providers/tavily.js
 *
 * Tavily Search API — LLM-first web search with clean snippets.
 * https://docs.tavily.com/docs/rest-api/api-reference
 *
 * Why this exists: Particle AI had no way to reach primary sources. When a
 * user asked "give me price / fleet for HTZ, CAR, RENT3, MOVI3", the toolbox
 * could pull market caps (sometimes) but had no path to fleet size, store
 * count, ARR, headcount, or any other operational KPI that lives on IR
 * pages, 10-K filings, 20-F, DFPs, press releases. This provider is the
 * first half of that capability — search the web and return a short list of
 * ranked URLs with snippets. The second half (`fetch_url`) reads one of
 * those URLs end-to-end.
 *
 * Auth:  api_key in JSON body (not header, not query param).
 * Cost:  ~$0.008 per basic search, ~$0.016 advanced (Apr 2026 pricing).
 *
 * Endpoints used here:
 *   POST /search — query → { answer, results: [{title, url, content, ...}] }
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const BASE = 'https://api.tavily.com';
const TIMEOUT_MS = 12_000;

function key() {
  return process.env.TAVILY_API_KEY;
}

// ── In-process TTL cache ────────────────────────────────────────────────────
// Search responses are deterministic enough at minute-scale that caching
// identical queries for 10 minutes avoids repeat spend when the model
// retries or rephrases. Keyed on (query|depth|max_results).
const _cache = new Map();
const MAX_CACHE = 200;
const CACHE_TTL_MS = 10 * 60_000;

function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}

function cacheSet(k, v) {
  if (_cache.size >= MAX_CACHE) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(k, { v, exp: Date.now() + CACHE_TTL_MS });
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of _cache) {
    if (now > e.exp) _cache.delete(k);
  }
}, 120_000).unref();

/**
 * Run a Tavily search. Returns a normalised shape regardless of Tavily API
 * quirks, or null if the API key isn't set, or `{ error }` on failure.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {'basic'|'advanced'} [opts.depth='basic']  advanced is ~2× cost
 * @param {number} [opts.maxResults=6]               cap 10
 * @param {boolean} [opts.includeAnswer=true]        ask Tavily for a one-liner
 * @param {string[]} [opts.includeDomains]           restrict to these domains
 * @param {string[]} [opts.excludeDomains]           strip these domains
 * @returns {Promise<{answer:string|null, results:Array, query:string, source:'tavily'} | {error:string} | null>}
 */
async function search(query, opts = {}) {
  const apiKey = key();
  if (!apiKey) return null;

  const q = String(query || '').trim();
  if (!q) return { error: 'query required' };

  const depth = opts.depth === 'advanced' ? 'advanced' : 'basic';
  const maxResults = Math.min(10, Math.max(1, Number(opts.maxResults) || 6));
  const includeAnswer = opts.includeAnswer !== false;

  const ck = `search:${depth}:${maxResults}:${q.toLowerCase()}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const body = {
    api_key: apiKey,
    query: q,
    search_depth: depth,
    max_results: maxResults,
    include_answer: includeAnswer,
    include_raw_content: false,   // raw bodies balloon context; fetch_url handles deep reads
    include_images: false,
  };
  if (Array.isArray(opts.includeDomains) && opts.includeDomains.length) {
    body.include_domains = opts.includeDomains.slice(0, 20);
  }
  if (Array.isArray(opts.excludeDomains) && opts.excludeDomains.length) {
    body.exclude_domains = opts.excludeDomains.slice(0, 20);
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('tavily', `search HTTP ${res.status}`, { query: q, status: res.status, snippet: text.slice(0, 200) });
      return { error: `tavily ${res.status}` };
    }
    const json = await res.json();
    const normalised = {
      query: q,
      answer: json.answer || null,
      results: Array.isArray(json.results) ? json.results.map(r => ({
        title:   r.title || '',
        url:     r.url || '',
        content: (r.content || '').slice(0, 600),  // 600 chars ≈ 2 paragraphs
        score:   typeof r.score === 'number' ? r.score : null,
        publishedDate: r.published_date || null,
      })) : [],
      source: 'tavily',
      asOf: new Date().toISOString(),
    };
    cacheSet(ck, normalised);
    return normalised;
  } catch (e) {
    if (e.name === 'AbortError') {
      logger.warn('tavily', 'search timeout', { query: q, ms: TIMEOUT_MS });
      return { error: 'tavily timeout' };
    }
    logger.warn('tavily', 'search failed', { query: q, error: e.message });
    return { error: e.message || 'tavily failed' };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { search };
