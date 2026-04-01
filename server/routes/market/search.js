/**
 * routes/market/search.js — Ticker search (Polygon + Yahoo + Eulerpool)
 */

const express = require('express');
const router  = express.Router();
const { sanitizeText, clampInt } = require('../../utils/validate');
const { yahooCache } = require('./lib/cache');
const { polyFetch, eulerpool, sendError, fetch, YF_UA } = require('./lib/providers');

// ── /search ─────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const q = sanitizeText(req.query.q || '', 100);
    const limit = clampInt(req.query.limit, 1, 30, 8);
    if (!q.trim()) return res.json({ results: [] });

    const [polyResult, yahooResult, eulerResult] = await Promise.allSettled([
      polyFetch(`/v3/reference/tickers?search=${encodeURIComponent(q.trim())}&active=true&limit=${limit}&sort=ticker`),
      yahooCache.wrap(`yf_search:${q.trim().toLowerCase()}`, async () => {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q.trim())}&lang=en-US&region=BR&quotesCount=8&newsCount=0&enableFuzzyQuery=false`,
          { headers: { 'User-Agent': YF_UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/' } }
        );
        if (r.status === 429) { const e = new Error('Yahoo search 429'); e.code = 'rate_limit'; throw e; }
        return r.json();
      }, 30 * 1000),
      // Eulerpool search — adds premium coverage for European & global tickers
      eulerpool.isConfigured() ? eulerpool.search(q.trim(), 10) : Promise.resolve([]),
    ]);

    const results = [];
    const seen = new Set();

    if (polyResult.status === 'fulfilled') {
      for (const r of polyResult.value?.results || []) {
        const sym = r.ticker?.toUpperCase();
        if (!sym || seen.has(sym)) continue;
        seen.add(sym);
        results.push({
          ticker:          sym,
          name:            r.name || sym,
          market:          r.market || '',
          primaryExchange: r.primary_exchange || '',
          type:            r.type || 'CS',
        });
      }
    } else {
      console.log('[Search] Polygon failed:', polyResult.reason?.message);
    }

    if (yahooResult.status === 'fulfilled') {
      for (const r of yahooResult.value?.quotes || []) {
        if (!r.symbol) continue;
        const sym = r.symbol.toUpperCase();
        if (seen.has(sym)) continue;
        seen.add(sym);
        results.push({
          ticker:          sym,
          name:            r.longname || r.shortname || sym,
          market:          r.exchange || '',
          primaryExchange: r.exchange || '',
          type:            r.quoteType || 'EQUITY',
        });
      }
    } else {
      console.log('[Search] Yahoo fallback failed:', yahooResult.reason?.message);
    }

    // Merge Eulerpool results (typically European / global tickers not in Polygon/Yahoo)
    if (eulerResult.status === 'fulfilled') {
      for (const r of eulerResult.value || []) {
        if (!r.symbol) continue;
        const sym = r.symbol.toUpperCase();
        if (seen.has(sym)) continue;
        seen.add(sym);
        results.push({
          ticker:          sym,
          name:            r.name || sym,
          market:          r.exchange || '',
          primaryExchange: r.exchange || '',
          type:            r.type || 'EQUITY',
          source:          'eulerpool',
        });
      }
    } else {
      console.log('[Search] Eulerpool failed:', eulerResult.reason?.message);
    }

    res.json({ results: results.slice(0, 20) });
  } catch (e) {
    console.error('[API] /search error:', e.message);
    sendError(res, e);
  }
});

module.exports = router;
