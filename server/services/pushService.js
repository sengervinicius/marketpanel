/**
 * services/pushService.js — Push notification hook (stub).
 *
 * Phase 22: Lays the groundwork for mobile push.
 * Currently logs the payload in structured form.
 * Future: fill in with APNs/FCM/web-push implementation.
 */

'use strict';

const logger = require('../utils/logger');

/**
 * Send a push notification (stub).
 * @param {{ id: number, pushEndpoint?: string, pushToken?: string }} user
 * @param {object} payload - alert data
 * @returns {{ success: boolean, reason?: string }}
 */
async function sendAlertPush(user, payload) {
  const endpoint = user.pushEndpoint || user.pushToken;
  if (!endpoint) {
    return { success: false, reason: 'no_push_endpoint' };
  }

  // TODO: Implement real push delivery via APNs/FCM/web-push
  // For now, log the payload so it's visible in structured logs
  logger.info('push', 'Push notification queued (stub)', {
    userId: user.id,
    alertId: payload.alertId,
    symbol: payload.symbol,
    type: payload.type,
    endpoint: endpoint.slice(0, 30) + '...',
  });

  return { success: true, reason: 'stub_logged' };
}

module.exports = { sendAlertPush };
