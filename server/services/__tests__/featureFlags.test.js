/**
 * featureFlags.test.js — W6.1 smoke tests.
 * Usage: node server/services/__tests__/featureFlags.test.js
 *
 * These tests exercise the pure evaluation logic via _prime() so they
 * don't require a live Postgres connection.
 */
'use strict';

const assert = require('node:assert/strict');
const flags = require('../featureFlags');

function t(name, fn) {
  return (async () => {
    try { await fn(); console.log(`  ok — ${name}`); }
    catch (e) { console.error(`  FAIL — ${name}: ${e.message}`); process.exitCode = 1; }
  })();
}

(async () => {
  console.log('featureFlags');

  await t('unknown flag is OFF (fail closed)', async () => {
    flags._reset(); flags._prime([]);
    assert.equal(await flags.isOn('does_not_exist', { userId: 1 }), false);
  });

  await t('kill switch wins over rollout_pct=100', async () => {
    flags._reset();
    flags._prime([{ name: 'x', enabled: false, rollout_pct: 100, cohort_rule: null }]);
    assert.equal(await flags.isOn('x', { userId: 1 }), false);
    assert.equal(await flags.isOn('x', { userId: 2 }), false);
  });

  await t('rollout_pct=100 is ON for everyone with a userId', async () => {
    flags._reset();
    flags._prime([{ name: 'x', enabled: true, rollout_pct: 100, cohort_rule: null }]);
    assert.equal(await flags.isOn('x', { userId: 1 }), true);
    assert.equal(await flags.isOn('x', { userId: 999 }), true);
  });

  await t('rollout_pct=0 is OFF unless cohort matches', async () => {
    flags._reset();
    flags._prime([{ name: 'x', enabled: true, rollout_pct: 0, cohort_rule: null }]);
    assert.equal(await flags.isOn('x', { userId: 1 }), false);
  });

  await t('anonymous users cannot be bucketed', async () => {
    flags._reset();
    flags._prime([{ name: 'x', enabled: true, rollout_pct: 50, cohort_rule: null }]);
    assert.equal(await flags.isOn('x', {}), false);
  });

  await t('tier cohort rule matches', async () => {
    flags._reset();
    flags._prime([{
      name: 'x', enabled: true, rollout_pct: 0,
      cohort_rule: { tiers: ['particle_elite'] },
    }]);
    assert.equal(await flags.isOn('x', { userId: 1, tier: 'particle_elite' }), true);
    assert.equal(await flags.isOn('x', { userId: 1, tier: 'particle_pro' }), false);
  });

  await t('userIds cohort rule matches', async () => {
    flags._reset();
    flags._prime([{
      name: 'x', enabled: true, rollout_pct: 0,
      cohort_rule: { userIds: [42, 99] },
    }]);
    assert.equal(await flags.isOn('x', { userId: 42 }), true);
    assert.equal(await flags.isOn('x', { userId: '99' }), true);
    assert.equal(await flags.isOn('x', { userId: 1 }), false);
  });

  await t('email domain cohort rule matches (case-insensitive)', async () => {
    flags._reset();
    flags._prime([{
      name: 'x', enabled: true, rollout_pct: 0,
      cohort_rule: { emailDomains: ['arccapital.com.br'] },
    }]);
    assert.equal(await flags.isOn('x', { userId: 1, email: 'vinicius@ARCCAPITAL.COM.BR' }), true);
    assert.equal(await flags.isOn('x', { userId: 1, email: 'v@gmail.com' }), false);
  });

  await t('rollout bucket is deterministic per (user, flag)', async () => {
    flags._reset();
    // a user bucketed at rollout=10 should stay bucketed at rollout=25 or 50 etc.
    const b1 = flags._hashBucket(7, 'some_flag');
    const b2 = flags._hashBucket(7, 'some_flag');
    assert.equal(b1, b2);
    // different users get different buckets (most of the time)
    const bs = new Set();
    for (let i = 1; i <= 100; i++) bs.add(flags._hashBucket(i, 'some_flag'));
    assert.ok(bs.size > 50, `expected bucket spread >50, got ${bs.size}`);
  });

  await t('rollout_pct=10 contains rollout_pct=5 cohort', async () => {
    flags._reset();
    flags._prime([{ name: 'x', enabled: true, rollout_pct: 5, cohort_rule: null }]);
    const onAt5 = new Set();
    for (let i = 1; i <= 500; i++) if (await flags.isOn('x', { userId: i })) onAt5.add(i);

    flags._reset();
    flags._prime([{ name: 'x', enabled: true, rollout_pct: 10, cohort_rule: null }]);
    for (const id of onAt5) {
      assert.equal(await flags.isOn('x', { userId: id }), true,
        `user ${id} was ON at 5% but OFF at 10% — bucketing is not monotonic`);
    }
  });

  await t('evaluateAll returns a map of names → booleans', async () => {
    flags._reset();
    flags._prime([
      { name: 'a', enabled: true,  rollout_pct: 100, cohort_rule: null },
      { name: 'b', enabled: false, rollout_pct: 100, cohort_rule: null },
    ]);
    const r = await flags.evaluateAll({ userId: 1 });
    assert.equal(r.a, true);
    assert.equal(r.b, false);
  });

  if (process.exitCode) console.log('\nFAIL'); else console.log('\nPASS');
})();
