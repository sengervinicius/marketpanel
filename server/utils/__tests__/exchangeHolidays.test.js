const { test } = require('node:test');
const assert = require('node:assert');
const h = require('../exchangeHolidays');

test('exchangeHolidays: B3 2026 movable + fixed dates', () => {
  const b3 = h.holidaysFor('B3', 2026);
  for (const d of ['2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04', '2026-11-20', '2026-12-24', '2026-12-31']) assert.ok(b3.has(d), d);
  assert.ok(!b3.has('2026-10-26'), 'Monday after the runoff is a trading day');
  assert.ok(!b3.has('2026-10-23'));
});

test('exchangeHolidays: NYSE 2026 observed rules', () => {
  const us = h.holidaysFor('US', 2026);
  assert.ok(us.has('2026-07-03'), 'Jul 4 2026 is a Saturday → observed Friday');
  assert.ok(us.has('2026-11-26'), 'Thanksgiving 4th Thu');
  assert.ok(us.has('2026-01-19'), 'MLK');
  assert.ok(!us.has('2026-11-20'), 'Consciência Negra is not a US holiday');
});

test('exchangeHolidays: unknown group has no holidays', () => {
  assert.strictEqual(h.isHoliday('CRYPTO', '2026-12-25'), false);
});
