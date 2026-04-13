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
 * Sent only to /api/auth/refresh endpoint for security.
 * sameSite: 'none' in production for cross-origin cookie delivery.
 */
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/api/auth/refresh',
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
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth/refresh', httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax' });
}

module.exports = { COOKIE_NAME, setTokenCookie, clearTokenCookie, REFRESH_COOKIE_NAME, setRefreshCookie, clearRefreshCookie };
