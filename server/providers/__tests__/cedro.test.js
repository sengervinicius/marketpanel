'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const cedro = require('../cedro');

test('cedro: normaliseRow maps the documented sample and derives change from price/previous', () => {
  const q = cedro.normaliseRow({ symbol: 'petr4', company: 'PETROBRAS', dateUpdate: '10-03-2025', lastTrade: 34.31, previous: 34.63, change: -0.9240508, bid: 34.31, ask: 34.32, volumeAmount: '24163900', volumeFinancier: '827150561', high: 34.6, low: 34.0, open: 34.58 });
  assert.strictEqual(q.symbol, 'PETR4');
  assert.strictEqual(q.price, 34.31);
  assert.ok(Math.abs(q.change - (-0.32)) < 1e-9);
  assert.ok(Math.abs(q.changePct - (-0.924)) < 0.01);
  assert.strictEqual(q.volume, 24163900);
  assert.strictEqual(q.asOf, '2025-03-10T03:00:00.000Z'); // DD-MM-YYYY at 00:00 -03:00
  assert.strictEqual(q.source, 'cedro');
});

test('cedro: parseCedroTime accepts ISO, DD-MM-YYYY HH:mm:ss, YYYYMMDDHHmmss, YYYYMMDD+HHmmss; rejects junk', () => {
  assert.strictEqual(cedro.parseCedroTime('2026-10-26T13:05:00-03:00'), Date.parse('2026-10-26T16:05:00Z'));
  assert.strictEqual(cedro.parseCedroTime('26-10-2026 13:05:00'), Date.parse('2026-10-26T16:05:00Z'));
  assert.strictEqual(cedro.parseCedroTime('20261026130500'), Date.parse('2026-10-26T16:05:00Z'));
  assert.strictEqual(cedro.parseCedroTime('20261026', '130500'), Date.parse('2026-10-26T16:05:00Z'));
  assert.strictEqual(cedro.parseCedroTime('garbage'), null);
  assert.strictEqual(cedro.parseCedroTime(''), null);
});

test('cedro: getQuotes without credentials reports not configured, never throws', async () => {
  const saved = [process.env.CEDRO_LOGIN, process.env.CEDRO_PASSWORD];
  delete process.env.CEDRO_LOGIN; delete process.env.CEDRO_PASSWORD;
  try {
    const r = await cedro.getQuotes(['PETR4', 'VALE3']);
    assert.strictEqual(r.received, 0);
    assert.deepStrictEqual(r.missing, ['PETR4', 'VALE3']);
    assert.match(r.failed[0].error, /CEDRO_LOGIN/);
  } finally {
    if (saved[0]) process.env.CEDRO_LOGIN = saved[0];
    if (saved[1]) process.env.CEDRO_PASSWORD = saved[1];
  }
});
