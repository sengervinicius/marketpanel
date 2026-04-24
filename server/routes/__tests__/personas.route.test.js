/**
 * routes/__tests__/personas.route.test.js — R0.3 route smoke.
 *
 * Proves:
 *   - GET /  responds 404 when PERSONA_AGENTS_V1 is OFF.
 *   - GET /  responds 200 with personas[] when flag is ON.
 *   - POST /:id/ask validates input and runs the stub runtime.
 *
 * We stub the featureFlags + llm modules via require.cache so no
 * network call hits Anthropic and the route remains offline-safe in CI.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const flagsPath = require.resolve('../../services/featureFlags');
const llmPath   = require.resolve('../../llm/adapter');
const routePath = require.resolve('../personas');

function setFlag(on) {
  require.cache[flagsPath] = {
    id: flagsPath, filename: flagsPath, loaded: true,
    exports: { isOn: async () => on },
  };
}

function installStubLlm(responseText) {
  require.cache[llmPath] = {
    id: llmPath, filename: llmPath, loaded: true,
    exports: {
      getAdapter: () => ({
        name: 'stub',
        chatJson: async () => ({
          content: [{ type: 'text', text: responseText }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
          provider: 'stub',
          model: 'stub',
        }),
      }),
      list: () => ['stub'],
      register: () => {},
    },
  };
}

function clearStubs() {
  delete require.cache[flagsPath];
  delete require.cache[llmPath];
  delete require.cache[routePath];
}

function buildApp() {
  delete require.cache[routePath];
  const personasRoutes = require('../personas');
  const app = express();
  app.use(express.json());
  // Mock auth: tests attach req.user directly.
  app.use((req, _res, next) => { req.user = { id: 42, tier: 'paid' }; next(); });
  app.use('/api/personas', personasRoutes);
  return app;
}

function request(app, { method = 'GET', url, body }) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const req = http.request({
        method, host: '127.0.0.1', port, path: url,
        headers: body ? { 'content-type': 'application/json' } : undefined,
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          server.close();
          try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

describe('/api/personas — flag OFF', () => {
  before(() => { setFlag(false); installStubLlm('ignored'); });
  after(clearStubs);

  it('GET / returns 404', async () => {
    const app = buildApp();
    const res = await request(app, { url: '/api/personas/' });
    assert.equal(res.status, 404);
    assert.equal(res.body.ok, false);
  });

  it('POST /:id/ask returns 404', async () => {
    const app = buildApp();
    const res = await request(app, {
      method: 'POST',
      url: '/api/personas/buffett/ask',
      body: { question: 'x' },
    });
    assert.equal(res.status, 404);
  });
});

describe('/api/personas — flag ON', () => {
  before(() => {
    setFlag(true);
    const fakeReply = [
      'Verdict: limited margin of safety on current price.',
      '<rubric>' + JSON.stringify({
        dimension_scores: [
          { name: 'owner_earnings', score: 7 },
          { name: 'economic_moat', score: 7 },
          { name: 'management', score: 7 },
          { name: 'balance_sheet', score: 7 },
          { name: 'margin_of_safety', score: 7 },
        ],
        citations: [{ source: 'lookup_quote' }],
      }) + '</rubric>',
    ].join('\n');
    installStubLlm(fakeReply);
  });
  after(clearStubs);

  it('GET / returns the six personas', async () => {
    const app = buildApp();
    const res = await request(app, { url: '/api/personas/' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const ids = res.body.personas.map(p => p.id);
    for (const expected of ['buffett','graham','lynch','munger','klarman','marks']) {
      assert.ok(ids.includes(expected));
    }
  });

  it('POST /:id/ask validates empty question', async () => {
    const app = buildApp();
    const res = await request(app, {
      method: 'POST',
      url: '/api/personas/buffett/ask',
      body: { question: '' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'question_required');
  });

  it('POST /:id/ask validates length cap', async () => {
    const app = buildApp();
    const res = await request(app, {
      method: 'POST',
      url: '/api/personas/buffett/ask',
      body: { question: 'x'.repeat(2100) },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'question_too_long');
  });

  it('POST /:id/ask returns 404 for unknown persona', async () => {
    const app = buildApp();
    const res = await request(app, {
      method: 'POST',
      url: '/api/personas/soros/ask',
      body: { question: 'hi' },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'unknown_persona');
  });

  it('POST /:id/ask runs runtime end-to-end with stubbed llm', async () => {
    const app = buildApp();
    const res = await request(app, {
      method: 'POST',
      url: '/api/personas/buffett/ask',
      body: { question: 'Is PETR4 attractive today?' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.response.persona.id, 'buffett');
    assert.ok(res.body.response.summary.includes('Verdict'));
    assert.equal(res.body.response.rubric_score, 7);
  });
});
