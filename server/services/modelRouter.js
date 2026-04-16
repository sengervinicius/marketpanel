/**
 * modelRouter.js — Intelligent model routing for Particle.
 *
 * Phase 4 routing overhaul. Core principle: if market context exists, use Claude.
 * Perplexity is ONLY for purely web-grounded queries where terminal data is irrelevant.
 *
 * Route hierarchy:
 *   CLAUDE SONNET + context:  terminal_overview, portfolio, deep_analysis, counter_thesis,
 *                             scenario, vault_rag, earnings_analysis, ticker_action,
 *                             sector_analysis, morning_brief, general
 *   CLAUDE HAIKU + context:   quick_factual (single ticker lookups with terminal data)
 *   PERPLEXITY SONAR:         web_lookup (pure definitional, historical events)
 *   PERPLEXITY SONAR PRO:     web_narrative (broad explainers, macro narratives)
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

/**
 * Call a function with exponential backoff retry logic.
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries (default 2)
 * @returns {Promise} Result of fn()
 */
async function callWithRetry(fn, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 5000);
      console.warn(`[ModelRouter] Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms:`, err.message);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

const PROVIDERS = {
  perplexity_fast: {
    url: 'https://api.perplexity.ai/chat/completions',
    model: 'sonar',
    keyEnv: 'PERPLEXITY_API_KEY',
  },
  perplexity_pro: {
    url: 'https://api.perplexity.ai/chat/completions',
    model: 'sonar-pro',
    keyEnv: 'PERPLEXITY_API_KEY',
  },
  claude_sonnet: {
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-20250514',
    keyEnv: 'ANTHROPIC_API_KEY',
  },
  claude_haiku: {
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-haiku-4-5-20251001',
    keyEnv: 'ANTHROPIC_API_KEY',
  },
};

// Phase 4: Intent → provider mapping.
// Core rule: ANY query with injected market context → Claude (Perplexity ignores it).
// Perplexity reserved for pure web lookups where terminal data is irrelevant.
const ROUTE_MAP = {
  // ── Claude Sonnet: terminal-aware, full context ──
  deep_analysis:    'claude_sonnet',
  portfolio:        'claude_sonnet',
  counter_thesis:   'claude_sonnet',
  scenario:         'claude_sonnet',
  vault_rag:        'claude_sonnet',
  earnings_analysis:'claude_sonnet',
  terminal_overview:'claude_sonnet',
  ticker_action:    'claude_sonnet',   // Phase 4: ticker + action verb (analyze, compare, explain)
  sector_analysis:  'claude_sonnet',   // Phase 4: sector screen queries
  morning_brief:    'claude_sonnet',   // Phase 4: moved from Perplexity — needs portfolio context
  general:          'claude_sonnet',   // Default: context-aware

  // ── Claude Haiku: lightweight terminal-aware ──
  quick_factual:    'claude_haiku',    // Phase 4: moved from Perplexity — we have live prices
  anomaly_classify: 'claude_haiku',

  // ── Perplexity: web-grounded, NO market context ──
  web_lookup:       'perplexity_fast', // Phase 4: pure definitional ("What is Lockheed Martin?")
  web_narrative:    'perplexity_pro',  // Phase 4: broad explainers ("Explain quantitative easing")
  web_search:       'perplexity_pro',  // Explicit "search the web" requests
};

/**
 * Phase 4: Classify the query into an intent using regex patterns.
 * This is the fast fallback when Haiku classifier is unavailable.
 *
 * Core principle: if the query references the user's data, a ticker with an
 * action verb, or arrives with market context, route to Claude. Only pure
 * definitional/web queries go to Perplexity.
 *
 * @param {string} query
 * @param {boolean} hasVaultContext - true if vault passages were found
 * @param {boolean} hasDeepAnalysis - true if deep analysis was triggered
 * @param {boolean} hasMarketContext - true if market context will be injected
 * @returns {string} intent name
 */
function classifyIntent(query, hasVaultContext = false, hasDeepAnalysis = false, hasMarketContext = false) {
  if (!query) return 'general';

  const q = query.trim().toLowerCase();
  const raw = query.trim();
  const tickerCount = (raw.match(/\b[A-Z]{1,5}\b/g) || []).length;
  const hasTicker = tickerCount > 0 || /\$[A-Z]{1,5}/i.test(raw);
  const hasMyRef = /\bmy\b/i.test(q);
  const hasScreenRef = /\b(screen|terminal|dashboard|watchlist|portfolio|positions?|holdings?)\b/i.test(q);

  // ── Priority 1: Forced overrides ──────────────────────────────────────
  if (hasVaultContext) return 'vault_rag';
  if (hasDeepAnalysis) return 'deep_analysis';

  // ── Priority 1b: Counter-thesis & scenario (explicit deep analysis) ──
  if (/\b(counter[- ]?thesis|bear\s+case|bull\s+case|devil'?s\s+advocate|what\s+could\s+go\s+wrong|what\s+are\s+the\s+risks)\b/i.test(q)) {
    return 'counter_thesis';
  }
  if (/\b(what\s+if|scenario|hypothetical|model\s+out|stress\s+test|simulate)\b/i.test(q)) {
    return 'scenario';
  }

  // ── Priority 2: Terminal-awareness (MUST route to Claude + context) ───
  // "My portfolio" + P&L keywords → portfolio intent (more specific than terminal_overview)
  if (hasMyRef && /\b(portfolio|positions?|holdings?|book|exposure)\b/i.test(q) && /\b(p&l|pnl|gain|loss|return|performance|allocation|weight)\b/i.test(q)) {
    return 'portfolio';
  }
  // Any query referencing user's personal data + screen/terminal
  if (hasMyRef && hasScreenRef) return 'terminal_overview';
  if (/\b(my\s+(screen|terminal|dashboard|home|data|watchlist|alerts?))\b/i.test(q)) {
    return 'terminal_overview';
  }
  // "what should I watch/buy/sell" queries
  if (/what\s+should\s+i\s+(watch|buy|sell|trade|monitor|look\s+at)/i.test(q)) return 'terminal_overview';
  // Morning brief / market overview
  if (/\b(morning\s*brief|daily\s*brief|market\s*summary|market\s*update|market\s*recap|give\s*me\s*a\s*summary)\b/i.test(q)) return 'morning_brief';

  // ── Priority 3: Ticker + action verb → Claude Sonnet ──────────────────
  // "analyze NVDA", "why is TSLA down", "compare AAPL and MSFT", "what's happening with BTC"
  if (hasTicker && /\b(analy[sz]e|explain|compare|why\s+is|what('s| is)\s+happening|break\s*down|outlook|thesis|risk|upside|downside|valuation|target|setup|technical)\b/i.test(q)) {
    return 'ticker_action';
  }

  // ── Priority 4: Sector analysis ───────────────────────────────────────
  if (/\b(analy[sz]e\s+(the\s+)?(sector|defence|defense|energy|tech|crypto|brazil|asia|europ|commodit|retail|fx))\b/i.test(q)) {
    return 'sector_analysis';
  }

  // ── Priority 5: Earnings intent ───────────────────────────────────────
  if (/\b(earnings|eps|beat|miss|guidance|outlook|revenue\s+(beat|miss)|quarter\s+results)\b/i.test(q)) {
    return 'earnings_analysis';
  }

  // ── Priority 6: Portfolio-specific ────────────────────────────────────
  if (/\b(portfolio|position|p&l|pnl|gain|loss|exposure|allocation|holding|weight|return|performance)\b/i.test(q)) {
    return 'portfolio';
  }

  // ── Priority 7: Quick factual with ticker (use Haiku, not Perplexity) ─
  // "what's AAPL at?", "NVDA price", "BTC current price"
  if (hasTicker && q.length < 80 && tickerCount <= 2) {
    if (/\b(price|quote|at\??|current|last|close|level)\b/i.test(q)) {
      return 'quick_factual';
    }
  }

  // ── Priority 8: "What's happening" (broad market) → Claude ────────────
  if (/\b(what('s| is)\s+happening|what('s| is)\s+going\s+on|market\s+(today|now|open)|overview)\b/i.test(q)) {
    return 'terminal_overview';
  }

  // ── Priority 9: Pure web lookups → Perplexity (no terminal data needed) ─
  // Explicit web search requests
  if (/\b(search\s+(the\s+)?web|google|find\s+me|look\s+up|latest\s+news\s+about|recent\s+article)\b/i.test(q)) {
    return 'web_search';
  }
  // Pure definitional: "What is [concept]?" with no ticker, no "my", no screen ref
  if (/^what\s+(is|are)\s+/i.test(q) && !hasTicker && !hasMyRef && !hasScreenRef && q.length < 120) {
    return 'web_lookup';
  }
  // Historical event lookup: "What happened to X on [date]?"
  if (/what\s+happened\s+to\b/i.test(q) && /\b(in\s+\d{4}|last\s+(year|month|week)|yesterday|on\s+\w+\s+\d)/i.test(q)) {
    return 'web_lookup';
  }
  // Broad narrative explainers with no ticker and no personal reference
  if (!hasTicker && !hasMyRef && /\b(explain|describe|tell\s+me\s+about|how\s+does|history\s+of)\b/i.test(q) && q.length > 30) {
    return 'web_narrative';
  }

  // ── Priority 10: If market context is present, default to Claude ──────
  if (hasMarketContext) return 'general';

  // ── Fallback ──────────────────────────────────────────────────────────
  return 'general';
}

/**
 * Phase 2: Haiku-based intent classifier.
 * Calls Claude Haiku (~$0.001/query, <100ms) for structured intent classification.
 * Falls back to regex classifyIntent() if Haiku is unavailable or times out.
 *
 * @param {string} query - User's natural language query
 * @param {boolean} hasVaultContext - true if vault passages were found
 * @param {boolean} hasDeepAnalysis - true if deep analysis was triggered
 * @returns {Promise<{intent: string, contextRequired: boolean}>}
 */
async function classifyIntentWithHaiku(query, hasVaultContext = false, hasDeepAnalysis = false, hasMarketContext = false) {
  // Fast-path overrides (no need to call Haiku for these)
  if (hasVaultContext) return { intent: 'vault_rag', contextRequired: true };
  if (hasDeepAnalysis) return { intent: 'deep_analysis', contextRequired: true };
  if (!query || query.trim().length < 3) return { intent: 'general', contextRequired: false };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No Anthropic key — fall back to regex
    return { intent: classifyIntent(query, hasVaultContext, hasDeepAnalysis, hasMarketContext), contextRequired: false };
  }

  try {
    const classifierPrompt = `Classify this financial terminal query into exactly ONE intent. Respond with ONLY a JSON object, no other text.

Intents (in priority order):
- deep_analysis: Multi-factor analysis, scenario modeling, counter-thesis, compare frameworks
- counter_thesis: Asks for bear case, counter-argument, risks, "what could go wrong"
- scenario: "What if" hypotheticals, conditional modeling
- vault_rag: References saved documents, research, uploaded files, vault
- ticker_action: Mentions a $TICKER + action verb (analyze, explain, compare, outlook, thesis, valuation, risk, technical, setup)
- sector_analysis: References a sector screen or asks about a sector with terminal data
- earnings_analysis: About earnings, EPS, guidance, revenue beats/misses
- portfolio: About user's holdings, P&L, allocation, exposure, performance
- quick_factual: Simple price/quote lookup ("what's AAPL at?", "price of BTC")
- terminal_overview: Asks "what's happening", market overview, morning brief, or references their screen/dashboard
- morning_brief: Morning summary, daily brief, market open overview
- web_search: Explicitly asks to "search the web", "find me", "latest news about"
- web_lookup: Pure definitional "What is X?" with no ticker or personal reference
- web_narrative: Broad explainer ("explain how X works", "history of Y") with no ticker
- general: Standard market/macro question answerable with terminal context data

Also set "contextRequired" to true if the query references the user's personal data (my, screen, portfolio, positions, watchlist) or needs live market data from the terminal.

Query: "${query.replace(/"/g, '\\"').slice(0, 300)}"

Respond: {"intent":"<intent>","contextRequired":<bool>}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500); // 1.5s max

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 60,
        messages: [{ role: 'user', content: classifierPrompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Haiku classifier HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text?.trim() || '';

    // Parse JSON from Haiku response
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const intent = parsed.intent || 'general';
      const contextRequired = !!parsed.contextRequired;

      // Validate intent is in our ROUTE_MAP
      if (ROUTE_MAP[intent]) {
        logger.info(`[ModelRouter] Haiku classified: "${query.slice(0, 50)}" → ${intent} (ctx=${contextRequired})`);
        return { intent, contextRequired };
      }
    }

    // Haiku returned something unexpected — fall back
    logger.warn(`[ModelRouter] Haiku classifier returned unparseable: ${text.slice(0, 100)}`);
    return { intent: classifyIntent(query, hasVaultContext, hasDeepAnalysis, hasMarketContext), contextRequired: false };

  } catch (err) {
    // Timeout, network error, or parse error — fall back to regex
    logger.warn(`[ModelRouter] Haiku classifier failed (${err.message}), falling back to regex`);
    return { intent: classifyIntent(query, hasVaultContext, hasDeepAnalysis, hasMarketContext), contextRequired: false };
  }
}

/**
 * Get the provider config for the given intent.
 * @param {string} intent
 * @returns {object} provider config
 */
function route(intent) {
  const providerKey = ROUTE_MAP[intent] || ROUTE_MAP.general;
  return PROVIDERS[providerKey];
}

/** Get a provider config by its key name (e.g. 'claude_sonnet', 'perplexity_pro'). */
function getProvider(key) {
  return PROVIDERS[key] || null;
}

/**
 * Make an API call to the appropriate provider (without retry).
 * Handles both Perplexity (OpenAI-compatible) and Anthropic (Messages API) formats.
 *
 * @param {object} provider - provider config from route()
 * @param {array} messages - message array
 * @param {string} systemPrompt - system prompt
 * @param {object} options - { stream, maxTokens, ...rest }
 * @returns {Promise<object>} API response
 */
async function callProviderImpl(provider, messages, systemPrompt, options = {}) {
  const apiKey = process.env[provider.keyEnv];
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${provider.keyEnv}`);
  }

  const isPerplexity = provider.url.includes('perplexity');
  const isAnthropic = provider.url.includes('anthropic');

  let body;
  let headers;

  if (isPerplexity) {
    // OpenAI-compatible format
    body = {
      model: provider.model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: options.stream || false,
      return_citations: true,
      search_recency_filter: 'week',
    };
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
  } else if (isAnthropic) {
    // Anthropic Messages API format
    body = {
      model: provider.model,
      system: systemPrompt,
      messages: messages,
      max_tokens: options.maxTokens || 4096,
      stream: options.stream || false,
    };
    headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
  } else {
    throw new Error(`Unknown provider type: ${provider.url}`);
  }

  const response = await fetch(provider.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[ModelRouter] API error from ${provider.model}:`, errorText);
    throw new Error(`API error: ${response.status} ${errorText}`);
  }

  return response;
}

/**
 * Make an API call with exponential backoff retry logic.
 * Wraps callProviderImpl with callWithRetry.
 *
 * @param {object} provider - provider config from route()
 * @param {array} messages - message array
 * @param {string} systemPrompt - system prompt
 * @param {object} options - { stream, maxTokens, ...rest }
 * @returns {Promise<object>} API response
 */
async function callProvider(provider, messages, systemPrompt, options = {}) {
  return callWithRetry(
    () => callProviderImpl(provider, messages, systemPrompt, options),
    2
  );
}

/**
 * Stream response from provider to client.
 * Normalizes both Perplexity SSE and Anthropic SSE to consistent format.
 * Uses callWithRetry for resilience.
 *
 * @param {object} provider - provider config
 * @param {array} messages - message array
 * @param {string} systemPrompt - system prompt
 * @param {object} res - Express response object
 */
async function streamResponse(provider, messages, systemPrompt, res, { onAbort } = {}) {
  try {
    const response = await callWithRetry(
      () => callProviderImpl(provider, messages, systemPrompt, { stream: true }),
      2
    );

    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    }

    const isPerplexity = provider.url.includes('perplexity');
    const isAnthropic = provider.url.includes('anthropic');

    const reader = response.body;
    let sseBuffer = '';
    let finished = false;
    let perplexityCitations = null; // Capture citations from Perplexity response

    const finish = () => {
      if (finished) return;
      finished = true;
      if (!res.writableEnded) {
        // Citations are now sent immediately when captured (not deferred to finish)
        res.write('data: [DONE]\n\n');
        res.end();
      }
    };

    // Parse a single SSE line and write normalized chunk to client
    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) return;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') { finish(); return; }

      try {
        const parsed = JSON.parse(payload);

        if (isPerplexity) {
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
          }
          // Send citations immediately as they arrive (don't wait for stream end)
          if (parsed.citations && Array.isArray(parsed.citations)) {
            perplexityCitations = parsed.citations;
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ citations: perplexityCitations })}\n\n`);
            }
          }
        } else if (isAnthropic) {
          if (parsed.type === 'content_block_delta') {
            const text = parsed.delta?.text || '';
            if (text) {
              res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
            }
          } else if (parsed.type === 'message_stop') {
            finish();
          }
          // Ignore: message_start, content_block_start, content_block_stop, message_delta, ping
        }
      } catch (err) {
        logger.debug(`[ModelRouter] Skipped malformed SSE: ${trimmed.slice(0, 60)}`);
      }
    };

    reader.on('data', (rawChunk) => {
      if (finished) return;
      sseBuffer += rawChunk.toString();
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop(); // Keep incomplete last line for next chunk
      for (const line of lines) {
        processLine(line);
      }
    });

    reader.on('end', () => {
      // Process any remaining buffered data
      if (sseBuffer.trim()) processLine(sseBuffer);
      finish();
    });

    reader.on('error', (err) => {
      logger.error('[ModelRouter] Stream error:', err.message);
      if (!res.writableEnded) {
        // Phase 2: Send [PARTIAL] marker so client can show "Response interrupted — tap to retry"
        res.write(`data: ${JSON.stringify({ partial: true, error: 'Stream interrupted — tap to retry' })}\n\n`);
      }
      finish();
    });

    // If caller provided an abort signal (e.g. client disconnect), destroy the stream
    if (onAbort) {
      onAbort(() => {
        reader.destroy();
        finish();
      });
    }
  } catch (err) {
    logger.error('[ModelRouter] streamResponse error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream error', details: err.message });
    } else if (!res.writableEnded) {
      // Phase 2: [PARTIAL] marker for client-side retry UX
      res.write(`data: ${JSON.stringify({ partial: true, error: 'Response interrupted — tap to retry' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

module.exports = {
  classifyIntent,
  classifyIntentWithHaiku,
  route,
  getProvider,
  callProvider,
  callProviderImpl,
  callWithRetry,
  streamResponse,
  PROVIDERS,
  ROUTE_MAP,
};
