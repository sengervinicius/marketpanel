/**
 * stores/missionStore.js
 * In-memory mission state per user. Generates default missions from the catalog,
 * tracks progress, handles daily/weekly resets, and claim logic.
 */

const { MISSION_CATALOG, STREAK_MILESTONES } = require('../config/missions');
const { getUserById, addXp, updateUser } = require('../authStore');

// userId → { missions: Map<missionId, missionState>, lastDailyReset, lastWeeklyReset }
const userMissions = new Map();

/** Get start-of-day (UTC midnight) for a given timestamp */
function startOfDayUTC(ts) {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** Get start of ISO week (Monday UTC midnight) */
function startOfWeekUTC(ts) {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  d.setUTCDate(d.getUTCDate() - diff);
  return d.getTime();
}

/** Build a fresh mission state object from a catalog entry */
function buildMissionState(template, now) {
  const state = {
    id: template.id,
    kind: template.kind,
    title: template.title,
    description: template.description,
    xpReward: template.xpReward,
    personaType: template.personaType || null,
    progress: { current: 0, target: template.target },
    status: 'active', // 'active' | 'completed' | 'claimed' | 'expired'
  };
  if (template.kind === 'daily') {
    state.expiresAt = new Date(startOfDayUTC(now) + 24 * 60 * 60 * 1000).toISOString();
  } else if (template.kind === 'weekly') {
    state.expiresAt = new Date(startOfWeekUTC(now) + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  return state;
}

/** Get or initialize mission data for a user */
function getUserMissionData(userId) {
  if (!userMissions.has(userId)) {
    const now = Date.now();
    const user = getUserById(userId);
    const personaType = user?.persona?.type || null;
    const missions = new Map();

    for (const template of MISSION_CATALOG) {
      // Skip persona-specific quests that don't match the user's persona
      if (template.personaType && template.personaType !== personaType) continue;
      missions.set(template.id, buildMissionState(template, now));
    }

    userMissions.set(userId, {
      missions,
      lastDailyReset: startOfDayUTC(now),
      lastWeeklyReset: startOfWeekUTC(now),
    });
  }
  return userMissions.get(userId);
}

/** Reset expired daily missions */
function resetDailyIfNeeded(data) {
  const now = Date.now();
  const today = startOfDayUTC(now);
  if (data.lastDailyReset >= today) return;

  data.lastDailyReset = today;
  for (const [id, mission] of data.missions) {
    if (mission.kind !== 'daily') continue;
    // Reset unless already claimed today
    const template = MISSION_CATALOG.find(t => t.id === id);
    if (!template) continue;
    data.missions.set(id, buildMissionState(template, now));
  }
}

/** Reset expired weekly missions */
function resetWeeklyIfNeeded(data) {
  const now = Date.now();
  const thisWeek = startOfWeekUTC(now);
  if (data.lastWeeklyReset >= thisWeek) return;

  data.lastWeeklyReset = thisWeek;
  for (const [id, mission] of data.missions) {
    if (mission.kind !== 'weekly') continue;
    const template = MISSION_CATALOG.find(t => t.id === id);
    if (!template) continue;
    data.missions.set(id, buildMissionState(template, now));
  }
}

/** Ensure daily and weekly missions are fresh */
function ensureFresh(userId) {
  const data = getUserMissionData(userId);
  resetDailyIfNeeded(data);
  resetWeeklyIfNeeded(data);
  return data;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get all missions for a user (with auto-reset of expired ones).
 * Returns an array of mission state objects.
 */
function getMissionsForUser(userId) {
  const data = ensureFresh(userId);
  return Array.from(data.missions.values());
}

/**
 * Update mission progress by delta. Auto-completes when current >= target.
 * Returns the updated mission state or null if not found/not active.
 */
function updateMissionProgress(userId, missionId, delta = 1) {
  const data = ensureFresh(userId);
  const mission = data.missions.get(missionId);
  if (!mission || mission.status !== 'active') return null;

  mission.progress.current = Math.min(
    mission.progress.current + delta,
    mission.progress.target
  );

  if (mission.progress.current >= mission.progress.target) {
    mission.status = 'completed';
  }

  return mission;
}

/**
 * Claim a completed mission: grants XP and marks as claimed.
 * Returns { mission, gamification } or throws if invalid.
 */
async function claimMission(userId, missionId) {
  const data = ensureFresh(userId);
  const mission = data.missions.get(missionId);
  if (!mission) throw new Error('Mission not found');
  if (mission.status !== 'completed') throw new Error('Mission not claimable');

  mission.status = 'claimed';
  const gamification = await addXp(userId, mission.xpReward);
  return { mission, gamification };
}

// ── Login streak logic ──────────────────────────────────────────────────────

/**
 * Update login streak for a user. Call on successful login.
 * Returns { streak, milestoneReached } where milestoneReached is a
 * STREAK_MILESTONES entry or null.
 */
async function updateLoginStreak(userId) {
  const user = getUserById(userId);
  if (!user) return { streak: 0, milestoneReached: null };

  const now = Date.now();
  const today = startOfDayUTC(now);
  const lastLogin = user.lastLoginAt ? startOfDayUTC(new Date(user.lastLoginAt).getTime()) : null;
  const yesterday = today - 24 * 60 * 60 * 1000;

  let streak = user.loginStreak || 0;

  if (lastLogin === today) {
    // Already logged in today — no change
  } else if (lastLogin === yesterday) {
    streak += 1;
  } else {
    streak = 1;
  }

  user.loginStreak = streak;
  user.lastLoginAt = new Date(now).toISOString();
  await updateUser(userId, { loginStreak: streak, lastLoginAt: user.lastLoginAt });

  // Check milestone
  const milestoneReached = STREAK_MILESTONES.find(m => m.days === streak) || null;
  if (milestoneReached) {
    await addXp(userId, milestoneReached.xp);
  }

  // Also mark the daily-login mission as complete
  const data = ensureFresh(userId);
  const loginMission = data.missions.get('daily-login');
  if (loginMission && loginMission.status === 'active') {
    loginMission.progress.current = 1;
    loginMission.status = 'completed';
  }

  return { streak, milestoneReached };
}

/**
 * Get current streak info for a user.
 */
function getStreakInfo(userId) {
  const user = getUserById(userId);
  if (!user) return { current: 0, lastLoginAt: null };
  return {
    current: user.loginStreak || 0,
    lastLoginAt: user.lastLoginAt || null,
  };
}

module.exports = {
  getMissionsForUser,
  updateMissionProgress,
  claimMission,
  updateLoginStreak,
  getStreakInfo,
};
