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
 * populatePlanTier — must be used after requireAuth. Loads the user's
 * plan_tier from Postgres (or memory) and attaches it to req.user as
 * req.user.planTier. NEVER returns a non-2xx — even users whose trial
 * has expired pass through. Routes that want hard subscription gating
 * use requireActiveSubscription instead; routes that want tier-aware
 * but trial-friendly behaviour (e.g. /api/vault — 5-file trial cap is
 * enforced inside the route handler against req.user.planTier) use
 * this.
 *
 * #283 — added so a trial user whose 14-day window has elapsed isn't
 * locked out of vault. The vault upload route still enforces the
 * trial tier's 5-document cap; the user keeps read access to existing
 * docs and can upgrade in-place. Previously requireActiveSubscription
 * 402'd them and the entire vault appeared "completely out of service".
 */
async function populatePlanTier(req, res, next) {
  const userId = req.user?.id;
  if (!userId) return next(); // requireAuth would have 401'd already
  let user = getUserById(userId);
  if (!user) {
    try {
      const result = await pg.query(
        'SELECT plan_tier FROM users WHERE id = $1',
        [userId]
      );
      if (result.rows.length > 0) {
        req.user.planTier = result.rows[0].plan_tier || 'trial';
      } else {
        req.user.planTier = 'trial';
      }
    } catch (dbError) {
      // Failure mode: log + fall through with the safe default. The
      // route handler will use the trial cap, which is the most
      // restrictive — better to under-grant than to over-grant on a
      // db blip.
      console.error(`[authMiddleware] populatePlanTier: Postgres query failed for user ${userId}:`, dbError.message);
      req.user.planTier = 'trial';
    }
  } else {
    req.user.planTier = user.planTier || 'trial';
  }
  next();
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
        'SELECT is_paid, subscription_active, trial_ends_at, plan_tier FROM users WHERE id = $1',
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
        planTier: row.plan_tier || 'trial',
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

  // Attach plan tier to req.user for downstream route handlers
  req.user.planTier = user.planTier || 'trial';

  const now = Date.now();

  // Paid subscriber — always allow
  if (user.isPaid && user.subscriptionActive) {
    return next();
  }

  // Check if trial is still active (explicit logic)
  const hasTrial = user.trialEndsAt && now < user.trialEndsAt;
  const isPaidActive = user.isPaid && user.subscriptionActive;

  if (!hasTrial && !isPaidActive) {
    // Neither trial nor paid subscription is active
    return res.status(402).json({
      error: 'Trial expired. Subscribe to continue.',
      code: 'subscription_required',
      trialEndsAt: user.trialEndsAt,
    });
  }

  // User has an active trial or paid subscription
  return next();
}

/**
 * isAdminUser(user) — pure predicate, shared by requireAdmin and the
 * `/api/auth/me/admin-status` diagnostic endpoint.
 *
 * Three env vars, any is sufficient:
 *   ADMIN_USER_IDS="1,2"                          — legacy, brittle
 *     across environments (user IDs depend on registration order).
 *   ADMIN_EMAILS="founder@the-particle.com,…"     — preferred for new accounts.
 *   ADMIN_USERNAMES="vsenger,…"                   — durable for legacy
 *     accounts that pre-date email capture on signup.
 *
 * Falls back to `'1,2'` when ALL THREE are unset so a fresh dev install has
 * a working founder out of the box.
 *
 * @param {{id?: number, email?: string|null, username?: string|null}} user
 * @returns {{ok: boolean, reason?: string}}
 */
function isAdminUser(user) {
  if (!user) return { ok: false, reason: 'no_user' };

  const idsRaw = (process.env.ADMIN_USER_IDS ?? '').trim();
  const emailsRaw = (process.env.ADMIN_EMAILS ?? '').trim();
  const usernamesRaw = (process.env.ADMIN_USERNAMES ?? '').trim();

  // Fall back to '1,2' only when ALL env vars are unset — otherwise a
  // deployment that explicitly sets ADMIN_EMAILS/ADMIN_USERNAMES would
  // silently grant admin to whoever happens to be user 1/2 on that shard.
  const noneSet = idsRaw === '' && emailsRaw === '' && usernamesRaw === '';
  const adminIds = (noneSet ? '1,2' : idsRaw)
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));

  if (user.id != null && adminIds.includes(Number(user.id))) {
    return { ok: true, reason: 'by_id' };
  }

  if (user.email && emailsRaw) {
    const userEmail = String(user.email).toLowerCase().trim();
    const adminEmails = emailsRaw
      .split(',')
      .map(s => s.toLowerCase().trim())
      .filter(Boolean);
    if (adminEmails.includes(userEmail)) {
      return { ok: true, reason: 'by_email' };
    }
  }

  if (user.username && usernamesRaw) {
    const userUsername = String(user.username).toLowerCase().trim();
    const adminUsernames = usernamesRaw
      .split(',')
      .map(s => s.toLowerCase().trim())
      .filter(Boolean);
    if (adminUsernames.includes(userUsername)) {
      return { ok: true, reason: 'by_username' };
    }
  }

  return { ok: false, reason: 'not_in_allowlist' };
}

/**
 * requireAdmin — lightweight admin gate.
 * Accepts either a user ID in ADMIN_USER_IDS or an email in ADMIN_EMAILS.
 * Must be used after requireAuth.
 */
function requireAdmin(req, res, next) {
  // Hydrate email off the in-memory user record; req.user from JWT only
  // carries {id, username} so we need the store to check by email.
  const userRec = getUserById(req.user?.id) || null;
  const check = isAdminUser({
    id: req.user?.id,
    email: userRec?.email || null,
    username: req.user?.username,
  });
  if (!check.ok) {
    return res.status(403).json({
      error: 'Admin access required',
      code: 'admin_required',
      // Surface just enough for the founder to self-diagnose in browser
      // devtools — never leak other admins' emails.
      userId: req.user?.id,
      reason: check.reason,
    });
  }
  next();
}

module.exports = { requireAuth, requireActiveSubscription, populatePlanTier, requireAdmin, isAdminUser };
