/**
 * middleware/sentryContext.js
 *
 * W0.3 — Tags every request with minimal user/route context for Sentry.
 * Sits AFTER requireAuth where applicable; on public routes it is a no-op.
 *
 * We tag `user.id` and `user.tier` (non-PII) but never username or email.
 */
'use strict';

let Sentry = null;
try { Sentry = require('@sentry/node'); } catch { /* optional dependency */ }

function sentryTagUser(req, _res, next) {
  if (!Sentry || !process.env.SENTRY_DSN) return next();
  try {
    const scope = Sentry.getCurrentScope?.();
    if (!scope) return next();
    if (req.user?.id) {
      scope.setUser({ id: String(req.user.id) });
    } else if (req.userId) {
      scope.setUser({ id: String(req.userId) });
    }
    if (req.user?.planTier) scope.setTag('user.tier', String(req.user.planTier));
    if (req.route?.path) scope.setTag('route', req.route.path);
    if (req.reqId) scope.setTag('reqId', String(req.reqId));
  } catch { /* never throw from a tagging middleware */ }
  next();
}

module.exports = { sentryTagUser };
