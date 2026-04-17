/**
 * middleware/aiQuotaGate.js — W1.2 pre-flight token quota enforcement.
 *
 * Runs before every AI-generating endpoint. Reads the user's tier, looks up
 * today's token total from ai_usage_ledger (with an in-memory fallback), and
 * blocks with 429 if they've hit their daily ceiling. Attaches informational
 * headers so the client can render a meter.
 *
 * This middleware is token-based and therefore stricter than the legacy
 * query-count-based dailyAILimit (which remains in place for a count-shaped
 * view). Both gates fire; whichever is stricter wins.
 *
 * It also consults the org-wide kill-switch: if block_all_ai is set, every
 * non-admin AI request gets 503.
 */

'use strict';

const { getTier, isUnlimited } = require('../config/tiers');
const { getDailyTokens, readKillSwitch } = require('../services/aiCostLedger');

async function aiQuotaGate(req, res, next) {
  const userId = req.user?.id;
  if (!userId) {
    // Unauthenticated paths shouldn't hit AI; let the downstream handler 401.
    return next();
  }

  // Org-wide block? Admins bypass for incident response.
  try {
    const ks = await readKillSwitch();
    const isAdmin = Array.isArray(req.user?.roles) && req.user.roles.includes('admin');
    if (ks.blockAllAI && !isAdmin) {
      return res.status(503).json({
        ok: false,
        error: 'ai_paused',
        code: 'ai_paused',
        message: 'AI temporarily paused by an operator. Non-AI features remain available.',
        reason: ks.reason || null,
      });
    }
    // If force_haiku is on we let the request through; modelRouter will
    // downgrade the choice. The flag is published as a response header so
    // the client can display a degraded-mode banner.
    if (ks.forceHaiku) res.setHeader('X-AI-Degraded', 'haiku-only');
  } catch (_) {
    // If the kill-switch read fails, continue — fail open on this check
    // only (the quota check below still applies).
  }

  const tierKey = req.user.planTier || 'trial';
  const tier = getTier(tierKey);
  const limit = tier.aiTokensPerDay;

  // No token limit configured on this tier → skip.
  if (!limit || isUnlimited(limit)) {
    res.setHeader('X-AI-Token-Limit', limit == null ? 'n/a' : 'unlimited');
    return next();
  }

  let used = 0;
  try {
    used = await getDailyTokens(userId);
  } catch (_) {
    // Fail open on read error; the ledger write path is best-effort too.
    used = 0;
  }

  res.setHeader('X-AI-Token-Used', String(used));
  res.setHeader('X-AI-Token-Limit', String(limit));
  res.setHeader('X-AI-Token-Remaining', String(Math.max(0, limit - used)));

  if (used >= limit) {
    // Midnight UTC reset.
    const resetAt = new Date();
    resetAt.setUTCHours(24, 0, 0, 0);
    const retryAfter = Math.ceil((resetAt.getTime() - Date.now()) / 1000);
    return res.status(429).json({
      ok: false,
      error: 'ai_token_quota',
      code: 'ai_token_quota',
      message: `Daily AI budget reached (${limit.toLocaleString()} tokens on ${tier.label}). Non-AI features remain available. Resets at 00:00 UTC.`,
      limit,
      used,
      retryAfter,
      resetAt: resetAt.toISOString(),
      upgradeTip: tierKey === 'trial'
        ? 'Upgrade to New Particle (300k tokens/day).'
        : tierKey === 'new_particle'
          ? 'Upgrade to Dark Particle (1M tokens/day).'
          : tierKey === 'dark_particle'
            ? 'Upgrade to Nuclear Particle (5M tokens/day).'
            : null,
    });
  }

  next();
}

module.exports = { aiQuotaGate };
