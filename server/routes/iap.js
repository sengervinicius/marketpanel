/**
 * routes/iap.js
 *
 * Apple In-App Purchase endpoints.
 * Handles receipt validation and subscription management for iOS users.
 *
 * Endpoints:
 *   GET  /api/billing/iap/products  — list available IAP products
 *   POST /api/billing/iap/purchase  — validate receipt and activate subscription
 *   POST /api/billing/iap/restore   — restore previous purchases
 *
 * Apple Server-to-Server notifications should be configured in App Store Connect
 * to POST to /api/billing/iap/webhook (separate from Stripe webhook).
 */

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../authMiddleware');
const { getUserById, updateSubscription } = require('../authStore');

// Product catalog — must match App Store Connect
const PRODUCTS = [
  {
    id: 'com.senger.market.pro.monthly',
    title: 'Senger Pro Monthly',
    description: 'Full access to all market data, alerts, and portfolio tools.',
    period: 'monthly',
    // Price is set in App Store Connect; this is informational only
    priceDisplay: '$9.99/month',
  },
  {
    id: 'com.senger.market.pro.yearly',
    title: 'Senger Pro Yearly',
    description: 'Full access — save 40% with annual billing.',
    period: 'yearly',
    priceDisplay: '$69.99/year',
  },
];

/**
 * GET /api/billing/iap/products
 * Returns the list of available IAP products.
 */
router.get('/products', requireAuth, (req, res) => {
  res.json({ products: PRODUCTS });
});

/**
 * POST /api/billing/iap/purchase
 * Validate an Apple receipt and activate the subscription.
 *
 * In production, this should:
 *   1. Receive the receipt data from the iOS client
 *   2. Validate it with Apple's /verifyReceipt endpoint
 *   3. Parse the latest_receipt_info for subscription status
 *   4. Update the user's subscription fields
 *
 * For now, this is a scaffold that handles the request flow.
 * Full receipt validation requires Apple shared secret configuration.
 */
router.post('/purchase', requireAuth, async (req, res) => {
  try {
    const { productId, receiptData, transactionId } = req.body;
    const userId = req.user.id;

    if (!productId) {
      return res.status(400).json({ error: 'productId is required', code: 'missing_product' });
    }

    const product = PRODUCTS.find(p => p.id === productId);
    if (!product) {
      return res.status(400).json({ error: 'Unknown product ID', code: 'invalid_product' });
    }

    // ── Receipt validation with Apple ────────────────────────────────────────
    const APPLE_SHARED_SECRET = process.env.APPLE_IAP_SHARED_SECRET;
    let verifiedExpiry = null;

    if (receiptData && APPLE_SHARED_SECRET) {
      // Try production first, fall back to sandbox (status 21007)
      let verifyUrl = 'https://buy.itunes.apple.com/verifyReceipt';
      const payload = JSON.stringify({
        'receipt-data': receiptData,
        'password': APPLE_SHARED_SECRET,
        'exclude-old-transactions': true,
      });

      let appleRes = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      let appleData = await appleRes.json();

      // Status 21007 = sandbox receipt sent to production — retry with sandbox
      if (appleData.status === 21007) {
        verifyUrl = 'https://sandbox.itunes.apple.com/verifyReceipt';
        appleRes = await fetch(verifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        appleData = await appleRes.json();
      }

      if (appleData.status !== 0) {
        console.warn(`[iap] Apple receipt status: ${appleData.status}`);
        return res.status(400).json({ error: 'Receipt validation failed', code: 'invalid_receipt', appleStatus: appleData.status });
      }

      // Parse latest_receipt_info for subscription expiry
      const latestReceipt = (appleData.latest_receipt_info || [])
        .filter(r => r.product_id === productId)
        .sort((a, b) => parseInt(b.expires_date_ms || 0) - parseInt(a.expires_date_ms || 0))[0];

      if (latestReceipt?.expires_date_ms) {
        verifiedExpiry = parseInt(latestReceipt.expires_date_ms);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Activate subscription
    const now = Date.now();
    const duration = product.period === 'yearly'
      ? 365 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
    const expiresAt = verifiedExpiry || (now + duration);

    await updateSubscription(userId, {
      isPaid: true,
      subscriptionActive: expiresAt > now,
      trialEndsAt: expiresAt,
      appleProductId: productId,
      appleTransactionId: transactionId || null,
      appleReceiptData: receiptData ? receiptData.slice(0, 100) + '...' : null,
      billingPlatform: 'apple',
    });

    console.log(`[iap] Purchase activated: user=${userId} product=${productId}`);
    res.json({ ok: true, message: 'Subscription activated' });
  } catch (e) {
    console.error('[iap] Purchase error:', e.message);
    res.status(500).json({ error: 'Purchase validation failed. Please try again.', code: 'purchase_failed' });
  }
});

/**
 * POST /api/billing/iap/restore
 * Restore previous Apple purchases for the current user.
 * Checks if the user has an existing Apple subscription.
 */
router.post('/restore', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = getUserById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'not_found' });
    }

    // Check if user has an active Apple subscription
    if (user.billingPlatform === 'apple' && user.subscriptionActive && user.isPaid) {
      return res.json({ ok: true, restored: true, message: 'Subscription is already active.' });
    }

    // In production, you would:
    // 1. Request the receipt from the iOS client
    // 2. Validate with Apple
    // 3. Check for active subscriptions in the receipt
    // 4. Reactivate if found

    res.json({ ok: true, restored: false, message: 'No previous purchases found.' });
  } catch (e) {
    console.error('[iap] Restore error:', e.message);
    res.status(500).json({ error: 'Restore failed. Please try again.', code: 'restore_failed' });
  }
});

/**
 * POST /api/billing/iap/webhook
 * Apple Server-to-Server notification handler.
 * Configure in App Store Connect → App → App Information → Server Notifications URL.
 *
 * Handles subscription lifecycle events:
 *   - INITIAL_BUY, DID_RENEW, DID_CHANGE_RENEWAL_STATUS, CANCEL, etc.
 */
router.post('/webhook', express.json(), async (req, res) => {
  try {
    const notification = req.body;
    const notificationType = notification.notification_type;

    console.log(`[iap/webhook] Received: ${notificationType}`);

    // In production, decode and verify the JWS signed notification
    // using Apple's certificates, then update user subscription status.
    //
    // For App Store Server Notifications V2:
    // const { signedPayload } = req.body;
    // const decoded = jwt.decode(signedPayload, { complete: true });
    // Verify signature with Apple's certificate chain...
    // Parse transaction info and update user subscription.

    res.json({ ok: true });
  } catch (e) {
    console.error('[iap/webhook] Error:', e.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
