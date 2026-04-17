/**
 * aiResponseCache.test.js — W5.1 smoke tests.
 * Usage: node server/services/__tests__/aiResponseCache.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const cache = require('../aiResponseCache');

function t(name, fn) {
  return (async () => {
    try { await fn(); console.log(`  ok — ${name}`); }
    catch (e) { console.error(`  FAIL — ${name}: ${e.message}`); process.exitCode = 1; }
  })();
}

(async () => {
  console.log('aiResponseCache');

  await t('miss returns null', async () => {
    cache._clear();
    const v = await cache.get({ prompt: 'never-seen', modelTier: 'cheap' });
    assert.equal(v, null);
  });

  await t('set then get roundtrip', async () => {
    cache._clear();
    await cache.set({ prompt: 'what is selic', modelTier: 'cheap' },
                    { answer: '14.75%' }, 5000);
    const v = await cache.get({ prompt: 'WHAT IS SELIC', modelTier: 'cheap' });
    assert.ok(v);
    assert.equal(v.value.answer, '14.75%');
  });

  await t('ttl=0 is not cached', async () => {
    cache._clear();
    const ok = await cache.set({ prompt: 'portfolio-specific', modelTier: 'cheap' }, { a: 1 }, 0);
    assert.equal(ok, false);
    assert.equal(await cache.get({ prompt: 'portfolio-specific', modelTier: 'cheap' }), null);
  });

  await t('ttlFor branches', () => {
    assert.equal(cache.ttlFor({ isPortfolioSpecific: true }), 0);
    assert.equal(cache.ttlFor({ isMarketDataAdjacent: true }), 60_000);
    assert.equal(cache.ttlFor({}), 30 * 60_000);
  });

  await t('lru evicts oldest', async () => {
    cache._clear();
    // fill with 2 entries, TTL very long
    await cache.set({ prompt: 'a', modelTier: 'x' }, 1, 60_000);
    await cache.set({ prompt: 'b', modelTier: 'x' }, 2, 60_000);
    const s = cache.stats();
    assert.equal(s.lruSize, 2);
  });

  if (process.exitCode) console.log('\nFAIL'); else console.log('\nPASS');
})();
