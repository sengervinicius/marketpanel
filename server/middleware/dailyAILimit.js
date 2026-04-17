/**
 * middleware/dailyAILimit.js — Per-user daily AI query counter.
 *
 * Enforces the aiQueriesPerDay limit from tiers.js.
 * Uses an in-memory Map with automatic midnight reset.
 * Attaches X-AI-Queries-Used / X-AI-Queries-Limit headers.
 *
 * Usage:
 *   const { dailyAILimit } = require('../middleware/dailyAILimit');
 *   router.post('/chat', dailyAILimit, async (req, res) => { ... });
 */

'use strict';

const { getTier, isUnlimited } = require('../config/tiers');

// Map<userId, { count: number, resetAt: number }>
const _usage = new Map();

// Hard cap to prevent memory exhaustion (evict oldest entries beyond this)
const MAX_TRACKED_USERS = 50000;

/**
 * Get midnight (UTC) of the next day from a given timestamp.
 */
function nextMidnightUTC(now) {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

/**
 * Get or initialize the usage record for a user.
 */
function getUsage(userId) {
  const now = Date.now();
  let rec = _usage.get(userId);

  if (!rec || now >= rec.resetAt) {
    // New day or first request — reset counter
    rec = { count: 0, resetAt: nextMidnightUTC(now) };
    _usage.set(userId, rec);
  }

  return rec;
}

/**
 * Periodic cleanup: remove expired entries every 10 minutes.
 */
setInterval(() => {
  const now = Date.now();
  for (const [uid, rec] of _usage) {
    if (now >= rec.resetAt) _usage.delete(uid);
  }
}, 10 * 60 * 1000).unref();

/**
 * Emergency eviction if map grows too large.
 */
function evictIfNeeded() {
  if (_usage.size <= MAX_TRACKED_USERS) return;
  // Delete oldest entries (first inserted)
  const excess = _usage.size - MAX_TRACKED_USERS;
  let i = 0;
  for (const key of _usage.keys()) {
    if (i >= excess) break;
    _usage.delete(key);
    i++;
  }
}

/**
 * Express middleware: enforce per-user daily AI query limit.
 *
 * Requires req.user.id and req.user.planTier (set by requireAuth + requireActiveSubscription).
 */
function dailyAILimit(req, res, next) {
  const userId = req.user?.id;
  if (!userId) {
    // If auth middleware hasn't run, skip (shouldn't happen in practice)
    return next();
  }

  const tierKey = req.user.planTier || 'trial';
  const tier = getTier(tierKey);
  const limit = tier.aiQueriesPerDay;

  // Unlimited tier — no enforcement
  if (isUnlimited(limit)) {
    res.setHeader('X-AI-Queries-Limit', 'unlimited');
    return next();
  }

  const usage = getUsage(userId);

  // Set informational headers
  res.setHeader('X-AI-Queries-Used', usage.count);
  res.setHeader('X-AI-Queries-Limit', limit);
  res.setHeader('X-AI-Queries-Reset', new Date(usage.resetAt).toISOString());

  if (usage.count >= limit) {
    const resetIn = Math.ceil((usage.resetAt - Date.now()) / 1000);
    return res.status(429).json({
      ok: false,
      error: 'daily_ai_limit',
      message: `Daily AI query limit reached (${limit} per day for ${tier.label} tier). Resets at midnight UTC.`,
      limit,
      used: usage.count,
      resetAt: new Date(usage.resetAt).toISOString(),
      retryAfter: resetIn,
      upgradeTip: tierKey === 'trial'
        ? 'Upgrade to New Particle for 50 queries/day.'
        : tierKey === 'new_particle'
          ? 'Upgrade to Dark Particle for 200 queries/day.'
          : null,
    });
  }

  // Increment and proceed
  usage.count++;
  evictIfNeeded();
  next();
}

/**
 * Get current usage stats for a user (for billing/info endpoints).
 */
function getAIUsageStats(userId, tierKey) {
  const tier = getTier(tierKey || 'trial');
  const limit = tier.aiQueriesPerDay;
  const usage = getUsage(userId);
  return {
    used: usage.count,
    limit: isUnlimited(limit) ? 'unlimited' : limit,
    resetAt: new Date(usage.resetAt).toISOString(),
    remaining: isUnlimited(limit) ? 'unlimited' : Math.max(0, limit - usage.count),
  };
}

module.exports = { dailyAILimit, getAIUsageStats };
