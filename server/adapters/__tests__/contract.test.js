/**
 * server/adapters/__tests__/contract.test.js
 *
 * Unit tests for the Wave 1 Adapter Contract. Uses node:assert + the
 * project's existing test runner conventions (no new deps). Run:
 *   node --test server/adapters/__tests__/contract.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ProviderErrorCode,
  makeProviderError,
  makeProvenance,
  ok,
  err,
  AdapterRegistry,
  executeChain,
} = require('../contract');

test('ProviderErrorCode taxonomy is frozen', () => {
  assert.throws(() => { ProviderErrorCode.NEW = 'NEW'; });
});

test('makeProviderError validates code', () => {
  assert.throws(() => makeProviderError('BOGUS', 'x'));
  const e = makeProviderError('RATE_LIMITED', 'polygon', { retryAfterMs: 1000 });
  assert.equal(e.code, 'RATE_LIMITED');
  assert.equal(e.adapter, 'polygon');
  assert.equal(e.retryAfterMs, 1000);
  assert.throws(() => { e.code = 'X'; }, 'error must be frozen');
});

test('makeProvenance carries defaults and is frozen', () => {
  const p = makeProvenance({ source: 'polygon' });
  assert.equal(p.source, 'polygon');
  assert.equal(p.confidence, 'medium');
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(p.adapterChain, []);
  assert.throws(() => { p.source = 'x'; });
});

test('ok() / err() Result discriminated union', () => {
  const good = ok({ last: 100 }, makeProvenance({ source: 'p' }));
  const bad = err(makeProviderError('TIMEOUT', 'p'), makeProvenance({ source: 'p' }));
  assert.equal(good.ok, true);
  assert.equal(good.data.last, 100);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'TIMEOUT');
});

test('AdapterRegistry.register requires describe() and health()', () => {
  const r = new AdapterRegistry();
  assert.throws(() => r.register({}), /describe/);
  assert.throws(() => r.register({ describe: () => ({}), health: async () => ok({}) }), /name or version/);
});

test('AdapterRegistry.route sorts by confidence', () => {
  const mk = (name, conf) => ({
    describe: () => ({
      name,
      version: '1.0.0',
      capabilities: ['quote'],
      coverageCells: [{ market: 'US', assetClass: 'equity', capability: 'quote', confidence: conf }],
      latencyP95TargetMs: 1000,
      freshnessSlaSec: 60,
    }),
    health: async () => ok({ adapter: name }, makeProvenance({ source: name })),
    quote: async () => ok({ last: 1 }, makeProvenance({ source: name })),
  });
  const r = new AdapterRegistry();
  r.register(mk('low', 'low'));
  r.register(mk('high', 'high'));
  r.register(mk('med', 'medium'));
  const chain = r.route('US', 'equity', 'quote');
  assert.deepEqual(chain.map(a => a.describe().name), ['high', 'med', 'low']);
});

test('executeChain returns first ok and records attempted adapters', async () => {
  const mk = (name, behavior) => ({
    describe: () => ({ name, version: '1.0.0', capabilities: ['quote'], coverageCells: [], latencyP95TargetMs: 1000, freshnessSlaSec: 60 }),
    health: async () => ok({ adapter: name }, makeProvenance({ source: name })),
    quote: behavior,
  });
  const a = mk('a', async () => err(makeProviderError('UPSTREAM_5XX', 'a'), makeProvenance({ source: 'a' })));
  const b = mk('b', async () => ok({ last: 42 }, makeProvenance({ source: 'b' })));
  const c = mk('c', async () => ok({ last: 99 }, makeProvenance({ source: 'c' })));
  const res = await executeChain([a, b, c], 'quote', ['AAPL']);
  assert.equal(res.ok, true);
  assert.equal(res.data.last, 42);
  assert.deepEqual(res.provenance.adapterChain, ['a', 'b']);
});

test('executeChain returns typed error when all adapters fail', async () => {
  const mk = (name, code) => ({
    describe: () => ({ name, version: '1.0.0', capabilities: ['quote'], coverageCells: [], latencyP95TargetMs: 1000, freshnessSlaSec: 60 }),
    health: async () => ok({}, makeProvenance({ source: name })),
    quote: async () => err(makeProviderError(code, name), makeProvenance({ source: name })),
  });
  const res = await executeChain([mk('a', 'TIMEOUT'), mk('b', 'UPSTREAM_5XX')], 'quote', ['X']);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'UPSTREAM_5XX');
  assert.deepEqual(res.provenance.adapterChain, ['a', 'b']);
});

test('executeChain with empty chain returns NOT_IN_COVERAGE', async () => {
  const res = await executeChain([], 'quote', ['X']);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'NOT_IN_COVERAGE');
  assert.equal(res.error.adapter, 'router');
});

test('executeChain treats thrown exceptions as UNKNOWN and continues', async () => {
  const throwing = {
    describe: () => ({ name: 'throwing', version: '1.0.0', capabilities: ['quote'], coverageCells: [], latencyP95TargetMs: 1000, freshnessSlaSec: 60 }),
    health: async () => ok({}, makeProvenance({ source: 'throwing' })),
    quote: async () => { throw new Error('boom'); },
  };
  const good = {
    describe: () => ({ name: 'good', version: '1.0.0', capabilities: ['quote'], coverageCells: [], latencyP95TargetMs: 1000, freshnessSlaSec: 60 }),
    health: async () => ok({}, makeProvenance({ source: 'good' })),
    quote: async () => ok({ last: 7 }, makeProvenance({ source: 'good' })),
  };
  const res = await executeChain([throwing, good], 'quote', ['X']);
  assert.equal(res.ok, true);
  assert.deepEqual(res.provenance.adapterChain, ['throwing', 'good']);
});
