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
async function streamResponse(provider, messages, systemPrompt, res) {
  try {
    const response = await callProvider(provider, messages, systemPrompt, {
      stream: true,
    });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const isPerplexity = provider.url.includes('perplexity');
    const isAnthropic = provider.url.includes('anthropic');

    const reader = response.body;

    reader.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          if (isPerplexity) {
            // Perplexity format: "data: {...json...}"
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                res.write('data: [DONE]\n\n');
                return;
              }
              const parsed = JSON.parse(data);
              if (parsed.choices?.[0]?.delta?.content) {
                const chunk = parsed.choices[0].delta.content;
                res.write(
                  `data: ${JSON.stringify({ chunk })}\n\n`
                );
              }
            }
          } else if (isAnthropic) {
            // Anthropic format: "data: {...json...}"
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              const parsed = JSON.parse(data);

              if (parsed.type === 'content_block_delta') {
                const chunk = parsed.delta?.text || '';
                if (chunk) {
                  res.write(
                    `data: ${JSON.stringify({ chunk })}\n\n`
                  );
                }
              } else if (parsed.type === 'message_stop') {
                res.write('data: [DONE]\n\n');
              }
            }
          }
        } catch (err) {
          // Skip malformed lines
          if (line.length > 0) {
            logger.debug(`[ModelRouter] Skipped malformed line: ${line.slice(0, 50)}`);
          }
        }
      }
    });

    reader.on('end', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });

    reader.on('error', (err) => {
      logger.error('[ModelRouter] Stream error:', err);
      res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
      res.end();
    });
  } catch (err) {
    logger.error('[ModelRouter] streamResponse error:', err.message);
    res.status(500).json({ error: 'Stream error', details: err.message });
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
