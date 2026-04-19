/**
 * featureFlags.core-flags.test.js
 *
 * Regression guard for the "AI chat offline in prod despite migration"
 * incident. Pins the invariant that the two core kill switches must be
 * ON for anonymous traffic after a boot — because /api/search/chat is
 * unauthenticated and will 503 on anything less than (enabled=true,
 * rollout_pct=100) without a cohort match.
 *
 * If you need rollout_pct<100 for a kill switch in the future, add an
 * explicit cohort rule covering anonymous sessions instead — never
 * leave a kill switch in a shape that silently takes the feature down
 * for unauth users.
 *
 * Run:
 *   node server/services/__tests__/featureFlags.core-flags.test.js
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

const CORE_KILL_SWITCHES = ['ai_chat_enabled', 'vault_enabled'];

(async () => {
  console.log('featureFlags core-flags');

  for (const name of CORE_KILL_SWITCHES) {
    await t(`${name} @ (true, 100) is ON for anonymous`, async () => {
      flags._reset();
      flags._prime([{ name, enabled: true, rollout_pct: 100, cohort_rule: null }]);
      assert.equal(await flags.isOn(name, {}), true);
    });

    // These are the regression cases — each represents a prod DB shape
    // the old narrow-WHERE migration would have failed to correct.
    await t(`${name} @ (true, 0) would 503 anonymous chat — guard-rail`, async () => {
      flags._reset();
      flags._prime([{ name, enabled: true, rollout_pct: 0, cohort_rule: null }]);
      const on = await flags.isOn(name, {});
      assert.equal(on, false,
        'evaluator should report OFF for this shape — the migration must catch and correct it on boot');
    });

    await t(`${name} @ (true, 50) would 503 anonymous chat — guard-rail`, async () => {
      flags._reset();
      flags._prime([{ name, enabled: true, rollout_pct: 50, cohort_rule: null }]);
      assert.equal(await flags.isOn(name, {}), false);
    });

    await t(`${name} @ (false, 100) would 503 — kill switch wins`, async () => {
      flags._reset();
      flags._prime([{ name, enabled: false, rollout_pct: 100, cohort_rule: null }]);
      assert.equal(await flags.isOn(name, {}), false);
    });

    await t(`${name} row missing returns OFF (fail closed)`, async () => {
      flags._reset();
      flags._prime([]);
      assert.equal(await flags.isOn(name, {}), false);
    });
  }

  // Verify the post-migration expected shape delivers on the promise
  // for both authenticated and anonymous callers.
  await t('post-migration shape is ON for authenticated + anonymous', async () => {
    flags._reset();
    flags._prime([
      { name: 'ai_chat_enabled', enabled: true, rollout_pct: 100, cohort_rule: null },
      { name: 'vault_enabled',   enabled: true, rollout_pct: 100, cohort_rule: null },
    ]);
    assert.equal(await flags.isOn('ai_chat_enabled', {}), true);
    assert.equal(await flags.isOn('ai_chat_enabled', { userId: 42, tier: 'particle_pro' }), true);
    assert.equal(await flags.isOn('vault_enabled', {}), true);
    assert.equal(await flags.isOn('vault_enabled', { userId: 42 }), true);
  });

  if (process.exitCode) console.log('\nFAIL'); else console.log('\nPASS');
})();
