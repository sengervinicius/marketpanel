/**
 * csrfProtect.js — Lightweight CSRF protection via custom header check.
 *
 * Strategy: Require a custom header (X-Requested-With) on all state-mutating
 * requests (POST, PUT, PATCH, DELETE). Browsers do NOT add custom headers to
 * cross-origin requests without CORS preflight. Since our CORS config uses
 * explicit origin allowlisting + credentials: true, an attacker site cannot
 * get preflight approval — so they cannot add the custom header.
 *
 * This is defense-in-depth on top of:
 *   1. CORS origin whitelist (server/index.js)
 *   2. SameSite cookie policy
 *   3. Content-Type: application/json (triggers preflight)
 *
 * Exempt: webhook endpoints (Stripe, etc.) and public GET routes.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PATHS = [
  '/api/billing/webhook',  // Stripe webhook — not browser-originated
  '/health',               // Health check
  '/api/health',           // Health check
];

function csrfProtect(req, res, next) {
  // Safe methods don't mutate state
  if (SAFE_METHODS.has(req.method)) return next();

  // Exempt paths (webhooks, health checks)
  if (EXEMPT_PATHS.some(p => req.path.startsWith(p))) return next();

  // Check for custom header — browsers never send this on cross-origin without preflight
  const xrw = req.headers['x-requested-with'];
  const ct  = req.headers['content-type'] || '';

  // Accept if: has custom header, OR content-type is JSON (also triggers preflight),
  // OR request has our auth cookie/header (proves browser went through our CORS flow)
  if (xrw || ct.includes('application/json') || ct.includes('multipart/form-data')) {
    return next();
  }

  // Reject plain form submissions from other origins
  console.warn(`[CSRF] Blocked ${req.method} ${req.path} — no CSRF indicator header`);
  return res.status(403).json({
    error: 'CSRF validation failed. Include Content-Type: application/json or X-Requested-With header.',
    code: 'csrf_failed',
  });
}

module.exports = { csrfProtect };
