/**
 * authMiddleware.js
 * Express middleware for JWT authentication and subscription enforcement.
 */

const { verifyToken, getUserById } = require('./authStore');
const { COOKIE_NAME } = require('./utils/cookieHelper');
const pg = require('./db/postgres');

/**
 * requireAuth — verifies JWT from httpOnly cookie (priority) or Authorization header (backward compat).
 * Sets req.user = { id, username } on success.
 */
function requireAuth(req, res, next) {
  // Priority: 1) httpOnly cookie, 2) Authorization header (backward compat for mobile/WS)
  const cookieToken = req.cookies?.[COOKIE_NAME];
  const header = req.headers['authorization'] || '';
  const headerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = cookieToken || headerToken;

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
 * If the user is not in the in-memory store, queries Postgres directly for
 * subscription status. If Postgres is also unavailable, returns 503.
 */
async function requireActiveSubscription(req, res, next) {
  const userId = req.user?.id;
  let user = getUserById(userId);

  // User not in memory — query Postgres
  if (!user) {
    try {
      const result = await pg.query(
        'SELECT is_paid, subscription_active, trial_ends_at FROM users WHERE id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        // User not found in DB either — deny access
        return res.status(402).json({
          error: 'User not found or subscription inactive.',
          code: 'subscription_required',
        });
      }

      const row = result.rows[0];
      user = {
        id: userId,
        isPaid: row.is_paid,
        subscriptionActive: row.subscription_active,
        trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : null,
      };
    } catch (dbError) {
      console.error(`[authMiddleware] requireActiveSubscription: Postgres query failed for user ${userId}:`, dbError.message);
      // DB unavailable — return 503
      return res.status(503).json({
        error: 'Service Unavailable. Unable to verify subscription status.',
        code: 'service_unavailable',
      });
    }
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
