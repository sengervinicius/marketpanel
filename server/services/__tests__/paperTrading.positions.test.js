/**
 * paperTrading.positions.test.js — R1.3
 *
 * Unit tests for the moving-average position math. Every behavior the
 * service depends on is asserted here; if these pass, the
 * persistence layer in services/paperTrading/index.js can rely on
 * applyFill() being correct.
 *
 * Usage: node server/services/__tests__/paperTrading.positions.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const { applyFill } = require('../paperTrading/positions');

function t(name, fn) {
  return (async () => {
    try { await fn(); console.log(`  ok — ${name}`); }
    catch (e) { console.error(`  FAIL — ${name}: ${e.message}`); process.exitCode = 1; }
  })();
}

function approx(a, b, tol = 1e-9, msg = '') {
  if (Math.abs(a - b) > tol) {
    throw new Error(`${msg} expected ${b}, got ${a} (diff ${Math.abs(a - b)})`);
  }
}

(async () => {
  console.log('paperTrading.positions — applyFill');

  // ── Case A: opening from zero ───────────────────────────────────────────
  await t('open long from zero', () => {
    const { position, fillPnL, cashDelta } = applyFill(null, {
      side: 'BUY', quantity: 100, price: 10,
    });
    assert.equal(position.quantity, 100);
    assert.equal(position.avg_cost, 10);
    assert.equal(position.realized_pnl, 0);
    assert.equal(fillPnL, 0);
    assert.equal(cashDelta, -1000);
  });

  await t('open short from zero', () => {
    const { position, fillPnL, cashDelta } = applyFill(null, {
      side: 'SELL', quantity: 50, price: 20,
    });
    assert.equal(position.quantity, -50);
    assert.equal(position.avg_cost, 20);
    assert.equal(fillPnL, 0);
    assert.equal(cashDelta, 1000); // selling short brings in cash
  });

  // ── Case A: same-direction add (averaging) ──────────────────────────────
  await t('long: buy more averages cost up correctly', () => {
    // Start: 100 @ 10. Buy 100 @ 12. Should be 200 @ 11.
    const start = { quantity: 100, avg_cost: 10, realized_pnl: 0 };
    const { position } = applyFill(start, { side: 'BUY', quantity: 100, price: 12 });
    assert.equal(position.quantity, 200);
    approx(position.avg_cost, 11);
    assert.equal(position.realized_pnl, 0);
  });

  await t('short: sell more averages short cost up correctly', () => {
    // Start: -50 @ 20. Sell 50 more @ 22. Should be -100 @ 21.
    const start = { quantity: -50, avg_cost: 20, realized_pnl: 0 };
    const { position } = applyFill(start, { side: 'SELL', quantity: 50, price: 22 });
    assert.equal(position.quantity, -100);
    approx(position.avg_cost, 21);
  });

  // ── Case B: partial close ──────────────────────────────────────────────
  await t('long: partial sell at profit', () => {
    // 100 @ 10. Sell 30 @ 15. Realized = 30 * (15 - 10) = 150.
    const start = { quantity: 100, avg_cost: 10, realized_pnl: 0 };
    const { position, fillPnL, cashDelta } = applyFill(start,
      { side: 'SELL', quantity: 30, price: 15 });
    assert.equal(position.quantity, 70);
    assert.equal(position.avg_cost, 10); // avg unchanged on remainder
    approx(position.realized_pnl, 150);
    approx(fillPnL, 150);
    assert.equal(cashDelta, 30 * 15);
  });

  await t('long: partial sell at loss', () => {
    // 100 @ 10. Sell 30 @ 8. Realized = 30 * (8 - 10) = -60.
    const start = { quantity: 100, avg_cost: 10, realized_pnl: 0 };
    const { position, fillPnL } = applyFill(start,
      { side: 'SELL', quantity: 30, price: 8 });
    approx(fillPnL, -60);
    approx(position.realized_pnl, -60);
  });

  await t('short: cover (BUY) at profit', () => {
    // -100 @ 20. Buy 30 @ 15. Profit = 30 * (15 - 20) * -1 = 150.
    const start = { quantity: -100, avg_cost: 20, realized_pnl: 0 };
    const { position, fillPnL, cashDelta } = applyFill(start,
      { side: 'BUY', quantity: 30, price: 15 });
    assert.equal(position.quantity, -70);
    assert.equal(position.avg_cost, 20);
    approx(fillPnL, 150);
    assert.equal(cashDelta, -30 * 15);
  });

  await t('long: full close zeroes out', () => {
    const start = { quantity: 100, avg_cost: 10, realized_pnl: 0 };
    const { position, fillPnL } = applyFill(start,
      { side: 'SELL', quantity: 100, price: 11 });
    assert.equal(position.quantity, 0);
    assert.equal(position.avg_cost, 0);
    approx(fillPnL, 100);
    approx(position.realized_pnl, 100);
  });

  // ── Case C: flip through zero ──────────────────────────────────────────
  await t('long flips to short', () => {
    // 50 @ 10. Sell 80 @ 12.
    //   Phase 1: close 50 @ 12 → realized = 50 * (12-10) = +100.
    //   Phase 2: open -30 @ 12. avg_cost = 12.
    const start = { quantity: 50, avg_cost: 10, realized_pnl: 0 };
    const { position, fillPnL, cashDelta } = applyFill(start,
      { side: 'SELL', quantity: 80, price: 12 });
    assert.equal(position.quantity, -30);
    approx(position.avg_cost, 12);
    approx(fillPnL, 100);
    assert.equal(cashDelta, 80 * 12); // proceeds from selling 80 units
  });

  await t('short flips to long', () => {
    // -40 @ 25. Buy 100 @ 20.
    //   Phase 1: close -40 @ 20 → realized = 40 * (20-25) * -1 = 200 profit.
    //   Phase 2: open +60 @ 20.
    const start = { quantity: -40, avg_cost: 25, realized_pnl: 0 };
    const { position, fillPnL } = applyFill(start,
      { side: 'BUY', quantity: 100, price: 20 });
    assert.equal(position.quantity, 60);
    approx(position.avg_cost, 20);
    approx(fillPnL, 200);
  });

  // ── Commissions ────────────────────────────────────────────────────────
  await t('commission reduces realized P&L on close', () => {
    const start = { quantity: 100, avg_cost: 10, realized_pnl: 0 };
    const { position, fillPnL, cashDelta } = applyFill(start,
      { side: 'SELL', quantity: 100, price: 11, commission: 5 });
    approx(fillPnL, 100 - 5);
    approx(position.realized_pnl, 95);
    assert.equal(cashDelta, 100 * 11 - 5);
  });

  await t('commission shows as fillPnL even on opens', () => {
    const { fillPnL, position } = applyFill(null,
      { side: 'BUY', quantity: 10, price: 100, commission: 1 });
    approx(fillPnL, -1);
    approx(position.realized_pnl, -1);
    assert.equal(position.avg_cost, 100); // commission does NOT inflate avg_cost
  });

  // ── Validation ─────────────────────────────────────────────────────────
  await t('rejects unknown side', () => {
    assert.throws(() => applyFill(null, { side: 'HOLD', quantity: 1, price: 1 }),
      /invalid side/);
  });

  await t('rejects zero quantity', () => {
    assert.throws(() => applyFill(null, { side: 'BUY', quantity: 0, price: 1 }),
      /quantity/);
  });

  await t('rejects negative price', () => {
    assert.throws(() => applyFill(null, { side: 'BUY', quantity: 1, price: -1 }),
      /price/);
  });

  await t('rejects non-finite quantity', () => {
    assert.throws(() => applyFill(null, { side: 'BUY', quantity: NaN, price: 1 }));
  });

  await t('rejects negative commission', () => {
    assert.throws(() => applyFill(null,
      { side: 'BUY', quantity: 1, price: 1, commission: -1 }),
      /commission/);
  });

  // ── Multi-fill chain (the real scenario) ───────────────────────────────
  await t('chain: build, partial trim, full close', () => {
    let pos = null;
    let cash = 0;
    let realized = 0;

    // Buy 100 @ 10
    let r = applyFill(pos, { side: 'BUY', quantity: 100, price: 10 });
    pos = r.position; cash += r.cashDelta; realized += r.fillPnL;

    // Buy 50 @ 12
    r = applyFill(pos, { side: 'BUY', quantity: 50, price: 12 });
    pos = r.position; cash += r.cashDelta; realized += r.fillPnL;

    // Position should be 150 @ avg = (100*10 + 50*12) / 150 = 1600/150 ≈ 10.667
    approx(pos.avg_cost, 1600 / 150);
    assert.equal(pos.quantity, 150);

    // Sell 50 @ 11 — realized = 50 * (11 - 10.667) ≈ 16.667
    r = applyFill(pos, { side: 'SELL', quantity: 50, price: 11 });
    pos = r.position; cash += r.cashDelta; realized += r.fillPnL;
    approx(pos.realized_pnl, 50 * (11 - 1600/150), 1e-6);

    // Sell remaining 100 @ 13 — realized for this fill = 100 * (13 - 10.667) ≈ 233.333
    r = applyFill(pos, { side: 'SELL', quantity: 100, price: 13 });
    pos = r.position; cash += r.cashDelta; realized += r.fillPnL;

    assert.equal(pos.quantity, 0);
    assert.equal(pos.avg_cost, 0);
    // Total realized should match: cash flow = total realized (no commission).
    approx(cash, realized, 1e-6, 'cash should equal realized when ending flat with no commissions');
  });

  console.log('done');
})();
