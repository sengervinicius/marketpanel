/**
 * billing.js — Stripe/Link integration stubs
 *
 * TODO: Replace these stubs with real Stripe integration.
 *
 * Required environment variables (not yet set):
 *   STRIPE_SECRET_KEY      — from Stripe dashboard
 *   STRIPE_PUBLISHABLE_KEY — exposed to frontend (VITE_STRIPE_KEY)
 *   STRIPE_WEBHOOK_SECRET  — from Stripe CLI or dashboard webhook endpoint
 *
 * User model must include:
 *   - subscriptionStatus: 'trial' | 'active' | 'cancelled' | 'expired'
 *   - stripeCustomerId: string | null
 *   - stripeSubscriptionId: string | null
 */

// TODO: const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Creates a Stripe Checkout session for the given userId.
 * Currently throws — wire this once Stripe is configured.
 * @param {string} userId
 * @param {string} priceId — Stripe Price ID (e.g. 'price_xxx')
 * @returns {Promise<{ url: string }>} The Stripe Checkout URL to redirect the user to
 */
async function createCheckoutSession(userId, priceId) {
  // TODO: look up or create Stripe customer for userId
  // TODO: const session = await stripe.checkout.sessions.create({ ... });
  // TODO: return { url: session.url };
  throw new Error('Billing not configured — set STRIPE_SECRET_KEY and implement createCheckoutSession');
}

/**
 * Handles incoming Stripe webhook events.
 * Verifies signature, processes customer.subscription.* events.
 * Currently returns 501 — wire this once Stripe is configured.
 */
function handleBillingWebhook(req, res) {
  // TODO: const sig = req.headers['stripe-signature'];
  // TODO: const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  // TODO: switch (event.type) { case 'customer.subscription.created': ... }
  res.status(501).json({ error: 'Billing webhook not implemented' });
}

/**
 * Returns the subscription status for a user.
 * Currently always returns 'trial'.
 */
async function getSubscriptionStatus(userId) {
  // TODO: query DB for user.subscriptionStatus
  return { status: 'trial', trialEndsAt: null };
}

module.exports = { createCheckoutSession, handleBillingWebhook, getSubscriptionStatus };
