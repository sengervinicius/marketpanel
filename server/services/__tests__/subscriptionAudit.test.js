/**
 * subscriptionAudit.test.js — W2.1 lightweight smoke tests.
 *
 * Run with:  node server/services/__tests__/subscriptionAudit.test.js
 *
 * We avoid bringing in a test runner at this stage; it's a node script
 * that throws on first failure. CI will invoke it directly.
 */

'use strict';

const assert = require('node:assert/strict');
const { classifyTransition } = require('../subscriptionAudit');

function t(name, fn) {
  try { fn(); console.log(`  ok — ${name}`); }
  catch (e) { console.error(`  FAIL — ${name}: ${e.message}`); process.exitCode = 1; }
}

console.log('subscriptionAudit.classifyTransition');

t('unpaid → paid = activate', () => {
  assert.equal(
    classifyTransition(
      { isPaid: false, planTier: 'trial' },
      { isPaid: true,  planTier: 'new_particle' },
    ),
    'activate',
  );
});

t('paid → unpaid = cancel', () => {
  assert.equal(
    classifyTransition(
      { isPaid: true, planTier: 'particle_pro' },
      { isPaid: false, planTier: 'trial' },
    ),
    'cancel',
  );
});

t('pro → elite = upgrade', () => {
  assert.equal(
    classifyTransition(
      { isPaid: true, planTier: 'particle_pro' },
      { isPaid: true, planTier: 'particle_elite' },
    ),
    'upgrade',
  );
});

t('elite → new_particle = downgrade', () => {
  assert.equal(
    classifyTransition(
      { isPaid: true, planTier: 'particle_elite' },
      { isPaid: true, planTier: 'new_particle' },
    ),
    'downgrade',
  );
});

t('same state = adjust', () => {
  assert.equal(
    classifyTransition(
      { isPaid: true, planTier: 'particle_pro', stripeSubscriptionId: 'sub_1' },
      { isPaid: true, planTier: 'particle_pro', stripeSubscriptionId: 'sub_1' },
    ),
    'adjust',
  );
});

t('attaching stripe id = activate', () => {
  assert.equal(
    classifyTransition(
      { isPaid: false, planTier: 'trial', stripeSubscriptionId: null },
      { isPaid: false, planTier: 'trial', stripeSubscriptionId: 'sub_new' },
    ),
    'activate',
  );
});

if (process.exitCode) console.log('\nFAIL'); else console.log('\nPASS');
