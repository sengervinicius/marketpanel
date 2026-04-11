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
 * GET /health — check whether AI features are available
 */
router.get('/health', (req, res) => {
  res.json({ ai: !!process.env.PERPLEXITY_API_KEY });
});

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

/**
 * POST /fundamentals — AI-powered fundamentals analysis for a single ticker
 *
 * Gathers real data from internal APIs (fundamentals, quote, news) and sends
 * a structured prompt to Perplexity for an analyst-quality company brief.
 */

// Cache for AI fundamentals: symbol → { result, exp }
const _fundsCache = new Map();
const FUNDS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

router.post('/fundamentals', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI not configured — PERPLEXITY_API_KEY missing' });
  }

  const { symbol } = req.body;
  if (!symbol || typeof symbol !== 'string' || symbol.trim().length < 1) {
    return res.status(400).json({ error: 'Symbol is required' });
  }
  const sym = symbol.trim().toUpperCase();

  // Check cache
  const cached = _fundsCache.get(sym);
  if (cached && Date.now() < cached.exp) {
    return res.json({ ...cached.v, cached: true });
  }

  // ── Gather internal data in parallel (with tight individual timeouts) ──
  const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
  const authHeader = req.headers.authorization || '';
  const headers = { Authorization: authHeader, Accept: 'application/json' };
  const DATA_TIMEOUT = 8000; // 8s max for internal API calls — leaves 12s for LLM

  let fundamentals = null, quote = null, newsItems = [];

  try {
    // Each internal fetch has its own AbortController so one slow call doesn't block others
    const fetchWithTimeout = async (url, timeoutMs = DATA_TIMEOUT) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(url, { headers, signal: ctrl.signal });
        return r.ok ? r.json() : null;
      } catch { return null; }
      finally { clearTimeout(timer); }
    };

    const [fundsRes, quoteRes, newsRes] = await Promise.allSettled([
      fetchWithTimeout(`${baseUrl}/api/fundamentals/${encodeURIComponent(sym)}`),
      fetchWithTimeout(`${baseUrl}/api/quote/${encodeURIComponent(sym)}`),
      fetchWithTimeout(`${baseUrl}/api/news?ticker=${encodeURIComponent(sym.replace(/^[XC]:/, ''))}&limit=5`),
    ]);

    fundamentals = fundsRes.status === 'fulfilled' ? fundsRes.value : null;
    quote        = quoteRes.status === 'fulfilled' ? quoteRes.value : null;
    const newsData = newsRes.status === 'fulfilled' ? newsRes.value : null;
    newsItems = (newsData?.results || []).slice(0, 5).map(n => n.title).filter(Boolean);
  } catch (err) {
    console.error('[Search/AI Fundamentals] Data gathering error:', err.message);
  }

  // ── Build context block for the LLM ───────────────────────────────────
  const lines = [`Ticker: ${sym}`];
  if (fundamentals) {
    if (fundamentals.sector)           lines.push(`Sector: ${fundamentals.sector}`);
    if (fundamentals.industry)         lines.push(`Industry: ${fundamentals.industry}`);
    if (fundamentals.marketCap)        lines.push(`Market Cap: ${fmtBig(fundamentals.marketCap)}`);
    if (fundamentals.totalRevenue)     lines.push(`Revenue (TTM): ${fmtBig(fundamentals.totalRevenue)}`);
    if (fundamentals.revenueGrowth != null) lines.push(`Revenue Growth: ${(fundamentals.revenueGrowth * 100).toFixed(1)}%`);
    if (fundamentals.ebitda)           lines.push(`EBITDA: ${fmtBig(fundamentals.ebitda)}`);
    if (fundamentals.profitMargins != null) lines.push(`Net Margin: ${(fundamentals.profitMargins * 100).toFixed(1)}%`);
    if (fundamentals.operatingMargins != null) lines.push(`Operating Margin: ${(fundamentals.operatingMargins * 100).toFixed(1)}%`);
    if (fundamentals.peRatio != null)  lines.push(`P/E (TTM): ${fundamentals.peRatio.toFixed(1)}x`);
    if (fundamentals.forwardPE != null) lines.push(`P/E (FWD): ${fundamentals.forwardPE.toFixed(1)}x`);
    if (fundamentals.priceToBook != null) lines.push(`P/B: ${fundamentals.priceToBook.toFixed(2)}x`);
    if (fundamentals.eps != null)      lines.push(`EPS (TTM): $${fundamentals.eps.toFixed(2)}`);
    if (fundamentals.dividendYield != null) lines.push(`Dividend Yield: ${(fundamentals.dividendYield * 100).toFixed(2)}%`);
    if (fundamentals.returnOnEquity != null) lines.push(`ROE: ${(fundamentals.returnOnEquity * 100).toFixed(1)}%`);
    if (fundamentals.totalCash)        lines.push(`Cash: ${fmtBig(fundamentals.totalCash)}`);
    if (fundamentals.totalDebt)        lines.push(`Debt: ${fmtBig(fundamentals.totalDebt)}`);
    if (fundamentals.beta != null)     lines.push(`Beta: ${fundamentals.beta.toFixed(2)}`);
    if (fundamentals.employees)        lines.push(`Employees: ${fundamentals.employees.toLocaleString()}`);
  }
  if (quote) {
    if (quote.price != null) lines.push(`Last Price: $${quote.price}`);
    if (quote.changePct != null) lines.push(`Day Change: ${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}%`);
  }
  if (newsItems.length > 0) {
    lines.push('', 'Recent headlines:');
    newsItems.forEach((h, i) => lines.push(`${i + 1}. ${h}`));
  }

  const contextBlock = lines.join('\n');

  // ── LLM prompt ────────────────────────────────────────────────────────
  const systemPrompt = `You are a senior equity research analyst. Given a ticker and its financial data, produce a structured analysis. Respond ONLY with valid JSON matching this schema:
{
  "summary": "2-3 sentence overview of what the company does and its current market position",
  "businessModel": "1-2 sentence description of how the company makes money",
  "segments": ["segment1 description", "segment2 description", ...],
  "financialHighlights": ["highlight1", "highlight2", ...],
  "valuationSnapshot": ["metric1 vs sector comment", "metric2 comment", ...],
  "riskFactors": ["risk1", "risk2", ...]
}
Rules:
- Use the provided financial data as the source of truth for numbers. Do NOT invent specific numbers not in the data.
- Keep each array item to 1-2 sentences max.
- 3-5 items per array.
- Be concise, professional, and factual.
- If data is missing for a field, provide qualitative analysis based on your knowledge.
- Do NOT include markdown formatting inside the JSON strings.`;

  const userPrompt = `Analyze this instrument:\n\n${contextBlock}`;

  // ── Call Perplexity ───────────────────────────────────────────────────
  // 10s timeout for LLM — combined with 8s data gather stays under 20s route timeout
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 800,
        temperature: 0.15,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Search/AI Fundamentals] Perplexity error ${response.status}:`, errText.substring(0, 200));
      return res.status(502).json({ error: `AI provider error (${response.status})` });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      return res.status(502).json({ error: 'Empty response from AI provider' });
    }

    // Parse JSON from response (handle potential markdown code fences)
    let parsed;
    try {
      const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('[Search/AI Fundamentals] JSON parse failed, raw:', raw.substring(0, 300));
      // Return raw as summary fallback
      parsed = {
        summary: raw.replace(/```json?\s*/gi, '').replace(/```/g, '').trim(),
        businessModel: '',
        segments: [],
        financialHighlights: [],
        valuationSnapshot: [],
        riskFactors: [],
      };
    }

    const result = {
      symbol: sym,
      generatedAt: new Date().toISOString(),
      summary: parsed.summary || '',
      businessModel: parsed.businessModel || '',
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
      financialHighlights: Array.isArray(parsed.financialHighlights) ? parsed.financialHighlights : [],
      valuationSnapshot: Array.isArray(parsed.valuationSnapshot) ? parsed.valuationSnapshot : [],
      riskFactors: Array.isArray(parsed.riskFactors) ? parsed.riskFactors : [],
    };

    // Cache
    _fundsCache.set(sym, { v: result, exp: Date.now() + FUNDS_CACHE_TTL });
    if (_fundsCache.size > 100) {
      const now = Date.now();
      for (const [k, e] of _fundsCache) { if (now > e.exp) _fundsCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'AI fundamentals timed out (10s)' });
    }
    console.error('[Search/AI Fundamentals] Error:', err.message);
    res.status(500).json({ error: 'AI fundamentals failed' });
  } finally {
    clearTimeout(timer);
  }
});

function fmtBig(n) {
  if (n == null) return null;
  if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(1) + 'T';
  if (Math.abs(n) >= 1e9)  return '$' + (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6)  return '$' + (n / 1e6).toFixed(1) + 'M';
  return '$' + n.toLocaleString();
}

/**
 * POST /chart-insight — AI-powered chart analysis
 *
 * Accepts recent OHLCV bars + computed indicators, returns a 2-3 sentence
 * technical commentary via Perplexity Sonar Pro.
 */

const _chartInsightCache = new Map();
const CHART_INSIGHT_TTL = 5 * 60 * 1000; // 5 minutes

router.post('/chart-insight', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI not configured — PERPLEXITY_API_KEY missing' });
  }

  const { symbol, range, bars, indicators } = req.body;
  if (!symbol || !bars || !Array.isArray(bars) || bars.length === 0) {
    return res.status(400).json({ error: 'symbol and bars[] are required' });
  }

  // Cache key based on symbol + range + last bar timestamp
  const lastT = bars[bars.length - 1]?.t || bars[bars.length - 1]?.label || '';
  const cacheKey = `${symbol}:${range || ''}:${lastT}`;
  const cached = _chartInsightCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) {
    return res.json({ ...cached.v, cached: true });
  }

  // Summarize bars for the prompt (last 5 bars + overall stats)
  const last5 = bars.slice(-5);
  const opens = bars.map(b => b.open).filter(v => v != null);
  const closes = bars.map(b => b.close).filter(v => v != null);
  const highs = bars.map(b => b.high).filter(v => v != null);
  const lows = bars.map(b => b.low).filter(v => v != null);
  const overallHigh = highs.length ? Math.max(...highs) : null;
  const overallLow = lows.length ? Math.min(...lows) : null;
  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const returnPct = firstClose && lastClose ? ((lastClose - firstClose) / firstClose * 100).toFixed(2) : null;

  const barSummary = last5.map(b =>
    `${b.label || ''}: O=${b.open} H=${b.high} L=${b.low} C=${b.close} V=${b.volume || 0}`
  ).join('\n');

  // Build indicator summary
  let indicatorBlock = '';
  if (indicators) {
    const parts = [];
    if (indicators.sma20 != null) parts.push(`SMA(20): ${indicators.sma20.toFixed(2)}`);
    if (indicators.ema50 != null) parts.push(`EMA(50): ${indicators.ema50.toFixed(2)}`);
    if (indicators.rsi14 != null) parts.push(`RSI(14): ${indicators.rsi14.toFixed(1)}`);
    if (indicators.macd) {
      parts.push(`MACD: ${indicators.macd.MACD?.toFixed(2) || '--'}, Signal: ${indicators.macd.signal?.toFixed(2) || '--'}, Hist: ${indicators.macd.histogram?.toFixed(2) || '--'}`);
    }
    if (indicators.bbUpper != null && indicators.bbLower != null) {
      parts.push(`Bollinger Bands: Upper=${indicators.bbUpper.toFixed(2)}, Lower=${indicators.bbLower.toFixed(2)}`);
    }
    if (parts.length > 0) indicatorBlock = '\n\nTechnical Indicators (latest values):\n' + parts.join('\n');
  }

  const systemPrompt = `You are a senior technical analyst at a Bloomberg-style terminal. Given chart data and indicators for a ticker, produce a concise 2-3 sentence technical analysis. Be specific about price levels, patterns, and indicator signals. Do NOT use emojis. Be professional and data-driven. Mention support/resistance levels if apparent. If indicators suggest a trend or reversal, state it clearly.`;

  const userPrompt = `Ticker: ${symbol}
Range: ${range || 'unknown'}
Bars: ${bars.length} data points
Period High: ${overallHigh}
Period Low: ${overallLow}
Period Return: ${returnPct != null ? returnPct + '%' : 'N/A'}
Last Close: ${lastClose}

Recent bars:
${barSummary}${indicatorBlock}

Provide a 2-3 sentence technical analysis.`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 250,
        temperature: 0.15,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Search/AI Chart Insight] Perplexity error ${response.status}:`, errText.substring(0, 200));
      return res.status(502).json({ error: `AI provider error (${response.status})` });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      return res.status(502).json({ error: 'Empty response from AI provider' });
    }

    const result = {
      symbol,
      range: range || '',
      insight: raw.trim(),
      generatedAt: new Date().toISOString(),
    };

    // Cache
    _chartInsightCache.set(cacheKey, { v: result, exp: Date.now() + CHART_INSIGHT_TTL });
    if (_chartInsightCache.size > 100) {
      const now = Date.now();
      for (const [k, e] of _chartInsightCache) { if (now > e.exp) _chartInsightCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'AI chart insight timed out (15s)' });
    }
    console.error('[Search/AI Chart Insight] Error:', err.message);
    res.status(500).json({ error: 'AI chart insight failed' });
  } finally {
    clearTimeout(timer);
  }
});

/**
 * POST /screener-helper — AI-powered filter generation for the fundamental screener
 *
 * Takes a natural-language query and returns structured screener filters.
 */

const _screenerHelperCache = new Map();
const SCREENER_HELPER_TTL = 10 * 60 * 1000; // 10 minutes

router.post('/screener-helper', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ ok: false, error: 'AI not configured' });
  }

  const { query, universe } = req.body;
  if (!query || typeof query !== 'string' || query.trim().length < 3) {
    return res.status(400).json({ ok: false, error: 'Query is required (min 3 characters)' });
  }

  const cacheKey = query.toLowerCase().trim();
  const cached = _screenerHelperCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) {
    return res.json({ ...cached.v, cached: true });
  }

  const systemPrompt = `You are a financial screener assistant. The user describes what stocks or assets they want to find. You must return ONLY a JSON object with screener filter fields. No prose, no markdown, no explanation — just the JSON.

Allowed filter fields:
- assetClass: "equity" | "etf" (string or array)
- country: array of ISO-2 codes, e.g. ["US","BR","GB","EU","JP"]
- sector: array from ["Technology","Financial","Energy","Industrial","Consumer","Healthcare","Auto","Materials","Agriculture","Diversified"]
- minPrice: number (USD)
- maxPrice: number (USD)
- minMarketCap: number (USD, e.g. 1000000000 for $1B)
- maxMarketCap: number (USD)
- minVolume: number (daily shares)
- maxVolume: number

Only include fields that are relevant to the query. Omit fields the user didn't mention.

Examples:
User: "US large cap tech" → {"assetClass":"equity","country":["US"],"sector":["Technology"],"minMarketCap":10000000000}
User: "cheap Brazilian stocks under $20" → {"assetClass":"equity","country":["BR"],"maxPrice":20}
User: "high volume ETFs" → {"assetClass":"etf","minVolume":1000000}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query.trim() },
        ],
        max_tokens: 200,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Search/AI Screener Helper] Perplexity error ${response.status}:`, errText.substring(0, 200));
      return res.status(502).json({ ok: false, error: 'ai_provider_error' });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      return res.status(502).json({ ok: false, error: 'empty_response' });
    }

    // Parse JSON from response
    let filters;
    try {
      const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
      filters = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('[Search/AI Screener Helper] JSON parse failed:', raw.substring(0, 300));
      return res.json({ ok: false, error: 'parse_error' });
    }

    // Build a compact explanation from the filters
    const parts = [];
    if (filters.assetClass) parts.push(`Asset: ${Array.isArray(filters.assetClass) ? filters.assetClass.join(', ') : filters.assetClass}`);
    if (filters.country) parts.push(`Country: ${filters.country.join(', ')}`);
    if (filters.sector) parts.push(`Sector: ${filters.sector.join(', ')}`);
    if (filters.minMarketCap) parts.push(`MCap >= $${(filters.minMarketCap / 1e9).toFixed(0)}B`);
    if (filters.maxMarketCap) parts.push(`MCap <= $${(filters.maxMarketCap / 1e9).toFixed(0)}B`);
    if (filters.minPrice) parts.push(`Price >= $${filters.minPrice}`);
    if (filters.maxPrice) parts.push(`Price <= $${filters.maxPrice}`);
    if (filters.minVolume) parts.push(`Vol >= ${(filters.minVolume / 1e6).toFixed(1)}M`);
    const explanation = parts.length > 0 ? parts.join(' | ') : 'General filter set';

    const result = { ok: true, filters, explanation };

    _screenerHelperCache.set(cacheKey, { v: result, exp: Date.now() + SCREENER_HELPER_TTL });
    if (_screenerHelperCache.size > 50) {
      const now = Date.now();
      for (const [k, e] of _screenerHelperCache) { if (now > e.exp) _screenerHelperCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ ok: false, error: 'timeout' });
    }
    console.error('[Search/AI Screener Helper] Error:', err.message);
    res.status(500).json({ ok: false, error: 'server_error' });
  } finally {
    clearTimeout(timer);
  }
});

/**
 * POST /macro-insight — AI-powered macro analysis comparing countries
 */

const _macroInsightCache = new Map();
const MACRO_INSIGHT_TTL = 10 * 60 * 1000; // 10 minutes

router.post('/macro-insight', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ ok: false, error: 'AI not configured' });
  }

  const { countries, indicators, snapshot } = req.body;
  if (!countries || !Array.isArray(countries) || countries.length === 0) {
    return res.status(400).json({ ok: false, error: 'countries[] is required' });
  }

  const cacheKey = countries.sort().join(',') + ':' + (indicators || []).sort().join(',');
  const cached = _macroInsightCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) {
    return res.json({ ...cached.v, cached: true });
  }

  // Build context from the snapshot data
  let dataBlock = '';
  if (snapshot?.countries) {
    dataBlock = snapshot.countries.map(c => {
      const parts = [`${c.name || c.country} (${c.country})`];
      if (c.policyRate != null) parts.push(`Policy Rate: ${(c.policyRate * 100).toFixed(2)}%`);
      if (c.cpiYoY != null) parts.push(`CPI YoY: ${(c.cpiYoY * 100).toFixed(1)}%`);
      if (c.gdpGrowthYoY != null) parts.push(`GDP Growth: ${(c.gdpGrowthYoY * 100).toFixed(1)}%`);
      if (c.unemploymentRate != null) parts.push(`Unemployment: ${(c.unemploymentRate * 100).toFixed(1)}%`);
      if (c.debtGDP != null) parts.push(`Debt/GDP: ${(c.debtGDP * 100).toFixed(0)}%`);
      if (c.currentAcctGDP != null) parts.push(`Current Acct/GDP: ${(c.currentAcctGDP * 100).toFixed(1)}%`);
      return parts.join(', ');
    }).join('\n');
  }

  const systemPrompt = `You are a macro-economist at a Bloomberg-style terminal. Given macro indicators for multiple countries, produce a concise 3-5 sentence comparison. Focus on monetary policy stance, inflation dynamics, growth outlook, and relative risks. Do NOT give investment advice. Do NOT use emojis. Be professional and specific about the numbers.`;

  const userPrompt = `Compare these countries' macro indicators:\n\n${dataBlock}\n\nProvide a 3-5 sentence macro comparison.`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 300,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Search/AI Macro Insight] Perplexity error ${response.status}:`, errText.substring(0, 200));
      return res.status(502).json({ ok: false, error: 'ai_provider_error' });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      return res.status(502).json({ ok: false, error: 'empty_response' });
    }

    const result = {
      ok: true,
      insight: raw.trim(),
      countries,
      generatedAt: new Date().toISOString(),
    };

    _macroInsightCache.set(cacheKey, { v: result, exp: Date.now() + MACRO_INSIGHT_TTL });
    if (_macroInsightCache.size > 50) {
      const now = Date.now();
      for (const [k, e] of _macroInsightCache) { if (now > e.exp) _macroInsightCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ ok: false, error: 'timeout' });
    }
    console.error('[Search/AI Macro Insight] Error:', err.message);
    res.status(500).json({ ok: false, error: 'server_error' });
  } finally {
    clearTimeout(timer);
  }
});

/**
 * POST /news-summary — AI-powered news summary + sentiment for a list of headlines
 *
 * Body: { headlines: string[] }
 * Returns: { items: [{ headline, sentiment, sentimentScore }], summary: string[] }
 * Cache: 5 min by joined-headline hash
 */

const _newsSummaryCache = new Map();
const NEWS_SUMMARY_TTL = 5 * 60 * 1000;

router.post('/news-summary', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const { headlines } = req.body;
  if (!headlines || !Array.isArray(headlines) || headlines.length === 0) {
    return res.status(400).json({ error: 'headlines[] is required' });
  }
  const trimmed = headlines.slice(0, 20).map(h => (h || '').trim()).filter(Boolean);
  if (trimmed.length === 0) return res.status(400).json({ error: 'No valid headlines provided' });

  const cacheKey = trimmed.join('|').toLowerCase().substring(0, 300);
  const cached = _newsSummaryCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return res.json({ ...cached.v, cached: true });

  const systemPrompt = `You are a financial news analyst at a Bloomberg-style terminal. Given a list of recent headlines, produce:
1. For each headline: a sentiment label (bullish / bearish / neutral) and a confidence score 0-100.
2. A 3-bullet executive summary of the key themes across all headlines.

Respond ONLY with valid JSON matching this schema:
{
  "items": [
    { "headline": "...", "sentiment": "bullish|bearish|neutral", "sentimentScore": 75 }
  ],
  "summary": ["bullet 1", "bullet 2", "bullet 3"]
}
Rules:
- Keep bullets under 25 words each.
- Be data-driven. No emojis. No disclaimers.
- Sentiment must be exactly one of: bullish, bearish, neutral.`;

  const userPrompt = `Analyze these ${trimmed.length} headlines:\n\n${trimmed.map((h, i) => `${i + 1}. ${h}`).join('\n')}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL, messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], max_tokens: 600, temperature: 0.15,
      }),
    });
    if (!response.ok) return res.status(502).json({ error: `AI provider error (${response.status})` });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return res.status(502).json({ error: 'Empty response from AI' });

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim());
    } catch {
      parsed = { items: [], summary: [raw.trim().substring(0, 200)] };
    }

    const result = {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      summary: Array.isArray(parsed.summary) ? parsed.summary : [],
      generatedAt: new Date().toISOString(),
    };

    _newsSummaryCache.set(cacheKey, { v: result, exp: Date.now() + NEWS_SUMMARY_TTL });
    if (_newsSummaryCache.size > 50) {
      const now = Date.now();
      for (const [k, e] of _newsSummaryCache) { if (now > e.exp) _newsSummaryCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'News summary timed out' });
    console.error('[Search/AI News Summary] Error:', err.message);
    res.status(500).json({ error: 'News summary failed' });
  } finally { clearTimeout(timer); }
});

/**
 * POST /portfolio-insight — AI-powered portfolio risk assessment
 *
 * Body: { positions: [{ symbol, weight, returnPct, sector }], totalValue: number }
 * Returns SSE stream with risk score, concentration warnings, rebalance suggestions
 */

const _portfolioInsightCache = new Map();
const PORTFOLIO_INSIGHT_TTL = 10 * 60 * 1000;

router.post('/portfolio-insight', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const { positions, totalValue } = req.body;
  if (!positions || !Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({ error: 'positions[] is required' });
  }

  // Build cache key from sorted symbols
  const cacheKey = positions.map(p => p.symbol).sort().join(',').toLowerCase();
  const cached = _portfolioInsightCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return res.json({ ...cached.v, cached: true });

  const posBlock = positions.map(p =>
    `${p.symbol}: weight=${(p.weight * 100).toFixed(1)}%, return=${p.returnPct != null ? p.returnPct.toFixed(1) + '%' : 'N/A'}, sector=${p.sector || 'Unknown'}`
  ).join('\n');

  const systemPrompt = `You are a portfolio risk analyst. Given portfolio positions with weights, returns, and sectors, produce a structured risk assessment. Respond ONLY with valid JSON:
{
  "riskScore": 1-10,
  "riskLabel": "Low|Moderate|Elevated|High|Critical",
  "concentrationWarnings": ["warning1", "warning2"],
  "sectorExposure": { "Tech": 45.2, "Finance": 20.1 },
  "rebalanceSuggestions": ["suggestion1", "suggestion2"],
  "summary": "2-3 sentence overall assessment"
}
Rules:
- riskScore 1=very safe, 10=very risky
- Flag any single position >20% or sector >40%
- Keep warnings and suggestions to 1 sentence each
- Max 5 items per array
- Be professional and data-driven`;

  const userPrompt = `Portfolio (${positions.length} positions, total value: $${(totalValue || 0).toLocaleString()}):\n\n${posBlock}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL, messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], max_tokens: 600, temperature: 0.15,
      }),
    });
    if (!response.ok) return res.status(502).json({ error: `AI provider error (${response.status})` });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return res.status(502).json({ error: 'Empty response from AI' });

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim());
    } catch {
      parsed = { riskScore: 5, riskLabel: 'Moderate', concentrationWarnings: [], sectorExposure: {}, rebalanceSuggestions: [], summary: raw.trim().substring(0, 300) };
    }

    const result = {
      riskScore: parsed.riskScore || 5,
      riskLabel: parsed.riskLabel || 'Moderate',
      concentrationWarnings: Array.isArray(parsed.concentrationWarnings) ? parsed.concentrationWarnings : [],
      sectorExposure: parsed.sectorExposure || {},
      rebalanceSuggestions: Array.isArray(parsed.rebalanceSuggestions) ? parsed.rebalanceSuggestions : [],
      summary: parsed.summary || '',
      generatedAt: new Date().toISOString(),
    };

    _portfolioInsightCache.set(cacheKey, { v: result, exp: Date.now() + PORTFOLIO_INSIGHT_TTL });
    if (_portfolioInsightCache.size > 50) {
      const now = Date.now();
      for (const [k, e] of _portfolioInsightCache) { if (now > e.exp) _portfolioInsightCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Portfolio insight timed out' });
    console.error('[Search/AI Portfolio Insight] Error:', err.message);
    res.status(500).json({ error: 'Portfolio insight failed' });
  } finally { clearTimeout(timer); }
});

/**
 * POST /alert-suggest — AI-powered alert suggestions for a given symbol
 *
 * Body: { symbol: string, currentPrice: number, positions?: [] }
 * Returns: { suggestions: [{ type, targetPrice, rationale }] }
 */

const _alertSuggestCache = new Map();
const ALERT_SUGGEST_TTL = 10 * 60 * 1000;

router.post('/alert-suggest', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const { symbol, currentPrice, positions } = req.body;
  if (!symbol || typeof symbol !== 'string') return res.status(400).json({ error: 'symbol is required' });

  const sym = symbol.trim().toUpperCase();
  const cacheKey = `${sym}:${Math.round(currentPrice || 0)}`;
  const cached = _alertSuggestCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return res.json({ ...cached.v, cached: true });

  let context = `Symbol: ${sym}`;
  if (currentPrice) context += `\nCurrent Price: $${currentPrice}`;
  if (positions?.length > 0) {
    const pos = positions[0];
    if (pos.entryPrice) context += `\nEntry Price: $${pos.entryPrice}`;
    if (pos.quantity) context += `\nShares: ${pos.quantity}`;
  }

  const systemPrompt = `You are a trading alert advisor. Given a symbol and its current price, suggest 3-5 useful price alerts. Respond ONLY with valid JSON:
{
  "suggestions": [
    { "type": "price_above", "targetPrice": 155.00, "rationale": "Near 52-week high resistance" },
    { "type": "price_below", "targetPrice": 140.00, "rationale": "Key support level breakdown" }
  ]
}
Rules:
- type must be: price_above, price_below, or pct_move_from_entry
- targetPrice must be a reasonable number relative to the current price
- rationale should be 1 short sentence
- Include a mix of upside and downside alerts
- If entry price is provided, include a pct_move alert`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL, messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: context },
        ], max_tokens: 400, temperature: 0.2,
      }),
    });
    if (!response.ok) return res.status(502).json({ error: `AI provider error (${response.status})` });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return res.status(502).json({ error: 'Empty response from AI' });

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim());
    } catch { parsed = { suggestions: [] }; }

    const result = {
      symbol: sym,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5) : [],
      generatedAt: new Date().toISOString(),
    };

    _alertSuggestCache.set(cacheKey, { v: result, exp: Date.now() + ALERT_SUGGEST_TTL });
    if (_alertSuggestCache.size > 100) {
      const now = Date.now();
      for (const [k, e] of _alertSuggestCache) { if (now > e.exp) _alertSuggestCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Alert suggest timed out' });
    console.error('[Search/AI Alert Suggest] Error:', err.message);
    res.status(500).json({ error: 'Alert suggest failed' });
  } finally { clearTimeout(timer); }
});

/**
 * POST /event-preview — AI-powered economic event impact preview
 *
 * Body: { event: string, date: string, previousValue?: string, forecast?: string }
 * Returns: { impact: string, affectedSectors: [], marketExpectation: string, tradingConsiderations: [] }
 */

const _eventPreviewCache = new Map();
const EVENT_PREVIEW_TTL = 15 * 60 * 1000;

router.post('/event-preview', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const { event, date, previousValue, forecast } = req.body;
  if (!event || typeof event !== 'string') return res.status(400).json({ error: 'event name is required' });

  const cacheKey = `${event}:${date || ''}`.toLowerCase().trim();
  const cached = _eventPreviewCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return res.json({ ...cached.v, cached: true });

  let context = `Event: ${event}`;
  if (date) context += `\nDate: ${date}`;
  if (previousValue) context += `\nPrevious: ${previousValue}`;
  if (forecast) context += `\nForecast: ${forecast}`;

  const systemPrompt = `You are a macro-economic analyst. Given an upcoming economic event, provide a brief impact preview. Respond ONLY with valid JSON:
{
  "impact": "high|medium|low",
  "summary": "1-2 sentence impact description",
  "affectedSectors": ["sector1", "sector2"],
  "affectedAssets": ["TICKER1", "TICKER2"],
  "marketExpectation": "1 sentence on consensus",
  "tradingConsiderations": ["consideration1", "consideration2"]
}
Rules:
- Be specific about which sectors and assets are affected
- Keep tradingConsiderations to max 3 items, 1 sentence each
- affectedAssets should be actual ticker symbols
- Do NOT give investment advice`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL, messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: context },
        ], max_tokens: 400, temperature: 0.2,
      }),
    });
    if (!response.ok) return res.status(502).json({ error: `AI provider error (${response.status})` });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return res.status(502).json({ error: 'Empty response from AI' });

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim());
    } catch { parsed = { impact: 'medium', summary: raw.trim().substring(0, 200), affectedSectors: [], affectedAssets: [], marketExpectation: '', tradingConsiderations: [] }; }

    const result = {
      event, date,
      impact: parsed.impact || 'medium',
      summary: parsed.summary || '',
      affectedSectors: Array.isArray(parsed.affectedSectors) ? parsed.affectedSectors : [],
      affectedAssets: Array.isArray(parsed.affectedAssets) ? parsed.affectedAssets : [],
      marketExpectation: parsed.marketExpectation || '',
      tradingConsiderations: Array.isArray(parsed.tradingConsiderations) ? parsed.tradingConsiderations : [],
      generatedAt: new Date().toISOString(),
    };

    _eventPreviewCache.set(cacheKey, { v: result, exp: Date.now() + EVENT_PREVIEW_TTL });
    if (_eventPreviewCache.size > 50) {
      const now = Date.now();
      for (const [k, e] of _eventPreviewCache) { if (now > e.exp) _eventPreviewCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Event preview timed out' });
    console.error('[Search/AI Event Preview] Error:', err.message);
    res.status(500).json({ error: 'Event preview failed' });
  } finally { clearTimeout(timer); }
});

/**
 * POST /sector-rotation — AI-powered sector rotation commentary
 *
 * Body: { sectors: [{ name, changePct, volume }], marketBreadth: { up, down } }
 * Returns: { commentary: string, rotationSignal: string, leadingSectors: [], laggingSectors: [] }
 */

const _sectorRotationCache = new Map();
const SECTOR_ROTATION_TTL = 10 * 60 * 1000;

router.post('/sector-rotation', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const { sectors, marketBreadth } = req.body;
  if (!sectors || !Array.isArray(sectors) || sectors.length === 0) {
    return res.status(400).json({ error: 'sectors[] is required' });
  }

  const cacheKey = sectors.map(s => `${s.name}:${(s.changePct || 0).toFixed(1)}`).sort().join(',');
  const cached = _sectorRotationCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return res.json({ ...cached.v, cached: true });

  const sectorBlock = sectors.map(s =>
    `${s.name}: ${s.changePct >= 0 ? '+' : ''}${(s.changePct || 0).toFixed(2)}%`
  ).join('\n');

  let context = `Today's Sector Performance:\n${sectorBlock}`;
  if (marketBreadth) {
    context += `\n\nMarket Breadth: ${marketBreadth.up || 0} advancing, ${marketBreadth.down || 0} declining`;
  }

  const systemPrompt = `You are a sector rotation analyst. Given today's sector performance, provide a concise rotation analysis. Respond ONLY with valid JSON:
{
  "commentary": "2-3 sentence rotation analysis",
  "rotationSignal": "risk-on|risk-off|mixed|sector-specific",
  "leadingSectors": ["sector1", "sector2"],
  "laggingSectors": ["sector1", "sector2"],
  "theme": "1 sentence theme summary"
}
Rules:
- Be specific about what the rotation implies for the market cycle
- rotationSignal must be exactly one of the listed values
- Keep commentary professional and data-driven
- No emojis, no disclaimers`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL, messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: context },
        ], max_tokens: 350, temperature: 0.2,
      }),
    });
    if (!response.ok) return res.status(502).json({ error: `AI provider error (${response.status})` });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return res.status(502).json({ error: 'Empty response from AI' });

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim());
    } catch { parsed = { commentary: raw.trim().substring(0, 300), rotationSignal: 'mixed', leadingSectors: [], laggingSectors: [], theme: '' }; }

    const result = {
      commentary: parsed.commentary || '',
      rotationSignal: parsed.rotationSignal || 'mixed',
      leadingSectors: Array.isArray(parsed.leadingSectors) ? parsed.leadingSectors : [],
      laggingSectors: Array.isArray(parsed.laggingSectors) ? parsed.laggingSectors : [],
      theme: parsed.theme || '',
      generatedAt: new Date().toISOString(),
    };

    _sectorRotationCache.set(cacheKey, { v: result, exp: Date.now() + SECTOR_ROTATION_TTL });
    if (_sectorRotationCache.size > 50) {
      const now = Date.now();
      for (const [k, e] of _sectorRotationCache) { if (now > e.exp) _sectorRotationCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Sector rotation timed out' });
    console.error('[Search/AI Sector Rotation] Error:', err.message);
    res.status(500).json({ error: 'Sector rotation failed' });
  } finally { clearTimeout(timer); }
});

/**
 * POST /options-strategy — AI-powered options strategy suggestion
 *
 * Body: { symbol, currentPrice, outlook: 'bullish'|'bearish'|'neutral', expirations: [], iv: number }
 * Returns: { strategies: [{ name, legs: [], rationale, maxProfit, maxLoss, breakeven }] }
 */

const _optionsStrategyCache = new Map();
const OPTIONS_STRATEGY_TTL = 10 * 60 * 1000;

router.post('/options-strategy', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const { symbol, currentPrice, outlook, iv } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });
  if (!outlook || !['bullish', 'bearish', 'neutral'].includes(outlook)) {
    return res.status(400).json({ error: 'outlook must be bullish, bearish, or neutral' });
  }

  const sym = symbol.toUpperCase().trim();
  const cacheKey = `${sym}:${outlook}:${Math.round(currentPrice || 0)}`;
  const cached = _optionsStrategyCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return res.json({ ...cached.v, cached: true });

  let context = `Symbol: ${sym}\nOutlook: ${outlook}`;
  if (currentPrice) context += `\nCurrent Price: $${currentPrice}`;
  if (iv) context += `\nImplied Volatility: ${(iv * 100).toFixed(1)}%`;

  const systemPrompt = `You are an options strategist. Given a stock, its price, and the trader's outlook, suggest 2-3 options strategies. Respond ONLY with valid JSON:
{
  "strategies": [
    {
      "name": "Strategy Name (e.g., Bull Call Spread)",
      "legs": [
        { "action": "buy|sell", "type": "call|put", "strike": 150, "expiry": "30-45 DTE" }
      ],
      "rationale": "1-2 sentence explanation",
      "riskReward": "defined risk|unlimited risk",
      "idealCondition": "When to use this strategy"
    }
  ]
}
Rules:
- Strikes should be realistic relative to current price
- Include strategies appropriate for the outlook
- For bullish: consider bull spreads, long calls, covered calls
- For bearish: consider bear spreads, long puts, protective puts
- For neutral: consider iron condors, strangles, butterflies
- Keep it practical and professional`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL, messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: context },
        ], max_tokens: 500, temperature: 0.2,
      }),
    });
    if (!response.ok) return res.status(502).json({ error: `AI provider error (${response.status})` });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return res.status(502).json({ error: 'Empty response from AI' });

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim());
    } catch { parsed = { strategies: [] }; }

    const result = {
      symbol: sym,
      outlook,
      strategies: Array.isArray(parsed.strategies) ? parsed.strategies.slice(0, 3) : [],
      generatedAt: new Date().toISOString(),
    };

    _optionsStrategyCache.set(cacheKey, { v: result, exp: Date.now() + OPTIONS_STRATEGY_TTL });
    if (_optionsStrategyCache.size > 50) {
      const now = Date.now();
      for (const [k, e] of _optionsStrategyCache) { if (now > e.exp) _optionsStrategyCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Options strategy timed out' });
    console.error('[Search/AI Options Strategy] Error:', err.message);
    res.status(500).json({ error: 'Options strategy failed' });
  } finally { clearTimeout(timer); }
});

/**
 * POST /chat — AI-powered multi-turn financial chat
 *
 * Body: { messages: [{ role: 'user'|'assistant', content: string }], context?: string }
 * Returns SSE stream: data: { chunk: string } ... data: [DONE]
 */

router.post('/chat', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const { messages, context } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] is required' });
  }

  // Limit conversation history
  const history = messages.slice(-20);
  const lastMsg = history[history.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || !lastMsg.content?.trim()) {
    return res.status(400).json({ error: 'Last message must be a user message with content' });
  }

  const systemPrompt = `You are an AI financial assistant embedded in the Senger Market Terminal — a Bloomberg-style market terminal. You help traders and investors with market analysis, portfolio questions, technical analysis, macro economics, and trading ideas.

Rules:
- Be concise and data-driven. Use specific numbers when possible.
- Format key metrics and tickers in bold (**AAPL**, **$150.25**).
- Keep responses under 300 words unless the question requires more detail.
- Do NOT give specific investment advice or recommendations to buy/sell.
- You can reference common financial concepts, indicators, and market dynamics.
- Be professional but conversational.
${context ? `\nAdditional context: ${context}` : ''}`;

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.map(m => ({ role: m.role, content: m.content })),
        ],
        max_tokens: 600,
        temperature: 0.3,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Search/AI Chat] Perplexity error ${response.status}:`, errText.substring(0, 200));
      res.write(`data: ${JSON.stringify({ error: `AI provider error (${response.status})` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Stream response chunks
    const reader = response.body;
    let buffer = '';

    reader.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') {
          res.write('data: [DONE]\n\n');
          return;
        }
        try {
          const parsed = JSON.parse(payload);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
          }
        } catch {}
      }
    });

    reader.on('end', () => {
      // Process any remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ') && trimmed.slice(6) !== '[DONE]') {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
          } catch {}
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });

    reader.on('error', (err) => {
      console.error('[Search/AI Chat] Stream error:', err.message);
      res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });

    // Handle client disconnect
    req.on('close', () => { ctrl.abort(); });

  } catch (err) {
    if (err.name === 'AbortError') {
      res.write(`data: ${JSON.stringify({ error: 'Chat timed out (30s)' })}\n\n`);
    } else {
      console.error('[Search/AI Chat] Error:', err.message);
      res.write(`data: ${JSON.stringify({ error: 'AI chat failed' })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } finally { clearTimeout(timer); }
});

/**
 * POST /instrument-lookup — AI-powered semantic instrument search
 * Two-layer system: fast local matching + AI fuzzy lookup
 * Cache: 10 min, Rate: lightweight (30/min)
 */
const _instrumentLookupCache = new Map();
const INSTRUMENT_LOOKUP_TTL = 10 * 60 * 1000;

router.post('/instrument-lookup', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI search not configured' });
  }

  const { query } = req.body;
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return res.status(400).json({ error: 'Query required (min 2 chars)' });
  }
  if (query.length > 200) {
    return res.status(400).json({ error: 'Query too long (max 200 chars)' });
  }

  const cacheKey = `inst:${query.toLowerCase().trim()}`;
  const cached = _instrumentLookupCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) {
    return res.json({ ...cached.v, cached: true });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: `You are a financial instrument search assistant. Given a user query (which may be a company description, sector, concept, or natural language question), return a JSON array of matching tickers/instruments. Each item must have: symbol (string, US ticker format), name (string, company/instrument name), reason (string, 1-sentence why it matches). Return 3-8 results. Focus on US-listed equities, ETFs, and major instruments. Respond ONLY with a valid JSON array, no markdown fences.`
          },
          {
            role: 'user',
            content: query.trim()
          }
        ],
        max_tokens: 400,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Search/Instrument Lookup] Perplexity error ${response.status}:`, errText.substring(0, 200));
      return res.status(502).json({ error: `AI provider error (${response.status})` });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      return res.status(502).json({ error: 'Empty response from AI' });
    }

    let parsed;
    try {
      const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error('[Search/Instrument Lookup] JSON parse failed:', raw.substring(0, 300));
      return res.status(502).json({ error: 'Failed to parse AI response' });
    }

    if (!Array.isArray(parsed)) {
      parsed = parsed.results || parsed.instruments || [];
    }

    const results = parsed.slice(0, 8).map(item => ({
      symbol: String(item.symbol || item.ticker || '').toUpperCase(),
      name: String(item.name || item.company || ''),
      reason: String(item.reason || item.description || ''),
    })).filter(item => item.symbol && item.name);

    const result = { results, query: query.trim(), generatedAt: new Date().toISOString() };

    _instrumentLookupCache.set(cacheKey, { v: result, exp: Date.now() + INSTRUMENT_LOOKUP_TTL });
    if (_instrumentLookupCache.size > 100) {
      const now = Date.now();
      for (const [k, e] of _instrumentLookupCache) { if (now > e.exp) _instrumentLookupCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'AI search timed out (12s)' });
    }
    console.error('[Search/Instrument Lookup] Error:', err.message);
    res.status(500).json({ error: 'AI search failed' });
  } finally {
    clearTimeout(timer);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase D1 — 6 new specialised AI endpoints
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Helper: make a Perplexity call with a specialised system prompt.
 * Shared by all D1 endpoints.
 */
async function perplexityCall(systemPrompt, userQuery, opts = {}) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('PERPLEXITY_API_KEY not configured');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT_MS);

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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userQuery },
        ],
        max_tokens: opts.maxTokens || 600,
        temperature: opts.temperature || 0.2,
        return_citations: true,
        search_domain_filter: opts.domains || [],
        search_recency_filter: opts.recency || 'week',
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Perplexity ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice?.message?.content) throw new Error('Empty AI response');

    return {
      summary: choice.message.content,
      citations: (data.citations || []).map((url, i) => ({ title: `Source ${i + 1}`, url })),
      model: data.model || MODEL,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── POST /sector-brief ───────────────────────────────────────────────────────
// AI-generated sector analysis brief
router.post('/sector-brief', async (req, res) => {
  try {
    const { sector, tickers } = req.body;
    if (!sector) return res.status(400).json({ error: 'sector is required' });

    const tickerContext = tickers?.length ? `Key tickers: ${tickers.join(', ')}.` : '';
    const systemPrompt = `You are a senior equity analyst at a bulge-bracket investment bank. Provide a concise sector brief for the ${sector} sector. ${tickerContext} Include: 1) Current sector dynamics and drivers, 2) Key risks and catalysts, 3) Relative valuation vs history, 4) Top picks with brief thesis. Keep under 300 words. Use specific data points.`;

    const result = await perplexityCall(systemPrompt, `Give me a current sector brief for ${sector}. ${tickerContext}`);
    res.json(result);
  } catch (e) {
    console.error('[Search/sector-brief]', e.message);
    res.status(e.message.includes('not configured') ? 503 : 502).json({ error: e.message });
  }
});

// ── POST /yield-curve-analysis ───────────────────────────────────────────────
// AI analysis of yield curve shape and implications
router.post('/yield-curve-analysis', async (req, res) => {
  try {
    const { countries } = req.body;
    const countryList = countries?.length ? countries.join(', ') : 'US, Germany, Japan, UK';

    const systemPrompt = `You are a fixed income strategist. Analyze the current yield curve shape for: ${countryList}. Cover: 1) Curve shape (normal/flat/inverted) and what it signals, 2) Key spread metrics (2s10s, 5s30s), 3) Central bank policy implications, 4) Cross-country divergences, 5) Trading implications. Be specific with current yield levels. Under 300 words.`;

    const result = await perplexityCall(systemPrompt, `Analyze current yield curves for ${countryList}. What are curves signaling about growth and policy?`);
    res.json(result);
  } catch (e) {
    console.error('[Search/yield-curve-analysis]', e.message);
    res.status(e.message.includes('not configured') ? 503 : 502).json({ error: e.message });
  }
});

// ── POST /bond-screener-insight ──────────────────────────────────────────────
// AI-powered bond screening recommendations
router.post('/bond-screener-insight', async (req, res) => {
  try {
    const { criteria, riskProfile } = req.body;
    const profile = riskProfile || 'moderate';

    const systemPrompt = `You are a fixed income portfolio manager. Based on a ${profile} risk profile, recommend specific bonds or bond ETFs. ${criteria ? `Additional criteria: ${criteria}.` : ''} Include: 1) Specific bond/ETF names with tickers, 2) Current yield and duration, 3) Credit quality assessment, 4) Risk/reward analysis. Under 250 words.`;

    const result = await perplexityCall(systemPrompt, `Recommend bonds/bond ETFs for a ${profile} risk profile. ${criteria || 'Focus on current market conditions.'}`);
    res.json(result);
  } catch (e) {
    console.error('[Search/bond-screener-insight]', e.message);
    res.status(e.message.includes('not configured') ? 503 : 502).json({ error: e.message });
  }
});

// ── POST /commodity-brief ────────────────────────────────────────────────────
// AI commodity market analysis
router.post('/commodity-brief', async (req, res) => {
  try {
    const { commodity, symbols } = req.body;
    const target = commodity || 'energy and metals';
    const symContext = symbols?.length ? `Tracking: ${symbols.join(', ')}.` : '';

    const systemPrompt = `You are a commodities strategist. Provide a brief on ${target} markets. ${symContext} Cover: 1) Supply/demand dynamics, 2) Key price drivers and geopolitical factors, 3) Seasonality and positioning, 4) Price outlook and key levels. Use specific prices and percentages. Under 250 words.`;

    const result = await perplexityCall(systemPrompt, `What's the current state of ${target} markets? ${symContext}`);
    res.json(result);
  } catch (e) {
    console.error('[Search/commodity-brief]', e.message);
    res.status(e.message.includes('not configured') ? 503 : 502).json({ error: e.message });
  }
});

// ── POST /em-country-brief ───────────────────────────────────────────────────
// AI emerging market country analysis
router.post('/em-country-brief', async (req, res) => {
  try {
    const { country } = req.body;
    if (!country) return res.status(400).json({ error: 'country is required' });

    const systemPrompt = `You are an emerging markets strategist. Provide an investment brief on ${country}. Cover: 1) Macro backdrop (GDP, inflation, fiscal position), 2) Central bank policy and rates outlook, 3) Currency dynamics and risks, 4) Key sectors and equity opportunities, 5) Fixed income: sovereign and corporate spread levels, 6) Political risks. Use specific data. Under 300 words.`;

    const result = await perplexityCall(systemPrompt, `Give me a comprehensive EM investment brief for ${country}.`);
    res.json(result);
  } catch (e) {
    console.error('[Search/em-country-brief]', e.message);
    res.status(e.message.includes('not configured') ? 503 : 502).json({ error: e.message });
  }
});

// ── POST /cross-asset-signal ─────────────────────────────────────────────────
// AI cross-asset correlation and signal analysis
router.post('/cross-asset-signal', async (req, res) => {
  try {
    const { assets, theme } = req.body;
    const assetList = assets?.length ? assets.join(', ') : 'equities, bonds, commodities, FX, crypto';
    const themeContext = theme ? `Focus theme: ${theme}.` : '';

    const systemPrompt = `You are a cross-asset macro strategist. Analyze intermarket signals across: ${assetList}. ${themeContext} Cover: 1) Key cross-asset correlations and divergences, 2) Risk-on vs risk-off regime assessment, 3) Unusual cross-asset moves or breakdowns, 4) Macro implications and positioning signals. Be specific with numbers. Under 300 words.`;

    const result = await perplexityCall(systemPrompt, `Analyze current cross-asset signals and correlations. ${themeContext} What are intermarket relationships telling us?`);
    res.json(result);
  } catch (e) {
    console.error('[Search/cross-asset-signal]', e.message);
    res.status(e.message.includes('not configured') ? 503 : 502).json({ error: e.message });
  }
});

module.exports = router;
