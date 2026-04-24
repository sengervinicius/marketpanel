/**
 * llm/__tests__/adapter.test.js — R0.2 multi-LLM adapter smoke tests.
 *
 * We do NOT hit any live provider in CI. Each adapter is exercised via
 * a stubbed node-fetch so the HTTP contract + normalisation logic are
 * proven without a network call.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// ── node-fetch stub. We swap the module export per-test via require.cache. ──
const fetchPath = require.resolve('node-fetch');
let nextFetchResponse = null;
function setFetchResponse(body, { status = 200, ok = true } = {}) {
  nextFetchResponse = {
    ok, status,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    json: async () => typeof body === 'string' ? JSON.parse(body) : body,
  };
}
function installFetchStub() {
  require.cache[fetchPath] = {
    id: fetchPath, filename: fetchPath, loaded: true,
    exports: async () => nextFetchResponse,
  };
}
function uninstallFetchStub() {
  delete require.cache[fetchPath];
}

describe('llm adapter registry', () => {
  it('registers anthropic + ollama by default', () => {
    delete require.cache[require.resolve('../adapter')];
    const { list, getAdapter } = require('../adapter');
    const names = list();
    assert.ok(names.includes('anthropic'), 'anthropic missing');
    assert.ok(names.includes('ollama'),    'ollama missing');
    assert.equal(typeof getAdapter('anthropic').chatJson, 'function');
    assert.equal(typeof getAdapter('ollama').chatJson,    'function');
  });

  it('throws on unknown adapter', () => {
    delete require.cache[require.resolve('../adapter')];
    const { getAdapter } = require('../adapter');
    assert.throws(() => getAdapter('made_up'));
  });
});

describe('anthropic adapter', () => {
  before(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    installFetchStub();
    // Purge cached require so the stubbed fetch is used.
    delete require.cache[require.resolve('../providers/anthropic')];
  });
  after(() => {
    uninstallFetchStub();
    delete require.cache[require.resolve('../providers/anthropic')];
  });

  it('normalises a successful /v1/messages response', async () => {
    setFetchResponse({
      content: [{ type: 'text', text: 'hello world' }],
      usage: { input_tokens: 12, output_tokens: 7 },
      stop_reason: 'end_turn',
    });
    const adapter = require('../providers/anthropic');
    const out = await adapter.chatJson({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(out.provider, 'anthropic');
    assert.equal(out.model, 'claude-haiku-4-5-20251001');
    assert.equal(out.stop_reason, 'end_turn');
    assert.deepEqual(out.usage, { input_tokens: 12, output_tokens: 7 });
    assert.deepEqual(out.content, [{ type: 'text', text: 'hello world' }]);
  });

  it('returns error envelope on upstream 500', async () => {
    setFetchResponse('internal server error', { status: 500, ok: false });
    const adapter = require('../providers/anthropic');
    const out = await adapter.chatJson({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(out.stop_reason, 'error');
    assert.match(out.error, /anthropic 500/);
  });

  it('returns error envelope when API key missing', async () => {
    const save = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const adapter = require('../providers/anthropic');
    const out = await adapter.chatJson({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(out.stop_reason, 'error');
    assert.match(out.error, /ANTHROPIC_API_KEY/);
    process.env.ANTHROPIC_API_KEY = save;
  });
});

describe('ollama adapter', () => {
  before(() => {
    installFetchStub();
    delete require.cache[require.resolve('../providers/ollama')];
  });
  after(() => {
    uninstallFetchStub();
    delete require.cache[require.resolve('../providers/ollama')];
  });

  it('converts system + multi-turn messages to OpenAI shape', () => {
    delete require.cache[require.resolve('../providers/ollama')];
    const { _toOllamaMessages } = require('../providers/ollama');
    const out = _toOllamaMessages({
      system: 'You are a helpful assistant.',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: [{ type: 'text', text: 'and?' }] },
      ],
    });
    assert.equal(out.length, 4);
    assert.equal(out[0].role, 'system');
    assert.equal(out[1].role, 'user');
    assert.equal(out[2].role, 'assistant');
    assert.equal(out[3].content, 'and?');
  });

  it('normalises a successful /api/chat response', async () => {
    setFetchResponse({
      model: 'llama3',
      message: { role: 'assistant', content: 'oi' },
      prompt_eval_count: 20,
      eval_count: 5,
      done: true,
      done_reason: 'stop',
    });
    const adapter = require('../providers/ollama');
    const out = await adapter.chatJson({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(out.provider, 'ollama');
    assert.equal(out.model, 'llama3');
    assert.equal(out.stop_reason, 'end_turn');
    assert.deepEqual(out.usage, { input_tokens: 20, output_tokens: 5 });
    assert.deepEqual(out.content, [{ type: 'text', text: 'oi' }]);
  });

  it('maps done_reason=length → stop_reason=max_tokens', async () => {
    setFetchResponse({
      message: { role: 'assistant', content: 'clipped…' },
      done: true, done_reason: 'length',
    });
    const adapter = require('../providers/ollama');
    const out = await adapter.chatJson({
      model: 'llama3',
      messages: [{ role: 'user', content: 'ramble' }],
    });
    assert.equal(out.stop_reason, 'max_tokens');
  });

  it('returns error envelope on upstream 503', async () => {
    setFetchResponse('model is loading', { status: 503, ok: false });
    const adapter = require('../providers/ollama');
    const out = await adapter.chatJson({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(out.stop_reason, 'error');
    assert.match(out.error, /ollama 503/);
  });
});
