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
 * Must be HTTPS, no localhost/private IPs, no cloud metadata endpoints.
 * Note: This blocks *hostname-form* private IPs only; DNS rebinding / domains that
 * resolve to private IPs are further mitigated by egress controls at the platform.
 */
function isValidWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();

    // Hostname length guard
    if (!host || host.length > 253) return false;

    // Localhost variants
    if (host === 'localhost' || host === 'localhost.localdomain') return false;
    if (host.endsWith('.localhost')) return false;

    // IPv6 loopback, link-local, unique-local
    if (host === '::1' || host === '[::1]') return false;
    if (host.startsWith('fe80:') || host.startsWith('[fe80:')) return false;
    if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('[fc') || host.startsWith('[fd')) return false;

    // IPv4 private/reserved ranges
    const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4) {
      const [a, b, c, d] = ipv4.slice(1).map(Number);
      if ([a, b, c, d].some(n => n < 0 || n > 255 || Number.isNaN(n))) return false;
      if (a === 0) return false;                                          // 0.0.0.0/8
      if (a === 10) return false;                                         // 10.0.0.0/8
      if (a === 127) return false;                                        // 127.0.0.0/8 loopback
      if (a === 169 && b === 254) return false;                           // 169.254.0.0/16 link-local (AWS metadata)
      if (a === 172 && b >= 16 && b <= 31) return false;                  // 172.16.0.0/12
      if (a === 192 && b === 168) return false;                           // 192.168.0.0/16
      if (a === 100 && b >= 64 && b <= 127) return false;                 // 100.64.0.0/10 CGNAT
      if (a === 192 && b === 0 && c === 0) return false;                  // 192.0.0.0/24 reserved
      if (a >= 224) return false;                                         // multicast + reserved
    }

    // Cloud metadata endpoint hostnames
    if (host === 'metadata.google.internal') return false;
    if (host === 'metadata' || host === 'metadata.goog') return false;

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
