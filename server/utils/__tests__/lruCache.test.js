/**
 * lruCache.test.js — #243 / P2.1
 *
 *   node server/utils/__tests__/lruCache.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const LruCache = require('../lruCache');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok  — ${name}`); pass++; }
  catch (e) { console.error(`  FAIL— ${name}: ${e.message}`); fail++; }
}

console.log('LruCache — construction guards');
t('rejects non-positive max', () => {
  assert.throws(() => new LruCache({ max: 0 }), /`max`/);
  assert.throws(() => new LruCache({ max: -1 }), /`max`/);
  assert.throws(() => new LruCache({ max: 1.5 }), /`max`/);
});
t('rejects non-positive ttl', () => {
  assert.throws(() => new LruCache({ max: 10, ttl: 0 }), /`ttl`/);
  assert.throws(() => new LruCache({ max: 10, ttl: -1 }), /`ttl`/);
});

console.log('\nLruCache — basic get/set');
t('set then get returns the value', () => {
  const c = new LruCache({ max: 3, ttl: 60_000 });
  c.set('a', 1);
  assert.equal(c.get('a'), 1);
});
t('missing key returns undefined', () => {
  const c = new LruCache({ max: 3, ttl: 60_000 });
  assert.equal(c.get('missing'), undefined);
});
t('has() is truthy for a fresh entry', () => {
  const c = new LruCache({ max: 3, ttl: 60_000 });
  c.set('a', 1);
  assert.equal(c.has('a'), true);
});
t('delete removes the entry', () => {
  const c = new LruCache({ max: 3, ttl: 60_000 });
  c.set('a', 1);
  assert.equal(c.delete('a'), true);
  assert.equal(c.get('a'), undefined);
});

console.log('\nLruCache — max-size eviction');
t('evicts oldest when over capacity', () => {
  const c = new LruCache({ max: 2, ttl: 60_000 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3); // should evict 'a'
  assert.equal(c.size, 2);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.get('b'), 2);
  assert.equal(c.get('c'), 3);
});
t('get() touches entry to most-recent', () => {
  const c = new LruCache({ max: 2, ttl: 60_000 });
  c.set('a', 1);
  c.set('b', 2);
  c.get('a'); // 'a' is now MRU
  c.set('c', 3); // should evict 'b' (oldest), NOT 'a'
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('c'), 3);
});
t('heavy load above max keeps size bounded', () => {
  const c = new LruCache({ max: 50, ttl: 60_000 });
  for (let i = 0; i < 500; i++) c.set(`k${i}`, i);
  assert.equal(c.size, 50);
});
t('set on existing key does not inflate size', () => {
  const c = new LruCache({ max: 3, ttl: 60_000 });
  c.set('a', 1);
  c.set('a', 2);
  c.set('a', 3);
  assert.equal(c.size, 1);
  assert.equal(c.get('a'), 3);
});

console.log('\nLruCache — TTL expiry');
t('expired entry returns undefined', () => {
  const c = new LruCache({ max: 3, ttl: 1 }); // 1 ms
  c.set('a', 1);
  // Busy-wait 5 ms so the entry is certainly expired.
  const end = Date.now() + 5;
  while (Date.now() < end) { /* spin */ }
  assert.equal(c.get('a'), undefined);
});
t('expired entry is deleted on get (lazy eviction)', () => {
  const c = new LruCache({ max: 3, ttl: 1 });
  c.set('a', 1);
  const end = Date.now() + 5;
  while (Date.now() < end) { /* spin */ }
  c.get('a'); // triggers lazy delete
  assert.equal(c.size, 0);
});
t('per-entry ttl override takes precedence', () => {
  const c = new LruCache({ max: 3, ttl: 1 });
  c.set('a', 1, 60_000); // override to 60s
  const end = Date.now() + 5;
  while (Date.now() < end) { /* spin */ }
  assert.equal(c.get('a'), 1);
});
t('peekFresh does not promote LRU order', () => {
  const c = new LruCache({ max: 2, ttl: 60_000 });
  c.set('a', 1);
  c.set('b', 2);
  c.peekFresh('a'); // should NOT bump 'a' to MRU
  c.set('c', 3); // should still evict 'a' (oldest)
  assert.equal(c.get('a'), undefined);
  assert.equal(c.get('b'), 2);
});

console.log('\nLruCache — semantics vs. the ad-hoc Map it replaced');
t('D4.1 regression — 51+ live entries no longer grow unbounded', () => {
  // This is exactly the scenario the audit flagged: the old Map only
  // evicted EXPIRED entries when size > 50. With 51+ *fresh* entries
  // and a 10-minute TTL, the sweep was a no-op and the Map grew.
  const c = new LruCache({ max: 50, ttl: 10 * 60_000 });
  for (let i = 0; i < 200; i++) c.set(`k${i}`, { v: i });
  assert.equal(c.size, 50);
  assert.equal(c.get('k0'), undefined, 'earliest entries must be evicted');
  assert.equal(c.get('k199')?.v, 199, 'latest entry must survive');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('lruCache: all assertions passed.');
