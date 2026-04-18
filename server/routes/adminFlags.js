/**
 * routes/adminFlags.js — W6.1 admin surface for DIY feature flags.
 *
 *   GET    /api/admin/flags            — list all flags + current state
 *   PUT    /api/admin/flags/:name      — upsert flag (requires reason)
 *   DELETE /api/admin/flags/:name      — delete flag (requires reason)
 *   GET    /api/admin/flags/:name/audit — recent mutations
 *
 * Every mutation is written to feature_flag_audit. The service-layer cache
 * is invalidated after each write so the new value propagates within the
 * same event loop tick.
 */

'use strict';

const express = require('express');
const router = express.Router();

const flags = require('../services/featureFlags');
const pg = require('../db/postgres');
const { adminAuditLog } = require('../middleware/adminAuditLog');

function requireAdmin(req, res, next) {
  const u = req.user;
  if (!u || !(u.isAdmin || u.role === 'admin')) {
    return res.status(403).json({ error: 'admin_required' });
  }
  next();
}

router.use(requireAdmin);
router.use(adminAuditLog);

router.get('/', async (_req, res) => {
  try {
    const rows = await flags.list();
    res.json({ flags: rows });
  } catch (e) {
    res.status(500).json({ error: 'list_failed', message: e.message });
  }
});

router.put('/:name', async (req, res) => {
  const { name } = req.params;
  const { enabled, rolloutPct, cohortRule, description, reason } = req.body || {};
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled_required' });
  if (!reason || String(reason).trim().length < 4) {
    return res.status(400).json({ error: 'reason_required', message: 'a reason of ≥4 chars is required for auditability' });
  }
  try {
    const after = await flags.upsert({
      name, enabled, rolloutPct, cohortRule, description,
      actor: req.user?.email || String(req.user?.id || 'unknown'),
      reason,
    });
    res.json({ flag: after });
  } catch (e) {
    res.status(400).json({ error: 'upsert_failed', message: e.message });
  }
});

router.delete('/:name', async (req, res) => {
  const { name } = req.params;
  const { reason } = req.body || {};
  if (!reason || String(reason).trim().length < 4) {
    return res.status(400).json({ error: 'reason_required' });
  }
  try {
    const ok = await flags.remove({
      name,
      actor: req.user?.email || String(req.user?.id || 'unknown'),
      reason,
    });
    res.json({ deleted: ok });
  } catch (e) {
    res.status(500).json({ error: 'delete_failed', message: e.message });
  }
});

router.get('/:name/audit', async (req, res) => {
  try {
    const { rows } = await pg.query(
      `SELECT id, name, before, after, actor, reason, created_at
       FROM feature_flag_audit
       WHERE name = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.params.name]
    );
    res.json({ entries: rows });
  } catch (e) {
    res.status(500).json({ error: 'audit_failed', message: e.message });
  }
});

module.exports = router;
