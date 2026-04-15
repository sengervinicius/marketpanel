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

const { updateSubscription, getUserById, findUserByStripeCustomerId } = require('./authStore');
const { sendEmail } = require('./services/emailService');
const { tierFromStripePriceId, getStripePriceId, TIERS } = require('./config/tiers');

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
 * @param {string} tier - 'new_particle', 'dark_particle', or 'nuclear_particle'
 */
async function createCheckoutSession(userId, plan = 'monthly', userContext = {}, tier = 'new_particle') {
  const stripe = getStripe();

  // Resolve Stripe price ID (tier-specific → legacy fallback chain)
  const priceId = getStripePriceId(tier, plan);

  if (!stripe) {
    console.error('[billing] STRIPE_SECRET_KEY not set — cannot create checkout');
    return {
      error: 'Billing not configured',
      message: 'Billing not configured — set STRIPE_SECRET_KEY',
      configured: false,
    };
  }
  if (!priceId) {
    console.error(`[billing] No Stripe price ID found for tier=${tier}, plan=${plan}. Check env vars: STRIPE_${tier.toUpperCase()}_${plan.toUpperCase()} or STRIPE_PRICE_ID`);
    return {
      error: 'Billing not configured',
      message: `No Stripe price configured for ${tier} (${plan}). Run stripe-setup.js and set the env vars.`,
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
        metadata: { userId: String(userId), plan, tier },
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
      // Determine tier from subscription metadata or price ID
      const subTier = sub.metadata?.tier
        || tierFromStripePriceId(sub.items?.data?.[0]?.price?.id)
        || 'new_particle';
      await updateSubscription(userId, {
        isPaid:               active,
        subscriptionActive:   active,
        stripeSubscriptionId: sub.id,
        trialEndsAt:          sub.trial_end ? sub.trial_end * 1000 : null,
        planTier:             active ? subTier : 'trial',
      });
      console.log(`[billing] subscription ${sub.status} (${subTier}) → user ${userId}`);
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
        planTier:             'trial',
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
      // Payment failed — deactivate after 3 attempts AND send dunning email
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

      // Send dunning email with link to update payment method
      const user = getUserById(userId);
      if (user) {
        const appUrl = process.env.CLIENT_URL || 'https://senger-client.onrender.com';

        const subject = 'Payment Failed — Update Your Payment Method';
        const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:24px;border-radius:8px;">
  <div style="border-bottom:2px solid #ff6600;padding-bottom:12px;margin-bottom:16px;">
    <span style="color:#ff6600;font-weight:700;font-size:18px;">PARTICLE</span>
    <span style="color:#ff6600;font-size:14px;margin-left:8px;">Payment Failed</span>
  </div>
  <div style="background:#16213e;padding:16px;border-radius:6px;margin-bottom:16px;">
    <div style="font-size:18px;font-weight:700;color:#fff;">Payment Attempt #${attemptCount} Failed</div>
    <div style="margin-top:12px;font-size:15px;color:#e0e0e0;">
      We were unable to process your subscription payment. Please update your payment method to continue your subscription.
    </div>
    <div style="margin-top:12px;font-size:14px;color:#aaa;">
      If not updated, your subscription will be canceled after multiple failed attempts.
    </div>
  </div>
  <a href="${appUrl}/?billing=manage" style="display:inline-block;background:#ff6600;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:600;font-size:14px;">Update Payment Method</a>
  <div style="margin-top:16px;font-size:11px;color:#555;">Particle Market Terminal — Payment disputes are processed securely.</div>
</div>`;

        const text = `Payment Failed\n\nPayment attempt #${attemptCount} could not be processed.\n\nPlease update your payment method to continue your subscription:\n${appUrl}/?billing=manage\n\nIf you do not update your payment, your subscription will be canceled after multiple failed attempts.`;

        await sendEmail(user, { subject, html, text });
        console.log(`[billing] payment_failed dunning email sent to user ${userId} (attempt #${attemptCount})`);
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

    case 'customer.subscription.trial_will_end': {
      // Trial ending soon — send reminder email 3 days before expiry
      const subscription = sub;
      const customerId = subscription.customer;
      const userId = await findUserIdByCustomer(customerId);
      if (!userId) { console.warn('[billing] trial_will_end: no userId for customer', customerId); break; }

      const user = getUserById(userId);
      if (!user) { console.warn('[billing] trial_will_end: user not found', userId); break; }

      const trialEndDate = new Date(subscription.trial_end * 1000);
      const appUrl = process.env.CLIENT_URL || 'https://senger-client.onrender.com';

      const subject = 'Your Particle Trial Ends Soon';
      const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:24px;border-radius:8px;">
  <div style="border-bottom:2px solid #ff6600;padding-bottom:12px;margin-bottom:16px;">
    <span style="color:#ff6600;font-weight:700;font-size:18px;">PARTICLE</span>
    <span style="color:#888;font-size:14px;margin-left:8px;">Trial Ending</span>
  </div>
  <div style="background:#16213e;padding:16px;border-radius:6px;margin-bottom:16px;">
    <div style="font-size:18px;font-weight:700;color:#fff;">Your trial expires in 3 days</div>
    <div style="margin-top:12px;font-size:15px;color:#aaa;">
      Trial ends on: <span style="color:#4ecdc4;font-weight:600;">${trialEndDate.toDateString()}</span>
    </div>
    <div style="margin-top:12px;font-size:14px;color:#e0e0e0;">
      Keep trading with uninterrupted access to Particle Market Terminal. Subscribe now to continue after your trial expires.
    </div>
  </div>
  <a href="${appUrl}/?billing=checkout" style="display:inline-block;background:#ff6600;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:600;font-size:14px;">Subscribe Now</a>
  <div style="margin-top:16px;font-size:11px;color:#555;">Particle Market Terminal — Keep your pro features active.</div>
</div>`;

      const text = `Your Particle Trial Ends Soon\n\nYour trial expires on ${trialEndDate.toDateString()}.\n\nSubscribe now to continue using Particle Market Terminal with uninterrupted access.\n\nSubscribe: ${appUrl}/?billing=checkout`;

      await sendEmail(user, { subject, html, text });
      console.log(`[billing] trial_will_end reminder sent to user ${userId}`);
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
    const tierKey = user.planTier || 'trial';
    const tierConfig = TIERS[tierKey] || TIERS.trial;

    if (user.isPaid && user.subscriptionActive) {
      return {
        status: 'active',
        isPaid: true,
        tier: tierKey,
        tierLabel: tierConfig.label,
        limits: {
          vaultDocuments: tierConfig.vaultDocuments,
          aiQueriesPerDay: tierConfig.aiQueriesPerDay,
          deepAnalysisPerDay: tierConfig.deepAnalysisPerDay,
          morningBrief: tierConfig.morningBrief,
          predictionMarkets: tierConfig.predictionMarkets,
        },
      };
    }
    if (user.trialEndsAt && now < user.trialEndsAt) {
      return {
        status: 'trial',
        isPaid: false,
        tier: 'trial',
        tierLabel: 'Trial',
        trialEndsAt: user.trialEndsAt,
        trialDaysRemaining: Math.max(0, Math.ceil((user.trialEndsAt - now) / 86400000)),
        limits: {
          vaultDocuments: TIERS.trial.vaultDocuments,
          aiQueriesPerDay: TIERS.trial.aiQueriesPerDay,
          deepAnalysisPerDay: TIERS.trial.deepAnalysisPerDay,
        },
      };
    }
    return { status: 'expired', isPaid: false, tier: 'trial' };
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
