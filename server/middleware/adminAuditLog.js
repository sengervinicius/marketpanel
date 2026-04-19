/**
 * middleware/adminAuditLog.js — W0.8 admin audit trail.
 *
 * Attaches to every /api/admin/* route. After the response finishes, appends
 * a row to admin_audit_log capturing actor, action, route, status, IP, UA,
 * reqId, and any small details object the handler has attached via
 * req.auditDetails = { ... }.
 *
 * This middleware runs AFTER requireAdmin, so req.userId is guaranteed to
 * be set to the admin's user id. It never blocks the response — DB failures
 * are logged and swallowed.
 *
 * The action string is derived from METHOD + final path segment, with
 * a small alias table for readability (e.g. POST /api/admin/delete-user
 * → "admin.user.delete").
 */

'use strict';

const pg = require('../db/postgres');
const logger = require('../utils/logger');

// Map of path fragments → canonical action labels. Anything not matched
// falls back to `admin.<verb>.<path-tail>`.
const ACTION_ALIASES = {
  'reset-user-settings': 'admin.user.reset_settings',
  'delete-user':         'admin.user.delete',
  'stats':               'admin.dashboard.read',
  'usage':               'admin.usage.read',
  'users':               'admin.users.read',
  'health':              'admin.health.read',
  'heatmap':             'admin.heatmap.read',
};

function deriveAction(req) {
  const method = (req.method || 'GET').toLowerCase();
  // Grab the tail of the URL path, stripping query string.
  const path = (req.originalUrl || req.path || '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  // .../admin/<fragment>[/<target>]
  const idx = parts.indexOf('admin');
  const fragment = idx >= 0 ? parts[idx + 1] : parts[parts.length - 1];
  const alias = ACTION_ALIASES[fragment];
  if (alias) return alias;
  return `admin.${method}.${fragment || 'root'}`;
}

function deriveTarget(req) {
  // Common patterns: /delete-user/:email, /user/:id, /subscription/:id
  const params = req.params || {};
  if (params.email) return { target_type: 'user', target_id: String(params.email) };
  if (params.userId) return { target_type: 'user', target_id: String(params.userId) };
  if (params.id) return { target_type: 'resource', target_id: String(params.id) };
  if (req.body && typeof req.body === 'object') {
    if (req.body.userId) return { target_type: 'user', target_id: String(req.body.userId) };
    if (req.body.email) return { target_type: 'user', target_id: String(req.body.email) };
  }
  return { target_type: null, target_id: null };
}

function clientIp(req) {
  // Prefer forwarded chain's first hop; fall back to socket address.
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

function adminAuditLog(req, res, next) {
  // Capture at request-start; some values (params) are already parsed by now.
  const action = deriveAction(req);
  const { target_type, target_id } = deriveTarget(req);
  const route = `${req.method} ${(req.originalUrl || req.path || '').split('?')[0]}`;
  const ip = clientIp(req);
  const userAgent = req.headers['user-agent'] || null;

  res.on('finish', () => {
    // Only audit authenticated admin requests. If requireAdmin rejected,
    // there was no privileged action to log. requireAuth sets req.user;
    // older code paths may also set req.userId directly.
    const actorId = req.user?.id || req.userId;
    if (!actorId) return;

    // Skip audit persistence for benign GETs returning 304 cache hits.
    if (req.method === 'GET' && res.statusCode === 304) return;

    const details = {};
    if (req.auditDetails && typeof req.auditDetails === 'object') {
      Object.assign(details, req.auditDetails);
    }

    // Fire-and-forget. Never block the response loop or the client.
    (async () => {
      if (!pg.isConnected || !pg.isConnected()) return;
      try {
        await pg.query(
          `INSERT INTO admin_audit_log
             (actor_id, actor_email, action, target_type, target_id, route,
              status_code, ip, user_agent, req_id, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            actorId,
            req.user?.email || req.userEmail || null,
            action,
            target_type,
            target_id,
            route,
            res.statusCode,
            ip,
            userAgent,
            req.reqId || null,
            JSON.stringify(details),
          ]
        );
      } catch (e) {
        logger.warn('audit', 'Failed to write admin audit row', {
          action, route, status: res.statusCode, error: e.message,
        });
      }
    })();
  });

  next();
}

// ── Diff helper (W5.3) ──────────────────────────────────────────────────
//
// Admin handlers that mutate a row often want to log "tier was particle_pro,
// is now particle_elite" rather than the whole user object. `diffObjects`
// returns a minimal before/after/changedKeys bundle suitable for pinning
// to req.auditDetails.diff.
//
// Design choices:
//   - Scalars only. We intentionally do NOT recurse into arrays or nested
//     objects: audit details are supposed to be grep-friendly, not a full
//     replay log. Reach for subscription_audit or a purpose-built table
//     for deeper diffs.
//   - Never emits secrets: any key matching SECRET_KEY_RE is redacted to
//     '[redacted]' regardless of actual value.
//   - Bounded size: long strings are truncated to 240 chars each so a
//     single admin action can't balloon details past JSONB sanity.

const SECRET_KEY_RE = /(password|secret|token|api[_-]?key|private[_-]?key|auth|cookie)/i;
const MAX_SCALAR_LEN = 240;

function _scalarOnly(v) {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === 'string') return v.length > MAX_SCALAR_LEN ? v.slice(0, MAX_SCALAR_LEN) + '…' : v;
  if (t === 'number' || t === 'boolean') return v;
  // Objects / arrays get reduced to a shape hint — we don't want deep
  // structures in audit rows.
  if (Array.isArray(v)) return `[array len=${v.length}]`;
  return '[object]';
}

function diffObjects(before, after) {
  const b = before || {};
  const a = after  || {};
  const changed = {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const k of keys) {
    if (b[k] === a[k]) continue;
    const bv = SECRET_KEY_RE.test(k) ? '[redacted]' : _scalarOnly(b[k]);
    const av = SECRET_KEY_RE.test(k) ? '[redacted]' : _scalarOnly(a[k]);
    changed[k] = { before: bv, after: av };
  }
  return {
    changedKeys: Object.keys(changed).sort(),
    fields: changed,
  };
}

/**
 * Convenience: admin handlers call this after they've loaded the "before"
 * state and are about to write. Sets req.auditDetails.diff so the
 * middleware's finish handler picks it up.
 */
function captureAdminDiff(req, before, after) {
  if (!req) return;
  if (!req.auditDetails || typeof req.auditDetails !== 'object') req.auditDetails = {};
  req.auditDetails.diff = diffObjects(before, after);
}

module.exports = {
  adminAuditLog,
  // Exposed for handlers + tests.
  diffObjects,
  captureAdminDiff,
  _internal: { deriveAction, deriveTarget, clientIp },
};
