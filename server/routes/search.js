/**
 * routes/search.js — AI-powered search via Perplexity Sonar Pro
 *
 * POST /api/search/ai
 *   Body: { query: string }
 *   Returns: { summary: string, citations: [{ title, url }], model: string }
 *
 * Uses Perplexity's Sonar Pro model for real-time financial research summaries.
 * Requires PERPLEXITY_API_KEY env var.
 */

const express = require('express');
const fetch   = require('node-fetch');
const router  = express.Router();

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const MODEL          = 'sonar-pro';
const TIMEOUT_MS     = 15000;

// Simple in-memory cache: query → { result, exp }
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function cacheGet(q) {
  const e = _cache.get(q.toLowerCase().trim());
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(q.toLowerCase().trim()); return null; }
  return e.v;
}
function cacheSet(q, v) {
  _cache.set(q.toLowerCase().trim(), { v, exp: Date.now() + CACHE_TTL });
  // Evict old entries if cache gets large
  if (_cache.size > 200) {
    const now = Date.now();
    for (const [k, e] of _cache) {
      if (now > e.exp) _cache.delete(k);
    }
  }
}

/**
 * POST /ai — AI-powered financial research summary
 */
router.post('/ai', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI search not configured — PERPLEXITY_API_KEY missing' });
  }

  const { query } = req.body;
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return res.status(400).json({ error: 'Query is required (min 2 characters)' });
  }
  if (query.length > 500) {
    return res.status(400).json({ error: 'Query too long (max 500 characters)' });
  }

  // Check cache
  const cached = cacheGet(query);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a financial research assistant for a professional market terminal. Provide concise, data-driven summaries about stocks, markets, economics, and finance. Include specific numbers, dates, and facts. Keep responses under 200 words. Format key metrics in bold. Always cite your sources.'
          },
          {
            role: 'user',
            content: query.trim()
          }
        ],
        max_tokens: 400,
        temperature: 0.2,
        return_citations: true,
        search_domain_filter: [],
        search_recency_filter: 'week',
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Search/AI] Perplexity API error ${response.status}:`, errText.substring(0, 200));
      return res.status(502).json({ error: `AI provider error (${response.status})` });
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice?.message?.content) {
      return res.status(502).json({ error: 'Empty response from AI provider' });
    }

    // Extract citations from Perplexity response
    const citations = (data.citations || []).map((url, i) => ({
      title: `Source ${i + 1}`,
      url,
    }));

    const result = {
      summary: choice.message.content,
      citations,
      model: data.model || MODEL,
      usage: data.usage ? { tokens: data.usage.total_tokens } : null,
    };

    // Cache the result
    cacheSet(query, result);

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'AI search timed out (15s)' });
    }
    console.error('[Search/AI] Error:', err.message);
    res.status(500).json({ error: 'AI search failed' });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
