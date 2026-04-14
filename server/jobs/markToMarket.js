/**
 * markToMarket.js — Periodic batch re-pricing of game positions.
 *
 * DISABLED: Game functionality has been removed from the platform.
 * This file is kept for historical reference only.
 */

'use strict';

/**
 * Run mark-to-market for all users with open game positions.
 * NO-OP: Game functionality removed.
 */
async function runMarkToMarket() {
  // Game functionality has been removed — this is now a no-op
  console.log('[markToMarket] Skipped — game functionality removed');
}

/**
 * Market-hours guard: only run during NYSE hours Mon-Fri.
 * NYSE: 13:30-21:00 UTC (9:30 AM - 5:00 PM ET).
 */
function isMarketHours() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const hour = now.getUTCHours();
  const min = now.getUTCMinutes();
  const totalMin = hour * 60 + min;
  return totalMin >= 810 && totalMin <= 1260; // 13:30 to 21:00
}

function maybeRunMarkToMarket() {
  if (isMarketHours()) {
    runMarkToMarket().catch(e => console.error('[markToMarket] Error:', e.message));
  } else {
    console.log('[markToMarket] Skipped — outside NYSE hours');
  }
}

// Game functionality removed — scheduling disabled
// setTimeout(maybeRunMarkToMarket, 15_000);
// setInterval(maybeRunMarkToMarket, 5 * 60 * 1000);

module.exports = { runMarkToMarket, isMarketHours };
