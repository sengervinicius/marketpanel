/**
 * llm/adapter.js — R0.2 multi-LLM adapter registry.
 *
 * getAdapter('anthropic') → anthropic adapter (default)
 * getAdapter('ollama')    → local Ollama
 *
 * More adapters land later (Groq, DeepSeek, Gemini, MiniMax, OpenRouter).
 * Each adapter normalises its upstream response into the Anthropic-style
 * content-block shape documented in README.md.
 */

'use strict';

const logger = require('../utils/logger');

const _registry = new Map();

function register(adapter) {
  if (!adapter || typeof adapter !== 'object' || typeof adapter.name !== 'string') {
    throw new Error('llm.register: adapter must have a string `name`');
  }
  if (typeof adapter.chatJson !== 'function') {
    throw new Error(`llm.register: adapter "${adapter.name}" must implement chatJson()`);
  }
  _registry.set(adapter.name, adapter);
  return adapter;
}

function getAdapter(name) {
  const a = _registry.get(name);
  if (!a) {
    throw new Error(`llm.getAdapter: unknown adapter "${name}". Known: ${list().join(', ')}`);
  }
  return a;
}

function list() { return Array.from(_registry.keys()); }

// Seed the default registrations. Providers self-register by requiring
// them here (module side-effect). Tests can call register() with stubs.
register(require('./providers/anthropic'));
register(require('./providers/ollama'));

/**
 * Build a normalised "error" response. Used by adapters when upstream
 * is unreachable. Keeps the calling code simple — it always sees the
 * Anthropic-shaped envelope.
 */
function errorEnvelope({ provider, model, error }) {
  return {
    content: [{ type: 'text', text: '' }],
    usage: { input_tokens: 0, output_tokens: 0 },
    stop_reason: 'error',
    provider,
    model,
    error: String(error?.message || error || 'unknown error'),
  };
}

module.exports = { register, getAdapter, list, errorEnvelope, _log: logger };
