/**
 * routes/market/news.js — Aggregated news (Finnhub primary + Polygon + RSS fallbacks)
 *
 * Fixed: Yahoo-first approach eliminates Polygon queue bottleneck for general news.
 * Finnhub general news is fast (no queue) and returns market-relevant headlines.
 * All fetches have explicit timeouts to prevent 504s from the route-level 15s guard.
 */

const express = require('express');
const router  = express.Router();
const { sanitizeText, clampInt } = require('../../utils/validate');
const { cacheGet, cacheSet, TTL } = require('./lib/cache');
const { polyFetch, parseRss, sendError, fetch, YF_UA } = require('./lib/providers');

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// ── Timeout-wrapped fetch helper ────────────────────────────────────
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Finnhub general news ────────────────────────────────────────────
async function fetchFinnhubNews(limit = 30) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return [];
  try {
    const r = await fetchWithTimeout(
      `${FINNHUB_BASE}/news?category=general&token=${key}`,
      { headers: { 'Accept': 'application/json' } },
      8000
    );
    if (!r.ok) return [];
    const items = await r.json();
    if (!Array.isArray(items)) return [];
    return items.slice(0, limit).map(item => ({
      title: item.headline,
      author: item.source,
      article_url: item.url,
      image_url: item.image,
      published_utc: item.datetime ? new Date(item.datetime * 1000).toISOString() : null,
      description: item.summary?.slice(0, 200) || '',
      source: item.source || 'Finnhub',
    }));
  } catch (e) {
    console.warn('[News] Finnhub general news failed:', e.message);
    return [];
  }
}

// ── Finnhub company news (ticker-specific) ──────────────────────────
async function fetchFinnhubCompanyNews(ticker, limit = 15) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return [];
  try {
    const to = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const r = await fetchWithTimeout(
      `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(ticker)}&from=${fromDate}&to=${to}&token=${key}`,
      { headers: { 'Accept': 'application/json' } },
      8000
    );
    if (!r.ok) return [];
    const items = await r.json();
    if (!Array.isArray(items)) return [];
    return items.slice(0, limit).map(item => ({
      title: item.headline,
      author: item.source,
      article_url: item.url,
      image_url: item.image,
      published_utc: item.datetime ? new Date(item.datetime * 1000).toISOString() : null,
      description: item.summary?.slice(0, 200) || '',
      source: item.source || 'Finnhub',
      tickers: [ticker],
    }));
  } catch (e) {
    console.warn(`[News] Finnhub company news failed for ${ticker}:`, e.message);
    return [];
  }
}

// ── /news ───────────────────────────────────────────────────────────
router.get('/news', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 1, 100, 30);
    const tickerFilter = req.query.ticker ? sanitizeText(req.query.ticker, 20).toUpperCase() : null;

    // ── Ticker-specific news ──────────────────────────────────────────
    if (tickerFilter) {
      const cacheKey = `news:${tickerFilter}:${limit}`;
      const cached = cacheGet(cacheKey);
      if (cached) return res.json(cached);

      // Try Finnhub company news first (fast), then Polygon as fallback
      const [finnhubItems, polyItems] = await Promise.allSettled([
        fetchFinnhubCompanyNews(tickerFilter, limit),
        polyFetch(
          `/v2/reference/news?ticker=${encodeURIComponent(tickerFilter)}&limit=${limit}&order=desc&sort=published_utc`,
          { priority: 6, label: 'news' }
        ).then(d => d?.results || []).catch(() => []),
      ]);

      const results = [];
      if (finnhubItems.status === 'fulfilled') results.push(...finnhubItems.value);
      if (polyItems.status === 'fulfilled') results.push(...polyItems.value);

      // Deduplicate by title similarity
      const seen = new Set();
      const unique = results.filter(r => {
        const key = (r.title || '').toLowerCase().slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      unique.sort((a, b) => {
        const ta = a.published_utc ? new Date(a.published_utc).getTime() : 0;
        const tb = b.published_utc ? new Date(b.published_utc).getTime() : 0;
        return tb - ta;
      });

      const result = { results: unique.slice(0, limit), status: 'OK' };
      cacheSet(cacheKey, result, 60_000);
      return res.json(result);
    }

    // ── General news feed ─────────────────────────────────────────────
    const cacheKey = `news:all:${limit}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // Fetch from all sources in parallel with individual timeouts
    // Finnhub is primary (fast, reliable); RSS feeds are supplementary
    const [finnhubRes, bloomRes, ftRes] = await Promise.allSettled([
      fetchFinnhubNews(limit),
      fetchWithTimeout('https://feeds.bloomberg.com/markets/news.rss', {
        headers: { 'User-Agent': YF_UA, 'Accept': 'application/rss+xml,*/*' },
      }, 6000).then(r => { if (!r.ok) throw new Error(`Bloomberg RSS ${r.status}`); return r.text(); }),
      fetchWithTimeout('https://www.ft.com/markets?format=rss', {
        headers: { 'User-Agent': YF_UA, 'Accept': 'application/rss+xml,*/*', 'Referer': 'https://www.ft.com/' },
      }, 6000).then(r => { if (!r.ok) throw new Error(`FT RSS ${r.status}`); return r.text(); }),
    ]);

    const results = [];

    if (finnhubRes.status === 'fulfilled') {
      results.push(...finnhubRes.value);
    }

    if (bloomRes.status === 'fulfilled') {
      results.push(...parseRss(bloomRes.value, 'Bloomberg', 'https://www.bloomberg.com'));
    }

    if (ftRes.status === 'fulfilled') {
      results.push(...parseRss(ftRes.value, 'Financial Times', 'https://www.ft.com'));
    }

    // If we got nothing from any source, try Polygon as last resort
    if (results.length === 0) {
      try {
        const polyData = await polyFetch(
          `/v2/reference/news?limit=${limit}&order=desc&sort=published_utc`,
          { priority: 6, label: 'news-fallback' }
        );
        results.push(...(polyData?.results || []));
      } catch (pe) {
        console.warn('[News] Polygon fallback also failed:', pe.message);
      }
    }

    results.sort((a, b) => {
      const ta = a.published_utc ? new Date(a.published_utc).getTime() : 0;
      const tb = b.published_utc ? new Date(b.published_utc).getTime() : 0;
      return tb - ta;
    });

    const payload = { results: results.slice(0, limit * 2), status: 'OK' };
    cacheSet(cacheKey, payload, TTL.news);
    res.json(payload);
  } catch (e) {
    console.error('[API] /news:', e.message);
    sendError(res, e);
  }
});

module.exports = router;
