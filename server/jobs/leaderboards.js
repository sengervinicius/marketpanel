/**
 * leaderboards.js — Periodic job that pre-computes leaderboard data.
 * Runs every 4 hours (and once on startup).
 * Stores results in an in-memory cache read by the leaderboard routes.
 */

const { getAllUsersWithPersona } = require('../authStore');
const { calculateLeaderboardScore } = require('../utils/leaderboardScore');

// ── In-memory leaderboard cache ─────────────────────────────────────────────
const cache = {
  global: { data: [], generatedAt: null },
  // persona:<type> entries added dynamically
  weekly: { data: [], generatedAt: null, endsAt: null },
};

/**
 * Build a leaderboard entry from a user object.
 */
function buildEntry(user) {
  const stats = user.persona?.stats || {};
  const gam = user.gamification || {};
  const score = calculateLeaderboardScore({
    ...stats,
    level: gam.level || 1,
    xp: gam.xp || 0,
  });
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
    level: gam.level || 1,
    xp: gam.xp || 0,
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

// ── Schedule: every 4 hours + immediate first run ───────────────────────────

// Run immediately on first require (after a short delay to let authStore init)
setTimeout(computeLeaderboards, 3000);

// Then every 4 hours
setInterval(computeLeaderboards, 4 * 60 * 60 * 1000);

module.exports = {
  computeLeaderboards,
  getGlobalLeaderboard,
  getPersonaLeaderboard,
  getWeeklyLeaderboard,
};
