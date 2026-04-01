/**
 * routes/market/news.js — Aggregated news (Polygon + Bloomberg + FT RSS)
 */

const express = require('express');
const router  = express.Router();
const { sanitizeText, clampInt } = require('../../utils/validate');
const { cacheGet, cacheSet, TTL } = require('./lib/cache');
const { polyFetch, parseRss, sendError, fetch, YF_UA } = require('./lib/providers');

// ── /news ───────────────────────────────────────────────────────────
router.get('/news', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 1, 100, 30);
    const tickerFilter = req.query.ticker ? sanitizeText(req.query.ticker, 20).toUpperCase() : null;

    if (tickerFilter) {
      const cacheKey = `news:${tickerFilter}:${limit}`;
      const cached = cacheGet(cacheKey);
      if (cached) return res.json(cached);
      const data = await polyFetch(
        `/v2/reference/news?ticker=${encodeURIComponent(tickerFilter)}&limit=${limit}&order=desc&sort=published_utc`
      );
      const result = { results: data?.results || [], status: 'OK' };
      cacheSet(cacheKey, result, TTL.news);
      return res.json(result);
    }

    const cacheKey = `news:all:${limit}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const [polyRes, bloomRes, ftRes] = await Promise.allSettled([
      polyFetch(`/v2/reference/news?limit=${limit}&order=desc&sort=published_utc`),
      fetch('https://feeds.bloomberg.com/markets/news.rss', {
        headers: { 'User-Agent': YF_UA, 'Accept': 'application/rss+xml,*/*' },
      }).then(r => { if (!r.ok) throw new Error(`Bloomberg RSS ${r.status}`); return r.text(); }),
      fetch('https://www.ft.com/markets?format=rss', {
        headers: { 'User-Agent': YF_UA, 'Accept': 'application/rss+xml,*/*', 'Referer': 'https://www.ft.com/' },
      }).then(r => { if (!r.ok) throw new Error(`FT RSS ${r.status}`); return r.text(); }),
    ]);

    const results = [];

    if (polyRes.status === 'fulfilled') {
      results.push(...(polyRes.value?.results || []));
    } else {
      console.warn('[News] Polygon:', polyRes.reason?.message);
    }

    if (bloomRes.status === 'fulfilled') {
      results.push(...parseRss(bloomRes.value, 'Bloomberg', 'https://www.bloomberg.com'));
    } else {
      console.warn('[News] Bloomberg RSS:', bloomRes.reason?.message);
    }

    if (ftRes.status === 'fulfilled') {
      results.push(...parseRss(ftRes.value, 'Financial Times', 'https://www.ft.com'));
    } else {
      console.warn('[News] FT RSS:', ftRes.reason?.message);
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
