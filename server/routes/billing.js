/**
 * routes/billing.js — billing/subscription endpoints
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const { createCheckoutSession, createPortalSession, handleBillingWebhook, getSubscriptionStatus } = require('../billing');

// POST /api/billing/create-session
// Phase 0: Wrapped in try/catch, all error paths use return
// Phase 7: Uses logger for error logging
// Validates that user exists before creating session
router.post('/create-session', async (req, res) => {
  try {
    // Phase 4: Validate that user exists
    if (!req.user || !req.user.id) {
      return sendApiError(
        res,
        { message: 'User not authenticated', code: 'auth_error' },
        'POST /api/billing/create-session'
      );
    }

    const plan = req.body?.plan === 'annual' ? 'annual' : 'monthly';
    const result = await createCheckoutSession(req.user.id, plan, {
      username: req.user.username,
      email: req.user.email,
    });
    if (result.error) {
      logger.warn('POST /api/billing/create-session', `Checkout creation failed for user ${req.user.id}`, { error: result.error });
      return res.status(503).json(result);
    }
    return res.json(result);
  } catch (e) {
    logger.error('POST /api/billing/create-session', e.message, { error: e, userId: req.user?.id });
    return sendApiError(res, e, 'POST /api/billing/create-session');
  }
});

// POST /api/billing/webhook — raw body for Stripe signature
// Phase 0: Webhook handler kept exactly as-is for Stripe signature verification
// Stripe signature verification requires raw body, not parsed JSON
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  handleBillingWebhook(req, res);
});

// GET /api/billing/status
// Phase 0: Wrapped in try/catch, all error paths use return
// Phase 7: Uses logger for error logging
router.get('/status', async (req, res) => {
  try {
    // Validate that user exists
    if (!req.user || !req.user.id) {
      return sendApiError(
        res,
        { message: 'User not authenticated', code: 'auth_error' },
        'GET /api/billing/status'
      );
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      logger.warn('GET /api/billing/status', 'Stripe not configured');
      return res.status(503).json({
        status: 'unconfigured',
        message: 'Billing not configured',
      });
    }

    const status = await getSubscriptionStatus(req.user.id);
    return res.json(status);
  } catch (e) {
    logger.error('GET /api/billing/status', e.message, { error: e, userId: req.user?.id });
    return sendApiError(res, e, 'GET /api/billing/status');
  }
});

// POST /api/billing/portal — Stripe Customer Portal (manage saved cards, cancel, invoices)
// Phase 0: Wrapped in try/catch, all error paths use return
// Phase 7: Uses logger for error logging
router.post('/portal', async (req, res) => {
  try {
    // Validate that user exists
    if (!req.user || !req.user.id) {
      return sendApiError(
        res,
        { message: 'User not authenticated', code: 'auth_error' },
        'POST /api/billing/portal'
      );
    }

    const result = await createPortalSession(req.user.id, {
      username: req.user.username,
      email: req.user.email,
    });
    if (result.error) {
      logger.warn('POST /api/billing/portal', `Portal creation failed for user ${req.user.id}`, { error: result.error });
      return res.status(503).json(result);
    }
    return res.json(result);
  } catch (e) {
    logger.error('POST /api/billing/portal', e.message, { error: e, userId: req.user?.id });
    return sendApiError(res, e, 'POST /api/billing/portal');
  }
});

module.exports = router;
