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

  // Accept if the request must have triggered a CORS preflight, which a
  // cross-origin attacker cannot cause without our server opting in.
  //
  //   X-Requested-With  -- not a safelisted header  -> preflight required
  //   application/json  -- not a safelisted type    -> preflight required
  //
  // multipart/form-data used to be accepted here and MUST NOT BE: it is a
  // CORS-*simple* content type, so a plain cross-origin <form> can POST it with
  // no preflight at all. Combined with sameSite:'none' cookies, that made every
  // state-changing multipart endpoint -- including vault upload -- forgeable from
  // any website the user happened to be visiting. Multipart callers must now send
  // X-Requested-With, which forces the preflight.
  if (xrw || ct.includes('application/json')) {
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
