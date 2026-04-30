/**
 * routes/support.js — User-facing feedback / report-issue intake.
 *
 * Before this route existed, the only feedback surface in the app was the
 * thumbs-up/down on AI answers (action-feedback). A user hitting a bug or
 * confusion had no way to tell us anything and would just bounce. This
 * route backs a small in-app "Report issue" pill: the user types a short
 * note, optionally their reply-to email (if not logged in or they want a
 * different address), and we forward it to support via the configured
 * email provider and log it for the admin audit trail.
 *
 * We intentionally don't require auth here so anonymous users browsing
 * the landing page can still file a complaint — but the rate limit is
 * applied by IP at the app-mount level, and message length is capped.
 *
 * Privacy: we PII-redact the body before logging; the email payload goes
 * straight to support and is not retained server-side beyond the logger.
 */

'use strict';

const express = require('express');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');
const pg = require('../db/postgres');

const router = express.Router();

const SUPPORT_TO = process.env.SUPPORT_EMAIL_TO || 'vinicius@arccapital.com.br';
const MAX_MESSAGE = 4000;     // characters — keeps payload bounded
const MAX_CONTEXT = 2000;     // for route/screen hint

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function isLikelyEmail(s) {
  if (!s || typeof s !== 'string') return false;
  // Deliberately permissive — reply-to validity is confirmed by delivery.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.length <= 200;
}

/**
 * POST /api/support/feedback
 *   body: { message: string, email?: string, context?: string, category?: string }
 *   auth: optional — if req.user is present we attach userId + email
 */
router.post('/feedback', async (req, res) => {
  try {
    const { message, email, context, category } = req.body || {};

    if (!message || typeof message !== 'string' || message.trim().length < 3) {
      return res.status(400).json({
        ok: false,
        error: 'message_required',
        message: 'Please tell us what happened (at least 3 characters).',
      });
    }

    const trimmed = message.trim().slice(0, MAX_MESSAGE);
    const ctx = typeof context === 'string' ? context.slice(0, MAX_CONTEXT) : '';
    const cat = typeof category === 'string' ? category.slice(0, 40) : 'general';
    const replyTo = isLikelyEmail(email) ? email.trim() : (req.user?.email || null);
    const userId = req.user?.id || null;

    const subject = `[Particle Feedback] ${cat} — ${trimmed.slice(0, 60).replace(/\s+/g, ' ')}${trimmed.length > 60 ? '…' : ''}`;

    const html = [
      '<h2 style="font-family:system-ui">Particle Feedback</h2>',
      `<p><strong>Category:</strong> ${escapeHtml(cat)}</p>`,
      userId ? `<p><strong>User ID:</strong> ${escapeHtml(String(userId))}</p>` : '',
      replyTo ? `<p><strong>Reply to:</strong> <a href="mailto:${escapeHtml(replyTo)}">${escapeHtml(replyTo)}</a></p>` : '<p><em>No reply address provided.</em></p>',
      ctx ? `<p><strong>Context:</strong> ${escapeHtml(ctx)}</p>` : '',
      '<hr />',
      '<pre style="white-space:pre-wrap;font-family:system-ui">',
      escapeHtml(trimmed),
      '</pre>',
      `<p style="color:#888;font-size:12px">Submitted ${new Date().toISOString()} · IP ${escapeHtml(req.ip || 'unknown')}</p>`,
    ].filter(Boolean).join('\n');

    const text = [
      `Particle Feedback (${cat})`,
      userId ? `User ID: ${userId}` : '',
      replyTo ? `Reply to: ${replyTo}` : 'No reply address.',
      ctx ? `Context: ${ctx}` : '',
      '',
      trimmed,
    ].filter(Boolean).join('\n');

    // Fire the email. Keep a short timeout — we don't want the user's tap
    // to hang on Postmark. If it fails we still log and return 202.
    let emailed = false;
    try {
      emailed = await emailService.sendEmail({
        to: SUPPORT_TO,
        subject,
        html,
        text,
        from: replyTo || undefined,   // Postmark will stamp their default sender anyway
        reason: 'support-feedback',
      });
    } catch (e) {
      logger.warn('support', 'feedback email send failed', { error: e.message });
    }

    // #284 — Persist to feedback_submissions. The previous flow lost
    // every submission when no email channel was configured. Now the
    // row is always durable; email is best-effort notification on top.
    let feedbackId = null;
    if (pg.isConnected && pg.isConnected()) {
      try {
        const ins = await pg.query(
          `INSERT INTO feedback_submissions
             (user_id, reply_to, category, message, context, ip_addr, emailed)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [userId, replyTo, cat, trimmed, ctx || null, req.ip || null, !!emailed],
        );
        feedbackId = ins.rows?.[0]?.id || null;
      } catch (dbErr) {
        // Don't break the user experience if DB insert fails; the
        // structured logger line below is still durable in Render logs.
        logger.error('support', 'feedback DB insert failed', { error: dbErr.message });
      }
    }

    // Always log — this is our durable record if email bounces AND db is down.
    logger.info('support', 'feedback submitted', {
      feedbackId,
      userId,
      category: cat,
      hasReplyTo: !!replyTo,
      emailed: !!emailed,
      persisted: !!feedbackId,
      messageLen: trimmed.length,
      // Preview is length-capped; logger.js already applies PII redaction
      // on the serialised payload so we don't duplicate the scrub here.
      messagePreview: trimmed.slice(0, 200),
    });

    // Respond 202 — accepted — even when email delivery status is unknown.
    // The user gets a confirmation either way; we'll chase down delivery
    // on our side.
    return res.status(202).json({ ok: true, received: true, id: feedbackId });
  } catch (e) {
    logger.error('support', 'feedback handler threw', { error: e.message });
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
