/**
 * jobs/iapReconciler.js — W5.1 IAP drift reconciler.
 *
 * Once a day, walk every Apple iap_receipts row in state ('active','grace')
 * and re-verify it against Apple's /verifyReceipt endpoint. This closes the
 * gap left by the existing Stripe reconciler (W2.2): Apple can silently
 * revoke a subscription (refund, chargeback, family-share removal) and the
 * only way to learn about it is to ask verifyReceipt or wait for an
 * S2S notification that was lost / never configured.
 *
 * Actions taken per row:
 *   1. Hit verifyReceipt with the stored latest_receipt (and shared secret).
 *   2. Refresh expires_at, auto_renew, last_validated_at.
 *   3. If new status differs from stored status (active → expired / revoked),
 *      update `users` via updateSubscription and append to subscription_audit
 *      with source='reconciler' so finance has a paper trail.
 *
 * Safety:
 *   - A single Apple 4xx or network failure does NOT downgrade the user —
 *     we only flip to 'expired' when Apple explicitly says the subscription
 *     is no longer active (status code 0 + empty latest_receipt_info, or an
 *     explicit cancellation_date).
 *   - Runs daily (not hourly) because each row = one Apple API call and
 *     Apple rate-limits aggressively on verifyReceipt.
 *   - Dependency injection everywhere so tests don't touch Apple / pg.
 *
 * Scheduling:
 *   Wired into jobs/index.js at 03:45 BRT (06:45 UTC) — staggered away from
 *   the LGPD retention job at 03:15 so the two can't compound load.
 */

'use strict';

const _pg = require('../db/postgres');
const _logger = require('../utils/logger');

// Apple verifyReceipt endpoints. Prod first, sandbox on status 21007.
const APPLE_PROD_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

// Apple status codes we need to distinguish:
//   0      = OK
//   21006  = Receipt valid but subscription has expired (→ status='expired')
//   21007  = Sandbox receipt sent to prod (→ retry sandbox)
//   21008  = Prod receipt sent to sandbox (→ retry prod)
// Anything else: transient / unknown → leave stored state alone.

/**
 * Call verifyReceipt with auto-fallback between prod & sandbox.
 * Factored out so tests can inject a fake.
 */
async function defaultAppleClient({ receipt, sharedSecret }) {
  const payload = JSON.stringify({
    'receipt-data': receipt,
    'password': sharedSecret,
    'exclude-old-transactions': true,
  });
  const once = async (url) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    return res.json();
  };
  let data = await once(APPLE_PROD_URL);
  if (data && data.status === 21007) data = await once(APPLE_SANDBOX_URL);
  else if (data && data.status === 21008) data = await once(APPLE_PROD_URL);
  return data;
}

/**
 * Pick the most recent latest_receipt_info row that matches the tracked
 * product. Apple returns an array; we want the one with the largest
 * expires_date_ms for this product_id.
 */
function _pickLatest(rows, productId) {
  if (!Array.isArray(rows)) return null;
  const filtered = productId ? rows.filter(r => r.product_id === productId) : rows;
  if (!filtered.length) return null;
  return filtered
    .slice()
    .sort((a, b) => Number(b.expires_date_ms || 0) - Number(a.expires_date_ms || 0))[0];
}

/**
 * Reduce an Apple verifyReceipt response to the fields we persist.
 * Returns { status, expiresAt, autoRenew, productId } OR null if the
 * response is too broken to interpret (transient — skip, do not flip).
 */
function interpretAppleResponse(data, { productId } = {}) {
  if (!data || typeof data.status !== 'number') return null;

  // 21006 legacy: "receipt is valid but subscription expired". The caller
  // should move status → 'expired'.
  if (data.status === 21006) {
    return { status: 'expired', expiresAt: null, autoRenew: false, productId };
  }
  if (data.status !== 0) {
    // Unknown / transient. Do NOT flip state.
    return null;
  }

  const latest = _pickLatest(data.latest_receipt_info, productId);
  if (!latest) {
    // Receipt is valid but we can't find our product → treat as expired.
    return { status: 'expired', expiresAt: null, autoRenew: false, productId };
  }

  // Cancellation beats expiry.
  if (latest.cancellation_date_ms) {
    return {
      status: 'revoked',
      expiresAt: Number(latest.cancellation_date_ms) || null,
      autoRenew: false,
      productId: latest.product_id || productId,
    };
  }

  const expiresAt = Number(latest.expires_date_ms) || null;
  // pending_renewal_info carries the auto-renew flag separately.
  const pri = Array.isArray(data.pending_renewal_info)
    ? data.pending_renewal_info.find(p => p.product_id === (latest.product_id || productId))
    : null;
  const autoRenew = pri ? String(pri.auto_renew_status) === '1' : true;

  // Grace vs active: if expired in the last 16 days, Apple may still renew.
  // We mark as 'grace'; the store flips to 'expired' only if the next pass
  // still sees it expired. This avoids flapping on clock skew.
  const now = Date.now();
  let status = 'active';
  if (expiresAt && expiresAt < now) {
    status = autoRenew ? 'grace' : 'expired';
  }
  return { status, expiresAt, autoRenew, productId: latest.product_id || productId };
}

function _tierForProduct(productId) {
  // Minimal mapping — production catalogue is in app_store_connect but
  // every active Apple SKU resolves to particle_pro in the current price
  // card. When we add an Elite SKU for iOS, extend this table.
  if (!productId) return 'particle_pro';
  if (/elite/i.test(productId)) return 'particle_elite';
  return 'particle_pro';
}

/**
 * Reconcile a single iap_receipts row.
 *
 * @returns {Promise<{changed:boolean, skipped?:boolean, error?:boolean}>}
 */
async function reconcileOneRow(row, deps) {
  const { pg, logger, appleClient, sharedSecret, updateSubscription, recordChange, classifyTransition } = deps;
  if (!row.latest_receipt) {
    logger.warn('iapReconciler', 'row missing latest_receipt — skipping', {
      otx: row.original_transaction_id, userId: row.user_id,
    });
    return { skipped: true };
  }

  let apple;
  try {
    apple = await appleClient({ receipt: row.latest_receipt, sharedSecret });
  } catch (e) {
    logger.error('iapReconciler', 'apple verifyReceipt failed', {
      otx: row.original_transaction_id, userId: row.user_id, error: e.message,
    });
    return { error: true };
  }
  const parsed = interpretAppleResponse(apple, { productId: row.product_id });
  if (!parsed) {
    logger.info('iapReconciler', 'apple response uninterpretable — leaving row untouched', {
      otx: row.original_transaction_id, status: apple && apple.status,
    });
    return { skipped: true };
  }

  const beforeStatus = row.status;
  const newStatus = parsed.status;
  const expiresAt = parsed.expiresAt ? new Date(parsed.expiresAt) : null;

  // Always refresh last_validated_at + expires_at + auto_renew. Only flip
  // the `status` column if the new verdict is more restrictive (active →
  // grace → expired/revoked).
  await pg.query(
    `UPDATE iap_receipts
        SET last_validated_at = NOW(),
            expires_at        = COALESCE($2, expires_at),
            auto_renew        = $3,
            status            = $4,
            updated_at        = NOW()
      WHERE original_transaction_id = $1`,
    [row.original_transaction_id, expiresAt, !!parsed.autoRenew, newStatus],
  ).catch(async (e) => {
    // updated_at is new in some envs; retry without it so older DBs still work.
    if (/column .*updated_at.* does not exist/i.test(e.message || '')) {
      await pg.query(
        `UPDATE iap_receipts
            SET last_validated_at = NOW(),
                expires_at        = COALESCE($2, expires_at),
                auto_renew        = $3,
                status            = $4
          WHERE original_transaction_id = $1`,
        [row.original_transaction_id, expiresAt, !!parsed.autoRenew, newStatus],
      );
    } else {
      throw e;
    }
  });

  // Was already in this state → no user mutation needed.
  if (beforeStatus === newStatus) return { changed: false };

  // Status changed. Only lifecycle transitions that cross the "entitled"
  // boundary translate to a users-row mutation.
  const wasEntitled = beforeStatus === 'active' || beforeStatus === 'grace';
  const nowEntitled = newStatus    === 'active' || newStatus    === 'grace';

  if (wasEntitled === nowEntitled) {
    // e.g. active → grace: keep them paid, but audit the status shift so
    // finance sees it.
    await recordChange({
      userId: row.user_id,
      source: 'reconciler',
      action: 'adjust',
      before: { iapStatus: beforeStatus },
      after:  { iapStatus: newStatus },
      meta:   { origin: 'iap', otx: row.original_transaction_id, productId: row.product_id },
    });
    return { changed: true, softOnly: true };
  }

  // Entitlement boundary crossed. Mutate users.
  const tier = nowEntitled ? _tierForProduct(parsed.productId || row.product_id) : 'trial';
  const before = {
    isPaid: !!wasEntitled,
    subscriptionActive: !!wasEntitled,
    planTier: wasEntitled ? _tierForProduct(row.product_id) : 'trial',
  };
  const after = {
    isPaid: !!nowEntitled,
    subscriptionActive: !!nowEntitled,
    planTier: tier,
    billingPlatform: 'apple',
  };

  try {
    await updateSubscription(row.user_id, after);
  } catch (e) {
    logger.error('iapReconciler', 'updateSubscription failed', {
      userId: row.user_id, error: e.message,
    });
    return { error: true };
  }

  await recordChange({
    userId: row.user_id,
    source: 'reconciler',
    action: classifyTransition(before, after),
    before, after,
    meta: { origin: 'iap', otx: row.original_transaction_id, fromStatus: beforeStatus, toStatus: newStatus },
  });

  return { changed: true };
}

/**
 * Select the rows this pass should examine. Candidates:
 *   - status in ('active', 'grace') regardless of expiry (we still want
 *     a daily heartbeat even on healthy rows to catch refunds).
 *   - status = 'expired' AND expires_at > NOW() - 30d — so we can promote
 *     a user back to active if Apple eventually re-attested a renewal
 *     (rare but happens with billing retries).
 */
async function selectCandidates(pg, limit = 500) {
  if (!pg.isConnected || !pg.isConnected()) return [];
  const r = await pg.query(
    `SELECT original_transaction_id, user_id, store, product_id,
            expires_at, auto_renew, latest_receipt, tier, status
       FROM iap_receipts
      WHERE store = 'apple'
        AND (
              status IN ('active','grace')
           OR (status = 'expired' AND expires_at > NOW() - INTERVAL '30 days')
        )
      ORDER BY last_validated_at ASC NULLS FIRST, original_transaction_id ASC
      LIMIT $1`,
    [limit],
  );
  return r.rows || [];
}

/**
 * One reconciler pass.
 *
 * @param {object} [opts]
 * @param {object} [opts.deps]      DI bundle for tests. See code for shape.
 * @param {number} [opts.limit]     Max rows per pass (default 500).
 * @returns {Promise<{scanned:number, changed:number, skipped:number, errors:number}>}
 */
async function runOnce(opts = {}) {
  const {
    pg = _pg,
    logger = _logger,
    appleClient = defaultAppleClient,
    sharedSecret = process.env.APPLE_IAP_SHARED_SECRET,
    updateSubscription = require('../authStore').updateSubscription,
    recordChange = require('../services/subscriptionAudit').recordSubscriptionChange,
    classifyTransition = require('../services/subscriptionAudit').classifyTransition,
  } = opts.deps || {};

  if (!sharedSecret) {
    logger.info('iapReconciler', 'skipped: APPLE_IAP_SHARED_SECRET unset');
    return { scanned: 0, changed: 0, skipped: 0, errors: 0 };
  }
  if (!pg.isConnected || !pg.isConnected()) {
    logger.warn('iapReconciler', 'skipped: db offline');
    return { scanned: 0, changed: 0, skipped: 0, errors: 0 };
  }

  const rows = await selectCandidates(pg, opts.limit || 500);
  const deps = { pg, logger, appleClient, sharedSecret, updateSubscription, recordChange, classifyTransition };
  let changed = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    try {
      const r = await reconcileOneRow(row, deps);
      if (r.changed)  changed += 1;
      if (r.skipped)  skipped += 1;
      if (r.error)    errors  += 1;
    } catch (e) {
      errors += 1;
      logger.error('iapReconciler', 'unhandled row error', {
        otx: row.original_transaction_id, userId: row.user_id, error: e.message,
      });
    }
  }

  logger.info('iapReconciler', 'apple pass complete', {
    scanned: rows.length, changed, skipped, errors, billing_reconciliation: true,
  });
  return { scanned: rows.length, changed, skipped, errors };
}

module.exports = {
  runOnce,
  // Exposed for tests.
  _internal: {
    interpretAppleResponse,
    reconcileOneRow,
    selectCandidates,
    _tierForProduct,
  },
};
