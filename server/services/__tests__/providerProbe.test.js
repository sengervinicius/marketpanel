const { test } = require('node:test');
const assert = require('node:assert');
const { PROVIDERS, _toMs } = require('../providerProbe');

test('providerProbe: toMs normalises seconds, ms and ISO; never substitutes now', () => {
  assert.strictEqual(_toMs(1_761_500_000), 1_761_500_000_000);
  assert.strictEqual(_toMs(1_761_500_000_000), 1_761_500_000_000);
  assert.strictEqual(_toMs('2026-10-24T20:00:00Z'), Date.parse('2026-10-24T20:00:00Z'));
  assert.strictEqual(_toMs(null), null);
  assert.strictEqual(_toMs('garbage'), null);
});

test('providerProbe: every provider declares role, symbol and a configured() guard', () => {
  assert.ok(PROVIDERS.length >= 15);
  for (const p of PROVIDERS) {
    assert.ok(p.name && p.role && p.symbol, p.name);
    assert.strictEqual(typeof p.configured, 'function', p.name);
    assert.ok(p.probe === null || typeof p.probe === 'function', p.name);
  }
  // Billable / hard-capped providers must never be probed automatically.
  for (const n of ['alpha_vantage', 'anthropic', 'perplexity', 'tavily']) {
    assert.strictEqual(PROVIDERS.find(p => p.name === n).probe, null, n);
  }
});

test('providerProbe: core home-screen providers are present', () => {
  for (const n of ['yahoo', 'yahoo_brazil', 'brapi', 'fred', 'bcb_sgs', 'ptax', 'coingecko']) {
    assert.ok(PROVIDERS.some(p => p.name === n), n);
  }
});
