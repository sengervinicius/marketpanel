/**
 * leaderboards.js — Periodic job that pre-computes leaderboard data.
 * Runs every 4 hours (and once on startup).
 * Stores results in an in-memory cache read by the leaderboard routes.
 */

const { getAllUsersWithPersona } = require('../authStore');
const { calculateLeaderboardScore } = require('../utils/leaderboardScore');
const { getAllGameProfiles } = require('../gameStore');

// ── In-memory leaderboard cache ─────────────────────────────────────────────
const cache = {
  global: { data: [], generatedAt: null },
  // persona:<type> entries added dynamically
  weekly: { data: [], generatedAt: null, endsAt: null },
};

// ── Game leaderboard cache ──────────────────────────────────────────────────
const gameLeaderboards = {
  global:    { data: [], generatedAt: null },
  weekly:    { data: [], generatedAt: null, endsAt: null },
  monthly:   { data: [], generatedAt: null, endsAt: null },
  quarterly: { data: [], generatedAt: null, endsAt: null },
  annual:    { data: [], generatedAt: null, endsAt: null },
};

/**
 * Build a leaderboard entry from a user object.
 */
function buildEntry(user) {
  const stats = user.persona?.stats || {};
  const score = calculateLeaderboardScore(stats);
  return {
    userId: user.id,
    username: user.username,
    personaType: user.persona?.type || null,
    stats: {
      totalReturn: stats.totalReturn ?? 0,
      sharpeRatio: stats.sharpeRatio ?? 0,
      winRate: stats.winRate ?? 0,
      bestMonth: stats.bestMonth ?? 0,
      worstMonth: stats.worstMonth ?? 0,
      weeklyReturn: stats.weeklyReturn ?? 0,
    },
    level: 1,
    xp: 0,
    score,
  };
}

/**
 * Compute the Sunday 23:59:59 UTC of the current week.
 */
function nextSundayEnd() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + daysUntilSunday);
  end.setUTCHours(23, 59, 59, 0);
  return end;
}

/**
 * Run the leaderboard computation.
 */
function computeLeaderboards() {
  try {
    const users = getAllUsersWithPersona();
    const now = new Date().toISOString();
    const entries = users.map(buildEntry);

    // ── Global leaderboard ────────────────────────────────────────────────
    const globalSorted = [...entries].sort((a, b) => b.score - a.score);
    cache.global = { data: globalSorted, generatedAt: now };

    // ── Persona leaderboards ──────────────────────────────────────────────
    const byPersona = {};
    for (const e of entries) {
      if (!e.personaType) continue;
      if (!byPersona[e.personaType]) byPersona[e.personaType] = [];
      byPersona[e.personaType].push(e);
    }
    for (const [type, arr] of Object.entries(byPersona)) {
      arr.sort((a, b) => b.score - a.score);
      cache[`persona:${type}`] = { data: arr, generatedAt: now };
    }

    // ── Weekly competition (best 7-day return) ────────────────────────────
    const weeklySorted = [...entries].sort(
      (a, b) => (b.stats.weeklyReturn ?? 0) - (a.stats.weeklyReturn ?? 0)
    );
    cache.weekly = {
      data: weeklySorted,
      generatedAt: now,
      endsAt: nextSundayEnd().toISOString(),
    };

    console.log(
      `[leaderboards] Computed: ${globalSorted.length} users, ` +
      `${Object.keys(byPersona).length} persona boards, weekly top=${weeklySorted[0]?.stats.weeklyReturn ?? 0}%`
    );
  } catch (e) {
    console.error('[leaderboards] Compute failed:', e);
  }
}

// ── Getters for the route layer ─────────────────────────────────────────────

function getGlobalLeaderboard() {
  return cache.global;
}

function getPersonaLeaderboard(type) {
  return cache[`persona:${type}`] || { data: [], generatedAt: null };
}

function getWeeklyLeaderboard() {
  return cache.weekly;
}

// ── Game leaderboard computation ────────────────────────────────────────────

/**
 * Compute periodic return from snapshots over a given number of days.
 */
function computePeriodicReturn(snapshots, days) {
  if (!snapshots || snapshots.length < 2) return 0;
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  // Find the latest snapshot at or before the cutoff
  const candidates = snapshots.filter(s => new Date(s.asOf).getTime() <= cutoff);
  const baseline = candidates.length > 0 ? candidates[candidates.length - 1] : null;
  if (!baseline || baseline.equity === 0) return 0;

  const latest = snapshots[snapshots.length - 1];
  if (!latest) return 0;

  return (latest.equity - baseline.equity) / baseline.equity;
}

/**
 * Build a game leaderboard entry from user + gameProfile.
 */
function buildGameEntry(user, gp) {
  const weeklyReturn = computePeriodicReturn(gp.snapshots, 7);
  const monthlyReturn = computePeriodicReturn(gp.snapshots, 30);
  const quarterlyReturn = computePeriodicReturn(gp.snapshots, 90);
  const annualReturn = computePeriodicReturn(gp.snapshots, 365);

  return {
    userId: user.id,
    username: user.username,
    personaType: user.persona?.type ?? null,
    avatarKey: user.persona?.avatarKey ?? null,
    equity: gp.equity,
    totalReturnPct: gp.totalReturnPct,
    cashMultiple: gp.cashMultiple,
    weeklyReturn,
    monthlyReturn,
    quarterlyReturn,
    annualReturn,
  };
}

/**
 * Get period end dates for game leaderboards.
 */
function getMonthEnd() {
  const now = new Date();
  return new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59);
}
function getQuarterEnd() {
  const now = new Date();
  const qMonth = Math.ceil((now.getUTCMonth() + 1) / 3) * 3;
  return new Date(now.getUTCFullYear(), qMonth, 0, 23, 59, 59);
}
function getYearEnd() {
  const now = new Date();
  return new Date(now.getUTCFullYear(), 11, 31, 23, 59, 59);
}

/**
 * Compute game leaderboards (runs alongside existing leaderboard computation).
 */
function computeGameLeaderboards() {
  try {
    const users = getAllUsersWithPersona();
    const profiles = getAllGameProfiles();
    const profileMap = new Map(profiles.map(p => [p.userId, p]));
    const now = new Date().toISOString();

    const entries = [];
    for (const user of users) {
      const gp = profileMap.get(user.id);
      if (!gp) continue;
      entries.push(buildGameEntry(user, gp));
    }

    // Global: by total return %
    gameLeaderboards.global = {
      data: [...entries].sort((a, b) => b.totalReturnPct - a.totalReturnPct),
      generatedAt: now,
    };

    // Weekly
    gameLeaderboards.weekly = {
      data: [...entries].sort((a, b) => b.weeklyReturn - a.weeklyReturn),
      generatedAt: now,
      endsAt: nextSundayEnd().toISOString(),
    };

    // Monthly
    gameLeaderboards.monthly = {
      data: [...entries].sort((a, b) => b.monthlyReturn - a.monthlyReturn),
      generatedAt: now,
      endsAt: getMonthEnd().toISOString(),
    };

    // Quarterly
    gameLeaderboards.quarterly = {
      data: [...entries].sort((a, b) => b.quarterlyReturn - a.quarterlyReturn),
      generatedAt: now,
      endsAt: getQuarterEnd().toISOString(),
    };

    // Annual
    gameLeaderboards.annual = {
      data: [...entries].sort((a, b) => b.annualReturn - a.annualReturn),
      generatedAt: now,
      endsAt: getYearEnd().toISOString(),
    };

    console.log(
      `[leaderboards] Game boards computed: ${entries.length} players, ` +
      `top return=${(gameLeaderboards.global.data[0]?.totalReturnPct ?? 0 * 100).toFixed(2)}%`
    );
  } catch (e) {
    console.error('[leaderboards] Game compute failed:', e);
  }
}

function getGameLeaderboard(period) {
  return gameLeaderboards[period] ?? { data: [], generatedAt: null };
}

// NOTE: Scheduling is now managed by jobs/index.js (node-cron).
// Do NOT add setInterval/setTimeout here — the central scheduler handles cadence.

module.exports = {
  computeLeaderboards,
  computeGameLeaderboards,
  getGlobalLeaderboard,
  getPersonaLeaderboard,
  getWeeklyLeaderboard,
  getGameLeaderboard,
};
