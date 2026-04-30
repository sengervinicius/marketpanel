/**
 * services/paperTrading/positions.js — R1.3
 *
 * Pure-function moving-average position math. Takes a current position
 * row and a fill, returns the new position row plus the realized P&L
 * attributable to that fill. No DB writes here — the caller (index.js)
 * is responsible for persistence and atomicity.
 *
 * Sign convention
 * ===============
 *   - Position quantity is signed: positive = long, negative = short.
 *   - Fill side is 'BUY' or 'SELL'; quantity is always positive.
 *   - A BUY adds +qty to the position. A SELL subtracts -qty.
 *   - Crossing through zero (e.g. closing a short and going long in
 *     the same fill) is handled in two phases: first close the open
 *     side with realized P&L, then open the new side at the fill price.
 *
 * Cost-basis method: moving-average
 * =================================
 * On any fill in the SAME direction as the existing position:
 *   new_avg_cost = (|old_qty| * old_avg + fill_qty * fill_price) /
 *                  (|old_qty| + fill_qty)
 *
 * On a fill in the OPPOSITE direction (a partial close):
 *   - avg_cost stays the same on the remainder
 *   - realized_pnl += closed_qty * (fill_price - old_avg) * sign
 *     where sign = +1 if old position was long, -1 if short.
 *
 * On a fill that flips through zero:
 *   - First, fully close the existing leg (realized P&L on old qty).
 *   - Then, open the new leg at the fill price with avg_cost = price.
 *
 * Commission is subtracted from realized_pnl on the fill, regardless of
 * whether the fill opens or closes. This matches every retail tax-lot
 * convention I've seen — commissions are a pure cost.
 */

'use strict';

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

// Normalize -0 → 0. Object.is(-0, 0) is false, which trips assert.equal
// and tests that compare cash deltas. Matters arithmetically only at the
// IEEE-754 level, never financially.
function nz(n) {
  return n === 0 ? 0 : n;
}

function assertFill(fill) {
  if (!fill || typeof fill !== 'object') throw new Error('paperTrading: fill missing');
  if (fill.side !== 'BUY' && fill.side !== 'SELL') {
    throw new Error(`paperTrading: invalid side ${fill.side}`);
  }
  if (!isFiniteNumber(fill.quantity) || fill.quantity <= 0) {
    throw new Error('paperTrading: fill.quantity must be > 0');
  }
  if (!isFiniteNumber(fill.price) || fill.price <= 0) {
    throw new Error('paperTrading: fill.price must be > 0');
  }
  if (fill.commission != null && (!isFiniteNumber(fill.commission) || fill.commission < 0)) {
    throw new Error('paperTrading: fill.commission must be >= 0 if present');
  }
}

/**
 * Apply a fill to a current position.
 *
 * @param {object|null} position — current { quantity, avg_cost, realized_pnl }
 *   or null if no position exists yet on this symbol.
 * @param {object} fill — { side: 'BUY'|'SELL', quantity, price, commission? }
 * @returns {{
 *   position: { quantity, avg_cost, realized_pnl },
 *   fillPnL: number,
 *   cashDelta: number,  // signed cash change to apply to the portfolio
 * }}
 */
function applyFill(position, fill) {
  assertFill(fill);
  const commission = isFiniteNumber(fill.commission) ? fill.commission : 0;
  const fillSign = fill.side === 'BUY' ? 1 : -1;
  const fillSignedQty = fillSign * fill.quantity;

  const oldQty = position?.quantity != null ? Number(position.quantity) : 0;
  const oldAvg = position?.avg_cost != null ? Number(position.avg_cost) : 0;
  const oldRealized = position?.realized_pnl != null ? Number(position.realized_pnl) : 0;

  // Cash delta: a BUY costs cash, a SELL frees cash; commission always
  // costs cash. Note that for a short SELL the proceeds still increase
  // cash on the books; the matching liability lives in the negative
  // position quantity.
  const cashDelta = -fillSignedQty * fill.price - commission;

  let newQty = oldQty + fillSignedQty;
  let newAvg = oldAvg;
  let fillPnL = 0;

  // Case A: same-direction add (or new position from zero).
  // - Includes oldQty === 0 (opening fresh).
  // - Includes long buying more, or short selling more.
  if (oldQty === 0 || Math.sign(oldQty) === Math.sign(fillSignedQty)) {
    const absOld = Math.abs(oldQty);
    const absFill = fill.quantity;
    const totalAbs = absOld + absFill;
    newAvg = totalAbs > 0
      ? ((absOld * oldAvg) + (absFill * fill.price)) / totalAbs
      : 0;
    // No realized P&L on adds. Commission is still a cost.
    fillPnL = -commission;
  }
  // Case B: opposite-direction fill smaller-or-equal to the position.
  // We close `min(|fill|, |old|)` units. avg stays put on the remainder.
  else if (Math.abs(fillSignedQty) <= Math.abs(oldQty)) {
    const closedQty = Math.abs(fillSignedQty);
    const oldSign = Math.sign(oldQty);
    // (close price - cost) * sign; long: SELL above cost is profit,
    // short: BUY below cost is profit.
    fillPnL = closedQty * (fill.price - oldAvg) * oldSign - commission;
    if (newQty === 0) newAvg = 0; // tidy zeroed-out books
  }
  // Case C: opposite-direction fill that flips through zero.
  // Phase 1: close the existing leg fully (realized at oldAvg).
  // Phase 2: open the residual at the fill price.
  else {
    const closedQty = Math.abs(oldQty);
    const oldSign = Math.sign(oldQty);
    fillPnL = closedQty * (fill.price - oldAvg) * oldSign - commission;
    // The new leg opens at the fill price.
    newAvg = fill.price;
    // newQty already correct from oldQty + fillSignedQty above.
  }

  const newRealized = oldRealized + fillPnL;

  return {
    position: {
      quantity: nz(newQty),
      avg_cost: newQty === 0 ? 0 : nz(newAvg),
      realized_pnl: nz(newRealized),
    },
    fillPnL: nz(fillPnL),
    cashDelta: nz(cashDelta),
  };
}

module.exports = { applyFill };
