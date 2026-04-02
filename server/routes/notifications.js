/**
 * routes/notifications.js
 * Notification preferences and webhook management.
 * Mounted at /api/notifications. All routes require requireAuth.
 *
 * Endpoints:
 *   GET  /preferences             → get notification preferences
 *   POST /preferences             → update notification preferences
 *   POST /preferences/test-webhook → test webhook URL
 */

'use strict';

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const { getUserById, mergeSettings } = require('../authStore');
const { isValidWebhookUrl, sendAlertWebhook } = require('../services/webhookService');

const VALID_CHANNELS = ['in_app', 'email', 'discord', 'webhook', 'push'];
const TIME_RE = /^\d{2}:\d{2}$/;

// ── GET /api/notifications/preferences ──────────────────────────────────
router.get('/preferences', (req, res) => {
  try {
    const user = getUserById(req.user.id);
    if (!user) return sendApiError(res, 401, 'User not found');

    const prefs = user.settings?.notificationPrefs || {
      defaultChannels: ['in_app'],
      quietHours: null,
      dailyDigest: false,
      webhookUrl: null,
      discordWebhookUrl: null,
    };

    res.json({ ok: true, data: prefs });
  } catch (e) {
    logger.error('notifications', 'GET preferences error', { error: e.message });
    sendApiError(res, 500, 'Failed to retrieve preferences');
  }
});

// ── POST /api/notifications/preferences ─────────────────────────────────
router.post('/preferences', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendApiError(res, 400, 'Body must be a preferences object');
    }

    const update = {};

    // Validate defaultChannels
    if (body.defaultChannels !== undefined) {
      if (!Array.isArray(body.defaultChannels)) {
        return sendApiError(res, 400, 'defaultChannels must be an array');
      }
      const invalid = body.defaultChannels.filter(c => !VALID_CHANNELS.includes(c));
      if (invalid.length > 0) {
        return sendApiError(res, 400, `Invalid channels: ${invalid.join(', ')}`);
      }
      // Always include in_app
      const channels = new Set(body.defaultChannels);
      channels.add('in_app');
      update.defaultChannels = [...channels];
    }

    // Validate quiet hours
    if (body.quietHours !== undefined) {
      if (body.quietHours === null) {
        update.quietHours = null;
      } else if (typeof body.quietHours === 'object') {
        const qh = body.quietHours;
        if (qh.start && !TIME_RE.test(qh.start)) {
          return sendApiError(res, 400, 'quietHours.start must be HH:MM format');
        }
        if (qh.end && !TIME_RE.test(qh.end)) {
          return sendApiError(res, 400, 'quietHours.end must be HH:MM format');
        }
        update.quietHours = {
          start: qh.start || null,
          end: qh.end || null,
          days: Array.isArray(qh.days) ? qh.days.filter(d => d >= 0 && d <= 6) : null,
        };
      }
    }

    // Validate daily digest
    if (body.dailyDigest !== undefined) {
      update.dailyDigest = !!body.dailyDigest;
    }

    // Validate webhook URLs
    if (body.webhookUrl !== undefined) {
      if (body.webhookUrl !== null && body.webhookUrl !== '' && !isValidWebhookUrl(body.webhookUrl)) {
        return sendApiError(res, 400, 'Webhook URL must be a valid HTTPS URL (no localhost)');
      }
      update.webhookUrl = body.webhookUrl || null;
    }

    if (body.discordWebhookUrl !== undefined) {
      if (body.discordWebhookUrl !== null && body.discordWebhookUrl !== '' && !isValidWebhookUrl(body.discordWebhookUrl)) {
        return sendApiError(res, 400, 'Discord webhook URL must be a valid HTTPS URL');
      }
      update.discordWebhookUrl = body.discordWebhookUrl || null;
    }

    // Merge into user settings
    const settings = await mergeSettings(req.user.id, { notificationPrefs: update });
    logger.info('notifications', 'Preferences updated', { userId: req.user.id, channels: update.defaultChannels });
    res.json({ ok: true, data: settings.notificationPrefs || update });
  } catch (e) {
    logger.error('notifications', 'POST preferences error', { error: e.message });
    sendApiError(res, 500, 'Failed to update preferences');
  }
});

// ── POST /api/notifications/preferences/test-webhook ───────────────────
router.post('/preferences/test-webhook', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !isValidWebhookUrl(url)) {
      return sendApiError(res, 400, 'Valid HTTPS webhook URL required');
    }

    const testPayload = {
      alertId: 'test_' + Date.now(),
      userId: req.user.id,
      symbol: 'TEST',
      type: 'price_above',
      condition: '≥ 100.00 (test)',
      actualValue: '101.50',
      triggeredAt: new Date().toISOString(),
    };

    const result = await sendAlertWebhook(url, testPayload);
    if (result.success) {
      res.json({ ok: true, message: 'Test webhook sent successfully' });
    } else {
      res.status(502).json({ ok: false, message: 'Webhook test failed', error: result.error || `Status: ${result.status}` });
    }
  } catch (e) {
    logger.error('notifications', 'Test webhook error', { error: e.message });
    sendApiError(res, 500, 'Webhook test failed');
  }
});

module.exports = router;
