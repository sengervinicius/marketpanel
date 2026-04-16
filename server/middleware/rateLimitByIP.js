/**
 * middleware/rateLimitByIP.js — Per-IP rate limiting middleware.
 *
 * Uses express-rate-limit for IP-based limiting on general and expensive endpoints.
 * Returns 429 on limit exceeded.
 */

'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Create a per-IP rate limit middleware.
 * @param {{ max: number, windowMs?: number }} opts
 *   max       — max requests per window per IP
 *   windowMs  — time window in milliseconds (default: 60000 = 1 minute)
 */
function rateLimitByIP({ max = 120, windowMs = 60000 } = {}) {
  return rateLimit({
    windowMs,
    max,
    message: {
      ok: false,
      error: 'ratelimit',
      message: 'Too many requests from this IP address',
    },
    standardHeaders: true, // Return RateLimit-* headers
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/health';
    },
  });
}

/**
 * Per-minute rate limiter for expensive endpoints (AI chat, vault upload).
 * Phase 1 Security: 20 requests per 60-second window per IP.
 * Stacks with any existing daily/per-user limits.
 */
const perMinuteLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: {
    ok: false,
    error: 'ratelimit',
    message: 'Rate limit exceeded. Maximum 20 requests per minute.',
    retryAfter: 60,
  },
  standardHeaders: true,    // Return RateLimit-* headers
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({
      ok: false,
      error: 'ratelimit',
      message: 'Rate limit exceeded. Maximum 20 requests per minute.',
      retryAfter,
    });
  },
});

module.exports = { rateLimitByIP, perMinuteLimit };
