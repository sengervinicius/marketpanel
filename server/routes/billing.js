/**
 * routes/billing.js — Billing/subscription endpoints
 *
 * POST /api/billing/create-session  — initiate Stripe Checkout
 * POST /api/billing/webhook         — receive Stripe webhook events
 * GET  /api/billing/status          — check subscription status
 *
 * All endpoints currently return 501 stubs. Wire up billing.js once
 * Stripe credentials are configured.
 */

const express = require('express');
const router = express.Router();
const { createCheckoutSession, handleBillingWebhook, getSubscriptionStatus } = require('../billing');

// POST /api/billing/create-session
// Body: { priceId: 'price_xxx' }
// Headers: Authorization: Bearer <jwt>  (TODO: add auth middleware)
router.post('/create-session', async (req, res) => {
  try {
    // TODO: extract and verify JWT from Authorization header
    // TODO: const userId = verifyToken(req.headers.authorization?.split(' ')[1])?.userId;
    const userId = 'stub-user-id'; // placeholder until auth middleware added
    const { priceId } = req.body;
    const result = await createCheckoutSession(userId, priceId);
    res.json(result);
  } catch (e) {
    console.error('[Billing] create-session error:', e.message);
    res.status(501).json({ error: 'Billing not configured', message: e.message });
  }
});

// POST /api/billing/webhook
// Raw body required for Stripe signature verification
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  handleBillingWebhook(req, res);
});

// GET /api/billing/status
// Returns subscription status for the authenticated user
router.get('/status', async (req, res) => {
  try {
    // TODO: extract userId from JWT
    const userId = 'stub-user-id';
    const status = await getSubscriptionStatus(userId);
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
