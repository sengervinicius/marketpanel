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

  // ── Gather internal data in parallel ──────────────────────────────────
  const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
  const authHeader = req.headers.authorization || '';
  const headers = { Authorization: authHeader, Accept: 'application/json' };

  let fundamentals = null, quote = null, newsItems = [];

  try {
    const [fundsRes, quoteRes, newsRes] = await Promise.allSettled([
      fetch(`${baseUrl}/api/fundamentals/${encodeURIComponent(sym)}`, { headers }).then(r => r.ok ? r.json() : null),
      fetch(`${baseUrl}/api/quote/${encodeURIComponent(sym)}`, { headers }).then(r => r.ok ? r.json() : null),
      fetch(`${baseUrl}/api/news?ticker=${encodeURIComponent(sym.replace(/^[XC]:/, ''))}&limit=5`, { headers }).then(r => r.ok ? r.json() : null),
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);

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
      return res.status(504).json({ error: 'AI fundamentals timed out (20s)' });
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

module.exports = router;
