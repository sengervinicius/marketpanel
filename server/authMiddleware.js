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
    // Canonical per-user id. Several modules (privacy/LGPD routes, rateLimitByUser,
    // share, discord, logger/Sentry context) read req.userId — it was never assigned,
    // so those silently ran with `undefined` (per-user quotas degraded to per-IP).
    req.userId = payload.id;
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
 * The product rule is simple: every account gets TRIAL_DAYS (default 14) from
 * signup. `users.trial_ends_at` is meant to encode that, but it is a single
 * nullable column written at registration time -- if that write ever fails, or
 * the value is stored in an unexpected shape, the user is silently locked out of
 * everything behind requireActiveSubscription (which includes ALL market data).
 * That is what happened: an account two days old was told "Trial expired".
 *
 * So we no longer trust that column alone. When it is missing or unusable we
 * derive the trial window from created_at instead, which cannot disagree with the
 * product rule. Note this does NOT resurrect old trials -- created_at + 14 days
 * for an account made months ago is still in the past, so it expires correctly.
 */
const TRIAL_MS = (parseInt(process.env.TRIAL_DAYS, 10) || 14) * 24 * 60 * 60 * 1000;

function effectiveTrialEnd(user, ctx) {
  const raw = user.trialEndsAt;
  const n = raw == null ? NaN : Number(raw);
  if (Number.isFinite(n) && n > 0) return n;

  const created = Number(user.createdAt);
  if (Number.isFinite(created) && created > 0) {
    // Visible, because a missing trial_ends_at is a data bug worth fixing at the
    // source even though we now survive it.
    console.warn(`[authMiddleware] trialEndsAt unusable (${JSON.stringify(raw)}) for user ${user.id}; deriving from createdAt${ctx ? ' via ' + ctx : ''}`);
    return created + TRIAL_MS;
  }
  return null;
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
  let source = user ? 'memory' : 'postgres';

  // User not in memory — query Postgres
  if (!user) {
    try {
      const result = await pg.query(
        'SELECT is_paid, subscription_active, trial_ends_at, plan_tier, created_at FROM users WHERE id = $1',
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
        // trial_ends_at is BIGINT (epoch ms). node-postgres returns BIGINT as a
        // STRING to avoid precision loss, and `new Date('1786953600000')` does not
        // parse an epoch-ms string -- it tries to read it as a date string, fails,
        // and yields Invalid Date, so .getTime() was NaN. hasTrial then evaluated
        // falsy and this middleware answered 402 'Trial expired' to users with
        // almost two weeks of trial left.
        //
        // It only bit users NOT in the in-memory map (that path uses Number(),
        // correctly), which is why it looked intermittent and platform-specific
        // rather than what it is: every market-data request for such a user.
        // authStore hydrate/refresh already use Number(); this now matches.
        trialEndsAt: row.trial_ends_at != null ? Number(row.trial_ends_at) : null,
        createdAt: row.created_at != null ? Number(row.created_at) : null,
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

  // Admins are never paywalled out of their own product.
  //
  // isAdminUser is this codebase's canonical admin predicate and TWO other
  // middlewares already use it to exempt admins -- aiQuotaGate and dailyAILimit.
  // This one did not, so an admin whose 14-day trial had lapsed (i.e. the owner,
  // who has no reason to ever pay) was 402'd out of ALL market data while still
  // being exempt from AI quotas. That inconsistency is the actual reason the
  // terminal went blank on the vsenger account, and no amount of trial-date
  // repair would have fixed it.
  const adminCheck = isAdminUser({
    id: user.id != null ? user.id : userId,
    email: user.email || req.user?.email || null,
    username: user.username || req.user?.username || null,
  });
  if (adminCheck.ok) {
    req.user.isAdmin = true;
    if (!req.user.planTier || req.user.planTier === 'trial') req.user.planTier = 'nuclear';
    return next();
  }

  const now = Date.now();

  // Paid subscriber — always allow
  if (user.isPaid && user.subscriptionActive) {
    return next();
  }

  // Check if trial is still active (explicit logic)
  const trialEnd = effectiveTrialEnd(user, user.__fromPg ? 'postgres' : 'memory');
  const hasTrial = trialEnd != null && now < trialEnd;
  const isPaidActive = user.isPaid && user.subscriptionActive;

  if (!hasTrial && !isPaidActive) {
    // Neither trial nor paid subscription is active
    // TEMPORARY DIAGNOSTIC (remove once the trial data issue is closed).
    // The client surfaces `error` verbatim, so putting the deciding values here
    // means we can see them on a device without shipping a new app build. These
    // are the requester's own subscription facts, not anyone else's.
    const diag = [
      `src=${source}`,
      `id=${userId}`,
      `raw=${JSON.stringify(user.trialEndsAt)}`,
      `created=${user.createdAt ? new Date(Number(user.createdAt)).toISOString().slice(0, 10) : 'null'}`,
      `end=${trialEnd ? new Date(trialEnd).toISOString().slice(0, 10) : 'null'}`,
      `paid=${user.isPaid ? 1 : 0}/${user.subscriptionActive ? 1 : 0}`,
      `tier=${user.planTier || '-'}`,
    ].join(' ');
    return res.status(402).json({
      error: `Trial expired. Subscribe to continue. [${diag}]`,
      code: 'subscription_required',
      trialEndsAt: trialEnd,
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
