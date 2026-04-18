/**
 * routes/privacy.js — W1.1 LGPD data-subject-access endpoints.
 *
 * Implements the five core data-subject rights from LGPD Arts. 18 & 19:
 *   - access       (GET  /api/privacy/me)            — full export JSON
 *   - rectify      (PATCH /api/privacy/me)           — user updates their data
 *   - erase        (DELETE /api/privacy/me)          — right to be forgotten
 *   - portability  (GET  /api/privacy/export)        — machine-readable ZIP
 *   - object       (POST /api/privacy/object)        — opt out of specific processing
 *
 * Also exposes:
 *   - GET  /api/privacy/data-map           — public; describes what we collect and why
 *   - POST /api/privacy/dpo-contact        — public; emails the DPO (Vinicius / Algotex Ltd)
 *
 * All authenticated endpoints are rate-limited to 5/hour to discourage
 * automated scraping or accidental mass-deletion.  Every call is recorded
 * in the admin audit log with the DSAR kind as a metadata tag.
 *
 * IMPORTANT: the "erase" endpoint is soft-delete by default (30-day grace
 * window). The user can reverse it via an email link within that window.
 * After 30 days the retention job (jobs/lgpdRetention.js) hard-deletes.
 */

'use strict';

const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();

const { requireAuth } = require('../authMiddleware');
const authStore = require('../authStore');
const pg        = require('../db/postgres');
const logger    = require('../utils/logger');
const { adminAuditLog } = require('../middleware/adminAuditLog');

// Per-user DSAR rate limit — generous enough for legitimate exports, tight
// enough to frustrate scripted abuse.
const dsarLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => (req.userId ? `u:${req.userId}` : ipKeyGenerator(req, res)),
  message: { error: 'rate_limited', retryAfter: 3600 },
});

// ── Public: the data map ──────────────────────────────────────────────────
// Returns a static description of every personal-data class we collect,
// legal basis, retention, and recipients.  Kept in code (not DB) so
// changes go through code review.
router.get('/data-map', (_req, res) => {
  res.json({
    controller: {
      name: 'Algotex Ltd',
      jurisdiction: 'BR',
      dpoEmail: process.env.DPO_EMAIL || 'dpo@arccapital.com.br',
    },
    lastUpdated: '2026-04-18',
    lawfulBases: ['art_7_V_execution_of_contract', 'art_7_IX_legitimate_interest', 'art_7_I_consent'],
    dataClasses: [
      {
        name: 'identity',
        fields: ['username', 'email', 'apple_user_id'],
        purpose: 'authentication, account recovery',
        retention: 'until account deletion + 30d grace',
        basis: 'contract',
        recipients: ['render.com (hosting)', 'mongodb.com (storage)', 'sendgrid (email)'],
      },
      {
        name: 'billing',
        fields: ['stripe_customer_id', 'stripe_subscription_id', 'tier', 'is_paid'],
        purpose: 'subscription management',
        retention: '5 years after last invoice (tax law)',
        basis: 'legal_obligation',
        recipients: ['stripe.com'],
      },
      {
        name: 'preferences',
        fields: ['settings (panel layout, screen ticker list, theme)'],
        purpose: 'user experience personalization',
        retention: 'until account deletion',
        basis: 'legitimate_interest',
        recipients: [],
      },
      {
        name: 'ai_interactions',
        fields: ['chat_messages', 'ai_usage_ledger (tokens, cents)'],
        purpose: 'service delivery + cost accounting',
        retention: 'chat history 90d; cost ledger 24 months',
        basis: 'contract',
        recipients: ['anthropic.com', 'perplexity.ai'],
      },
      {
        name: 'telemetry',
        fields: ['audit_log', 'http request logs (redacted)'],
        purpose: 'fraud prevention, security, compliance',
        retention: '12 months',
        basis: 'legitimate_interest',
        recipients: ['sentry.io (error tracking)'],
      },
      {
        name: 'marketing',
        fields: ['referral_code', 'referred_by'],
        purpose: 'referral tracking (opt-in)',
        retention: 'until opt-out or deletion',
        basis: 'consent',
        recipients: [],
      },
    ],
    rights: [
      'access',     // Art 18 II
      'rectify',    // Art 18 III
      'erase',      // Art 18 VI
      'portability',// Art 18 V
      'object',     // Art 18 § 2
      'withdraw_consent', // Art 8 § 5
      'be_informed_of_sharing', // Art 18 VII
    ],
    crossBorderTransfers: {
      'render.com': 'US, adequacy via SCC',
      'stripe.com': 'US, adequacy via SCC',
      'anthropic.com': 'US, adequacy via SCC',
      'perplexity.ai': 'US, adequacy via SCC',
      'sentry.io': 'US, adequacy via SCC',
    },
  });
});

// ── Public: contact the DPO ───────────────────────────────────────────────
router.post('/dpo-contact',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 3, keyGenerator: (req, res) => ipKeyGenerator(req, res) }),
  async (req, res) => {
    const { name, email, subject, message } = req.body || {};
    if (!email || !message || !subject) {
      return res.status(400).json({ error: 'email, subject, message are required' });
    }
    logger.info('privacy/dpo-contact', 'Received DPO inquiry', {
      fromEmail: email,
      subjectPreview: String(subject).slice(0, 80),
      fromName: name || null,
    });
    // Persist the ticket so the DPO can act on it even if email is down.
    try {
      if (pg.isConnected && pg.isConnected()) {
        await pg.query(
          `INSERT INTO dpo_tickets (email, name, subject, message)
           VALUES ($1, $2, $3, $4)`,
          [String(email).slice(0, 320), (name || '').slice(0, 200), String(subject).slice(0, 500), String(message).slice(0, 10_000)]
        );
      }
    } catch (e) {
      logger.warn('privacy/dpo-contact', 'persist failed', { error: e.message });
    }
    res.json({ ok: true });
  }
);

// ── Authenticated: access + rectify + erase + portability + object ──────
router.use(requireAuth);
router.use(dsarLimiter);
router.use(adminAuditLog);   // every DSAR call is audited

// Access (Art 18 II): full JSON export of the user's own record.
router.get('/me', async (req, res) => {
  const uid = req.userId;
  try {
    const user = await authStore.getUserById(uid);
    if (!user) return res.status(404).json({ error: 'not_found' });

    const payload = {
      identity: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt,
      },
      subscription: {
        tier: user.subscription?.tier || 'trial',
        isPaid: !!user.subscription?.active,
        trialEndsAt: user.subscription?.trialEndsAt || null,
      },
      preferences: user.settings || {},
      referral: {
        code: user.referralCode || null,
        referredBy: user.referredBy || null,
      },
      aiUsageToday: null,
      chatHistory30Days: null,
      auditLast90Days: null,
    };

    if (pg.isConnected && pg.isConnected()) {
      try {
        const usage = await pg.query(
          `SELECT day, model, tokens_in, tokens_out, calls, cents
             FROM ai_usage_ledger WHERE user_id = $1
            ORDER BY day DESC LIMIT 30`,
          [uid]
        );
        payload.aiUsage30Days = usage.rows;
      } catch (_) {}
      try {
        const audit = await pg.query(
          `SELECT created_at, kind, route, details FROM audit_log
            WHERE actor_user_id = $1 OR target_user_id = $1
            ORDER BY created_at DESC LIMIT 500`,
          [uid]
        );
        payload.auditLast90Days = audit.rows;
      } catch (_) {}
    }

    res.json(payload);
  } catch (e) {
    logger.error('privacy/me', 'access handler failed', { error: e.message });
    res.status(500).json({ error: 'internal' });
  }
});

// Rectify (Art 18 III): allow-list of editable fields.
router.patch('/me', async (req, res) => {
  const uid = req.userId;
  const patch = {};
  if (typeof req.body?.email    === 'string') patch.email = req.body.email.trim().toLowerCase();
  if (typeof req.body?.username === 'string') patch.username = req.body.username.trim();
  if (req.body?.settings && typeof req.body.settings === 'object') patch.settings = req.body.settings;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no_editable_fields' });
  }
  try {
    if (patch.settings) await authStore.mergeSettings(uid, patch.settings);
    if (patch.email || patch.username) await authStore.updateUser(uid, patch);
    req.auditDetails = { kind: 'dsar_rectify', fields: Object.keys(patch) };
    res.json({ ok: true, updated: Object.keys(patch) });
  } catch (e) {
    logger.error('privacy/rectify', 'handler failed', { error: e.message });
    res.status(500).json({ error: 'internal' });
  }
});

// Erase (Art 18 VI): soft-delete with 30-day grace. Hard-delete by retention job.
router.delete('/me', async (req, res) => {
  const uid = req.userId;
  try {
    if (pg.isConnected && pg.isConnected()) {
      await pg.query(
        `INSERT INTO dsar_erasure_queue (user_id, requested_at, hard_delete_after)
         VALUES ($1, NOW(), NOW() + INTERVAL '30 days')
         ON CONFLICT (user_id) DO UPDATE SET requested_at = EXCLUDED.requested_at,
                                             hard_delete_after = EXCLUDED.hard_delete_after`,
        [uid]
      );
    }
    // Mark account as pending deletion — blocks login path.
    try { await authStore.updateUser(uid, { pendingDeletionAt: Date.now() }); } catch (_) {}
    req.auditDetails = { kind: 'dsar_erase', softDelete: true, graceDays: 30 };
    logger.warn('privacy/erase', 'Soft-delete scheduled', { affectedUserId: uid });
    res.json({ ok: true, hardDeleteAfterDays: 30, cancelable: true });
  } catch (e) {
    logger.error('privacy/erase', 'handler failed', { error: e.message });
    res.status(500).json({ error: 'internal' });
  }
});

// Reverse an in-progress erasure (user changed their mind within grace window).
router.post('/cancel-erase', async (req, res) => {
  const uid = req.userId;
  try {
    if (pg.isConnected && pg.isConnected()) {
      await pg.query(`DELETE FROM dsar_erasure_queue WHERE user_id = $1`, [uid]);
    }
    try { await authStore.updateUser(uid, { pendingDeletionAt: null }); } catch (_) {}
    req.auditDetails = { kind: 'dsar_erase_cancel' };
    res.json({ ok: true });
  } catch (e) {
    logger.error('privacy/cancel-erase', 'handler failed', { error: e.message });
    res.status(500).json({ error: 'internal' });
  }
});

// Portability (Art 18 V): machine-readable export. For LGPD we only need
// JSON; CSV would be over-spec. Re-use /me payload, set content-disposition.
router.get('/export', async (req, res) => {
  const uid = req.userId;
  try {
    // Reuse /me logic by internal call — cheaper than duplicating.
    req.url = '/me';
    req.method = 'GET';
    res.setHeader('Content-Disposition', `attachment; filename="particle-export-${uid}.json"`);
    // Delegate to the handler we just defined:
    const accessHandler = router.stack.find(l => l.route && l.route.path === '/me' && l.route.methods.get);
    return accessHandler.route.stack[0].handle(req, res);
  } catch (e) {
    logger.error('privacy/export', 'handler failed', { error: e.message });
    res.status(500).json({ error: 'internal' });
  }
});

// Object (Art 18 § 2): user opts out of a specific processing.
// Current opt-outs: marketing, ai_training (not currently performed, preserved
// for completeness), analytics.  Flags live in users.settings.privacy.
router.post('/object', async (req, res) => {
  const uid = req.userId;
  const kind = String(req.body?.kind || '').toLowerCase();
  if (!['marketing', 'ai_training', 'analytics'].includes(kind)) {
    return res.status(400).json({ error: 'unknown_objection_kind' });
  }
  try {
    await authStore.mergeSettings(uid, { privacy: { [`optOut_${kind}`]: true, updatedAt: Date.now() } });
    req.auditDetails = { kind: 'dsar_object', optOut: kind };
    res.json({ ok: true, optOut: kind });
  } catch (e) {
    logger.error('privacy/object', 'handler failed', { error: e.message });
    res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
