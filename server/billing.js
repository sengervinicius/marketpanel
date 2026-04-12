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
  // If user already has a stripeCustomerId, verify it still exists
  // (handles test→live mode switch where old customer IDs are invalid)
  if (user.stripeCustomerId) {
    try {
      await stripe.customers.retrieve(user.stripeCustomerId);
      return user.stripeCustomerId;
    } catch (err) {
      console.warn(`[billing] Stale stripeCustomerId ${user.stripeCustomerId} for user ${user.id} — creating new customer`);
      // Fall through to search / create
    }
  }

  // Search Stripe for existing customer by userId metadata (handles case where
  // in-memory store is empty but customer was already created in a previous session)
  try {
    const existing = await stripe.customers.search({
      query: `metadata["userId"]:"${user.id}"`,
      limit: 1,
    });
    if (existing.data.length > 0) {
      const cid = existing.data[0].id;
      console.log(`[billing] Found existing Stripe customer ${cid} for user ${user.id} via search`);
      await updateSubscription(user.id, { stripeCustomerId: cid });
      return cid;
    }
  } catch (searchErr) {
    console.warn(`[billing] Stripe customer search failed:`, searchErr.message);
    // Fall through to create new
  }

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
 *
 * @param {number} userId - User ID from JWT
 * @param {string} plan - 'monthly' or 'annual'
 * @param {object} userContext - { username, email } from the route handler (JWT-verified)
 */
async function createCheckoutSession(userId, plan = 'monthly', userContext = {}) {
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

  // Build user object: prefer in-memory store, fall back to JWT-provided context.
  // This ensures billing works even when the in-memory store hasn't been populated
  // (e.g. MongoDB is empty or hydration failed).
  let user = getUserById(userId);
  if (!user) {
    console.warn(`[billing] getUserById(${userId}) returned null — using JWT context`);
    user = {
      id: userId,
      username: userContext.username || null,
      email: userContext.email || null,
      stripeCustomerId: null,
    };
  }

  let customerId;
  try {
    customerId = await ensureStripeCustomer(stripe, user);
  } catch (custErr) {
    console.error(`[billing] Customer error:`, custErr.message);
    return {
      error: `Checkout failed: ${custErr.message}`,
      configured: true,
    };
  }

  const clientUrl  = process.env.CLIENT_URL || 'http://localhost:5173';

  console.log(`[billing] Creating checkout session for user ${userId}, priceId: ${priceId?.slice(0, 20)}..., customer: ${customerId}`);

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
      error: `Checkout failed: ${stripeErr.message}`,
      configured: true,
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
async function createPortalSession(userId, userContext = {}) {
  const stripe = getStripe();
  if (!stripe) {
    return {
      error: 'Billing not configured',
      message: 'Billing not configured — set STRIPE_SECRET_KEY',
      configured: false,
    };
  }

  // Try in-memory store first, fall back to JWT context
  let user = getUserById(userId);
  if (!user) {
    console.warn(`[billing] portal: getUserById(${userId}) returned null — using JWT context`);
    user = {
      id: userId,
      username: userContext.username || null,
      stripeCustomerId: null,
    };
  }

  // If we don't have stripeCustomerId from memory, try to find it via Stripe search
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    try {
      const customers = await stripe.customers.search({
        query: `metadata["userId"]:"${userId}"`,
        limit: 1,
      });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        console.log(`[billing] portal: found customer ${customerId} via Stripe search for user ${userId}`);
      }
    } catch (searchErr) {
      console.warn(`[billing] portal: Stripe customer search failed:`, searchErr.message);
    }
  }

  if (!customerId) {
    return {
      error: 'No billing account found — subscribe first',
      configured: true,
    };
  }

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const session = await stripe.billingPortal.sessions.create({
    customer:   customerId,
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
  // Try in-memory store first
  const { findUserByStripeCustomerId } = require('./authStore');
  const user = findUserByStripeCustomerId(customerId);
  if (user) return user.id;

  // Fallback: look up customer in Stripe to get userId from metadata
  const stripe = getStripe();
  if (stripe) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.metadata?.userId) {
        return Number(customer.metadata.userId);
      }
    } catch (err) {
      console.warn(`[billing] findUserIdByCustomer: Stripe lookup failed for ${customerId}:`, err.message);
    }
  }

  return null;
}

// ── Subscription status ───────────────────────────────────────────────────────

async function getSubscriptionStatus(userId) {
  const user = getUserById(userId);

  // If user is in memory, use cached subscription fields
  if (user) {
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

  // User not in memory — try to check subscription via Stripe API
  const stripe = getStripe();
  if (!stripe) return { status: 'unknown' };

  try {
    const customers = await stripe.customers.search({
      query: `metadata["userId"]:"${userId}"`,
      limit: 1,
    });
    if (customers.data.length > 0) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customers.data[0].id,
        status: 'active',
        limit: 1,
      });
      if (subscriptions.data.length > 0) {
        return { status: 'active', isPaid: true };
      }
    }
  } catch (err) {
    console.warn(`[billing] getSubscriptionStatus: Stripe lookup failed for user ${userId}:`, err.message);
  }

  // Default: treat as trial/new user (not expired) so checkout flow works
  return { status: 'unknown', isPaid: false };
}

module.exports = {
  createCheckoutSession,
  createPortalSession,
  handleBillingWebhook,
  getSubscriptionStatus,
};
