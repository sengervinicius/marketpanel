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
  general: 'perplexity_pro',
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

  // Default to general
  return 'general';
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

/**
 * Make an API call to the appropriate provider.
 * Handles both Perplexity (OpenAI-compatible) and Anthropic (Messages API) formats.
 *
 * @param {object} provider - provider config from route()
 * @param {array} messages - message array
 * @param {string} systemPrompt - system prompt
 * @param {object} options - { stream, maxTokens, ...rest }
 * @returns {Promise<object>} API response
 */
async function callProvider(provider, messages, systemPrompt, options = {}) {
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
 * Stream response from provider to client.
 * Normalizes both Perplexity SSE and Anthropic SSE to consistent format.
 *
 * @param {object} provider - provider config
 * @param {array} messages - message array
 * @param {string} systemPrompt - system prompt
 * @param {object} res - Express response object
 */
async function streamResponse(provider, messages, systemPrompt, res, { onAbort } = {}) {
  try {
    const response = await callProvider(provider, messages, systemPrompt, {
      stream: true,
    });

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

    const finish = () => {
      if (finished) return;
      finished = true;
      if (!res.writableEnded) {
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
        res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
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
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

module.exports = {
  classifyIntent,
  route,
  callProvider,
  streamResponse,
  PROVIDERS,
  ROUTE_MAP,
};
