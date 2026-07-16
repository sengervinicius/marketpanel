/**
 * routes/market/news.js — Aggregated news (Finnhub primary + Polygon + RSS fallbacks)
 *
 * Fixed: Yahoo-first approach eliminates Polygon queue bottleneck for general news.
 * Finnhub general news is fast (no queue) and returns market-relevant headlines.
 * All fetches have explicit timeouts to prevent 504s from the route-level 15s guard.
 *
 * Phase 3 (news intelligence):
 *   - GET /news?tickers=AAPL,PETR4 — watchlist-scoped feed. Validates/
 *     uppercases/caps the list at 30, enriches the general feed with
 *     Finnhub company news for the first few tickers, and filters the
 *     merged items by ticker match.
 *   - GET /news/ticker-summary/:symbol — 7-day AI summary for one ticker.
 *     Perplexity → Anthropic Haiku fallback (same pattern as
 *     /api/search/news-briefing, #291 W1.15). 30-min in-memory cache.
 */

const express = require('express');
const router  = express.Router();
const { sanitizeText, clampInt } = require('../../utils/validate');
const { cacheGet, cacheSet, TTL } = require('./lib/cache');
const { polyFetch, parseRss, sendError, fetch, YF_UA } = require('./lib/providers');
const { dailyAILimit } = require('../../middleware/dailyAILimit');
const { aiQuotaGate } = require('../../middleware/aiQuotaGate');
const { PERPLEXITY_URL, MODEL } = require('../search.helpers');

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

// ── Ticker helpers (watchlist-scoped feed) ──────────────────────────
const TICKER_RE = /^[A-Z0-9.\-:]{1,15}$/;
const MAX_SCOPE_TICKERS = 30;

/**
 * Parse ?tickers=aapl,PETR4 into a validated, uppercased, deduped list
 * capped at MAX_SCOPE_TICKERS. Returns null when nothing valid remains.
 */
function parseTickersParam(raw) {
  if (!raw) return null;
  const seen = new Set();
  const out = [];
  for (const part of String(raw).split(',')) {
    const t = part.trim().toUpperCase();
    if (!t || !TICKER_RE.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_SCOPE_TICKERS) break;
  }
  return out.length > 0 ? out : null;
}

/** Uppercased ticker list on a normalized news item (tickers | symbols). */
function itemTickers(item) {
  const src = item && (item.tickers || item.symbols);
  if (Array.isArray(src)) return src.map(t => String(t).toUpperCase());
  if (typeof src === 'string' && src) {
    return src.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }
  return [];
}

/** Dedupe by title prefix (same heuristic as the legacy ticker path). */
function dedupeByTitle(items) {
  const seen = new Set();
  return items.filter(r => {
    const key = (r.title || '').toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortByPublished(items) {
  items.sort((a, b) => {
    const ta = a.published_utc ? new Date(a.published_utc).getTime() : 0;
    const tb = b.published_utc ? new Date(b.published_utc).getTime() : 0;
    return tb - ta;
  });
  return items;
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
      // Finnhub attaches related symbols as a comma-separated string —
      // surface them so the ?tickers= filter can match general items.
      tickers: typeof item.related === 'string' && item.related
        ? item.related.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 10)
        : [],
    }));
  } catch (e) {
    console.warn('[News] Finnhub general news failed:', e.message);
    return [];
  }
}

// ── Finnhub company news (ticker-specific, 7-day window) ────────────
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

// ── Ticker news (Finnhub company + Polygon), shared by /news?ticker=
//    and /news/ticker-summary/:symbol ─────────────────────────────────
async function fetchTickerNews(ticker, limit) {
  const [finnhubItems, polyItems] = await Promise.allSettled([
    fetchFinnhubCompanyNews(ticker, limit),
    polyFetch(
      `/v2/reference/news?ticker=${encodeURIComponent(ticker)}&limit=${limit}&order=desc&sort=published_utc`,
      { priority: 6, label: 'news' }
    ).then(d => d?.results || []).catch(() => []),
  ]);

  const results = [];
  if (finnhubItems.status === 'fulfilled') results.push(...finnhubItems.value);
  if (polyItems.status === 'fulfilled') results.push(...polyItems.value);

  return sortByPublished(dedupeByTitle(results));
}

// ── General feed (Finnhub + Bloomberg/FT RSS + Polygon last resort) ──
async function fetchGeneralFeed(limit) {
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

  return sortByPublished(results);
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

      const unique = await fetchTickerNews(tickerFilter, limit);
      const result = { results: unique.slice(0, limit), status: 'OK' };
      cacheSet(cacheKey, result, 60_000);
      return res.json(result);
    }

    // ── Watchlist-scoped feed (?tickers=AAPL,PETR4) ───────────────────
    const scopeTickers = parseTickersParam(req.query.tickers);
    if (scopeTickers) {
      const cacheKey = `news:scoped:${scopeTickers.slice().sort().join(',')}:${limit}`;
      const cached = cacheGet(cacheKey);
      if (cached) return res.json(cached);

      // The general feed alone is too sparse on per-item tickers to
      // filter well, so enrich it with Finnhub company news for the
      // first few requested symbols (cheap, 7-day window, parallel).
      const enrich = scopeTickers.slice(0, 8);
      const perTickerLimit = Math.max(5, Math.ceil(limit / enrich.length));
      const [general, ...company] = await Promise.all([
        fetchGeneralFeed(limit),
        ...enrich.map(t => fetchFinnhubCompanyNews(t, perTickerLimit).catch(() => [])),
      ]);

      const want = new Set(scopeTickers);
      const matched = [...general, ...company.flat()]
        .filter(item => itemTickers(item).some(t => want.has(t)));

      const unique = sortByPublished(dedupeByTitle(matched));
      const payload = {
        results: unique.slice(0, limit),
        status: 'OK',
        scope: 'tickers',
        tickers: scopeTickers,
      };
      cacheSet(cacheKey, payload, 60_000);
      return res.json(payload);
    }

    // ── General news feed ─────────────────────────────────────────────
    const cacheKey = `news:all:${limit}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const results = await fetchGeneralFeed(limit);
    const payload = { results: results.slice(0, limit * 2), status: 'OK' };
    cacheSet(cacheKey, payload, TTL.news);
    res.json(payload);
  } catch (e) {
    console.error('[API] /news:', e.message);
    sendError(res, e);
  }
});

/**
 * GET /news/ticker-summary/:symbol — 7-day AI news summary for one ticker.
 *
 * Pulls the ticker's news through the provider layer (Finnhub company
 * news is already scoped to a 7-day window; Polygon supplements), then
 * makes ONE LLM call to produce a 3-5 bullet summary + a net sentiment
 * word. Provider chain mirrors /api/search/news-briefing (#291 W1.15):
 * Perplexity first, Anthropic Haiku fallback, each with its own
 * AbortController; Sentry fires only when BOTH providers fail.
 *
 * Returns: { symbol, summary, bullets, sentiment, articleCount, cached,
 *            provider, degraded, generatedAt }
 * Cache: in-memory, 30 min per symbol.
 */

const _tickerSummaryCache = new Map();
const TICKER_SUMMARY_TTL = 30 * 60 * 1000;

router.get('/news/ticker-summary/:symbol', dailyAILimit, aiQuotaGate, async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!TICKER_RE.test(symbol)) {
    return res.status(400).json({ error: 'invalid_symbol' });
  }

  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!perplexityKey && !anthropicKey) return res.status(503).json({ error: 'AI not configured' });

  const cachedEntry = _tickerSummaryCache.get(symbol);
  if (cachedEntry && Date.now() < cachedEntry.exp) {
    return res.json({ ...cachedEntry.v, cached: true });
  }

  try {
    const items = await fetchTickerNews(symbol, 20);

    if (items.length === 0) {
      const empty = {
        symbol,
        summary: 'No news found for this ticker in the last 7 days.',
        bullets: [],
        sentiment: 'neutral',
        articleCount: 0,
        provider: null,
        degraded: false,
        generatedAt: new Date().toISOString(),
      };
      // Short cache for the empty case so a quiet ticker doesn't hammer providers.
      _tickerSummaryCache.set(symbol, { v: empty, exp: Date.now() + 5 * 60 * 1000 });
      return res.json({ ...empty, cached: false });
    }

    const headlines = items.slice(0, 20).map((it, i) => {
      const when = it.published_utc ? it.published_utc.slice(0, 10) : '?';
      const desc = it.description ? ` — ${String(it.description).slice(0, 120)}` : '';
      return `${i + 1}. [${when}] (${it.source || it.author || 'wire'}) ${it.title}${desc}`;
    });

    const systemPrompt = `You are a financial news analyst at a Bloomberg-style terminal. Given the last 7 days of headlines for a single ticker, produce:
1. "summary": ONE sentence (≤ 30 words) capturing the week's dominant narrative for the ticker.
2. "bullets": 3 to 5 bullets (≤ 22 words each) covering the most decision-relevant developments, most important first.
3. "sentiment": the NET sentiment word for the ticker across the week — exactly one of: bullish, bearish, neutral, mixed.

Respond ONLY with valid JSON:
{ "summary": "...", "bullets": ["...", "..."], "sentiment": "bullish|bearish|neutral|mixed" }
Rules: no emojis, no disclaimers, no hedging filler. Be data-driven.`;

    const userPrompt = `Ticker: ${symbol}\nLast 7 days — ${items.length} articles (top ${headlines.length} shown):\n\n${headlines.join('\n')}`;

    // #291 W1.15 pattern — outcomes tracker so Sentry alerts ONLY when
    // both providers fail (see /api/search/news-briefing).
    const _outcomes = { perplexity: null, anthropic: null };

    async function tryPerplexity() {
      if (!perplexityKey) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await fetch(PERPLEXITY_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${perplexityKey}`, 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            max_tokens: 500,
            temperature: 0.15,
          }),
        });
        clearTimeout(timer);
        if (!r.ok) {
          const errText = await r.text().catch(() => '');
          if (r.status === 401 || r.status === 403) {
            console.error(`[Ticker-Summary] Perplexity auth ${r.status} — PERPLEXITY_API_KEY likely expired. Body:`, errText.substring(0, 200));
            _outcomes.perplexity = 'auth';
          } else {
            console.warn(`[Ticker-Summary] Perplexity ${r.status}:`, errText.substring(0, 200));
            _outcomes.perplexity = `http_${r.status}`;
          }
          return null; // fall through to Anthropic
        }
        const data = await r.json();
        _outcomes.perplexity = 'ok';
        return data.choices?.[0]?.message?.content || null;
      } catch (e) {
        clearTimeout(timer);
        console.warn('[Ticker-Summary] Perplexity threw:', e.message);
        _outcomes.perplexity = 'network';
        return null;
      }
    }

    async function tryAnthropic() {
      if (!anthropicKey) { _outcomes.anthropic = 'not_configured'; return null; }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          signal: ctrl.signal,
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });
        clearTimeout(timer);
        if (!r.ok) {
          const errText = await r.text().catch(() => '');
          if (r.status === 401 || r.status === 403) {
            console.error(`[Ticker-Summary] Anthropic auth ${r.status} — ANTHROPIC_API_KEY likely expired. Body:`, errText.substring(0, 200));
            _outcomes.anthropic = 'auth';
          } else {
            console.warn(`[Ticker-Summary] Anthropic ${r.status}:`, errText.substring(0, 200));
            _outcomes.anthropic = `http_${r.status}`;
          }
          return null;
        }
        const data = await r.json();
        _outcomes.anthropic = 'ok';
        // Anthropic returns content as an array of { type: 'text', text: '...' }
        return data.content?.[0]?.text || null;
      } catch (e) {
        clearTimeout(timer);
        console.warn('[Ticker-Summary] Anthropic threw:', e.message);
        _outcomes.anthropic = 'network';
        return null;
      }
    }

    let raw = await tryPerplexity();
    let providerUsed = 'perplexity';
    if (!raw) {
      raw = await tryAnthropic();
      providerUsed = 'anthropic';
    }
    if (!raw) {
      // Sentry alerts ONLY when both providers failed (user impacted).
      try {
        require('@sentry/node').captureMessage(
          'Ticker-summary degraded: both providers failed',
          {
            level: 'error',
            tags: {
              route: 'news/ticker-summary',
              perplexity_outcome: _outcomes.perplexity || 'skipped',
              anthropic_outcome: _outcomes.anthropic || 'skipped',
            },
          }
        );
      } catch (_) { /* sentry optional */ }
      return res.status(503).json({
        error: 'summary_temporarily_unavailable',
        message: 'The AI ticker summary is temporarily unavailable across all providers. Headlines remain current.',
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim());
    } catch {
      return res.status(502).json({ error: 'Failed to parse AI response' });
    }

    const validSents = new Set(['bullish', 'bearish', 'neutral', 'mixed']);
    const result = {
      symbol,
      summary: String(parsed.summary || '').slice(0, 400),
      bullets: (Array.isArray(parsed.bullets) ? parsed.bullets : [])
        .slice(0, 5)
        .map(b => String(b).slice(0, 200))
        .filter(Boolean),
      sentiment: validSents.has(parsed.sentiment) ? parsed.sentiment : 'neutral',
      articleCount: items.length,
      provider: providerUsed,
      degraded: providerUsed !== 'perplexity',
      generatedAt: new Date().toISOString(),
    };

    _tickerSummaryCache.set(symbol, { v: result, exp: Date.now() + TICKER_SUMMARY_TTL });
    if (_tickerSummaryCache.size > 100) {
      const now = Date.now();
      for (const [k, e] of _tickerSummaryCache) { if (now > e.exp) _tickerSummaryCache.delete(k); }
    }

    res.json({ ...result, cached: false });
  } catch (err) {
    // #220 — guard against late-abort write-after-send crashes.
    if (res.headersSent) return;
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Ticker summary timed out' });
    console.error(`[API] /news/ticker-summary/${symbol}:`, err.message);
    res.status(500).json({ error: 'Ticker summary failed' });
  }
});

module.exports = router;
