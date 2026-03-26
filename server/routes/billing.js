/**
 * routes/billing.js — billing/subscription endpoints
 */

const express = require('express');
const router  = express.Router();
const { createCheckoutSession, handleBillingWebhook, getSubscriptionStatus } = require('../billing');

// POST /api/billing/create-session
router.post('/create-session', async (req, res) => {
  try {
    const result = await createCheckoutSession(req.user.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/billing/webhook — raw body for Stripe signature
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  handleBillingWebhook(req, res);
});

// GET /api/billing/status
router.get('/status', async (req, res) => {
  try {
    const status = await getSubscriptionStatus(req.user.id);
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
