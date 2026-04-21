/**
 * routes/adminDebug.js — W4.1 on-call debug surface.
 *
 * Gives the on-call engineer one URL to answer the Tier-1 "what's broken
 * right now?" question. Requires admin role; every call is captured by
 * adminAuditLog.
 *
 *   GET  /api/admin/debug/health         — overall health snapshot
 *   GET  /api/admin/debug/providers      — providerFallback health
 *   GET  /api/admin/debug/feeds          — stalenessMonitor snapshot
 *   GET  /api/admin/debug/kill-switch    — current ai_kill_switch state
 *   POST /api/admin/debug/kill-switch    — flip force_haiku / block_all_ai
 *   GET  /api/admin/debug/sub-audit/:id  — recent subscription_audit rows
 *   GET  /api/admin/debug/inbound-email  — last N inbound-email delivery outcomes
 *
 * Everything is JSON so it plugs directly into the admin UI + is easy
 * to curl from a laptop during an incident.
 */

'use strict';

const express = require('express');
const router = express.Router();

const pg = require('../db/postgres');
const logger = require('../utils/logger');
const providerFallback = require('../services/providerFallback');
const stalenessMonitor = require('../services/stalenessMonitor');
const inboundEmail = require('./inboundEmail');
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

/** Top-level health summary — what an on-call should check first. */
router.get('/health', async (_req, res) => {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    process: {
      uptimeSec: Math.floor(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      nodeVersion: process.version,
    },
    db: { connected: !!(pg.isConnected && pg.isConnected()) },
    providers: providerFallback.providerHealth(),
    feeds: stalenessMonitor.snapshot(),
  };

  // Count critical feeds for quick-glance.
  snapshot.alarmCount = Object.values(snapshot.feeds)
    .filter(f => f.lastSeverity === 'critical' || f.lastSeverity === 'stale').length;

  res.json(snapshot);
});

router.get('/providers', (_req, res) => res.json(providerFallback.providerHealth()));
router.get('/feeds',     (_req, res) => res.json(stalenessMonitor.snapshot()));

/** Current AI kill-switch state. */
router.get('/kill-switch', async (_req, res) => {
  if (!pg.isConnected || !pg.isConnected()) {
    return res.status(503).json({ error: 'db_offline' });
  }
  const r = await pg.query(`SELECT * FROM ai_kill_switch WHERE singleton = TRUE`);
  res.json(r.rows[0] || null);
});

/**
 * Flip force_haiku / block_all_ai. Requires {reason: string} in body.
 * Audit row captures the admin, previous state, and reason.
 */
router.post('/kill-switch', express.json(), async (req, res) => {
  if (!pg.isConnected || !pg.isConnected()) {
    return res.status(503).json({ error: 'db_offline' });
  }
  const { force_haiku, block_all_ai, reason } = req.body || {};
  if (typeof reason !== 'string' || reason.length < 4) {
    return res.status(400).json({ error: 'reason_required' });
  }

  const r = await pg.query(
    `UPDATE ai_kill_switch
        SET force_haiku      = COALESCE($1, force_haiku),
            block_all_ai     = COALESCE($2, block_all_ai),
            reason           = $3,
            tripped_at       = CASE WHEN $1 IS TRUE OR $2 IS TRUE THEN NOW() ELSE tripped_at END,
            tripped_by       = $4,
            updated_at       = NOW()
      WHERE singleton = TRUE
      RETURNING *`,
    [force_haiku ?? null, block_all_ai ?? null, reason, req.user.email || String(req.user.id)],
  );
  logger.warn('admin/kill-switch', 'state changed', {
    actor: req.user.id, force_haiku, block_all_ai, reason,
    incident_response: 'kill_switch_flip',
  });
  res.json(r.rows[0]);
});

/** Subscription audit rows for one user (most recent 50). */
router.get('/sub-audit/:id', async (req, res) => {
  if (!pg.isConnected || !pg.isConnected()) {
    return res.status(503).json({ error: 'db_offline' });
  }
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad_id' });
  const r = await pg.query(
    `SELECT id, source, action, before_state, after_state, meta, created_at
       FROM subscription_audit
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [id],
  );
  res.json({ userId: id, rows: r.rows });
});

/**
 * Phase 10.2 — recent inbound-email delivery outcomes.
 *
 * Postmark marks an email "Processed" as soon as our webhook 200s, but
 * we 200 on drops too (duplicate / allowlist miss / bad recipient) to
 * prevent retries. That means the CIO can't tell from the Postmark UI
 * why a forwarded research note never landed in the vault. This surface
 * returns the last ~50 outcomes we've seen so on-call can answer "why
 * didn't my email arrive?" in one HTTP call.
 *
 * In-memory only — cleared on every deploy / restart. This is a
 * debugging aid, not a system of record.
 */
router.get('/inbound-email', (_req, res) => {
  const rows = typeof inboundEmail.getRecentOutcomes === 'function'
    ? inboundEmail.getRecentOutcomes()
    : [];
  res.json({
    generatedAt: new Date().toISOString(),
    count: rows.length,
    outcomes: rows,
  });
});

module.exports = router;
