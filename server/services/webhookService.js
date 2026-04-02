/**
 * services/webhookService.js — Webhook/Discord alert delivery.
 *
 * Sends alert payloads to user-configured webhook URLs.
 * Supports Discord-compatible format and generic JSON.
 */

'use strict';

const logger = require('../utils/logger');

const WEBHOOK_TIMEOUT = 8000;

/**
 * Validate a webhook URL.
 * Must be HTTPS, no localhost/private IPs.
 */
function isValidWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('172.')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a Discord-compatible embed payload.
 */
function buildDiscordPayload(payload) {
  const typeLabel = (payload.type || '').replace(/_/g, ' ').toUpperCase();
  const appUrl = process.env.CLIENT_URL || 'https://senger-client.onrender.com';

  return {
    username: 'Senger Alerts',
    embeds: [{
      title: `Alert Triggered — ${payload.symbol}`,
      color: 0xff6600,
      fields: [
        { name: 'Type', value: typeLabel, inline: true },
        { name: 'Condition', value: payload.condition || '—', inline: true },
        { name: 'Actual', value: payload.actualValue || '—', inline: true },
      ],
      footer: { text: 'Senger Market Terminal' },
      timestamp: payload.triggeredAt || new Date().toISOString(),
      url: appUrl,
    }],
  };
}

/**
 * Build a generic JSON payload.
 */
function buildGenericPayload(payload) {
  return {
    source: 'senger-market-terminal',
    event: 'alert_triggered',
    alertId: payload.alertId,
    symbol: payload.symbol,
    type: payload.type,
    condition: payload.condition,
    actualValue: payload.actualValue,
    triggeredAt: payload.triggeredAt,
    userId: payload.userId,
  };
}

/**
 * Send alert to a webhook URL.
 * @param {string} webhookUrl
 * @param {object} payload - alert data
 * @param {{ format?: 'discord'|'generic' }} opts
 * @returns {{ success: boolean, status?: number, error?: string }}
 */
async function sendAlertWebhook(webhookUrl, payload, opts = {}) {
  if (!webhookUrl || !isValidWebhookUrl(webhookUrl)) {
    return { success: false, error: 'invalid_url' };
  }

  const format = opts.format || (webhookUrl.includes('discord.com') ? 'discord' : 'generic');
  const body = format === 'discord' ? buildDiscordPayload(payload) : buildGenericPayload(payload);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'SengerMarketTerminal/1.0' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const success = res.status >= 200 && res.status < 300;
    if (!success) {
      logger.warn('webhook', 'Non-2xx response', { url: webhookUrl.slice(0, 60), status: res.status, alertId: payload.alertId });
    } else {
      logger.info('webhook', 'Delivered', { alertId: payload.alertId, symbol: payload.symbol, format });
    }
    return { success, status: res.status };
  } catch (e) {
    clearTimeout(timer);
    logger.error('webhook', 'Send failed', { alertId: payload.alertId, error: e.message });
    return { success: false, error: e.message };
  }
}

module.exports = { isValidWebhookUrl, sendAlertWebhook, buildDiscordPayload, buildGenericPayload };
