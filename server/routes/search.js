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

const { perMinuteLimit } = require('../middleware/rateLimitByIP');
const { dailyAILimit } = require('../middleware/dailyAILimit');
const { aiQuotaGate } = require('../middleware/aiQuotaGate');
const featureFlags = require('../services/featureFlags'); // W6.1 kill switch
const aiCostLedger = require('../services/aiCostLedger');
// W1.3: scrub credential/URL patterns and auto-append disclaimers on any
// AI answer that mentions a ticker + direction.
const { guardAndLog } = require('../services/aiOutputGuard');
const logger = require('../utils/logger');
const memoryManager = require('../services/memoryManager');
const conversationMemory = require('../services/conversationMemory');
const aiChatStore = require('../services/aiChatStore'); // P5: DB-backed chat history
const aiToolbox = require('../services/aiToolbox'); // s3: LLM tool-use over internal adapters

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const MODEL          = 'sonar-pro';
const TIMEOUT_MS     = 15000;

/**
 * Sanitize user queries to strip prompt-injection delimiters.
 * Removes common LLM instruction markers that could trick the model
 * into treating user input as system/assistant instructions.
 */
function sanitizeQuery(q) {
  if (!q || typeof q !== 'string') return q;
  return q
    // Strip XML-style instruction tags
    .replace(/<\|?(system|assistant|user|instruction|endoftext|im_start|im_end)\|?>/gi, '')
    // Strip markdown-style section delimiters used in prompts
    .replace(/^###\s*(System|Assistant|Instruction|User)\s*:?\s*/gim, '')
    // Strip [INST] [/INST] <<SYS>> <</SYS>> markers
    .replace(/\[\/?(INST|SYS)\]|<<\/?SYS>>/gi, '')
    // Collapse excess whitespace left behind
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Estimate token count for a string (rough: ~4 chars per token).
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Apply token budget to context sections.
 * Truncates lowest-priority sections first until total fits within budget.
 * Returns an object with the (possibly truncated) sections and truncation log.
 */
const TOKEN_BUDGET = 6000;
function applyTokenBudget(sections) {
  // Priority order: lowest priority first (removed first when over budget)
  const priorityOrder = [
    'behaviorContext',
    'sessionMemoryContext',
    'persistentMemoryContext',
    'unusualWhalesContext',
    'earningsContext',
    'edgarContext',
    'portfolioMetricsContext',
    'conversationMemoryContext',
    'newsContext',
    'vaultContext',
    'marketContext', // NEVER truncate
  ];

  const result = { ...sections };
  const truncated = [];
  let total = 0;
  for (const key of Object.keys(result)) {
    total += estimateTokens(result[key]);
  }

  if (total <= TOKEN_BUDGET) return { sections: result, truncated, totalTokens: total };

  // Truncate from lowest priority
  for (const key of priorityOrder) {
    if (total <= TOKEN_BUDGET) break;
    if (key === 'marketContext') break; // NEVER truncate market data
    const tokens = estimateTokens(result[key]);
    if (tokens > 0) {
      total -= tokens;
      result[key] = '';
      truncated.push({ section: key, tokensSaved: tokens });
    }
  }

  return { sections: result, truncated, totalTokens: total };
}

// Simple in-memory cache: query → { result, exp }
const _cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour (increased from 5 minutes)

// Cache stats
let _cacheHits = 0;
let _cacheMisses = 0;

function cacheGet(q) {
  const e = _cache.get(q.toLowerCase().trim());
  if (!e) {
    _cacheMisses++;
    return null;
  }
  if (Date.now() > e.exp) {
    _cache.delete(q.toLowerCase().trim());
    _cacheMisses++;
    return null;
  }
  _cacheHits++;
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
 * GET /cache-stats — Cache diagnostics for AI endpoints
 */
router.get('/cache-stats', (req, res) => {
  const totalRequests = _cacheHits + _cacheMisses;
  const hitRate = totalRequests > 0 ? ((_cacheHits / totalRequests) * 100).toFixed(2) : 'N/A';

  const fundsTotalRequests = _fundsCacheHits + _fundsCacheMisses;
  const fundsHitRate = fundsTotalRequests > 0 ? ((_fundsCacheHits / fundsTotalRequests) * 100).toFixed(2) : 'N/A';

  res.json({
    ai_search: {
      hits: _cacheHits,
      misses: _cacheMisses,
      total: totalRequests,
      hitRate: hitRate + '%',
      cacheSize: _cache.size,
      ttlMinutes: CACHE_TTL / (60 * 1000),
    },
    fundamentals: {
      hits: _fundsCacheHits,
      misses: _fundsCacheMisses,
      total: fundsTotalRequests,
      hitRate: fundsHitRate + '%',
      cacheSize: _fundsCache.size,
      ttlHours: FUNDS_CACHE_TTL / (60 * 60 * 1000),
    },
  });
});

/**
 * POST /ai — AI-powered financial research summary
 */
router.post('/ai', dailyAILimit, aiQuotaGate, async (req, res) => {
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
            content: 'You are Particle — the AI engine inside a professional financial terminal. You speak like a sell-side desk analyst: terse, numeric, opinionated. Use **$TICKER** format (**$AAPL**, **$BTC**). Use basis points for rate moves. Bold all prices and percentages. NEVER use these phrases: "It\'s important to note", "Based on the data", "As an AI", "I\'d recommend considering", "It\'s worth noting", "Many analysts believe", "Time will tell". Coverage: all of finance — equities, fixed income, forex, crypto, commodities, derivatives, prediction markets (Kalshi, Polymarket), macro, central bank policy, geopolitics-as-markets, fintech, market structure. If clearly non-financial: "Outside my coverage." Keep responses under 200 words. Lead with the insight, not background. End with BOTTOM LINE: one sentence giving your actual view. Cite sources with [1], [2]. Be opinionated — state bull/bear views directly.'
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

// Cache TTL varies by asset class — volatile assets get shorter TTLs
const FUNDS_CACHE_TTL_DEFAULT = 2 * 60 * 60 * 1000;  // 2 hours for equities
const FUNDS_CACHE_TTL_CRYPTO  = 30 * 60 * 1000;       // 30 min for crypto (very volatile)
const FUNDS_CACHE_TTL_FX      = 60 * 60 * 1000;       // 1 hour for FX

function getFundsCacheTTL(sym) {
  if (sym.startsWith('X:') || ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'XRP', 'AVAX', 'DOT', 'LINK', 'MATIC'].some(c => sym.includes(c) && !sym.includes('.'))) {
    return FUNDS_CACHE_TTL_CRYPTO;
  }
  if (sym.startsWith('C:') || sym.match(/^[A-Z]{6}$/)) return FUNDS_CACHE_TTL_FX;
  return FUNDS_CACHE_TTL_DEFAULT;
}

// Fundamentals cache stats
let _fundsCacheHits = 0;
let _fundsCacheMisses = 0;

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

  // Check cache (TTL varies by asset class)
  const cached = _fundsCache.get(sym);
  const ttl = getFundsCacheTTL(sym);
  if (cached && Date.now() < cached.exp) {
    _fundsCacheHits++;
    // Inject live price alongside cached analysis so UI can show current price
    // even when the AI text references an older price
    return res.json({ ...cached.v, cached: true, cachedAt: new Date(cached.exp - ttl).toISOString() });
  }
  _fundsCacheMisses++;

  // ── Gather internal data in parallel (with tight individual timeouts) ──
  // Default: call our own HTTP listener via loopback (works on Render/any PaaS
  // where the server binds to process.env.PORT on the same instance).
  // Override: set INTERNAL_API_URL to proxy through a shared ingress if this
  // service is ever split across multiple processes.
  const baseUrl = process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3001}`;
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
    try { require('../utils/logger').error('search', 'AI fundamentals data gathering error', { msg: err.message }); } catch { /* logger optional */ }
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
    if (quote.price != null) lines.push(`CURRENT LIVE PRICE (as of right now): $${quote.price}`);
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
- CRITICAL: Use the provided financial data as the ONLY source of truth for ALL numbers including price, market cap, ratios, and metrics. Do NOT use prices or numbers from your training data — they are outdated. The "Last Price" in the data below is the LIVE current price.
- Keep each array item to 1-2 sentences max.
- 3-5 items per array.
- Be concise, professional, and factual.
- If data is missing for a field, provide qualitative analysis based on your knowledge but NEVER invent specific price levels or numbers.
- Do NOT include markdown formatting inside the JSON strings.
- In the summary, reference the actual current price from the data provided, not from your training knowledge.`;

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
      livePrice: quote?.price ?? null,
      summary: parsed.summary || '',
      businessModel: parsed.businessModel || '',
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
      financialHighlights: Array.isArray(parsed.financialHighlights) ? parsed.financialHighlights : [],
      valuationSnapshot: Array.isArray(parsed.valuationSnapshot) ? parsed.valuationSnapshot : [],
      riskFactors: Array.isArray(parsed.riskFactors) ? parsed.riskFactors : [],
    };

    // Cache (TTL varies by asset class)
    _fundsCache.set(sym, { v: result, exp: Date.now() + getFundsCacheTTL(sym) });
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
 * POST /news-briefing — CIO-style top-3 briefing from a news feed (Phase 9.3)
 *
 * Body: { stories: [{ id, title, publisher, tickers, publishedAt }] }
 * Returns: {
 *   briefing: [
 *     { rank, headline, whyItMatters, tickers: [], sourceIds: [],
 *       sentiment: 'bullish'|'bearish'|'neutral', regime: 'macro'|'earnings'|'policy'|'geo'|'idio' }
 *   ],
 *   generatedAt, cached
 * }
 * Cache: 10 min, keyed by the first 10 story ids.
 *
 * The goal is signal-density, not coverage. We give the model up to ~30
 * headlines and ask it to pick the 3 things a multi-asset CIO should
 * actually act on in the next 6 hours — with a one-line "why it matters"
 * that has a real, decision-relevant point (not a restatement of the
 * headline).
 */

const _newsBriefingCache = new Map();
const NEWS_BRIEFING_TTL = 10 * 60 * 1000;

router.post('/news-briefing', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const { stories } = req.body || {};
  if (!Array.isArray(stories) || stories.length === 0) {
    return res.status(400).json({ error: 'stories[] is required' });
  }

  const clean = stories
    .filter(s => s && (s.title || s.headline))
    .slice(0, 30)
    .map(s => ({
      id:         String(s.id || s.title || '').slice(0, 64),
      title:      String(s.title || s.headline || '').slice(0, 240),
      publisher:  String(s.publisher?.name || s.publisher || s.source || '').slice(0, 40),
      tickers:    Array.isArray(s.tickers) ? s.tickers.slice(0, 6) : [],
      publishedAt: s.publishedAt || s.published_utc || null,
    }))
    .filter(s => s.title);

  if (clean.length === 0) return res.status(400).json({ error: 'No valid stories' });

  // Cache key: first 10 ids joined — stable for the same feed slice.
  const cacheKey = clean.slice(0, 10).map(s => s.id).join('|').toLowerCase();
  const cached = _newsBriefingCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return res.json({ ...cached.v, cached: true });

  const systemPrompt = `You are the head of research at a multi-asset fund writing a 3-bullet morning briefing for the CIO.

Pick the TOP 3 stories from the list that matter most to a multi-asset portfolio over the next 6 trading hours. Rank in order of decision-relevance (1 = most important).

For each pick, output:
  - headline: a crisp re-headline in CIO voice (≤ 12 words)
  - whyItMatters: ONE sentence (≤ 24 words) explaining the portfolio implication — what to watch, what it changes, or what's at risk. NOT a restatement of the headline.
  - tickers: up to 4 directly-affected tickers (use the ones provided if relevant, add 1-2 obvious ones if missing)
  - sourceIds: array of source story ids this pick is based on (may merge near-duplicates)
  - sentiment: bullish | bearish | neutral (for the broader market, not just the named tickers)
  - regime: one of macro | earnings | policy | geo | idio

Rules:
  - NO emojis. NO hedging language ("may", "could"). Be direct.
  - Do NOT duplicate stories across picks.
  - If fewer than 3 distinct high-impact stories exist, return fewer.
  - Respond ONLY with valid JSON: { "briefing": [ ... ] }`;

  const userPrompt = `Today's feed (${clean.length} stories):\n\n` +
    clean.map((s, i) => {
      const t = s.tickers.length ? ` [${s.tickers.join(',')}]` : '';
      return `${i + 1}. id=${s.id} ${s.publisher ? '(' + s.publisher + ')' : ''} ${s.title}${t}`;
    }).join('\n');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens: 900,
        temperature: 0.15,
      }),
    });
    if (!response.ok) return res.status(502).json({ error: `AI provider error (${response.status})` });

    const data = await response.json();
    const raw  = data.choices?.[0]?.message?.content;
    if (!raw) return res.status(502).json({ error: 'Empty response from AI' });

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim());
    } catch {
      return res.status(502).json({ error: 'Failed to parse AI response' });
    }

    const validRegimes = new Set(['macro', 'earnings', 'policy', 'geo', 'idio']);
    const validSents   = new Set(['bullish', 'bearish', 'neutral']);
    const briefing = (Array.isArray(parsed.briefing) ? parsed.briefing : [])
      .slice(0, 3)
      .map((b, i) => ({
        rank:         i + 1,
        headline:     String(b.headline || '').slice(0, 140),
        whyItMatters: String(b.whyItMatters || b.why_it_matters || '').slice(0, 260),
        tickers:      Array.isArray(b.tickers) ? b.tickers.slice(0, 4).map(t => String(t).toUpperCase()) : [],
        sourceIds:    Array.isArray(b.sourceIds || b.source_ids) ? (b.sourceIds || b.source_ids).slice(0, 4) : [],
        sentiment:    validSents.has(b.sentiment) ? b.sentiment : 'neutral',
        regime:       validRegimes.has(b.regime) ? b.regime : 'macro',
      }))
      .filter(b => b.headline && b.whyItMatters);

    const result = {
      briefing,
      generatedAt: new Date().toISOString(),
      coverage:    clean.length,
    };

    _newsBriefingCache.set(cacheKey, { v: result, exp: Date.now() + NEWS_BRIEFING_TTL });
    if (_newsBriefingCache.size > 30) {
      const now = Date.now();
      for (const [k, e] of _newsBriefingCache) { if (now > e.exp) _newsBriefingCache.delete(k); }
    }

    res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'News briefing timed out' });
    console.error('[Search/AI News Briefing] Error:', err.message);
    res.status(500).json({ error: 'News briefing failed' });
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
 * POST /chat — Particle AI: contextual, streaming financial intelligence
 *
 * Body: { messages: [{ role: 'user'|'assistant', content: string }], context?: string }
 * Returns SSE stream: data: { chunk: string } ... data: [DONE]
 *
 * Wave 6: Now injects live market data, user context, and temporal awareness
 * via MarketContextBuilder. Query intent classification determines which
 * context layers to include.
 */

const { buildContext } = require('../services/marketContextBuilder');
const behaviorTracker = require('../services/behaviorTracker');
const deepAnalysis = require('../services/deepAnalysis');
const modelRouter = require('../services/modelRouter');
const agentOrchestrator = require('../services/agentOrchestrator');
const edgar = require('../services/edgar');
const earnings = require('../services/earnings');
const computeEngine = require('../services/computeEngine');
const portfolioStore = require('../portfolioStore');

// ── Chat response cache (first-turn only, 5 min TTL) ──────────────────────
const _chatCache = new Map();
const CHAT_CACHE_TTL = 5 * 60 * 1000;
const CHAT_CACHE_MAX = 200;

function chatCacheGet(key) {
  const e = _chatCache.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { _chatCache.delete(key); return null; }
  return e.value;
}

function chatCacheSet(key, value) {
  if (_chatCache.size > CHAT_CACHE_MAX) {
    // Evict oldest entry
    const firstKey = _chatCache.keys().next().value;
    _chatCache.delete(firstKey);
  }
  _chatCache.set(key, { value, exp: Date.now() + CHAT_CACHE_TTL });
}

// W6.1 — kill switch middleware. If `ai_chat_enabled` flag is OFF for this
// user (or globally), return 503 and let the client fall back to the
// degraded-experience CTA. Checked BEFORE rate limits so a disabled feature
// doesn't burn a user's quota.
async function aiChatKillSwitch(req, res, next) {
  try {
    const ctx = req.user ? { userId: req.user.id, tier: req.user.tier, email: req.user.email } : {};
    const on = await featureFlags.isOn('ai_chat_enabled', ctx);
    if (!on) {
      return res.status(503).json({
        error: 'ai_chat_disabled',
        message: 'AI chat is temporarily unavailable. Please check status.particle.xyz or try again later.',
      });
    }
    return next();
  } catch (e) {
    // Fail closed on evaluation errors — 503 beats accidental outage.
    return res.status(503).json({ error: 'ai_chat_disabled', message: 'feature gate unavailable' });
  }
}

router.post('/chat', aiChatKillSwitch, perMinuteLimit, dailyAILimit, aiQuotaGate, async (req, res) => {
  // API key check moved to modelRouter fallback logic below
  const { messages, context, conversationId } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] is required' });
  }

  // Limit conversation history and validate
  const MAX_MSG_CHARS = 3000;
  const history = messages.slice(-20)
    // Filter out null/undefined/empty content
    .filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0)
    // Truncate individual messages that are excessively long
    .map(m => ({
      ...m,
      content: m.content.length > MAX_MSG_CHARS ? m.content.slice(0, MAX_MSG_CHARS) + '... [truncated]' : m.content,
    }));
  const lastMsg = history[history.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || !lastMsg.content?.trim()) {
    return res.status(400).json({ error: 'Last message must be a user message with content' });
  }

  // ── Wave 6: Build rich market context ──────────────────────────────────
  const userId = req.user?.id || null;
  const userQuery = sanitizeQuery(lastMsg.content.trim());
  let marketContext = '';
  let queryIntent = 'general';

  try {
    const ctx = await buildContext({ query: userQuery, userId });
    marketContext = ctx.contextString;
    queryIntent = ctx.intent;
  } catch (err) {
    // Graceful degradation: proceed without context
    console.error('[Particle/Chat] Context builder error:', err.message);
  }

  // Track search behavior (fire-and-forget)
  if (userId) {
    behaviorTracker.trackSearch(userId, userQuery).catch((e) => {
      logger.warn('search', 'behaviorTracker.trackSearch failed', { error: e.message });
    });
  }

  // ── P5: DB-backed chat history ─────────────────────────────────────────
  // Lazy-create a conversation on first turn, then persist the user message
  // before we kick off the stream. Failures here never block the response —
  // the sidebar just won't populate for this turn. Conversations created
  // here will surface in the /api/ai-chat list endpoint used by the sidebar.
  let convoId = conversationId ? String(conversationId) : null;
  if (userId) {
    try {
      if (!convoId) {
        const created = await aiChatStore.createConversation(userId, { firstMessage: userQuery });
        if (created) convoId = created.id;
      } else {
        // Verify ownership; if the id doesn't belong to this user, drop it
        // silently rather than letting a client-forged id poison writes.
        const existing = await aiChatStore.getConversation(userId, convoId);
        if (!existing) convoId = null;
      }
      if (convoId) {
        await aiChatStore.appendMessage(userId, convoId, 'user', userQuery);
      }
    } catch (e) {
      logger.warn('search', 'aiChatStore user turn failed', { error: e.message });
      convoId = null;
    }
  }

  // ── Behavioral profile: personalize AI responses ───────────────────────
  let behaviorContext = '';
  if (userId) {
    try {
      const profile = await behaviorTracker.getCachedProfile(userId);
      behaviorContext = behaviorTracker.formatForAI(profile);
    } catch (e) {
      // Graceful — proceed without personalization
    }
  }

  // ── Wave 5A + Phase 10.1: Parallel orchestration + intent classification ──────
  // Run all data sources AND the Haiku intent classifier concurrently. These
  // don't depend on each other, so running them sequentially (as before) was
  // just wasted wall-clock time on the hot path. We still await both before
  // picking the provider, but the effective latency is now max(context, intent)
  // rather than the prior sum.
  let orchestratedContext = {
    vault: { context: '', sources: [] },
    edgar: { context: '' },
    earnings: { context: '' },
    memory: { sessionContext: '', persistentContext: '' },
    compute: { context: '' },
    news: { context: '', sources: [] },
    unusualWhales: { context: '', ticker: null },
    completeness: { score: 0, available: [], failed: [], skipped: [] },
    summary: { hasVault: false, hasEDGAR: false, hasEarnings: false, hasMemory: false, hasCompute: false },
  };

  // Prepare portfolio data if query mentions portfolio-related keywords
  let portfolioData = null;
  if (userId) {
    const portfolio = portfolioStore.getPortfolio(userId);
    const userQuery_lower = userQuery.toLowerCase();
    const isPortfolioQuery = /portfolio|position|p&l|pnl|gain|loss|exposure|allocation|holding|weight|return|performance|net worth|total value/i.test(userQuery_lower);

    if (portfolio && portfolio.positions && portfolio.positions.length > 0 && isPortfolioQuery) {
      portfolioData = portfolio.positions.map(p => ({
        symbol: p.symbol || 'UNKNOWN',
        shares: p.quantity || 0,
        avgCost: p.entryPrice || 0,
        currentPrice: p.currentPrice || 0,
        dayPriceChange: p.dayPriceChange || 0,
      }));
    }
  }

  // Phase 10.1: Kick off context gathering immediately — we'll await it below.
  // We pass `hasDeep` optimistically off the sync detector so the classifier
  // fast-paths don't even hit Haiku for vault/deep queries.
  const contextPromise = agentOrchestrator.gatherContext({
    query: userQuery,
    userId,
    portfolioData,
    sessionId: req.sessionID || null,
  }).catch(err => {
    console.warn('[Particle/Orchestrator] Context gathering failed, falling back to empty:', err.message);
    return orchestratedContext;
  });

  // Phase 10.1: Run intent classification in parallel with context gathering.
  // The classifier only needs to know hasVault/hasMarketCtx for fast-paths,
  // which we can estimate from cheap signals (marketContext is already built).
  let deepAnalysisEarly = null;
  try { deepAnalysisEarly = deepAnalysis.getAnalysisPrompt(userQuery, userId); } catch {}
  const hasMarketCtxEarly = (marketContext?.length || 0) > 0;
  const intentPromise = modelRouter.classifyIntentWithHaiku(
    userQuery,
    false /* hasVault resolved after context */,
    !!deepAnalysisEarly,
    hasMarketCtxEarly,
  ).catch(() => ({
    intent: modelRouter.classifyIntent(userQuery, false, !!deepAnalysisEarly, hasMarketCtxEarly),
    contextRequired: false,
  }));

  // Phase 10.1: Open the SSE connection immediately so the browser shows the
  // "thinking…" animation without waiting for context/classification to
  // finish. The streaming headers are a no-op cost on the server but shave
  // meaningful perceived latency — the user sees "typing" dots within ~50ms.
  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx/CDN buffering on SSE
    });
    // Fire a keep-alive so the browser flushes the headers immediately.
    res.write(': ping\n\n');
    if (typeof res.flush === 'function') res.flush();
  }

  // Await both in parallel — effective latency is max(context, intent).
  orchestratedContext = await contextPromise;

  // ── Extract context variables from orchestrated result ────────────────────
  const vaultContext = orchestratedContext.vault?.context || '';
  const vaultSources = orchestratedContext.vault?.sources || [];
  const edgarContext = orchestratedContext.edgar?.context || '';
  const earningsContext = orchestratedContext.earnings?.context || '';
  const sessionMemoryContext = orchestratedContext.memory?.sessionContext || '';
  const persistentMemoryContext = orchestratedContext.memory?.persistentContext || '';
  const portfolioMetricsContext = orchestratedContext.compute?.context || '';
  const unusualWhalesContext = orchestratedContext.unusualWhales?.context || '';
  const newsContext = orchestratedContext.news?.context || '';
  // W6 Aegea fix + WS5.4 repair: when Perplexity explicitly returns the
  // no-material-news sentinel, we lift that to a named flag so the
  // synthesis prompt can instruct the model NOT to fill the gap with
  // training-data thesis. Pre-WS5.4 this was captured here but the
  // aggregator in agentOrchestrator.js stripped it before it got here —
  // see WS5.4 commit for the end-to-end fix. Typed NewsEvent[] now
  // flow alongside the freeform context so we can render a structured
  // source block instead of injecting raw strings.
  const noMaterialNews = !!orchestratedContext.news?.noMaterialNews;
  const newsEvents = Array.isArray(orchestratedContext.news?.events)
    ? orchestratedContext.news.events
    : [];
  // Build a compact, numbered source block the model can cite with [1],
  // [2], etc. Cap at 10 to keep prompt tokens sane. Skip this when the
  // sentinel fired — there are no material items to cite.
  let newsSourcesBlock = '';
  if (!noMaterialNews && newsEvents.length > 0) {
    const lines = newsEvents.slice(0, 10).map((ev, i) => {
      const when = ev.publishedAt ? ev.publishedAt.slice(0, 10) : '';
      const conf = ev.confidence ? ` conf=${ev.confidence}` : '';
      return `[${i + 1}] ${ev.source || 'unknown'}${conf} — ${ev.headline}${when ? ` (${when})` : ''}\n    ${ev.url}`;
    });
    newsSourcesBlock = `\n--- NEWS SOURCES (typed, citable) ---\n${lines.join('\n')}\n--- END NEWS SOURCES ---\n`;
  }
  const conversationMemoryContext = orchestratedContext.memory?.conversationMemory || '';
  const completeness = orchestratedContext.completeness || { score: 0, available: [], failed: [] };

  // ── Phase 2: Token budget — truncate lowest-priority sections to fit ────
  const budgetInput = {
    marketContext, vaultContext, edgarContext, earningsContext,
    newsContext, unusualWhalesContext, portfolioMetricsContext,
    behaviorContext, conversationMemoryContext, persistentMemoryContext,
    sessionMemoryContext,
  };
  const budget = applyTokenBudget(budgetInput);
  if (budget.truncated.length > 0) {
    logger.info('chat', 'Token budget truncation', { truncated: budget.truncated, totalTokens: budget.totalTokens });
  }
  // Reassign context variables from budget result (some may have been emptied)
  const ctx_ = budget.sections;

  // ── Wave 11: Deep analysis detection (re-use Phase 10.1 early eval) ────
  const deepAnalysisResult = deepAnalysisEarly;

  let systemPrompt;
  if (deepAnalysisResult?.prompt) {
    // Deep analysis mode: use the specialized prompt with market and vault context appended
    systemPrompt = `${deepAnalysisResult.prompt}
${noMaterialNews ? '\nCRITICAL: The news wire explicitly returned "NO MATERIAL NEWS FOUND" for the entity in this query. This is a grounded signal, not a gap to paper over. FIRST, check every other grounded section still available below (VAULT, MEMORY, PORTFOLIO METRICS, EDGAR, EARNINGS, OPTIONS FLOW, LIVE MARKET DATA) — if ANY of them reference this entity, synthesize from those and lead with what they say. ONLY if every grounded section is also silent: state plainly that no material news hit in the last 7 days AND no other terminal context covers it, name the primary sources the user should check (Valor, Bloomberg Línea, company IR, rating agencies), and stop. Training-data thesis when every grounded section is silent is a hallucination.\n' : ''}
${ctx_.conversationMemoryContext ? `\n${ctx_.conversationMemoryContext}\n` : ''}${ctx_.persistentMemoryContext ? `\n${ctx_.persistentMemoryContext}\n` : ''}${ctx_.sessionMemoryContext ? `\n${ctx_.sessionMemoryContext}\n` : ''}${ctx_.behaviorContext ? `\n${ctx_.behaviorContext}\n` : ''}${ctx_.portfolioMetricsContext ? `\n${ctx_.portfolioMetricsContext}\n` : ''}${ctx_.vaultContext || ''}${ctx_.marketContext ? `\n--- LIVE MARKET DATA ---\n${ctx_.marketContext}\n--- END MARKET DATA ---\n` : ''}${ctx_.earningsContext ? `\n--- EARNINGS CALENDAR ---\n${ctx_.earningsContext}\n--- END EARNINGS CALENDAR ---\n` : ''}${ctx_.edgarContext ? `\n--- SEC FILINGS ---\n${ctx_.edgarContext}\n--- END SEC FILINGS ---\n` : ''}${ctx_.unusualWhalesContext ? `\n--- OPTIONS FLOW & MARKET INTELLIGENCE (Unusual Whales) ---\n${ctx_.unusualWhalesContext}\n--- END OPTIONS FLOW ---\n` : ''}${ctx_.newsContext ? `\n--- RECENT NEWS (from real-time web search — PRIORITIZE this for current events) ---\n${ctx_.newsContext}\n--- END NEWS ---\n` : ''}${newsSourcesBlock}${context ? `\n--- SCREEN CONTEXT (from client) ---\n${context}\n--- END SCREEN CONTEXT ---\n` : ''}`;
  } else {
    // Standard Particle prompt — v2 with voice contract + persona card
    systemPrompt = `IDENTITY: You are Particle — the AI engine inside a professional financial terminal. You are a senior macro strategist who has managed risk through the 2008 crisis, COVID crash, and 2022 rate shock. You form strong, data-grounded views and defend them. You speak in terminal shorthand — terse, numeric, opinionated. When you're uncertain, you say so directly, but you never hide behind vague qualifiers. Never say "I" — you are the terminal's voice, not a person.

COVERAGE: Equities, fixed income, forex, crypto, commodities, derivatives, prediction markets (Kalshi, Polymarket), macro, central bank policy, geopolitics-as-markets, fintech, financial regulation, market structure, alternative data, investment strategy. If it touches money or markets, cover it. Only redirect clearly non-financial questions (cooking, sports, health) with a single sentence: "Outside my coverage — I focus on markets and macro."

VOICE CONTRACT — MANDATORY:
- Never say "I" or "As an AI" — write as if the terminal is speaking
- Use **$TICKER** format for all securities: **$AAPL**, **$BTC**, **$SPY**, **$EURUSD**
- Use basis points for rate moves: "Fed hiked 25bp" not "0.25%"
- Bold all prices and percentages: **$182.50** (**+2.3%**)
- Use trader shorthand: "bid", "offered", "screens cheap/rich", "risk-on/risk-off", "carry", "vol"
- Be opinionated. State direct views — "bullish above X", "short below Y" — never "one could argue"
- Every number must come from the LIVE MARKET DATA section below — no hallucinated prices
- Standard responses: 250 words max. Deep analysis: 500 words max

PROHIBITED PHRASES — NEVER USE THESE:
"It's important to note", "Based on the data provided", "As an AI", "I'd recommend considering", "It's worth noting", "Let me explain", "In conclusion", "It should be noted", "As always, do your own research", "There are several factors to consider", "The market is complex", "Many analysts believe", "Time will tell", "I think", "I believe", "In my opinion"

INLINE CHARTS — You can embed live charts in your responses using this syntax:
- [chart:sparkline:TICKER:PERIOD] — price sparkline for single ticker. PERIOD: 1M, 3M, 6M, 1Y (default 1M)
  Example: [chart:sparkline:AAPL:1M]
- [chart:comparison:TICKER1,TICKER2,TICKER3:PERIOD] — overlay comparison of multiple tickers
  Example: [chart:comparison:AAPL,MSFT,NVDA:3M]
- [chart:bar:LABEL1=VALUE1,LABEL2=VALUE2] — horizontal bar chart for sector/metric comparisons
  Example: [chart:bar:Tech=5.2,Healthcare=3.1,Energy=1.8]
Use sparingly — max one chart per response. Best for: price trend discussions, sector comparisons, before/after analysis, momentum visualizations.

RESPONSE STRUCTURE — MANDATORY SECTIONS:
For any market/asset question, your response MUST follow this 4-section structure:

[sentiment:bull] or [sentiment:bear] or [sentiment:neutral] — always lead with this tag

**WHAT'S HAPPENING** — 1-3 sentences. State the key move with specific numbers from LIVE MARKET DATA. Current price, % change, volume context, catalyst. Lead with the number, not the narrative.

**WHY IT MATTERS** — 1-3 sentences. Cross-asset linkage and second-order effects. How does this move connect to rates, FX, sector rotation, or the user's portfolio? If portfolio data is available, cite their P&L and weight here.

**WATCH** — 1-3 bullet points. Specific levels, dates, catalysts. Example: "**$4,200** SPX support — a break opens **$4,050**", "FOMC June 12 — dot plot repricing risk", "**$NVDA** earnings May 28 — sector bellwether"

**RISKS** — 1-2 sentences. What invalidates the view. Be specific: name the level, the event, the data point.

End with: **BOTTOM LINE:** — one bold sentence, your actual call with a price level and timeframe.

For morning briefs and overview queries, use:
1. **PORTFOLIO IMPACT**: Their positions, today's P&L, biggest movers in their book
2. **WHAT'S HAPPENING**: Indices, sectors, FX, crypto — with specific numbers
3. **CATALYSTS**: What's driving today — data releases, earnings, geopolitical
4. **BOTTOM LINE**: The one thing they should pay attention to today

WEB SEARCH DIRECTIVE:
Do NOT search the web or provide generic web-sourced information unless the query is SPECIFICALLY asking for breaking news, recent events, or web articles. Your primary job is to analyze the LIVE TERMINAL DATA injected below. The user is paying for context-aware analysis, not Google results. If you have live market data in the context, USE IT — don't paraphrase news articles about the same topic.

CONTEXT MANDATE — CRITICAL:
You have access to LIVE MARKET DATA, VAULT documents, EDGAR filings, EARNINGS data, OPTIONS FLOW, and PORTFOLIO METRICS injected below. You MUST reference this data in every response. If you see a "--- LIVE MARKET DATA ---" section, you MUST cite specific numbers from it. If the user asks about an asset and you have live data for it, ALWAYS lead with the real numbers — never give a generic answer when you have specifics.

If context sections are present but you ignore them, you are failing at your job. The user is sitting in front of a terminal with live data — your job is to synthesize what they're seeing, not repeat what Google would say.

DATA INTEGRITY — CRITICAL (read this twice):
- Every number you cite MUST come from the LIVE MARKET DATA section below. If a ticker shows a price and % change in that section, use THOSE EXACT numbers. Do not override them with guesses or training data.
- If the LIVE MARKET DATA shows a ticker is UP, do NOT call it bearish based on narrative alone. The DATA leads, your narrative follows.
- If the on-demand data shows a stock at $25.82 up +2.2%, that is GROUND TRUTH for today's session. Your sentiment tag MUST be consistent with the actual price action in the data.
- NEVER fabricate sector analysis, catalyst narratives, or performance claims that aren't grounded in the injected data. If you don't have specific data about a company's sector dynamics, say "limited fundamental data available" — don't make things up.

VAULT RELEVANCE — CRITICAL:
- Only cite vault documents when they are DIRECTLY relevant to the asset or topic the user asked about.
- If the user asks about Unity Software and your vault contains a Bank of America energy sector report, DO NOT reference that vault document — it is irrelevant.
- A vault citation must pass this test: "Does this document specifically discuss the company/asset the user asked about?" If no, don't cite it.
- Never force-fit vault content into an analysis where it doesn't belong. Irrelevant vault citations destroy user trust.
- When citing vault documents, ALWAYS include the page number if available. Format: [V1, Document Name, p.X]. The terminal renders these as gold citation badges.

RULES:
- ALWAYS use specific numbers from the LIVE MARKET DATA section — this is non-negotiable
- Never start with "Based on" or "According to" — lead with the insight
- If the user has a watchlist or portfolio, relate to their holdings briefly for context — but keep the focus on what they actually asked about. Don't let watchlist/portfolio context dominate the answer
- Disclaimers: one brief parenthetical at the very end, if at all. Never at the top
- Prediction market data: weave naturally when it adds edge
- When you have live data for an asset (price, change%, volume), you MUST use it as the foundation of your analysis. Build your narrative around the actual numbers
- GROUNDED-SOURCE HIERARCHY: treat the following injected sections as GROUNDED context and USE them freely, in this priority order: (1) LIVE MARKET DATA, (2) RECENT NEWS, (3) user's VAULT documents, (4) SEC FILINGS / EDGAR, (5) EARNINGS CALENDAR, (6) OPTIONS FLOW / Unusual Whales, (7) PRE-COMPUTED PORTFOLIO METRICS, (8) conversation + persistent + session MEMORY. Every one of these counts as valid grounding — the terminal is built to accumulate user-specific context over time and you SHOULD synthesize from it. Never apologise for using vault, memory, portfolio, or EDGAR context; that's the product
- TRAINING-DATA FALLBACK — the only restricted surface: when the user asks about a specific named entity (ticker, company, bond issuer, project), do NOT fabricate an analytical thesis from training-data knowledge alone. CALL TOOLS FIRST: if you have the [TERMINAL TOOLS] layer below, you MUST attempt lookup_quote (for every ticker — US, LSE, B3, anywhere), search_vault, get_macro_snapshot, list_corporate_bonds, list_sovereign_bonds, get_recent_wire, get_earnings_calendar as relevant BEFORE claiming the terminal lacks coverage. Tools are free — use them liberally; four lookup_quote calls for a four-ticker question is expected, not excessive. Only after a tool actually returned empty or errored can you say you lack that specific datum. If after tool calls the terminal genuinely has nothing: say plainly "I don't have live X on $TICKER in the terminal right now" and offer an adjacent angle the terminal CAN answer (sector peer, yield curve, macro snapshot, related ticker). NEVER recommend external providers — no Bloomberg, Refinitiv, FactSet, Valor, Bloomberg Línea, 10-Ks, company IR pages, or rating-agency sites. We ARE the terminal; recommending competitors is a product failure. Training data can support general macro / market-structure / educational questions; it is not banned, only demoted as a substitute for a live event on a specific name
- When you lack live market data BUT RECENT NEWS (or any other grounded section) contains material information on the entity (rating action, M&A, litigation, earnings, guidance, management change), LEAD with what those sources say. Cite them. Do not bury material news under a generic company-overview paragraph
- If RECENT NEWS contains the sentinel "NO MATERIAL NEWS FOUND FOR [entity]", the news wire has explicitly told you it searched and found nothing. Combine this with the grounded-source check above: if ANY other grounded section (vault, memory, portfolio, EDGAR, earnings, options) covers the entity, synthesize from those. If nothing does, say: "No material news for $TICKER in the last 7 days per the news wire, and no other terminal context on this name." Do NOT silently fill with training-data thesis
- Suggest terminal actions: [action:watchlist_add:BTC], [action:alert_set:BTC:65000], [action:chart_open:AAPL], [action:detail_open:MSFT]
- If Perplexity provides web citations, use [1], [2] naturally — the terminal renders these as orange badges
- When referencing information from the VAULT sections below, cite with [V1], [V2] etc. matching the order of vault passages — the terminal renders these as gold badges. ONLY use vault citations when the vault content is directly relevant to the question
- NEVER do math in your head. If you need to calculate returns, P&L, or ratios, use the pre-computed numbers from context
- When multiple context sources are available (market data + vault + EDGAR + options flow), SYNTHESIZE them into a cohesive view — but only include sources that are RELEVANT to the specific question. Don't force every available source into every answer

FEW-SHOT EXAMPLE — BAD vs GOOD:
User: "What's happening with Tesla?"
BAD: "Tesla is an interesting stock to watch right now. Based on the data, there are several factors to consider. The stock has been volatile recently, and many analysts have different views on its trajectory. It's important to note that Tesla's fundamentals..."
GOOD: "[sentiment:bear]
**WHAT'S HAPPENING** — **$TSLA** breaking below its 200-DMA at **$165**, down **-4.2%** on the session. Q1 deliveries came in at 387K vs 415K consensus — a 7% miss. Volume running 2x 20d avg.

**WHY IT MATTERS** — BYD outsold Tesla globally for the second straight quarter. China competition is structural, not cyclical. If you hold **$TSLA**, book is down **-$2,340** today on your 50-share position.

**WATCH**
- **$155** support — a break opens **$140** gap fill from October
- Q2 delivery guidance on the earnings call April 23
- FSD v12.4 rollout timeline — the bull case hinge

**RISKS** — A surprise China stimulus package or FSD licensing deal could squeeze shorts hard. Invalidated above **$175**.

**BOTTOM LINE:** Bearish below **$165** — the delivery miss trend suggests this isn't a one-quarter problem."

--- CONTEXT COMPLETENESS: ${completeness.score}/100 (active: ${completeness.available.join(', ') || 'none'}${completeness.failed.length > 0 ? ` | failed: ${completeness.failed.join(', ')}` : ''}${completeness.skipped?.length > 0 ? ` | skipped: ${completeness.skipped.join(', ')}` : ''}) ---
${completeness.score < 30 ? 'WARNING: Pre-fetched context is sparse — but the [TERMINAL TOOLS] layer below lets you fill gaps on demand. Call tools aggressively before caveating; do NOT tell the user to check external providers.\n' : ''}${ctx_.newsContext ? '\nIMPORTANT: A RECENT NEWS section is available below with real-time web search results. ALWAYS reference and incorporate this news data in your response — it contains the latest market events, M&A activity, and corporate news that you would not otherwise know about.\n' : ''}${noMaterialNews ? '\nCRITICAL: The news wire explicitly returned "NO MATERIAL NEWS FOUND" for the entity in this query. This is a grounded signal, not a gap to paper over. FIRST, check every other grounded section still available below (VAULT, MEMORY, PORTFOLIO METRICS, EDGAR, EARNINGS, OPTIONS FLOW, LIVE MARKET DATA) — if ANY of them reference this entity, synthesize from those and lead with what they say. AND: if you have the [TERMINAL TOOLS] layer, call lookup_quote / search_vault / get_macro_snapshot on the entity before concluding there is no coverage — "no material news" is not the same as "no data". Only after tools return empty too: state plainly "no material news for $TICKER in the last 7 days, and no other terminal context on this name" and stop. Do NOT suggest the user check external providers (Bloomberg, Valor, IR pages, rating agencies) — we ARE the terminal. Producing a generic company-overview thesis purely from training data when every grounded section and every tool is silent is a hallucination.\n' : ''}${!ctx_.newsContext && !noMaterialNews && completeness.score < 50 ? '\nNOTE: The news agent did not return context for this query — either it was rate-limited, timed out, or the query did not trigger news lookup. Before caveating, CHECK THE OTHER GROUNDED SECTIONS (vault, memory, portfolio, EDGAR, earnings, options, live market data) AND CALL [TERMINAL TOOLS] (lookup_quote for tickers, search_vault, get_macro_snapshot, etc.). If after tool calls NONE of those cover the specific named entity: state that clearly and offer an adjacent angle we CAN answer. Do NOT recommend external providers. Training data is fine for general macro / market-structure / educational questions; it is NOT a substitute for a live answer on a specific name.\n' : ''}
${ctx_.conversationMemoryContext ? `\n${ctx_.conversationMemoryContext}\n` : ''}${ctx_.persistentMemoryContext ? `\n${ctx_.persistentMemoryContext}\n` : ''}${ctx_.sessionMemoryContext ? `\n${ctx_.sessionMemoryContext}\n` : ''}${ctx_.behaviorContext ? `\n${ctx_.behaviorContext}\n` : ''}
${ctx_.portfolioMetricsContext ? `\n${ctx_.portfolioMetricsContext}\n` : ''}${ctx_.vaultContext || ''}${ctx_.marketContext ? `\n--- LIVE MARKET DATA ---\nThe following data is from the user's LIVE terminal session pulled seconds ago. Treat every number here as ground truth. If a price or % move appears below, cite it verbatim — do not round, do not paraphrase, do not substitute with memorised data. If the user asks about an asset listed here, you MUST lead with these numbers.\n${ctx_.marketContext}\n--- END MARKET DATA ---\n` : ''}${ctx_.earningsContext ? `\n--- EARNINGS CALENDAR ---\n${ctx_.earningsContext}\n--- END EARNINGS CALENDAR ---\n` : ''}${ctx_.edgarContext ? `\n--- SEC FILINGS ---\n${ctx_.edgarContext}\n--- END SEC FILINGS ---\n` : ''}${ctx_.unusualWhalesContext ? `\n--- OPTIONS FLOW & MARKET INTELLIGENCE (Unusual Whales) ---\n${ctx_.unusualWhalesContext}\n--- END OPTIONS FLOW ---\n` : ''}${ctx_.newsContext ? `\n--- RECENT NEWS (from real-time web search — PRIORITIZE this for current events) ---\n${ctx_.newsContext}\n--- END NEWS ---\n` : ''}${newsSourcesBlock}${context ? `\n--- SCREEN CONTEXT (from client) ---\n${context}\n--- END SCREEN CONTEXT ---\n` : ''}`;
  }

  // ── Phase 10.1: Resolve the intent classifier that's been running in parallel
  // with context gathering. The vault fast-path upgrade happens here in case
  // vault hits came back — we upgrade vault_rag without another round-trip.
  const hasVault = vaultContext.length > 0;
  const hasDeep = !!deepAnalysisResult;
  const hasMarketCtx = marketContext.length > 0;
  let intent, contextRequired;
  try {
    const classification = await intentPromise;
    intent = classification.intent;
    contextRequired = classification.contextRequired;
    // If the classifier didn't know about vault hits but we actually have
    // vault sources, upgrade to vault_rag so Sonnet gets picked.
    if (hasVault && intent !== 'vault_rag' && intent !== 'deep_analysis') {
      intent = 'vault_rag';
      contextRequired = true;
    }
  } catch (err) {
    // Ultimate fallback
    intent = modelRouter.classifyIntent(userQuery, hasVault, hasDeep, hasMarketCtx);
    contextRequired = false;
  }
  // W1.2: honor the org-wide kill-switch (force_haiku / block_all_ai). Read
  // is cached for 15s so this is not a hot-path hit.
  let killSwitch = null;
  try { killSwitch = await aiCostLedger.readKillSwitch(); } catch (_) {}
  let provider = modelRouter.route(intent, { killSwitch });

  // Fallback chain: if the chosen provider needs an API key we don't have, try alternatives
  if (!process.env[provider.keyEnv]) {
    logger.warn('chat', 'Primary provider unavailable, attempting fallback', { intent });
    // Try each provider in priority order: Claude Sonnet → Perplexity Pro → Perplexity Fast
    const fallbackOrder = ['claude_sonnet', 'perplexity_pro', 'perplexity_fast', 'claude_haiku'];
    let found = false;
    for (const fb of fallbackOrder) {
      const fbProvider = modelRouter.getProvider(fb);
      if (fbProvider && process.env[fbProvider.keyEnv]) {
        provider = fbProvider;
        found = true;
        logger.info('chat', 'Fell back to alternative provider', { provider: fb });
        break;
      }
    }
    if (!found) {
      // Phase 10.1: headers are already sent (early SSE open), so surface the
      // error via the stream instead of a 503 body. The client handles a
      // `partial` payload as a soft failure.
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ partial: true, error: 'No AI provider configured. The team has been notified.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      return res.status(503).json({ error: 'No AI provider configured. Set ANTHROPIC_API_KEY or PERPLEXITY_API_KEY in Render environment.' });
    }
  }

  logger.info('chat', 'Routing intent', { intent, model: provider.model, contextRequired, personalized: !!behaviorContext });
  if (process.env.NODE_ENV !== 'production') {
    logger.info('chat', 'Context summary', { model: provider.model, marketCtxLen: marketContext.length, vaultPassages: vaultSources.length, hasEdgar: edgarContext.length > 0, hasEarnings: earningsContext.length > 0, hasOptions: unusualWhalesContext.length > 0, hasNews: newsContext.length > 0, completeness: completeness.score });
  }

  // Prepare messages for router
  const routerMessages = history.map(m => ({ role: m.role, content: m.content }));

  // Phase 2: Send context metadata before AI stream — lets client show source badges
  if (!res.headersSent && (convoId || vaultSources.length > 0 || completeness.score > 0)) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  }

  // P5: send conversationId first so the client can immediately bind the
  // active turn to a conversation row (used by the sidebar / refresh).
  if (convoId) {
    res.write(`data: ${JSON.stringify({ conversationId: convoId })}\n\n`);
  }

  // Send vault citation metadata (client uses this for source badges)
  if (vaultSources.length > 0) {
    res.write(`data: ${JSON.stringify({ vaultSources })}\n\n`);
  }

  // Phase 2: Send context completeness metadata — client can show "Sources: ✓/✗" footer
  if (completeness.score >= 0) {
    res.write(`data: ${JSON.stringify({
      contextMeta: {
        score: completeness.score,
        available: completeness.available,
        failed: completeness.failed,
        intent,
        model: provider.model,
      }
    })}\n\n`);
  }

  // ── Deep analysis wrapper: collect full response to extract JSON ──────────
  if (deepAnalysisResult) {
    try {
      // Set up AbortController and attach cleanup BEFORE fetch
      const controller = new AbortController();
      req.on('close', () => {
        if (!controller.signal.aborted) {
          controller.abort();
        }
        res.end();
      });

      const apiResponse = await modelRouter.callProvider(provider, routerMessages, systemPrompt, { signal: controller.signal, userId });

      // Extract full text from provider response
      let responseText = '';
      const isPerplexity = provider.url.includes('perplexity');
      const isAnthropic = provider.url.includes('anthropic');

      if (!res.headersSent) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
      }

      // Parse provider response to get full text
      if (isPerplexity) {
        const data = await apiResponse.json();
        responseText = data.choices?.[0]?.message?.content || '';
      } else if (isAnthropic) {
        const data = await apiResponse.json();
        responseText = data.content?.[0]?.text || '';
      }

      // W1.3: scrub credentials + external URLs; auto-disclaim ticker+direction
      // pairs. Logs violations under ai_safety_violation for Sentry alerting.
      responseText = guardAndLog(responseText, { userId, model: provider.model });

      // Stream the full response as chunks (matching modelRouter.streamResponse behavior)
      const chunkSize = 50;
      for (let i = 0; i < responseText.length; i += chunkSize) {
        const chunk = responseText.slice(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }

      // Extract structured JSON from markdown code fences
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const structuredAnalysis = JSON.parse(jsonMatch[1].trim());
          res.write(`data: ${JSON.stringify({ structuredAnalysis })}\n\n`);
        } catch (parseErr) {
          console.warn('[Particle/Chat] Failed to parse structured JSON from deep analysis:', parseErr.message);
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();

      // P5: persist assistant turn for the sidebar (deep-analysis branch).
      // Fire-and-forget — never blocks the client response.
      if (userId && convoId && responseText) {
        aiChatStore.appendMessage(userId, convoId, 'assistant', responseText).catch((e) => {
          logger.warn('search', 'aiChatStore assistant turn failed (deep)', { error: e.message });
        });
      }

      // ── Fire-and-forget: Update session memory and extract persistent memories ──
      try {
        if (userId && userQuery && responseText) {
          const sessionId = req.sessionID || `s_${userId}_${Date.now()}`;
          // Add to session memory
          memoryManager.addMessageToSession(userId, 'user', userQuery).catch((e) => {
            logger.warn('search', 'memoryManager.addMessageToSession(user) failed', { error: e.message });
          });
          memoryManager.addMessageToSession(userId, 'assistant', responseText).catch((e) => {
            logger.warn('search', 'memoryManager.addMessageToSession(assistant) failed', { error: e.message });
          });
          // Extract new factual memories asynchronously (non-blocking)
          memoryManager.extractMemoriesAsync(userId, userQuery, responseText);
          // Phase 5: Extract typed conversation memory records
          conversationMemory.extractFromTurn(userId, sessionId, userQuery, responseText).catch((e) => {
            logger.warn('search', 'conversationMemory.extractFromTurn failed', { error: e.message });
          });
        }
      } catch (err) {
        console.warn('[Particle/Chat] Memory update error (non-blocking):', err.message);
      }
    } catch (err) {
      console.error('[Particle/Chat] Deep analysis stream error:', err.message);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message || 'AI chat failed' });
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: err.message || 'AI chat failed' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  } else {
    // Standard streaming response (non-deep-analysis)
    try {
      // s3: When the selected provider is Claude we route through the
      // tool-use agent loop. This lets the model reach every internal
      // adapter we have (quotes, curves, bonds, macro, earnings, options,
      // predictions, vault, wire) instead of being limited to the fixed
      // context bundle pre-fetched above. Perplexity does not support our
      // tool schema, so web-lookup intents still run through the plain
      // streamResponse path.
      const useToolLoop = aiToolbox.providerSupportsTools(provider);

      // The same onComplete hook persists the assistant turn to the
      // sidebar for both paths. W1.3 guardAndLog is applied in both.
      const persistAssistantTurn = (fullText) => {
        if (!userId || !convoId || !fullText) return;
        let safe = fullText;
        try { safe = guardAndLog(fullText, { userId, model: provider.model }); } catch (_) {}
        aiChatStore.appendMessage(userId, convoId, 'assistant', safe).catch((e) => {
          logger.warn('search', 'aiChatStore assistant turn failed (stream)', { error: e.message });
        });
      };

      if (useToolLoop) {
        // Tool-use directive. This section is MANDATORY and supersedes any
        // refusal / "check external sources" instruction earlier in the
        // prompt — without that override, the TRAINING-DATA FALLBACK rule
        // fires first and the model refuses to call tools.
        const toolAugmentedPrompt = systemPrompt +
          '\n\n[TERMINAL TOOLS — MANDATORY]\n' +
          'You have direct access to the terminal\'s live adapters via ' +
          'tools: lookup_quote, lookup_fx, get_yield_curve, ' +
          'list_sovereign_bonds, list_corporate_bonds, get_macro_snapshot, ' +
          'get_earnings_calendar, get_options_flow, ' +
          'search_prediction_markets, search_vault, get_recent_wire.\n\n' +
          'RULES:\n' +
          '1. TOOLS ARE MANDATORY FOR NAMED ENTITIES. For every ticker, ' +
          'company, bond issuer, or country the user mentions, you MUST ' +
          'call the relevant tool BEFORE concluding the terminal lacks ' +
          'coverage. lookup_quote works for US (AAPL), crypto (BTC-USD), ' +
          'FX (EURUSD=X), and international listings including B3 tickers ' +
          '(PETR4.SA, RENT3.SA, MOVI3.SA, VALE3.SA). Four tickers in a ' +
          'question = four lookup_quote calls. This is expected, not excessive.\n' +
          '2. TOOLS SUPERSEDE PRE-FETCHED CONTEXT. The LIVE MARKET DATA / ' +
          'EDGAR / EARNINGS sections above are supplementary snapshots. If ' +
          'they are thin or missing a ticker, call the tool — do NOT treat ' +
          'a partial pre-fetched context as permission to refuse.\n' +
          '3. DELIVER PARTIAL ANSWERS. If you get market caps from the tool ' +
          'but not fleet sizes, deliver the market caps and say "fleet size ' +
          'isn\'t in our live feeds." Do not refuse the whole answer ' +
          'because one datum is missing.\n' +
          '4. NEVER RECOMMEND EXTERNAL PROVIDERS. No Bloomberg, Refinitiv, ' +
          'FactSet, Valor, Bloomberg Línea, 10-Ks, company IR pages, rating ' +
          'agency websites. We ARE the terminal. Recommending competitors ' +
          'is a product failure. If tools can\'t answer, state specifically ' +
          'what we tried ("lookup_quote returned no marketCap for $MOVI3.SA") ' +
          'and offer an adjacent terminal angle (sector peers, yield curve, ' +
          'a related ticker we DO cover).\n' +
          '5. BE HONEST ABOUT TOOL ERRORS. If a tool returns {error: ...}, ' +
          'surface that plainly — "the corporate bond adapter returned HTTP ' +
          '404" is useful; "terminal data limitation" is not.\n' +
          '6. FX — PTAX vs LIVE. For any question about câmbio, dólar, euro, ' +
          'USDBRL, EURBRL, or any currency rate, call lookup_fx. For BRL ' +
          'pairs the response contains BOTH a live market rate AND the ' +
          'official BCB PTAX — these are different numbers and you MUST ' +
          'explain the distinction to the user: PTAX is the official BCB ' +
          'reference rate (end-of-day closing print, what contracts and ' +
          'tax filings use); live is the current market mid from Twelve ' +
          'Data or Yahoo. Show both when asked about BRL pairs. For ' +
          'non-BRL pairs only the live rate is returned, and that\'s fine.';

        await aiToolbox.runToolLoopStream(provider, routerMessages, toolAugmentedPrompt, res, {
          userId,
          onComplete: persistAssistantTurn,
        });
      } else {
        await modelRouter.streamResponse(provider, routerMessages, systemPrompt, res, {
          onAbort: (abortFn) => { req.on('close', abortFn); },
          userId,
          // P5: persist full assistant reply once streaming finishes so the
          // sidebar shows the complete turn. W1.3 guardAndLog is applied
          // here for consistency with the deep-analysis branch.
          onComplete: persistAssistantTurn,
        });
      }

      // ── Fire-and-forget: Update session memory (non-blocking) ──
      // Note: We can't capture the full response here since it's streamed directly.
      // So we just log the user message to session memory and trigger async extraction
      // with a placeholder for the AI response (will be captured on next turn).
      try {
        if (userId && userQuery) {
          const sessionId = req.sessionID || `s_${userId}_${Date.now()}`;
          memoryManager.addMessageToSession(userId, 'user', userQuery).catch((e) => {
            logger.warn('search', 'memoryManager.addMessageToSession(user) failed', { error: e.message });
          });
          // Phase 5: Extract typed memories from user query alone (response not available in stream mode)
          conversationMemory.extractFromTurn(userId, sessionId, userQuery, null).catch((e) => {
            logger.warn('search', 'conversationMemory.extractFromTurn failed', { error: e.message });
          });
        }
      } catch (err) {
        console.warn('[Particle/Chat] Session memory update error (non-blocking):', err.message);
      }
    } catch (err) {
      console.error('[Particle/Chat] Stream error:', err.message);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message || 'AI chat failed' });
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: err.message || 'AI chat failed' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  }
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

// ── T3.5: Action Chip Feedback Loop ───────────────────────────────────────

/**
 * POST /action-feedback — Log when user clicks an AI-suggested action chip.
 * Body: { actionType, ticker, params, messageContext, timestamp }
 * Fire-and-forget endpoint (async logging).
 */
router.post('/action-feedback', (req, res) => {
  // Don't require auth for now — logged via session/cookie if available
  const { actionType, ticker, params, messageContext, timestamp } = req.body;

  // Queue for async processing (don't block response)
  setImmediate(async () => {
    try {
      const pg = require('../db/postgres');
      const userId = req.user?.id || null;

      if (!userId || !pg.isConnected()) {
        // Silently fail if not authenticated or DB unavailable
        return;
      }

      await pg.query(
        `INSERT INTO action_feedback (user_id, action_type, ticker, params, context, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          userId,
          actionType || 'unknown',
          ticker || null,
          params || null,
          messageContext || null,
        ]
      );

      logger.info('search-route', 'Action feedback logged', {
        userId,
        actionType,
        ticker,
      });
    } catch (err) {
      logger.warn('search-route', 'Action feedback log error', { error: err.message });
    }
  });

  // Return immediately to client
  res.json({ ok: true });
});

/**
 * GET /action-stats — Get user's action engagement stats for personalization.
 * Returns: { mostClickedActions: [...], topTickers: [...] }
 * Internal use only (for behavioral profiling).
 */
router.get('/action-stats', (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.json({ mostClickedActions: [], topTickers: [] });
  }

  setImmediate(async () => {
    try {
      const pg = require('../db/postgres');
      if (!pg.isConnected()) {
        return res.json({ mostClickedActions: [], topTickers: [] });
      }

      // Get most-clicked action types (last 90 days)
      const actionsResult = await pg.query(
        `SELECT action_type, COUNT(*) as count
         FROM action_feedback
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '90 days'
         GROUP BY action_type
         ORDER BY count DESC
         LIMIT 5`,
        [userId]
      );

      // Get most-engaged tickers (last 90 days)
      const tickersResult = await pg.query(
        `SELECT ticker, COUNT(*) as count
         FROM action_feedback
         WHERE user_id = $1 AND ticker IS NOT NULL AND created_at > NOW() - INTERVAL '90 days'
         GROUP BY ticker
         ORDER BY count DESC
         LIMIT 10`,
        [userId]
      );

      const mostClickedActions = (actionsResult.rows || []).map(r => ({
        type: r.action_type,
        count: parseInt(r.count, 10),
      }));

      const topTickers = (tickersResult.rows || []).map(r => ({
        ticker: r.ticker,
        count: parseInt(r.count, 10),
      }));

      res.json({ mostClickedActions, topTickers });
    } catch (err) {
      logger.warn('search-route', 'Action stats error', { error: err.message });
      res.json({ mostClickedActions: [], topTickers: [] });
    }
  });
});

module.exports = router;
