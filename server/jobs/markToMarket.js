/**
 * markToMarket.js — Periodic batch re-pricing of all game positions.
 *
 * Runs every 5 minutes during NYSE market hours (Mon-Fri 13:30-21:00 UTC).
 * For each user with open positions, fetches live prices and updates:
 *   - position.lastPrice, marketValue, unrealizedPnl
 *   - profile equity, totalReturnPct, cashMultiple, peak/trough
 *   - appends an equity snapshot
 */

'use strict';

const { getAllUsersWithPersona } = require('../authStore');
const { getGameProfile, saveGameProfile } = require('../gameStore');
const { fetchWithFallback } = require('../routes/market/lib/providers');

/**
 * Run mark-to-market for all users with open game positions.
 */
async function runMarkToMarket() {
  const users = getAllUsersWithPersona();
  let updated = 0;

  for (const user of users) {
    const profile = getGameProfile(user.id);
    if (!profile || !profile.positions || profile.positions.length === 0) continue;

    const symbols = [...new Set(profile.positions.map(p => p.symbol))];
    // Cap at 20 symbols per user to avoid rate limits
    const symbolsToMark = symbols.slice(0, 20);

    const priceMap = {};

    // Batch in groups of 10
    const batches = [];
    for (let i = 0; i < symbolsToMark.length; i += 10) {
      batches.push(symbolsToMark.slice(i, i + 10));
    }

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async sym => {
          try {
            const result = await fetchWithFallback(sym);
            return { sym, price: result.data?.regularMarketPrice ?? null };
          } catch {
            return { sym, price: null };
          }
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.price !== null) {
          priceMap[r.value.sym] = r.value.price;
        }
      }

      // 100ms pause between batches to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Update positions with new prices
    let changed = false;
    for (const pos of profile.positions) {
      const price = priceMap[pos.symbol];
      if (price == null) continue;
      if (pos.lastPrice === price) continue;
      pos.lastPrice = price;
      pos.marketValue = pos.quantity * price;
      pos.unrealizedPnl = (price - pos.avgPrice) * pos.quantity;
      changed = true;
    }

    if (!changed) continue;

    // Recalculate profile metrics
    const totalMarketValue = profile.positions.reduce((s, p) => s + (p.marketValue || 0), 0);
    profile.equity = profile.cash + totalMarketValue;
    profile.totalReturnPct = (profile.equity - profile.startBalance) / profile.startBalance;
    profile.cashMultiple = profile.equity / profile.startBalance;
    profile.peakEquity = Math.max(profile.peakEquity, profile.equity);
    profile.troughEquity = Math.min(profile.troughEquity, profile.equity);
    profile.lastUpdatedAt = new Date().toISOString();

    // Append snapshot
    profile.snapshots.push({
      asOf: new Date().toISOString(),
      equity: profile.equity,
      totalReturnPct: profile.totalReturnPct,
    });
    if (profile.snapshots.length > 365) {
      profile.snapshots = profile.snapshots.slice(-365);
    }

    await saveGameProfile(user.id, profile);
    updated++;
  }

  console.log(`[markToMarket] Updated ${updated} user profile(s)`);
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

// 15s delay on boot so authStore + gameStore finish loading
setTimeout(maybeRunMarkToMarket, 15_000);

// Repeat every 5 minutes
setInterval(maybeRunMarkToMarket, 5 * 60 * 1000);

module.exports = { runMarkToMarket, isMarketHours };
