/**
 * brief.daily.test.js — Phase S wave 2 route contracts on /api/brief:
 *
 *   1. GET /  — returns the briefEngine result envelope { ok, data,
 *      cached, generatedAt, emailOptIn }, passes ?force=1 through, and
 *      is wired through the AI gates (dailyAILimit + aiQuotaGate).
 *   2. POST /email-optin — accepts { enabled: boolean } only, persists
 *      via authStore.mergeSettings, 400s anything else.
 *
 * The route module is loaded with every heavy dependency stubbed; we
 * invoke the matched layer handlers directly with fake req/res.
 *
 * Run: node --test server/routes/__tests__/brief.daily.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function stubModule(rel, exports) {
  const abs = require.resolve(path.join('..', '..', rel));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// ── Stubs ─────────────────────────────────────────────────────────────
stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

const gateCalls = [];
stubModule('middleware/dailyAILimit', {
  dailyAILimit: (req, res, next) => { gateCalls.push('dailyAILimit'); next(); },
});
stubModule('middleware/aiQuotaGate', {
  aiQuotaGate: (req, res, next) => { gateCalls.push('aiQuotaGate'); next(); },
});

const engineCalls = [];
stubModule('services/briefEngine', {
  getBrief: async (userId, opts) => {
    engineCalls.push({ userId, opts });
    return {
      brief: { oneThing: 'test one thing', buckets: [], macro: [], vaultCheck: [] },
      cached: false,
      generatedAt: '2026-07-20T10:30:00.000Z',
    };
  },
});

const merged = [];
stubModule('authStore', {
  getUserById: (id) => ({ id, settings: { dailyBriefEmail: true } }),
  mergeSettings: (userId, partial) => { merged.push({ userId, partial }); },
});
stubModule('db/postgres', { isConnected: () => false, query: async () => ({ rows: [] }) });
stubModule('services/morningBrief', {
  getUserBrief: async () => null,
  forceGenerate: async () => null,
  getContextualGreeting: async () => ({ greeting: 'stub' }),
});

const router = require('../brief');

// ── Layer lookup + invocation helpers ─────────────────────────────────
function findRoute(method, routePath) {
  const layer = router.stack.find(l =>
    l.route && l.route.path === routePath && l.route.methods[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${routePath} must exist`);
  return layer.route;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this._done && this._done(); return this; },
  };
  return res;
}

async function run(route, req) {
  const res = makeRes();
  await new Promise((resolve, reject) => {
    res._done = resolve;
    let i = 0;
    const next = (err) => {
      if (err) return reject(err);
      const layer = route.stack[i++];
      if (!layer) return resolve();
      Promise.resolve(layer.handle(req, res, next)).catch(reject);
    };
    next();
  });
  return res;
}

// ── 1. GET / ──────────────────────────────────────────────────────────
test('GET / runs the AI gates then returns the engine envelope', async () => {
  gateCalls.length = 0;
  engineCalls.length = 0;

  const route = findRoute('get', '/');
  const res = await run(route, { user: { id: 42 }, query: {} });

  assert.deepEqual(gateCalls, ['dailyAILimit', 'aiQuotaGate'],
    'both AI gates run before the handler');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.oneThing, 'test one thing');
  assert.equal(res.body.emailOptIn, true, 'reads settings.dailyBriefEmail');
  assert.equal(res.body.generatedAt, '2026-07-20T10:30:00.000Z');
  assert.deepEqual(engineCalls[0], { userId: 42, opts: { force: false } });
});

test('GET /?force=1 bypasses the engine cache', async () => {
  engineCalls.length = 0;
  const route = findRoute('get', '/');
  await run(route, { user: { id: 42 }, query: { force: '1' } });
  assert.deepEqual(engineCalls[0].opts, { force: true });
});

// ── 2. POST /email-optin ──────────────────────────────────────────────
test('POST /email-optin persists a boolean and echoes it', async () => {
  merged.length = 0;
  const route = findRoute('post', '/email-optin');
  const res = await run(route, { user: { id: 42 }, body: { enabled: true } });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, emailOptIn: true });
  assert.deepEqual(merged, [{ userId: 42, partial: { dailyBriefEmail: true } }]);
});

test('POST /email-optin rejects non-boolean payloads with 400', async () => {
  merged.length = 0;
  const route = findRoute('post', '/email-optin');
  for (const bad of [{ enabled: 'yes' }, { enabled: 1 }, {}, null]) {
    const res = await run(route, { user: { id: 42 }, body: bad });
    assert.equal(res.statusCode, 400, `payload ${JSON.stringify(bad)} must 400`);
  }
  assert.equal(merged.length, 0, 'nothing persisted on rejection');
});
