/**
 * priceAnomaly.test.js — #289 part 4
 * Usage: node server/services/__tests__/priceAnomaly.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const { check } = require('../priceAnomaly');

function t(name, fn) {
  return (async () => {
    try { await fn(); console.log(`  ok — ${name}`); }
    catch (e) { console.error(`  FAIL — ${name}: ${e.message}`); process.exitCode = 1; }
  })();
}

(async () => {
  console.log('priceAnomaly');

  await t('ABEV3 +15% is flagged anomalous', () => {
    const r = check('ABEV3', 15.17);
    assert.equal(r.anomalous, true);
    assert.match(r.reason, /implausible/);
  });

  await t('ABEV3.SA +15% (with suffix) flagged too', () => {
    const r = check('ABEV3.SA', 15.0);
    assert.equal(r.anomalous, true);
  });

  await t('ABEV3 -12% is flagged (works in both directions)', () => {
    const r = check('ABEV3', -12.0);
    assert.equal(r.anomalous, true);
  });

  await t('ABEV3 +5% is normal', () => {
    const r = check('ABEV3', 5.0);
    assert.equal(r.anomalous, false);
  });

  await t('ABEV3 +9.99% just below threshold — not flagged', () => {
    const r = check('ABEV3', 9.99);
    assert.equal(r.anomalous, false);
  });

  await t('ABEV3 +10.01% just above threshold — flagged', () => {
    const r = check('ABEV3', 10.01);
    assert.equal(r.anomalous, true);
  });

  await t('TSLA +20% is NOT flagged (not on the defensive whitelist)', () => {
    const r = check('TSLA', 20.0);
    assert.equal(r.anomalous, false);
  });

  await t('SPY +15% IS flagged (ETF on whitelist)', () => {
    const r = check('SPY', 15.0);
    assert.equal(r.anomalous, true);
  });

  await t('rejects bad inputs without throwing', () => {
    assert.equal(check('', 5).anomalous, false);
    assert.equal(check(null, 5).anomalous, false);
    assert.equal(check('ABEV3', NaN).anomalous, false);
    assert.equal(check('ABEV3', Infinity).anomalous, false);
  });

  await t('case insensitive', () => {
    assert.equal(check('abev3', 15).anomalous, true);
    assert.equal(check('Abev3', 15).anomalous, true);
  });

  console.log('done');
})();
