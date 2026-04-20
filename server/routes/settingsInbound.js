/**
 * routes/settingsInbound.js
 *
 * P4 — user-facing API for the per-user inbound email vault address.
 *
 * Mounted at /api/settings/vault-inbound under `requireAuth`. Every
 * route acts on the authenticated user's OWN token; there is deliberately
 * no admin-by-user_id path here. An admin who wants to audit another user
 * goes through the `vault_inbound_tokens` table directly (see
 * docs/OPS_INBOUND_EMAIL.md § 'Auditing a leaked token').
 *
 * Endpoints
 * ─────────
 *   GET    /                   → { enabled, address, token, createdAt, lastUsedAt }
 *                                Lazy-mints on first call so the Settings UI
 *                                always has something to show without a
 *                                separate "create" step.
 *   POST   /rotate             → revokes the current token + mints a new one
 *                                inside a single DB transaction.
 *   POST   /disable            → revokes without replacement. Inbound to the
 *                                old address starts returning `unknown_token`.
 *
 * All responses are JSON; errors use sendApiError for consistency with the
 * rest of /api/settings. The token itself is returned verbatim in the body —
 * it IS the credential, and the user needs it to paste into the "send from"
 * address in their mail client. We NEVER log it in full (service layer
 * redacts to the first four chars).
 */
'use strict';

const express = require('express');
const router = express.Router();

const inboundTokens = require('../services/inboundTokens');
const logger = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');

// Shape the Settings UI expects. Extracted so the three handlers don't
// drift if we ever add fields (e.g. `rotatedAt`, `revokedCount`).
function serialise(row) {
  if (!row) return { enabled: false };
  return {
    enabled: true,
    address: inboundTokens.addressForToken(row.token),
    token: row.token,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

// GET /api/settings/vault-inbound
// Lazy-mint: if the user hasn't got an active token we create one now.
// This keeps the Settings page stateless — the UI doesn't need to know
// whether it's a first visit or a returning user.
router.get('/', async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return sendApiError(res, 401, 'Unauthorized');
    let row = await inboundTokens.getActiveForUser(userId);
    if (!row) {
      row = await inboundTokens.mintForUser(userId);
      logger.info('settings-inbound', 'Lazy-minted token for user', { userId });
    }
    return res.json(serialise(row));
  } catch (e) {
    logger.error('settings-inbound', 'GET failed', {
      userId: req.user && req.user.id, error: e.message,
    });
    return sendApiError(res, 500, 'Failed to load inbound address');
  }
});

// POST /api/settings/vault-inbound/rotate
// Revoke + mint in a single service call (which runs inside a DB
// transaction). The old address returns unknown_token on the very next
// delivery, even if a delivery is mid-flight when we commit.
router.post('/rotate', async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return sendApiError(res, 401, 'Unauthorized');
    // mintForUser revokes any active row first; no separate revoke call.
    const row = await inboundTokens.mintForUser(userId);
    logger.info('settings-inbound', 'Rotated token for user', { userId });
    return res.json(serialise(row));
  } catch (e) {
    logger.error('settings-inbound', 'rotate failed', {
      userId: req.user && req.user.id, error: e.message,
    });
    return sendApiError(res, 500, 'Failed to rotate inbound address');
  }
});

// POST /api/settings/vault-inbound/disable
// Disable without a replacement. A subsequent GET will lazy-mint a fresh
// one — this is intentional: "disable" is for panic scenarios and the
// user is expected to rotate-then-forget, not leave the feature off
// permanently. If we discover users want durable opt-out we'll add a
// `vault_inbound_disabled` flag on the users row.
router.post('/disable', async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return sendApiError(res, 401, 'Unauthorized');
    const didRevoke = await inboundTokens.revokeForUser(userId);
    logger.info('settings-inbound', 'Disabled inbound for user', { userId, didRevoke });
    return res.json({ enabled: false, revoked: !!didRevoke });
  } catch (e) {
    logger.error('settings-inbound', 'disable failed', {
      userId: req.user && req.user.id, error: e.message,
    });
    return sendApiError(res, 500, 'Failed to disable inbound address');
  }
});

module.exports = router;
