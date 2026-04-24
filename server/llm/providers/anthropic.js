/**
 * llm/providers/anthropic.js — R0.2 Anthropic chatJson adapter.
 *
 * Non-streaming wrapper around /v1/messages. Same HTTP behaviour
 * (headers, anthropic-version) as the existing aiToolbox.callClaudeJson
 * — we deliberately mirror it so the paths are interchangeable.
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../../utils/logger');

const DEFAULT_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

async function chatJson({ model, messages, system, tools, max_tokens = 4096 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return errorEnvelope({ model, error: 'ANTHROPIC_API_KEY missing' });
  }
  const body = { model, messages, max_tokens };
  if (system) body.system = system;
  if (Array.isArray(tools) && tools.length) body.tools = tools;

  try {
    const res = await fetch(DEFAULT_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return errorEnvelope({ model, error: `anthropic ${res.status}: ${text.slice(0, 200)}` });
    }
    const json = await res.json();
    return {
      content: Array.isArray(json.content) ? json.content : [],
      usage: {
        input_tokens:  Number(json.usage?.input_tokens)  || 0,
        output_tokens: Number(json.usage?.output_tokens) || 0,
      },
      stop_reason: json.stop_reason || 'end_turn',
      provider: 'anthropic',
      model,
    };
  } catch (e) {
    logger.warn('llm/anthropic', 'chatJson failed', { error: e.message });
    return errorEnvelope({ model, error: e });
  }
}

function errorEnvelope({ model, error }) {
  return {
    content: [{ type: 'text', text: '' }],
    usage: { input_tokens: 0, output_tokens: 0 },
    stop_reason: 'error',
    provider: 'anthropic',
    model,
    error: String(error?.message || error || 'unknown error'),
  };
}

module.exports = { name: 'anthropic', chatJson };
