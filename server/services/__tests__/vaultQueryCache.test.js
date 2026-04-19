/**
 * vaultQueryCache.test.js — W4.6 regression guard.
 *
 * Locks in the in-process LRU behaviour the retrieval hot path depends on:
 *   - get() returns null on cold miss
 *   - set() then get() roundtrips
 *   - Normalisation collapses whitespace + case variants
 *   - Different providers / models are independent keys
 *   - TTL expiry treats old entries as misses
 *   - LRU evicts least-recently-used when full
 *   - embedQuery() calls embedFn only on miss
 *   - embedQuery() propagates embedFn throws (so retrieve() still sees errors)
 *   - configure() shrinks the cache immediately when capacity drops
 *   - stats() exposes hit/miss counters for observability
 *
 * Run:
 *   node --test server/services/__tests__/vaultQueryCache.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cache = require('../vaultQueryCache');

// ── Smoke ───────────────────────────────────────────────────────────────

test('cold miss returns null', () => {
  cache._clear();
  assert.equal(cache.get({ provider: 'openai', query: 'never seen' }), null);
});

test('set then get roundtrips', () => {
  cache._clear();
  const vec = [0.1, 0.2, 0.3];
  cache.set({ provider: 'openai', query: 'hello world', embedding: vec });
  assert.deepEqual(cache.get({ provider: 'openai', query: 'hello world' }), vec);
});

test('set with empty embedding is a no-op', () => {
  cache._clear();
  cache.set({ provider: 'openai', query: 'x', embedding: [] });
  cache.set({ provider: 'openai', query: 'y', embedding: null });
  assert.equal(cache.size(), 0);
});

// ── Normalisation ────────────────────────────────────────────────────────

test('normalises whitespace and case', () => {
  cache._clear();
  const vec = [0.5];
  cache.set({ provider: 'openai', query: 'AAPL earnings?', embedding: vec });
  assert.deepEqual(cache.get({ provider: 'openai', query: '  aapl   earnings?  ' }), vec);
  assert.deepEqual(cache.get({ provider: 'openai', query: 'AAPL EARNINGS?' }), vec);
});

// ── Provider / model scoping ────────────────────────────────────────────

test('different providers are independent keys', () => {
  cache._clear();
  const vOpenai = [1, 0, 0];
  const vVoyage = [0, 1, 0];
  cache.set({ provider: 'openai', query: 'Q', embedding: vOpenai });
  cache.set({ provider: 'voyage', query: 'Q', embedding: vVoyage });
  assert.deepEqual(cache.get({ provider: 'openai', query: 'Q' }), vOpenai);
  assert.deepEqual(cache.get({ provider: 'voyage', query: 'Q' }), vVoyage);
});

test('different model labels are independent keys', () => {
  cache._clear();
  const v1 = [1]; const v2 = [2];
  cache.set({ provider: 'openai', model: 'text-embedding-3-small', query: 'Q', embedding: v1 });
  cache.set({ provider: 'openai', model: 'text-embedding-3-large', query: 'Q', embedding: v2 });
  assert.deepEqual(cache.get({ provider: 'openai', model: 'text-embedding-3-small', query: 'Q' }), v1);
  assert.deepEqual(cache.get({ provider: 'openai', model: 'text-embedding-3-large', query: 'Q' }), v2);
});

// ── TTL ─────────────────────────────────────────────────────────────────

test('TTL expiry evicts on next get', async () => {
  cache._clear();
  cache.configure({ ttlMs: 10 }); // 10ms
  cache.set({ provider: 'openai', query: 'ttl', embedding: [1, 2] });
  assert.deepEqual(cache.get({ provider: 'openai', query: 'ttl' }), [1, 2]);
  await new Promise(r => setTimeout(r, 25));
  assert.equal(cache.get({ provider: 'openai', query: 'ttl' }), null);
});

// ── LRU eviction ────────────────────────────────────────────────────────

test('evicts least-recently-used when full', () => {
  cache._clear();
  cache.configure({ maxEntries: 3 });
  cache.set({ provider: 'p', query: 'a', embedding: [1] });
  cache.set({ provider: 'p', query: 'b', embedding: [2] });
  cache.set({ provider: 'p', query: 'c', embedding: [3] });
  // Touch 'a' so it becomes most-recent
  assert.deepEqual(cache.get({ provider: 'p', query: 'a' }), [1]);
  // Insert a 4th — 'b' was the LRU and should evict
  cache.set({ provider: 'p', query: 'd', embedding: [4] });
  assert.equal(cache.size(), 3);
  assert.equal(cache.get({ provider: 'p', query: 'b' }), null, 'b should have evicted');
  assert.deepEqual(cache.get({ provider: 'p', query: 'a' }), [1]);
  assert.deepEqual(cache.get({ provider: 'p', query: 'c' }), [3]);
  assert.deepEqual(cache.get({ provider: 'p', query: 'd' }), [4]);
});

test('configure() shrinks immediately if capacity drops', () => {
  cache._clear();
  cache.configure({ maxEntries: 10 });
  for (let i = 0; i < 10; i++) {
    cache.set({ provider: 'p', query: `q${i}`, embedding: [i] });
  }
  assert.equal(cache.size(), 10);
  cache.configure({ maxEntries: 4 });
  assert.equal(cache.size(), 4, 'cache must evict down to new cap immediately');
});

// ── embedQuery convenience wrapper ──────────────────────────────────────

test('embedQuery: calls embedFn on miss, reuses on hit', async () => {
  cache._clear();
  let calls = 0;
  const embedFn = async () => { calls += 1; return [0.9, 0.1]; };
  const a = await cache.embedQuery({ query: 'what is selic', provider: 'openai', embedFn });
  const b = await cache.embedQuery({ query: 'what is selic', provider: 'openai', embedFn });
  assert.deepEqual(a, [0.9, 0.1]);
  assert.deepEqual(b, [0.9, 0.1]);
  assert.equal(calls, 1, 'second call should hit the cache');
});

test('embedQuery: propagates embedFn rejection', async () => {
  cache._clear();
  const embedFn = async () => { throw new Error('voyage rate limit'); };
  await assert.rejects(
    () => cache.embedQuery({ query: 'Q', provider: 'voyage', embedFn }),
    /voyage rate limit/
  );
  // Nothing cached after a failure
  assert.equal(cache.get({ provider: 'voyage', query: 'Q' }), null);
});

test('embedQuery: requires embedFn', async () => {
  cache._clear();
  await assert.rejects(
    () => cache.embedQuery({ query: 'Q', provider: 'openai' }),
    /embedFn is required/
  );
});

test('embedQuery: embedFn returning null/empty leaves nothing cached', async () => {
  cache._clear();
  const out = await cache.embedQuery({
    query: 'Q', provider: 'openai',
    embedFn: async () => null,
  });
  assert.equal(out, null);
  assert.equal(cache.get({ provider: 'openai', query: 'Q' }), null);
});

// ── Stats ───────────────────────────────────────────────────────────────

test('stats() tracks hits / misses / evictions', async () => {
  cache._clear();
  cache.configure({ maxEntries: 2 });
  cache.set({ provider: 'p', query: 'a', embedding: [1] });
  cache.set({ provider: 'p', query: 'b', embedding: [2] });
  cache.get({ provider: 'p', query: 'a' }); // hit
  cache.get({ provider: 'p', query: 'x' }); // miss
  cache.set({ provider: 'p', query: 'c', embedding: [3] }); // evicts 'b'
  const s = cache.stats();
  assert.ok(s.hits >= 1);
  assert.ok(s.misses >= 1);
  assert.ok(s.evictions >= 1);
  assert.equal(s.size, 2);
});
