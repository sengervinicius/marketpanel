/**
 * billing.js — Stripe integration
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY      — from Stripe dashboard (sk_live_... or sk_test_...)
 *   STRIPE_WEBHOOK_SECRET  — from Stripe webhook endpoint (whsec_...)
 *   STRIPE_PRICE_ID        — recurring price ID (price_...)
 *   CLIENT_URL             — your frontend URL (for redirect after checkout)
 *
 * Features:
 *   - Checkout with saved payment methods (card, Apple Pay, Google Pay)
 *   - Customer Portal for managing billing / cancelling / updating card
 *   - Webhook handler for subscription lifecycle events
 */

const { updateSubscription, getUserById } = require('./authStore');

// ── Stripe client (lazy — only initialised when env vars are present) ─────────
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!getStripe._client) {
    getStripe._client = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return getStripe._client;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ensure a Stripe customer exists for this user; return stripeCustomerId. */
async function ensureStripeCustomer(stripe, user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    metadata: { userId: String(user.id) },
    ...(user.email ? { email: user.email } : {}),
    ...(user.username ? { name: user.username } : {}),
  });

  await updateSubscription(user.id, { stripeCustomerId: customer.id });
  return customer.id;
}

// ── Checkout session ──────────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout session.
 * Returns { checkoutUrl } on success, or an error object if Stripe is not configured.
 */
async function createCheckoutSession(userId, plan = 'monthly') {
  const stripe = getStripe();
  const monthlyPriceId = process.env.STRIPE_PRICE_ID;
  const annualPriceId  = process.env.STRIPE_ANNUAL_PRICE_ID;
  const priceId = plan === 'annual' && annualPriceId ? annualPriceId : monthlyPriceId;

  if (!stripe || !priceId) {
    return {
      error: 'Billing not configured',
      message: 'Billing not configured — set STRIPE_SECRET_KEY and STRIPE_PRICE_ID',
      configured: false,
    };
  }

  const user = getUserById(userId);
  if (!user) throw new Error('User not found');

  const customerId = await ensureStripeCustomer(stripe, user);
  const clientUrl  = process.env.CLIENT_URL || 'http://localhost:5173';

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      customer:             customerId,
      mode:                 'subscription',
      payment_method_types: ['card'],            // enables Apple Pay & Google Pay automatically on eligible browsers
      payment_method_collection: 'always',       // always save the card for future charges
      line_items: [{
        price:    priceId,
        quantity: 1,
      }],
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      success_url: `${clientUrl}/?billing=success`,
      cancel_url:  `${clientUrl}/?billing=cancelled`,
      subscription_data: {
        metadata: { userId: String(userId), plan },
      },
    });
  } catch (stripeErr) {
    const code = stripeErr.code || stripeErr.type || 'unknown';
    console.error(`[billing] Stripe error (${code}):`, stripeErr.message);
    return {
      error: code === 'resource_missing'
        ? 'Subscription plan not yet configured. Please check STRIPE_PRICE_ID.'
        : `Checkout failed: ${stripeErr.message}`,
      configured: false,
    };
  }

  return { checkoutUrl: session.url };
}

// ── Customer Portal ───────────────────────────────────────────────────────────

/**
 * Create a Stripe Customer Portal session so the user can:
 *   - View and update saved payment methods (credit card, Apple Pay card, etc.)
 *   - Cancel or modify their subscription
 *   - Download invoices
 */
async function createPortalSession(userId) {
  const stripe = getStripe();
  if (!stripe) {
    return {
      error: 'Billing not configured',
      message: 'Billing not configured — set STRIPE_SECRET_KEY',
      configured: false,
    };
  }

  const user = getUserById(userId);
  if (!user) throw new Error('User not found');
  if (!user.stripeCustomerId) throw new Error('No billing account found — subscribe first');

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const session = await stripe.billingPortal.sessions.create({
    customer:   user.stripeCustomerId,
    return_url: clientUrl,
  });

  return { portalUrl: session.url };
}

// ── Webhook ───────────────────────────────────────────────────────────────────

async function handleBillingWebhook(req, res) {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(501).json({ error: 'Billing not configured' });
  }

  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(501).json({ error: 'STRIPE_WEBHOOK_SECRET not set' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (e) {
    console.error('[billing] webhook signature error:', e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    await handleWebhookEvent(stripe, event);
  } catch (e) {
    console.error('[billing] webhook handler error:', e.message);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }

  res.json({ received: true });
}

async function handleWebhookEvent(stripe, event) {
  const sub = event.data.object;

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const userId = sub.metadata?.userId
        ? Number(sub.metadata.userId)
        : await findUserIdByCustomer(sub.customer);
      if (!userId) { console.warn('[billing] no userId for customer', sub.customer); break; }

      const active = sub.status === 'active' || sub.status === 'trialing';
      await updateSubscription(userId, {
        isPaid:               active,
        subscriptionActive:   active,
        stripeSubscriptionId: sub.id,
        trialEndsAt:          sub.trial_end ? sub.trial_end * 1000 : null,
      });
      console.log(`[billing] subscription ${sub.status} → user ${userId}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const userId = sub.metadata?.userId
        ? Number(sub.metadata.userId)
        : await findUserIdByCustomer(sub.customer);
      if (!userId) break;

      await updateSubscription(userId, {
        isPaid:               false,
        subscriptionActive:   false,
        stripeSubscriptionId: null,
      });
      console.log(`[billing] subscription deleted → user ${userId}`);
      break;
    }

    case 'checkout.session.completed': {
      // Ensure stripeCustomerId is stored on user
      const session = sub;
      if (session.customer && session.metadata?.userId) {
        const userId = Number(session.metadata.userId);
        await updateSubscription(userId, { stripeCustomerId: session.customer });
      }
      break;
    }

    case 'invoice.payment_failed': {
      // Payment failed — flag user with grace period before deactivation
      const invoice = sub;
      const customerId = invoice.customer;
      const userId = await findUserIdByCustomer(customerId);
      if (!userId) { console.warn('[billing] payment_failed: no userId for customer', customerId); break; }

      const attemptCount = invoice.attempt_count || 1;
      console.warn(`[billing] payment failed for user ${userId}, attempt #${attemptCount}`);

      // After 3 failed attempts, deactivate subscription
      if (attemptCount >= 3) {
        await updateSubscription(userId, {
          isPaid: false,
          subscriptionActive: false,
        });
        console.warn(`[billing] user ${userId} deactivated after ${attemptCount} failed payment attempts`);
      }
      // Stripe handles retry scheduling via Smart Retries
      break;
    }

    case 'customer.updated': {
      // Track card expiry or customer info changes
      const customer = sub;
      const userId = await findUserIdByCustomer(customer.id);
      if (!userId) break;
      console.log(`[billing] customer updated for user ${userId}`);
      break;
    }

    case 'charge.dispute.created': {
      // Chargeback/dispute — log for manual review
      const dispute = sub;
      console.error(`[billing] DISPUTE created: ${dispute.id}, amount: ${dispute.amount}, reason: ${dispute.reason}`);
      break;
    }

    default:
      // Ignore other events
      break;
  }
}

async function findUserIdByCustomer(customerId) {
  const { findUserByStripeCustomerId } = require('./authStore');
  const user = findUserByStripeCustomerId(customerId);
  return user ? user.id : null;
}

// ── Subscription status ───────────────────────────────────────────────────────

async function getSubscriptionStatus(userId) {
  const user = getUserById(userId);
  if (!user) return { status: 'unknown' };
  const now = Date.now();
  if (user.isPaid && user.subscriptionActive) return { status: 'active', isPaid: true };
  if (user.trialEndsAt && now < user.trialEndsAt) {
    return {
      status: 'trial',
      isPaid: false,
      trialEndsAt: user.trialEndsAt,
      trialDaysRemaining: Math.max(0, Math.ceil((user.trialEndsAt - now) / 86400000)),
    };
  }
  return { status: 'expired', isPaid: false };
}

module.exports = {
  createCheckoutSession,
  createPortalSession,
  handleBillingWebhook,
  getSubscriptionStatus,
};
