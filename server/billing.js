/**
 * billing.js — Stripe/Link integration stubs
 *
 * TODO: Replace stubs with real Stripe integration.
 *
 * Required env vars (not yet configured):
 *   STRIPE_SECRET_KEY       — from Stripe dashboard
 *   STRIPE_PUBLISHABLE_KEY  — exposed to frontend
 *   STRIPE_WEBHOOK_SECRET   — from Stripe webhook endpoint
 *   STRIPE_PRICE_ID         — recurring price ID for $20/mo subscription
 *
 * Implementation steps:
 *   1. npm install stripe
 *   2. const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
 *   3. Implement createCheckoutSession using stripe.checkout.sessions.create
 *   4. In handleBillingWebhook: verify sig, handle customer.subscription.* events
 *   5. On subscription.created/updated: updateSubscription(userId, { isPaid: true, subscriptionActive: true })
 *   6. On subscription.deleted:         updateSubscription(userId, { isPaid: false, subscriptionActive: false })
 */

const { updateSubscription, getUserById } = require('./authStore');

// TODO: const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createCheckoutSession(userId) {
  // TODO: look up / create Stripe customer
  // TODO: const session = await stripe.checkout.sessions.create({
  //   customer: user.stripeCustomerId || undefined,
  //   mode: 'subscription',
  //   line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
  //   success_url: process.env.CLIENT_URL + '/success',
  //   cancel_url:  process.env.CLIENT_URL + '/cancel',
  // });
  // return { checkoutUrl: session.url };
  return { checkoutUrl: null, stub: true, message: 'Billing not yet configured — set STRIPE_SECRET_KEY' };
}

function handleBillingWebhook(req, res) {
  // TODO: const sig = req.headers['stripe-signature'];
  // TODO: const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  // TODO: switch (event.type) { case 'customer.subscription.created': ... }
  res.status(501).json({ error: 'Webhook not yet implemented' });
}

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

module.exports = { createCheckoutSession, handleBillingWebhook, getSubscriptionStatus };
