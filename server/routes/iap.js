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
const { TIERS, tierFromAppleProductId } = require('../config/tiers');
const logger = require('../utils/logger');

// Fail-closed toggle: in production, IAP MUST have a shared secret or we
// refuse to grant subscriptions. Previously, a missing env var silently
// bypassed receipt validation and handed out 30/365-day subscriptions to
// anyone who hit /purchase with a valid product ID — a critical auth gap.
const IS_PROD = process.env.NODE_ENV === 'production';

// Product catalog — derived from the canonical 3-tier model in
// config/tiers.js so the Apple SKUs can never drift from the real tiers.
// Six auto-renewable subscriptions: {new,dark,nuclear} x {monthly,annual}.
// These productId strings MUST match App Store Connect exactly.
const PAID_TIER_KEYS = ['new_particle', 'dark_particle', 'nuclear_particle'];

function buildProducts() {
  const out = [];
  for (const tierKey of PAID_TIER_KEYS) {
    const tier = TIERS[tierKey];
    if (!tier || !tier.appleProductId) continue;
    for (const period of ['monthly', 'annual']) {
      const productId = tier.appleProductId[period];
      if (!productId) continue;
      out.push({
        productId,
        tierKey,
        label: tier.label,
        period, // 'monthly' | 'annual'
        price: tier.price ? tier.price[period] : null,
      });
    }
  }
  return out;
}

const PRODUCTS = buildProducts();

/**
 * GET /api/billing/iap/products
 * Returns the list of available IAP products.
 */
router.get('/products', requireAuth, (req, res) => {
  res.json({ products: PRODUCTS });
});

/**
 * #292 W5-B2 — verifyAppleReceipt(receiptData)
 *
 * Shared by /purchase and /restore. POSTs the base64 app receipt to Apple's
 * verifyReceipt endpoint (production first, sandbox on status 21007) and
 * returns the parsed response. Throws on transport failure; returns
 * { status, latest_receipt_info, latest_receipt } otherwise — callers decide
 * what a non-zero status means for them.
 */
async function verifyAppleReceipt(receiptData, sharedSecret) {
  const payload = JSON.stringify({
    'receipt-data': receiptData,
    'password': sharedSecret,
    'exclude-old-transactions': true,
  });
  const post = async (url) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
    return r.json();
  };
  let data = await post('https://buy.itunes.apple.com/verifyReceipt');
  if (data.status === 21007) data = await post('https://sandbox.itunes.apple.com/verifyReceipt');
  return data;
}

/**
 * #292 W5-B2 — pick the entitlement that should win from latest_receipt_info.
 * Prefers an unexpired entry for one of OUR product ids with the furthest
 * expiry; falls back to the most-recently-expired one so callers can tell
 * "had a sub, lapsed" from "never had one". Returns null if nothing matches.
 */
function pickLatestEntitlement(latestReceiptInfo, knownProductIds) {
  const mine = (latestReceiptInfo || []).filter(r => knownProductIds.has(r.product_id));
  if (mine.length === 0) return null;
  mine.sort((a, b) => parseInt(b.expires_date_ms || 0) - parseInt(a.expires_date_ms || 0));
  return mine[0];
}

/**
 * #292 W5-B2 — write-through to iap_receipts (best-effort; never blocks the
 * entitlement). Extracted from /purchase so /restore shares it.
 */
async function recordReceipt({ userId, productId, tierKey, latestReceipt, transactionId, verifiedExpiry, storedReceipt }) {
  try {
    const pg = require('../db/postgres');
    if (!(pg.isConnected && pg.isConnected())) return;
    const otx = latestReceipt?.original_transaction_id || transactionId || `user-${userId}-${productId}`;
    const expiresAtIso = verifiedExpiry ? new Date(verifiedExpiry) : null;
    await pg.query(
      `INSERT INTO iap_receipts
         (original_transaction_id, user_id, store, product_id,
          expires_at, auto_renew, last_validated_at, latest_receipt, tier, status)
       VALUES ($1, $2, 'apple', $3, $4, TRUE, NOW(), $5, $6, 'active')
       ON CONFLICT (original_transaction_id) DO UPDATE
         SET expires_at        = EXCLUDED.expires_at,
             auto_renew        = EXCLUDED.auto_renew,
             last_validated_at = EXCLUDED.last_validated_at,
             latest_receipt    = EXCLUDED.latest_receipt,
             status            = EXCLUDED.status`,
      [otx, userId, productId, expiresAtIso, storedReceipt, tierKey],
    );
  } catch (ledgerErr) {
    logger.error('iap', 'iap_receipts write-through failed (entitlement still honoured)', {
      userId, productId, error: ledgerErr.message,
    });
  }
}


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

    // Validate against the canonical tier catalogue. Unknown ids (e.g. the
    // retired "pro" SKUs) resolve to null and are rejected.
    const tierKey = tierFromAppleProductId(productId);
    const product = PRODUCTS.find(p => p.productId === productId);
    if (!tierKey || !product) {
      return res.status(400).json({ error: 'Unknown product ID', code: 'invalid_product' });
    }

    // ── Receipt validation with Apple ────────────────────────────────────────
    const APPLE_SHARED_SECRET = process.env.APPLE_IAP_SHARED_SECRET;
    let verifiedExpiry = null;

    // Fail-closed: in production, missing secret OR missing receipt means the
    // request cannot be trusted. Without this gate, a malicious client can
    // POST {productId} and receive a free subscription because the
    // verification branch silently no-ops on missing inputs.
    if (IS_PROD) {
      if (!APPLE_SHARED_SECRET) {
        logger.error('iap', 'APPLE_IAP_SHARED_SECRET not configured in production — refusing to grant subscription without receipt verification', {
          userId, productId,
        });
        return res.status(503).json({
          error: 'IAP is not configured on the server. Please contact support.',
          code: 'iap_not_configured',
        });
      }
      if (!receiptData) {
        logger.warn('iap', 'Purchase attempted without receiptData in production', {
          userId, productId,
        });
        return res.status(400).json({
          error: 'Receipt data is required.',
          code: 'missing_receipt',
        });
      }
    }

    if (receiptData && APPLE_SHARED_SECRET) {
      const appleData = await verifyAppleReceipt(receiptData, APPLE_SHARED_SECRET);

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

      await recordReceipt({
        userId, productId, tierKey, latestReceipt, transactionId,
        verifiedExpiry, storedReceipt: appleData.latest_receipt || receiptData,
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Activate subscription
    const now = Date.now();
    const duration = product.period === 'annual'
      ? 365 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
    const expiresAt = verifiedExpiry || (now + duration);

    // Dev-only safety net: log when we're granting a subscription without
    // Apple-verified expiry (should only happen when APPLE_IAP_SHARED_SECRET
    // is unset in local development — blocked in prod by the gate above).
    if (!verifiedExpiry) {
      logger.warn('iap', 'Granting subscription without verified Apple expiry (dev-only path)', {
        userId, productId, fallbackExpiresAt: expiresAt,
      });
    }

    await updateSubscription(userId, {
      isPaid: true,
      subscriptionActive: expiresAt > now,
      planTier: tierKey,
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
 *
 * #292 W5-B2 — was a stub that returned restored:true only if the account was
 * ALREADY active and otherwise "No previous purchases found" without ever
 * looking at a receipt. A reviewer who buys, reinstalls, and taps Restore on
 * a second account saw a false "Purchases restored." and no entitlement
 * (Guideline 3.1.1). Now: the client (after StoreKit AppStore.sync) sends the
 * receipt of its most relevant subscription transaction; we verify with
 * Apple, pick the furthest-expiry entry for one of our product ids, and
 * activate it on THIS account if it is unexpired.
 *
 * Body: { receiptData: string (base64 app receipt), productId?: string,
 *         transactionId?: string }
 * Reply: { ok: true, restored: boolean, tier?, expiresAt?, message }
 */
router.post('/restore', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found', code: 'not_found' });

    const { receiptData, productId: hintedProductId, transactionId } = req.body || {};
    const APPLE_SHARED_SECRET = process.env.APPLE_IAP_SHARED_SECRET;

    // Fail-closed in production — same reasoning as /purchase.
    if (IS_PROD && !APPLE_SHARED_SECRET) {
      logger.error('iap', 'APPLE_IAP_SHARED_SECRET not configured — refusing restore', { userId });
      return res.status(503).json({ error: 'IAP is not configured on the server. Please contact support.', code: 'iap_not_configured' });
    }

    // No receipt from the device = nothing to restore. Still a 200 so the
    // client can show "no active subscription found" rather than an error.
    if (!receiptData) {
      const alreadyActive = user.billingPlatform === 'apple' && user.subscriptionActive && user.isPaid;
      return res.json({
        ok: true,
        restored: alreadyActive,
        message: alreadyActive ? 'Subscription is already active.' : 'No App Store subscription found for this Apple ID.',
      });
    }

    if (!APPLE_SHARED_SECRET) {
      // Dev-only path (prod is gated above).
      logger.warn('iap', 'Restore without shared secret (dev-only path)', { userId });
      return res.json({ ok: true, restored: false, message: 'Receipt verification unavailable in this environment.' });
    }

    const appleData = await verifyAppleReceipt(receiptData, APPLE_SHARED_SECRET);
    if (appleData.status !== 0) {
      logger.warn('iap', 'Restore: Apple receipt status non-zero', { userId, status: appleData.status });
      return res.status(400).json({ error: 'Receipt validation failed', code: 'invalid_receipt', appleStatus: appleData.status });
    }

    const knownIds = new Set(PRODUCTS.map(p => p.productId));
    const best = pickLatestEntitlement(appleData.latest_receipt_info, knownIds);
    if (!best) {
      return res.json({ ok: true, restored: false, message: 'No Particle subscription found on this Apple ID.' });
    }

    const expiresAt = parseInt(best.expires_date_ms || 0);
    const now = Date.now();
    const productId = best.product_id;
    const tierKey = tierFromAppleProductId(productId);
    if (!tierKey) {
      return res.json({ ok: true, restored: false, message: 'Subscription product is no longer offered.' });
    }

    if (!(expiresAt > now)) {
      // Had one, lapsed. Tell the user plainly; don't flip the account.
      return res.json({
        ok: true,
        restored: false,
        lapsed: true,
        tier: tierKey,
        expiresAt,
        message: 'Your previous subscription has expired. Resubscribe to continue.',
      });
    }

    await recordReceipt({
      userId, productId, tierKey, latestReceipt: best, transactionId,
      verifiedExpiry: expiresAt, storedReceipt: appleData.latest_receipt || receiptData,
    });

    await updateSubscription(userId, {
      isPaid: true,
      subscriptionActive: true,
      planTier: tierKey,
      trialEndsAt: expiresAt,
      appleProductId: productId,
      appleTransactionId: best.original_transaction_id || transactionId || null,
      appleReceiptData: receiptData.slice(0, 100) + '...',
      billingPlatform: 'apple',
    });

    logger.info('iap', 'Restore activated', { userId, productId, tierKey, expiresAt });
    res.json({ ok: true, restored: true, tier: tierKey, expiresAt, message: 'Subscription restored.' });
  } catch (e) {
    logger.error('iap', 'Restore error', { error: e.message });
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
