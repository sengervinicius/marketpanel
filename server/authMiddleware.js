/**
 * authMiddleware.js
 * Express middleware for JWT authentication and subscription enforcement.
 */

const { verifyToken, getUserById } = require('./authStore');

/**
 * requireAuth — verifies JWT in Authorization header.
 * Sets req.user = { id, username } on success.
 */
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'No token provided', code: 'no_token' });
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.id, username: payload.username };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'invalid_token' });
  }
}

/**
 * requireActiveSubscription — must be used after requireAuth.
 * Checks trial or paid status. Returns 402 if subscription inactive.
 *
 * If the user is not in the in-memory store (e.g. MongoDB hydration failed),
 * we allow the request through — the JWT was already verified by requireAuth,
 * and blocking users from using the app because of a cache miss is worse than
 * allowing access. Subscription enforcement will still work once the store
 * is properly populated.
 */
function requireActiveSubscription(req, res, next) {
  const user = getUserById(req.user?.id);

  // User not in memory — allow through (JWT already verified, better UX than blocking)
  if (!user) {
    console.warn(`[authMiddleware] requireActiveSubscription: user ${req.user?.id} not in memory — allowing through`);
    return next();
  }

  const now = Date.now();

  // Paid subscriber — always allow
  if (user.isPaid && user.subscriptionActive) {
    return next();
  }

  // Trial still active
  if (user.trialEndsAt && now < user.trialEndsAt) {
    return next();
  }

  // Trial expired, not paid
  return res.status(402).json({
    error: 'Trial expired. Subscribe to continue.',
    code: 'subscription_required',
    trialEndsAt: user.trialEndsAt,
  });
}

module.exports = { requireAuth, requireActiveSubscription };
