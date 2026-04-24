/**
 * llm/providers/ollama.js — R0.2 local Ollama chatJson adapter.
 *
 * Ollama (https://ollama.com) runs models locally and exposes an
 * OpenAI-ish /api/chat endpoint. We normalise its response into the
 * Anthropic content-block shape documented in README.md so the caller
 * never sees the difference.
 *
 * Default endpoint: http://localhost:11434/api/chat. Override via
 * OLLAMA_URL env. For compliance deployments pointing at a private
 * Ollama tenant, set OLLAMA_URL + OLLAMA_API_KEY (optional bearer).
 *
 * Tool-use on Ollama: most models don't natively support
 * Anthropic-style tools, so we return stop_reason='end_turn' regardless
 * of whether `tools` were passed in. Callers that rely on tool loops
 * should stick with Anthropic for now. This is an intentional v1
 * limitation — R0.3 persona agents call chatJson without tools.
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../../utils/logger');

const DEFAULT_URL = 'http://localhost:11434/api/chat';

function endpoint() {
  return process.env.OLLAMA_URL || DEFAULT_URL;
}

function headers() {
  const h = { 'content-type': 'application/json' };
  if (process.env.OLLAMA_API_KEY) {
    h.authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
  }
  return h;
}

/**
 * Convert our Anthropic-shaped `messages` + `system` into Ollama's
 * OpenAI-style chat format: [{role:'system'|'user'|'assistant', content:string}].
 */
function toOllamaMessages({ system, messages }) {
  const out = [];
  if (system) out.push({ role: 'system', content: String(system) });
  for (const m of (messages || [])) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant'
              : m.role === 'system'    ? 'system'
              : 'user';
    let content = m.content;
    if (Array.isArray(content)) {
      // Anthropic content-block array → flatten to plain text.
      content = content.map(b => (b && typeof b === 'object' && typeof b.text === 'string') ? b.text : '').join('\n');
    } else if (typeof content !== 'string') {
      content = String(content ?? '');
    }
    out.push({ role, content });
  }
  return out;
}

async function chatJson({ model, messages, system, max_tokens = 4096 /* tools: ignored */ }) {
  const body = {
    model,
    messages: toOllamaMessages({ system, messages }),
    stream: false,
    options: { num_predict: max_tokens },
  };
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return errorEnvelope({ model, error: `ollama ${res.status}: ${text.slice(0, 200)}` });
    }
    const json = await res.json();
    // Ollama /api/chat returns:
    //   { message: { role, content }, prompt_eval_count, eval_count, done, done_reason, ... }
    const text = (json.message && typeof json.message.content === 'string') ? json.message.content : '';
    return {
      content: [{ type: 'text', text }],
      usage: {
        input_tokens:  Number(json.prompt_eval_count) || 0,
        output_tokens: Number(json.eval_count)        || 0,
      },
      stop_reason: json.done_reason === 'length' ? 'max_tokens' : 'end_turn',
      provider: 'ollama',
      model,
    };
  } catch (e) {
    logger.warn('llm/ollama', 'chatJson failed', { error: e.message });
    return errorEnvelope({ model, error: e });
  }
}

function errorEnvelope({ model, error }) {
  return {
    content: [{ type: 'text', text: '' }],
    usage: { input_tokens: 0, output_tokens: 0 },
    stop_reason: 'error',
    provider: 'ollama',
    model,
    error: String(error?.message || error || 'unknown error'),
  };
}

module.exports = { name: 'ollama', chatJson, _endpoint: endpoint, _toOllamaMessages: toOllamaMessages };
