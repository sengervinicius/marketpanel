/**
 * services/subscriptionAudit.js — W2.1 subscription state-change audit log.
 *
 * Every transition of a user's plan tier, paid flag, or stripeSubscriptionId
 * funnels through `recordSubscriptionChange()` so we have a full paper trail
 * for every change — whether it originated from a Stripe webhook, an IAP
 * receipt validation, a manual admin override, or an internal reconciler
 * correcting drift.
 *
 * Why we care:
 *   1. Finance reconciliation — "why does this user have Pro in prod but
 *      Trial in Stripe?" becomes answerable in a single query.
 *   2. Chargeback disputes — Stripe often asks "prove the user had access
 *      during this window"; the audit log is the proof.
 *   3. Incident response — if a billing bug accidentally downgrades users,
 *      this log is how we enumerate and reverse the change.
 *
 * The `subscription_audit` table is append-only. Retention is aligned with
 * fiscal-law requirements (5 years) per docs/LGPD_COMPLIANCE.md §2.
 */

'use strict';

const pg = require('../db/postgres');
const logger = require('../utils/logger');

/**
 * @param {object} entry
 * @param {number} entry.userId
 * @param {string} entry.source   — 'stripe_webhook' | 'iap_receipt' | 'admin_override'
 *                                  | 'reconciler' | 'self_serve'
 * @param {string} entry.action   — 'upgrade' | 'downgrade' | 'renew' | 'cancel'
 *                                  | 'reactivate' | 'trial_start' | 'trial_end'
 *                                  | 'payment_failed' | 'payment_recovered' | 'adjust'
 * @param {object} entry.before   — {tier,isPaid,subscriptionActive,stripeSubscriptionId}
 * @param {object} entry.after
 * @param {object} [entry.meta]   — free-form (eventId, priceId, reason, actor)
 */
async function recordSubscriptionChange(entry) {
  const { userId, source, action, before = {}, after = {}, meta = {} } = entry;
  if (!pg.isConnected || !pg.isConnected()) {
    logger.warn('subscriptionAudit', 'db offline — audit log dropped', { userId, action, source });
    return;
  }
  try {
    await pg.query(
      `INSERT INTO subscription_audit
         (user_id, source, action, before_state, after_state, meta, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, NOW())`,
      [userId, source, action, JSON.stringify(before), JSON.stringify(after), JSON.stringify(meta)],
    );
    logger.info('subscriptionAudit', 'recorded', {
      userId, source, action,
      from: before.planTier, to: after.planTier,
      billing_event: action,
    });
  } catch (e) {
    // Never block the webhook / IAP flow on audit-log failure.
    logger.error('subscriptionAudit', 'insert failed', { userId, action, error: e.message });
  }
}

/**
 * Compute a transition verdict given a before/after snapshot. The output
 * is fed into `action` on recordSubscriptionChange.
 */
function classifyTransition(before, after) {
  const b = before || {};
  const a = after || {};
  if (!b.isPaid && a.isPaid)               return 'activate';
  if (b.isPaid && !a.isPaid)               return 'cancel';
  if (b.planTier && a.planTier && b.planTier !== a.planTier) {
    return rank(a.planTier) > rank(b.planTier) ? 'upgrade' : 'downgrade';
  }
  if (!b.stripeSubscriptionId && a.stripeSubscriptionId) return 'activate';
  return 'adjust';
}

// ordering used only for upgrade/downgrade inference; update when a new tier ships.
const TIER_RANK = { trial: 0, new_particle: 1, particle_pro: 2, particle_elite: 3 };
function rank(t) { return TIER_RANK[t] ?? 0; }

module.exports = { recordSubscriptionChange, classifyTransition };
