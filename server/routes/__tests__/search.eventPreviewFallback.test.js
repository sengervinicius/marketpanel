/**
 * search.eventPreviewFallback.test.js — fix/ux-round4 FIX 2.
 *
 * POST /event-preview (Calendar panel MACRO tab "AI preview") was
 * hardwired to Perplexity and passed the provider's raw status through
 * to the UI as "AI provider error (401)". This pins the fix — the route
 * now mirrors /news-briefing + /news-summary (#291 / N6):
 *
 *   - Perplexity healthy  → provider 'perplexity', degraded:false
 *   - Perplexity 401      → Anthropic Haiku serves it, degraded:true
 *   - both providers fail → 503 preview_temporarily_unavailable with an
 *     honest message; no raw provider status codes in the body
 *   - successful results cache for 15 min (cached:true, no new LLM call)
 *
 * node-fetch is stubbed via require.cache before routes/search.js loads,
 * so the test is deterministic and offline-safe.
 *
 *   cd server && node --test routes/__tests__/search.eventPreviewFallback.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

process.env.PERPLEXITY_API_KEY = 'test-pplx-key';
process.env.ANTHROPIC_API_KEY  = 'test-anthropic-key';

// ── Stub node-fetch BEFORE routes/search.js is required ─────────────
const calls = { perplexity: 0, anthropic: 0 };
const state = {
  perplexityMode: 'ok',    // 'ok' | 'auth' | 'fail'
  anthropicMode:  'ok',
  payload: {
    impact: 'high',
    summary: 'CPI print will steer near-term Fed expectations.',
    affectedSectors: ['Financials', 'Real Estate'],
    affectedAssets: ['TLT', 'XLF'],
    marketExpectation: 'Consensus sees 0.3% m/m core.',
    tradingConsiderations: ['Watch rate-sensitive sectors.'],
  },
};

function jsonRes(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

async function fakeFetch(url) {
  const u = String(url);
  if (u.includes('api.perplexity.ai')) {
    calls.perplexity++;
    if (state.perplexityMode === 'auth') return jsonRes({ error: 'unauthorized' }, 401);
    if (state.perplexityMode !== 'ok')   return jsonRes({ error: 'down' }, 500);
    return jsonRes({ choices: [{ message: { content: JSON.stringify(state.payload) } }] });
  }
  if (u.includes('api.anthropic.com')) {
    calls.anthropic++;
    if (state.anthropicMode !== 'ok') return jsonRes({ error: 'down' }, 500);
    return jsonRes({ content: [{ type: 'text', text: JSON.stringify(state.payload) }] });
  }
  throw new Error('unexpected fetch in test: ' + u);
}

const fetchPath = require.resolve('node-fetch');
require.cache[fetchPath] = {
  id: fetchPath, filename: fetchPath, loaded: true,
  exports: fakeFetch,
};

const searchPath = require.resolve('../search');
delete require.cache[searchPath];
const searchRouter = require('../search');

function postJson(port, pathStr, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1', port, path: pathStr, method: 'POST', agent: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
          catch (e) { reject(new Error(`bad JSON from ${pathStr}: ${body.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

describe('POST /event-preview provider fallback (fix/ux-round4 FIX 2)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use(searchRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('uses Perplexity when healthy (degraded:false)', async () => {
    const { status, body } = await postJson(port, '/event-preview', {
      event: 'US CPI (June)', date: '2026-07-15',
    });
    assert.equal(status, 200);
    assert.equal(body.provider, 'perplexity');
    assert.equal(body.degraded, false);
    assert.equal(body.impact, 'high');
    assert.deepEqual(body.affectedAssets, state.payload.affectedAssets);
    assert.equal(calls.perplexity, 1);
    assert.equal(calls.anthropic, 0);
  });

  it('Perplexity 401 → Anthropic Haiku serves the preview (degraded:true)', async () => {
    state.perplexityMode = 'auth';
    try {
      const { status, body } = await postJson(port, '/event-preview', {
        event: 'FOMC rate decision', date: '2026-07-29',
      });
      assert.equal(status, 200);
      assert.equal(body.provider, 'anthropic');
      assert.equal(body.degraded, true);
      assert.equal(body.summary, state.payload.summary);
      assert.equal(calls.perplexity, 2, 'Perplexity was tried first');
      assert.equal(calls.anthropic, 1, 'Anthropic served the fallback');
    } finally {
      state.perplexityMode = 'ok';
    }
  });

  it('degraded results are cached (no additional LLM calls)', async () => {
    const pplxBefore = calls.perplexity;
    const anthBefore = calls.anthropic;
    const { status, body } = await postJson(port, '/event-preview', {
      event: 'FOMC rate decision', date: '2026-07-29',
    });
    assert.equal(status, 200);
    assert.equal(body.cached, true);
    assert.equal(calls.perplexity, pplxBefore);
    assert.equal(calls.anthropic, anthBefore);
  });

  it('503 preview_temporarily_unavailable only when BOTH fail — no raw provider codes', async () => {
    state.perplexityMode = 'fail';
    state.anthropicMode  = 'fail';
    try {
      const { status, body } = await postJson(port, '/event-preview', {
        event: 'NFP (July)', date: '2026-08-07',
      });
      assert.equal(status, 503);
      assert.equal(body.error, 'preview_temporarily_unavailable');
      assert.ok(body.message, 'honest human-readable message present');
      const flat = JSON.stringify(body);
      assert.ok(!/\b(401|403|502)\b/.test(flat), 'no raw provider status codes leak to the client');
      assert.ok(!/AI provider error/i.test(flat), 'legacy passthrough message is gone');
    } finally {
      state.perplexityMode = 'ok';
      state.anthropicMode  = 'ok';
    }
  });

  it('still 400s on missing event name', async () => {
    const { status } = await postJson(port, '/event-preview', { date: '2026-08-07' });
    assert.equal(status, 400);
  });
});
