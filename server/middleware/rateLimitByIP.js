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

module.exports = { rateLimitByIP };
