/**
 * modelRouter.js — Intelligent model routing for Particle.
 *
 * Routes queries to the optimal AI model based on intent:
 *   quick_factual    → Perplexity sonar (fast, web-grounded)
 *   deep_analysis    → Anthropic Claude Sonnet (best reasoning)
 *   morning_brief    → Perplexity sonar-pro (narrative + web data)
 *   vault_rag        → Anthropic Claude Sonnet (document synthesis)
 *   anomaly_classify → Anthropic Claude Haiku (fast, cheap)
 *   earnings_analysis → Anthropic Claude Sonnet (structured reasoning)
 *   general          → Perplexity sonar-pro (default, web-grounded)
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

// Intent → provider mapping
// Phase 2: 'general' now routes to claude_sonnet so ambiguous queries use
// injected market context instead of Perplexity web search (which ignores it).
// Perplexity is reserved for explicitly web-grounded intents (quick_factual, morning_brief, web_search).
const ROUTE_MAP = {
  quick_factual: 'perplexity_fast',
  deep_analysis: 'claude_sonnet',
  portfolio: 'claude_sonnet',
  counter_thesis: 'claude_sonnet',
  scenario: 'claude_sonnet',
  vault_rag: 'claude_sonnet',
  morning_brief: 'perplexity_pro',
  anomaly_classify: 'claude_haiku',
  earnings_analysis: 'claude_sonnet',
  terminal_overview: 'claude_sonnet',
  web_search: 'perplexity_pro',       // Explicit web-search intent (Phase 2)
  general: 'claude_sonnet',            // Phase 2: default to Claude for context-aware responses
};

/**
 * Classify the query into an intent.
 * @param {string} query
 * @param {boolean} hasVaultContext - true if vault passages were found
 * @param {boolean} hasDeepAnalysis - true if deep analysis was triggered
 * @returns {string} intent name
 */
function classifyIntent(query, hasVaultContext = false, hasDeepAnalysis = false) {
  if (!query) return 'general';

  const q = query.trim().toLowerCase();

  // If vault context is present, route to vault_rag
  if (hasVaultContext) {
    return 'vault_rag';
  }

  // If deep analysis intent was detected, use it
  if (hasDeepAnalysis) {
    return 'deep_analysis';
  }

  // Quick factual queries: "what is the price of", "how much is", "what's TICKER at"
  const quickFactualPatterns = [
    /^(?:what\s+is\s+)?(?:the\s+)?price\s+of\s+/i,
    /^how\s+much\s+is\s+/i,
    /what['s]{1,2}\s+\w{1,5}\s+at/i,
    /^[a-z]{1,5}\s+price/i,
    /^price\s+of\s+/i,
  ];

  for (const pattern of quickFactualPatterns) {
    if (pattern.test(q)) {
      // Verify it's a short, single-ticker query (not multi-sentence)
      if (query.length < 100 && (query.match(/\b[A-Z]{1,5}\b/g) || []).length <= 2) {
        return 'quick_factual';
      }
    }
  }

  // Earnings analysis intent
  if (/earnings|eps|beat|miss|guidance|outlook/i.test(q)) {
    return 'earnings_analysis';
  }

  // Terminal-awareness: user asking about their screen, dashboard, watchlist, portfolio, positions
  // Route to Claude so the injected market context is actually used (Perplexity ignores it for web search)
  if (/\b(my\s+(screen|terminal|dashboard|home|data|watchlist|portfolio|positions?|holdings?|alerts?)|analyze\s+(my|the)\s+(screen|terminal|home|dashboard)|what('s| is)\s+(on\s+)?my\s+(screen|dashboard|terminal)|brief|morning|summary|overview|what.*happening|market\s+(update|recap|summary))\b/i.test(q)) {
    return 'terminal_overview';
  }

  // Default to general (now routed to Claude, not Perplexity)
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
async function classifyIntentWithHaiku(query, hasVaultContext = false, hasDeepAnalysis = false) {
  // Fast-path overrides (no need to call Haiku for these)
  if (hasVaultContext) return { intent: 'vault_rag', contextRequired: true };
  if (hasDeepAnalysis) return { intent: 'deep_analysis', contextRequired: true };
  if (!query || query.trim().length < 3) return { intent: 'general', contextRequired: false };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No Anthropic key — fall back to regex
    return { intent: classifyIntent(query, hasVaultContext, hasDeepAnalysis), contextRequired: false };
  }

  try {
    const classifierPrompt = `Classify this financial terminal query into exactly ONE intent. Respond with ONLY a JSON object, no other text.

Intents:
- quick_factual: Simple price/quote lookup ("what's AAPL at?", "price of BTC")
- earnings_analysis: About earnings, EPS, guidance, revenue beats/misses
- terminal_overview: User references their screen, dashboard, watchlist, portfolio, positions, or asks for a morning brief/summary/overview of markets
- portfolio: About user's holdings, P&L, allocation, exposure, performance
- web_search: Requires real-time web data NOT available in a terminal (breaking news, specific articles, recent events, "search for", "find me", "latest news about")
- deep_analysis: Multi-factor analysis, scenario modeling, counter-thesis, compare frameworks
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
    return { intent: classifyIntent(query, hasVaultContext, hasDeepAnalysis), contextRequired: false };

  } catch (err) {
    // Timeout, network error, or parse error — fall back to regex
    logger.warn(`[ModelRouter] Haiku classifier failed (${err.message}), falling back to regex`);
    return { intent: classifyIntent(query, hasVaultContext, hasDeepAnalysis), contextRequired: false };
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
