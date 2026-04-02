/**
 * middleware/rateLimitByUser.js — Per-user rate limiting middleware.
 *
 * Uses Redis when available, in-memory fallback otherwise.
 * Returns typed 429 JSON on limit exceeded.
 */

'use strict';

const { rateLimitCheck } = require('../cache/redisClient');

/**
 * Create a per-user rate limit middleware.
 * @param {{ key: string, windowSec: number, max: number }} opts
 *   key       — namespace prefix (e.g. 'share', 'screener')
 *   windowSec — sliding window in seconds
 *   max       — max requests per window per user
 */
function rateLimitByUser({ key, windowSec = 60, max = 10 }) {
  return async (req, res, next) => {
    const userId = req.userId || req.ip;
    const rlKey = `rl:${key}:${userId}`;

    try {
      const result = await rateLimitCheck(rlKey, windowSec, max);
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter);
        return res.status(429).json({
          ok: false,
          error: 'ratelimit',
          message: 'Too many requests',
          retryAfter: result.retryAfter,
        });
      }
      next();
    } catch {
      // Never block the server if rate-limit check fails
      next();
    }
  };
}

module.exports = { rateLimitByUser };
