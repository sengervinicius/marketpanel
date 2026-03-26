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
 */
function requireActiveSubscription(req, res, next) {
  const user = getUserById(req.user?.id);
  if (!user) {
    return res.status(401).json({ error: 'User not found', code: 'user_not_found' });
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
