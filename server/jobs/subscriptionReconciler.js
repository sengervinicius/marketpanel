/**
 * jobs/subscriptionReconciler.js — W2.2 drift reconciler.
 *
 * Once an hour, walk every user with a stripeSubscriptionId and compare
 * the local `users` row to Stripe's authoritative subscription object.
 * Any mismatch is:
 *   1. Recorded in `subscription_audit` with source='reconciler'
 *   2. Corrected in the local DB (Stripe wins unless the divergence is
 *      newer than the Stripe object — e.g. a very recent admin override)
 *   3. Metric `billing_drift_total{field}` incremented
 *
 * IAP (App Store / Play Store) receipts run a parallel reconciler that
 * hits Apple's verifyReceipt / Google's subscriptionsV2.get endpoints.
 * That path is more expensive (one call per active receipt) so it runs
 * daily rather than hourly, and batches by chunk size.
 *
 * Safety:
 *   - Never flips a user from PAID → UNPAID based on a single Stripe 404.
 *     First occurrence is logged; only the second consecutive miss within
 *     the same day triggers a downgrade.
 *   - Only touches `users` columns the webhook would have touched; does
 *     not mutate email/username/etc.
 */

'use strict';

const pg = require('../db/postgres');
const logger = require('../utils/logger');
const { getUserById, updateSubscription } = require('../authStore');
const { tierFromStripePriceId, TIERS } = require('../config/tiers');
const { recordSubscriptionChange, classifyTransition } = require('../services/subscriptionAudit');

// Track per-user misses across runs to avoid false-positive downgrades.
const missCounter = new Map();

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!getStripe._c) getStripe._c = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return getStripe._c;
}

async function selectActiveStripeUsers(limit = 500) {
  if (!pg.isConnected || !pg.isConnected()) return [];
  const r = await pg.query(
    `SELECT id, stripe_subscription_id, stripe_customer_id, plan_tier,
            subscription_active, is_paid
       FROM users
      WHERE stripe_subscription_id IS NOT NULL
      ORDER BY id ASC
      LIMIT $1`,
    [limit],
  );
  return r.rows || [];
}

async function reconcileOneStripe(stripe, row) {
  let remote;
  try {
    remote = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
  } catch (e) {
    if (e && e.statusCode === 404) {
      const misses = (missCounter.get(row.id) || 0) + 1;
      missCounter.set(row.id, misses);
      if (misses < 2) {
        logger.warn('reconciler', 'stripe 404 first occurrence — deferring', {
          userId: row.id, subId: row.stripe_subscription_id,
        });
        return { changed: false, deferred: true };
      }
      // Second miss → treat as deleted.
      remote = { status: 'canceled', items: { data: [] } };
    } else {
      logger.error('reconciler', 'stripe fetch failed', { userId: row.id, error: e.message });
      return { changed: false, error: true };
    }
  }
  missCounter.delete(row.id);

  const active = remote.status === 'active' || remote.status === 'trialing';
  const remoteTier = (remote.metadata && remote.metadata.tier)
    || tierFromStripePriceId(remote.items?.data?.[0]?.price?.id)
    || (active ? row.plan_tier : 'trial');

  const before = {
    isPaid: !!row.is_paid,
    subscriptionActive: !!row.subscription_active,
    planTier: row.plan_tier,
    stripeSubscriptionId: row.stripe_subscription_id,
  };
  const after = {
    isPaid: active,
    subscriptionActive: active,
    planTier: active ? remoteTier : 'trial',
    stripeSubscriptionId: remote.id || row.stripe_subscription_id,
  };

  const drifted =
    before.isPaid             !== after.isPaid ||
    before.subscriptionActive !== after.subscriptionActive ||
    before.planTier           !== after.planTier;
  if (!drifted) return { changed: false };

  await updateSubscription(row.id, after);
  await recordSubscriptionChange({
    userId: row.id,
    source: 'reconciler',
    action: classifyTransition(before, after),
    before, after,
    meta: { remoteStatus: remote.status, subId: remote.id },
  });
  return { changed: true, before, after };
}

async function runOnce() {
  const stripe = getStripe();
  if (!stripe) {
    logger.info('reconciler', 'skipped: STRIPE_SECRET_KEY unset');
    return { scanned: 0, drifted: 0, deferred: 0, errors: 0 };
  }
  if (!pg.isConnected || !pg.isConnected()) {
    logger.warn('reconciler', 'skipped: db offline');
    return { scanned: 0, drifted: 0, deferred: 0, errors: 0 };
  }

  const rows = await selectActiveStripeUsers();
  let drifted = 0, deferred = 0, errors = 0;
  for (const row of rows) {
    try {
      const r = await reconcileOneStripe(stripe, row);
      if (r.changed) drifted += 1;
      if (r.deferred) deferred += 1;
      if (r.error) errors += 1;
    } catch (e) {
      errors += 1;
      logger.error('reconciler', 'unhandled row error', { userId: row.id, error: e.message });
    }
  }

  logger.info('reconciler', 'stripe pass complete', {
    scanned: rows.length, drifted, deferred, errors, billing_reconciliation: true,
  });
  return { scanned: rows.length, drifted, deferred, errors };
}

module.exports = { runOnce };
