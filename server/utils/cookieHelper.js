/**
 * cookieHelper.js
 * Centralized cookie configuration for JWT auth tokens.
 */

const COOKIE_NAME = 'senger_token';
const REFRESH_COOKIE_NAME = 'senger_refresh';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Standard options for the access token cookie.
 * httpOnly: prevents JavaScript access (XSS protection)
 * secure: only sent over HTTPS (always true in prod)
 * sameSite: 'none' in production because client (the-particle.com) and server
 *   (senger-server.onrender.com) are on different domains — 'lax' blocks
 *   cross-origin fetch/XHR requests from including cookies.
 * maxAge: 15 minutes in milliseconds (matches JWT expiry)
 * path: '/' so all API routes receive it
 */
function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: '/',
  };
}

/**
 * Options for the refresh token cookie.
 *
 * #285 — path broadened from '/api/auth/refresh' to '/'. The narrow path
 * was intended as defence-in-depth (refresh cookie only travels to the
 * one endpoint that needs it), but it broke the in-depth-screen popout:
 * when the popout window loaded fresh and the access token had expired,
 * /api/auth/me 401'd. AuthContext then tried /api/auth/refresh — but in
 * some Safari ITP and cross-domain scenarios the path-restricted cookie
 * wasn't included on the popout's first request even though origin
 * matched. Result: refresh failed, localStorage fallback may have been
 * empty, user landed on LoginScreen.
 *
 * Trade-off: refresh cookie is now sent on every request to the API
 * origin (~20 bytes per request). It's still httpOnly (JS cannot read
 * it, so XSS irrelevant) and sameSite='none' + Secure (CSRF mitigated
 * the same way the access cookie is). Server only USES it at
 * /api/auth/refresh; the broader path just makes the cookie reliably
 * present.
 */
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
  };
}

/**
 * Set the auth token cookie on the response.
 */
function setTokenCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

/**
 * Clear the auth token cookie.
 */
function clearTokenCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax' });
}

/**
 * Set the refresh token cookie on the response.
 */
function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions());
}

/**
 * Clear the refresh token cookie.
 */
function clearRefreshCookie(res) {
  // #285 — clear matches the broadened path on set. Also clear the legacy
  // narrow path so any cookies set by older builds get cleared on logout.
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/', httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax' });
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth/refresh', httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax' });
}

module.exports = { COOKIE_NAME, setTokenCookie, clearTokenCookie, REFRESH_COOKIE_NAME, setRefreshCookie, clearRefreshCookie };
