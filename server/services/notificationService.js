/**
 * services/notificationService.js — Central alert notification dispatcher.
 *
 * Orchestrates delivery across all enabled channels per user preferences.
 * Handles quiet hours, cooldowns, deduplication, retries, and logging.
 */

'use strict';

const logger = require('../utils/logger');
const { sendAlertEmail } = require('./emailService');
const { sendAlertWebhook } = require('./webhookService');
const { sendAlertPush } = require('./pushService');
const { getUserById } = require('../authStore');

// ── Deduplication ──────────────────────────────────────────────────────────
// Track recent dispatches: key = `${alertId}:${triggeredAt}` → timestamp
const _dispatched = new Map();
const DEDUPE_WINDOW_MS = 5 * 60_000; // 5 min window

// Cleanup old dedupe entries every 2 minutes
setInterval(() => {
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  for (const [k, ts] of _dispatched) {
    if (ts < cutoff) _dispatched.delete(k);
  }
}, 120_000).unref();

function isDuplicate(alertId, triggeredAt) {
  const key = `${alertId}:${triggeredAt}`;
  if (_dispatched.has(key)) return true;
  _dispatched.set(key, Date.now());
  return false;
}

// ── Cooldown check ─────────────────────────────────────────────────────────
const DEFAULT_COOLDOWN_SEC = 300; // 5 min

function isOnCooldown(alert) {
  const cooldownSec = alert.cooldownSeconds ?? DEFAULT_COOLDOWN_SEC;
  if (!alert.lastNotifiedAt) return false;
  const elapsed = (Date.now() - new Date(alert.lastNotifiedAt).getTime()) / 1000;
  return elapsed < cooldownSec;
}

// ── Quiet hours ────────────────────────────────────────────────────────────
/**
 * Check if current time is within user's quiet hours.
 * @param {{ start: string, end: string, days?: number[] }} quietHours - e.g. { start: '22:00', end: '07:00' }
 * @returns {boolean}
 */
function isQuietHour(quietHours) {
  if (!quietHours || !quietHours.start || !quietHours.end) return false;

  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();

  // Check day-of-week filter if specified
  if (quietHours.days && Array.isArray(quietHours.days)) {
    if (!quietHours.days.includes(now.getDay())) return false;
  }

  const [sh, sm] = quietHours.start.split(':').map(Number);
  const [eh, em] = quietHours.end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin <= endMin) {
    // Same day range (e.g. 09:00–17:00)
    return currentMin >= startMin && currentMin < endMin;
  } else {
    // Overnight range (e.g. 22:00–07:00)
    return currentMin >= startMin || currentMin < endMin;
  }
}

// ── Retry with backoff ─────────────────────────────────────────────────────
async function withRetry(fn, { maxRetries = 2, baseDelayMs = 30000, retryOn5xx = true } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await fn();
    if (result.success) return result;

    // Don't retry 4xx errors
    if (result.status && result.status >= 400 && result.status < 500) return result;
    if (!retryOn5xx && result.status >= 500) return result;

    if (attempt < maxRetries) {
      const delay = baseDelayMs * Math.pow(2, attempt);
      logger.info('notify', `Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return { success: false, error: 'max_retries_exhausted' };
}

// ── Build consistent payload ───────────────────────────────────────────────
function buildPayload(alert, context = {}) {
  const params = alert.parameters || {};
  let condition = '';
  switch (alert.type) {
    case 'price_above':
    case 'fx_level_above':
      condition = `≥ ${params.targetPrice}`; break;
    case 'price_below':
    case 'fx_level_below':
      condition = `≤ ${params.targetPrice}`; break;
    case 'pct_move_from_entry':
      condition = `${params.direction === 'down' ? '↓' : params.direction === 'up' ? '↑' : '↕'} ${Math.abs(params.pctChange || 0)}% from ${params.entryPrice}`; break;
    case 'screener':
      condition = `Screener ${params.matchMode === 'new_match' ? 'new matches' : 'count changed'}`; break;
    default:
      condition = alert.type;
  }

  return {
    alertId: alert.id,
    userId: alert.userId,
    symbol: alert.symbol,
    type: alert.type,
    condition,
    actualValue: context.actualValue || context.price?.toString() || '—',
    triggeredAt: alert.triggeredAt || new Date().toISOString(),
  };
}

// ── Main dispatcher ────────────────────────────────────────────────────────
/**
 * Dispatch alert notifications to all enabled channels for a user.
 * @param {object} alert - The triggered alert
 * @param {object} context - Additional context (price, etc.)
 */
async function dispatchAlert(alert, context = {}) {
  const start = Date.now();
  const user = getUserById(alert.userId);
  if (!user) {
    logger.warn('notify', 'User not found for alert dispatch', { alertId: alert.id, userId: alert.userId });
    return;
  }

  // Deduplication
  if (isDuplicate(alert.id, alert.triggeredAt)) {
    logger.info('notify', 'Skipped duplicate dispatch', { alertId: alert.id });
    return;
  }

  // Cooldown
  if (isOnCooldown(alert)) {
    logger.info('notify', 'Skipped — on cooldown', { alertId: alert.id, cooldownSeconds: alert.cooldownSeconds ?? DEFAULT_COOLDOWN_SEC });
    return;
  }

  const payload = buildPayload(alert, context);
  const prefs = user.settings?.notificationPrefs || {};
  const alertOverride = alert.overrideChannels ? alert.channels : null;
  const channels = alertOverride || prefs.defaultChannels || ['in_app'];
  const quiet = isQuietHour(prefs.quietHours);

  const results = {};

  for (const channel of channels) {
    // Quiet hours: allow in_app always, defer others
    if (quiet && channel !== 'in_app') {
      results[channel] = { success: false, skipped: true, reason: 'quiet_hours' };
      logger.info('notify', `Skipped ${channel} — quiet hours`, { alertId: alert.id, channel });
      continue;
    }

    try {
      switch (channel) {
        case 'in_app':
          // In-app is handled by the existing triggeredAt/dismissed flow
          results.in_app = { success: true };
          break;

        case 'email':
          results.email = await withRetry(
            () => sendAlertEmail(user, payload),
            { maxRetries: 2, baseDelayMs: 30000 },
          );
          break;

        case 'discord':
        case 'webhook': {
          const url = prefs.webhookUrl || prefs.discordWebhookUrl;
          if (url) {
            results[channel] = await withRetry(
              () => sendAlertWebhook(url, payload),
              { maxRetries: 2, baseDelayMs: 10000 },
            );
          } else {
            results[channel] = { success: false, skipped: true, reason: 'no_webhook_url' };
          }
          break;
        }

        case 'push':
          results.push = await sendAlertPush(user, payload);
          break;

        default:
          results[channel] = { success: false, reason: 'unknown_channel' };
      }
    } catch (e) {
      results[channel] = { success: false, error: e.message };
      logger.error('notify', `Channel ${channel} threw`, { alertId: alert.id, error: e.message });
    }
  }

  const durationMs = Date.now() - start;
  const sent = Object.entries(results).filter(([, r]) => r.success).map(([ch]) => ch);
  const failed = Object.entries(results).filter(([, r]) => !r.success && !r.skipped).map(([ch]) => ch);
  const skipped = Object.entries(results).filter(([, r]) => r.skipped).map(([ch]) => ch);

  logger.info('notify', 'Dispatch completed', {
    alertId: alert.id,
    userId: alert.userId,
    symbol: alert.symbol,
    channels: channels.join(','),
    sent: sent.join(',') || 'none',
    failed: failed.join(',') || 'none',
    skipped: skipped.join(',') || 'none',
    quiet,
    durationMs,
  });
}

module.exports = { dispatchAlert, buildPayload, isQuietHour, isDuplicate, isOnCooldown };
