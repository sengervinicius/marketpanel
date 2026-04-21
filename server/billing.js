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

const { updateSubscription, getUserById, findUserByStripeCustomerId, signToken, createRefreshToken, safeUser, persistUser } = require('./authStore');
const { sendEmail } = require('./services/emailService');
const { tierFromStripePriceId, getStripePriceId, TIERS } = require('./config/tiers');
const pg = require('./db/postgres');
const logger = require('./utils/logger');

// ── Price-ID hygiene ─────────────────────────────────────────────────────────
// Stripe test/live modes are isolated — a price created against sk_test_ will
// never resolve against sk_live_. Env var drift (stale ID, wrong account,
// mode mismatch) silently breaks checkout until a real user tries to pay.
// We validate at boot AND pre-flight per checkout call.
//
// Keep this list in lock-step with server/config/tiers.js → stripePriceEnv.
const TIER_PRICE_ENVS = [
  'STRIPE_NEW_PARTICLE_MONTHLY',
  'STRIPE_NEW_PARTICLE_ANNUAL',
  'STRIPE_DARK_PARTICLE_MONTHLY',
  'STRIPE_DARK_PARTICLE_ANNUAL',
  'STRIPE_NUCLEAR_PARTICLE_MONTHLY',
  'STRIPE_NUCLEAR_PARTICLE_ANNUAL',
  // Legacy fallbacks — still validated if set, so no surprises.
  'STRIPE_PRICE_ID',
  'STRIPE_ANNUAL_PRICE_ID',
];
// W2.1 audit: every webhook transition is recorded for finance + LGPD.
const { recordSubscriptionChange, classifyTransition } = require('./services/subscriptionAudit');

function _snapshot(u) {
  if (!u) return {};
  return {
    isPaid: !!u.isPaid,
    subscriptionActive: !!u.subscriptionActive,
    planTier: u.planTier || null,
    stripeSubscriptionId: u.stripeSubscriptionId || null,
  };
}

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

/**
 * Validate every configured Stripe price ID against the connected Stripe
 * account. Called at boot so ops sees broken config BEFORE a user does.
 *
 * Failure modes this catches:
 *   - Mode mismatch (price_... was made in test mode, key is live, or v.v.)
 *   - Stale ID (price was archived/deleted)
 *   - Wrong account (ID copy-pasted from a different Stripe org)
 *
 * Non-blocking: logs ERROR per bad env var but does not refuse to boot,
 * because webhook + portal endpoints and non-billing features still work.
 * Returns a summary object for tests and /health payloads.
 */
async function validateStripePriceIds() {
  const stripe = getStripe();
  if (!stripe) {
    logger.warn('billing', 'STRIPE_SECRET_KEY not set — skipping price ID validation');
    return { validated: 0, errors: [], mode: null };
  }

  const keyMode = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_')
    ? 'live'
    : (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')
      ? 'test'
      : 'unknown';
  logger.info('billing', `Stripe price validator running in ${keyMode} mode`);

  const errors = [];
  let validated = 0;

  for (const envVar of TIER_PRICE_ENVS) {
    const priceId = process.env[envVar];
    if (!priceId) continue; // unset is a separate concern, caught at checkout
    try {
      const price = await stripe.prices.retrieve(priceId);
      if (!price.active) {
        logger.error('billing', `Stripe price for ${envVar} is ARCHIVED (id=${priceId}). Checkout for this tier/plan will fail. Reactivate in Stripe dashboard or create a new price — see docs/RUNBOOK_BILLING.md.`);
        errors.push({ envVar, priceId, reason: 'archived' });
      } else {
        validated++;
      }
    } catch (err) {
      // Stripe throws "No such price" here when ID is invalid in this mode.
      const reason = err.code === 'resource_missing' ? 'not_found' : err.code || 'error';
      logger.error('billing', `Stripe price for ${envVar} is INVALID (id=${priceId}): ${err.message}. Checkout for this tier/plan will fail. Likely causes: mode mismatch (key is ${keyMode}-mode), archived price, or wrong account.`, {
        envVar, priceId, reason, stripeCode: err.code, keyMode,
      });
      errors.push({ envVar, priceId, reason, message: err.message });
    }
  }

  if (errors.length === 0) {
    logger.info('billing', `All ${validated} configured Stripe price IDs validated against ${keyMode}-mode account`);
  } else {
    logger.error('billing', `${errors.length} broken Stripe price ID(s) detected — paying users will hit checkout errors until fixed. See previous log lines for the offending env vars.`);
  }

  return { validated, errors, mode: keyMode };
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
      message: `No Stripe price configured for ${tier} (${plan}). Set STRIPE_${tier.toUpperCase()}_${plan.toUpperCase()} in Render — see docs/RUNBOOK_BILLING.md.`,
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

  // Pre-flight: verify the price ID resolves in the connected Stripe account
  // before we spin up a checkout session. If the env var points at a stale /
  // mode-mismatched / deleted price, we'd otherwise only find out *after*
  // creating the session — surfacing Stripe's raw error to the user.
  // Catching it here lets us:
  //   1. Log the specific env var that's broken so ops can fix it.
  //   2. Return a user-friendly "temporarily unavailable" message.
  //   3. Avoid creating orphan Stripe customer sessions for invalid prices.
  try {
    const p = await stripe.prices.retrieve(priceId);
    if (!p.active) {
      const envVar = `STRIPE_${tier.toUpperCase()}_${plan.toUpperCase()}`;
      logger.error('billing', `Price ID for ${envVar} is archived — cannot create checkout. See docs/RUNBOOK_BILLING.md.`, {
        userId, tier, plan, priceId, envVar,
      });
      return {
        error: 'Checkout is temporarily unavailable. Our team has been notified. Please try again later.',
        configured: true,
      };
    }
  } catch (priceErr) {
    const envVar = `STRIPE_${tier.toUpperCase()}_${plan.toUpperCase()}`;
    logger.error('billing', `Price ID for ${envVar} failed validation — checkout blocked: ${priceErr.message}`, {
      userId, tier, plan, priceId, envVar, stripeCode: priceErr.code,
    });
    return {
      error: 'Checkout is temporarily unavailable. Our team has been notified. Please try again later.',
      configured: true,
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
      // W3.1 — include {CHECKOUT_SESSION_ID} so the client can mint a fresh
      // JWT on return from checkout.stripe.com. On mobile Safari the user's
      // 15-min access token may expire during checkout, and ITP blocks the
      // refresh-cookie round-trip across the third-party redirect. Round-tripping
      // the session ID lets us bypass cookies entirely: we retrieve the session
      // from Stripe, read session.metadata.userId, and hand the client a fresh
      // token+refresh pair — so a post-Apple-Pay return never logs them out.
      success_url: `${clientUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${clientUrl}/?billing=cancelled`,
      // W3.1 — carry userId on the Session itself (not only the subscription)
      // so our verify-session endpoint can resolve the user by a single
      // stripe.checkout.sessions.retrieve() — without needing a subscription
      // to exist yet (Stripe's subscription object isn't guaranteed to be
      // attached immediately after success_url redirect).
      client_reference_id: String(userId),
      metadata: { userId: String(userId), plan, tier },
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

/**
 * Atomically claim a Stripe event for processing using INSERT … ON CONFLICT
 * DO NOTHING. The first request wins; duplicates return 200 without side
 * effects so Stripe stops retrying.
 *
 * Returns:
 *   - { alreadyProcessed: false } if this request should process the event
 *   - { alreadyProcessed: true }  if another request already handled it
 *   - { alreadyProcessed: false, bestEffort: true } if Postgres is unavailable
 *     (fall back to processing; Stripe's at-least-once semantics are preserved).
 */
async function claimStripeEvent(event) {
  if (!pg.isConnected || typeof pg.isConnected !== 'function' || !pg.isConnected()) {
    // No Postgres — cannot enforce idempotency at DB layer. Log and proceed.
    logger.warn('billing', 'Postgres unavailable — processing webhook without idempotency guard', {
      eventId: event.id, eventType: event.type,
    });
    return { alreadyProcessed: false, bestEffort: true };
  }
  try {
    const r = await pg.query(
      `INSERT INTO stripe_events_processed (event_id, event_type, received_at, status)
       VALUES ($1, $2, NOW(), 'received')
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.id, event.type]
    );
    // If no row was returned, another request already claimed this event.
    const claimed = r && r.rowCount > 0;
    return { alreadyProcessed: !claimed };
  } catch (e) {
    logger.error('billing', 'Failed to record Stripe event — proceeding best-effort', {
      eventId: event.id, error: e.message,
    });
    return { alreadyProcessed: false, bestEffort: true };
  }
}

async function markStripeEventProcessed(eventId, status, errorMessage) {
  if (!pg.isConnected || !pg.isConnected()) return;
  try {
    await pg.query(
      `UPDATE stripe_events_processed
         SET processed_at = NOW(), status = $2, error_message = $3
       WHERE event_id = $1`,
      [eventId, status, errorMessage || null]
    );
  } catch (e) {
    logger.warn('billing', 'Failed to update Stripe event status', {
      eventId, status, error: e.message,
    });
  }
}

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
    logger.error('billing', 'webhook signature error', { error: e.message });
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // W0.6: Idempotency — Stripe may redeliver the same event on retry or network
  // flaps. Claim it atomically; if another request already processed it, 200.
  const claim = await claimStripeEvent(event);
  if (claim.alreadyProcessed) {
    logger.info('billing', 'Stripe event already processed — skipping', {
      eventId: event.id, eventType: event.type,
    });
    return res.json({ received: true, duplicate: true });
  }

  try {
    await handleWebhookEvent(stripe, event);
    await markStripeEventProcessed(event.id, 'processed');
  } catch (e) {
    logger.error('billing', 'webhook handler error', {
      eventId: event.id, eventType: event.type, error: e.message,
    });
    await markStripeEventProcessed(event.id, 'failed', e.message);
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
      // sub.status === 'trialing' counts as "paid" (active card on file) but
      // we do NOT send the paid-welcome email to trialing users — that note
      // belongs to the moment they actually start paying. `active` is the
      // only status that triggers the welcome.
      const isPaidNow = sub.status === 'active';
      // Determine tier from subscription metadata or price ID
      const subTier = sub.metadata?.tier
        || tierFromStripePriceId(sub.items?.data?.[0]?.price?.id)
        || 'new_particle';
      const before = _snapshot(getUserById(userId));
      const after = {
        isPaid:               active,
        subscriptionActive:   active,
        stripeSubscriptionId: sub.id,
        trialEndsAt:          sub.trial_end ? sub.trial_end * 1000 : null,
        planTier:             active ? subTier : 'trial',
      };
      await updateSubscription(userId, after);
      await recordSubscriptionChange({
        userId, source: 'stripe_webhook',
        action: classifyTransition(before, after),
        before,
        after: { ...before, ...after },
        meta: { eventId: event.id, eventType: event.type, subStatus: sub.status,
                priceId: sub.items?.data?.[0]?.price?.id || null },
      });
      logger.info('billing', `subscription ${sub.status} (${subTier}) → user ${userId}`, {
        userId, tier: subTier, billing_event: sub.status,
      });

      // Phase 10.4 — paid-welcome email. Fire once per user, the first
      // time they land in a truly active state. We gate on a persisted
      // `settings.billing.welcomePaidSentAt` timestamp because Stripe
      // will replay `customer.subscription.updated` for any unrelated
      // field flip (card_on_file change, plan swap, proration, etc.)
      // and we don't want a subscriber's inbox hit twice.
      //
      // Idempotency layers here:
      //   1. Stripe event claim (outer `claimStripeEvent`) — dedupes retries.
      //   2. welcomePaidSentAt (this block) — dedupes across distinct events.
      //   3. `isPaidNow` requires sub.status === 'active' — skips `trialing`.
      if (isPaidNow) {
        const user = getUserById(userId);
        const alreadySent = !!user?.settings?.billing?.welcomePaidSentAt;
        if (user && user.email && !alreadySent) {
          try {
            const tierMeta = TIERS?.[subTier] || null;
            const tierLabel = tierMeta?.label || 'Particle';
            const { sendPaidWelcomeEmail } = require('./services/emailService');
            const sent = await sendPaidWelcomeEmail(user, { tierLabel });
            if (sent) {
              // Persist the dedupe marker so the next webhook skips this.
              user.settings = user.settings || {};
              user.settings.billing = {
                ...(user.settings.billing || {}),
                welcomePaidSentAt: Date.now(),
                welcomePaidTier: subTier,
              };
              await persistUser(user);
              logger.info('billing', 'paid-welcome email delivered', {
                userId, tier: subTier,
              });
            }
          } catch (e) {
            // Never let an email error 500 the webhook. Stripe will
            // retry the whole event otherwise and we'd still re-fire.
            logger.warn('billing', 'paid-welcome email failed', {
              userId, error: e.message,
            });
          }
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const userId = sub.metadata?.userId
        ? Number(sub.metadata.userId)
        : await findUserIdByCustomer(sub.customer);
      if (!userId) break;

      const before = _snapshot(getUserById(userId));
      const after = {
        isPaid:               false,
        subscriptionActive:   false,
        stripeSubscriptionId: null,
        planTier:             'trial',
      };
      await updateSubscription(userId, after);
      await recordSubscriptionChange({
        userId, source: 'stripe_webhook', action: 'cancel',
        before, after: { ...before, ...after },
        meta: { eventId: event.id, eventType: event.type },
      });
      logger.info('billing', `subscription deleted → user ${userId}`, {
        userId, billing_event: 'cancel',
      });
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

    case 'invoice.payment_succeeded': {
      // W3.3 — send a branded receipt from receipts@the-particle.com.
      // We do NOT rely on this to flip subscription flags — that's done
      // by customer.subscription.{created,updated}. This handler is
      // purely informational + the welcome receipt for the user.
      const invoice = sub;
      const customerId = invoice.customer;
      const userId = invoice.subscription_details?.metadata?.userId
        ? Number(invoice.subscription_details.metadata.userId)
        : await findUserIdByCustomer(customerId);
      if (!userId) break;
      const user = getUserById(userId);
      if (!user || !user.email) break;
      try {
        const { sendPaymentReceiptEmail } = require('./services/emailService');
        await sendPaymentReceiptEmail(user, invoice);
      } catch (e) {
        logger.warn('billing', 'payment receipt email failed', {
          userId, error: e.message,
        });
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

// ── W3.1: Post-checkout session verification ──────────────────────────────
/**
 * Verify a Stripe Checkout Session and mint a fresh auth bundle.
 *
 * Problem this solves (the "post-payment logout on mobile" bug):
 *   After a user pays via Apple Pay on checkout.stripe.com, the browser
 *   returns to the-particle.com/?billing=success. If 15+ minutes elapsed
 *   during checkout (common on mobile), the stored JWT is expired. On iOS
 *   Safari, ITP commonly blocks the refresh cookie across the third-party
 *   Stripe redirect — so even /api/auth/refresh fails, forcing a re-login.
 *
 * Solution:
 *   Pass {CHECKOUT_SESSION_ID} through the success_url. On return the
 *   client POSTs the session_id to this endpoint. We retrieve it from
 *   Stripe — the ID itself is the auth proof (unguessable, single-use,
 *   only handed to the paying user) — read session.metadata.userId,
 *   load that user, and mint a fresh (token, refreshToken) pair.
 *
 * Security properties:
 *   - Session IDs are high-entropy and only transmitted to the user who paid.
 *   - We require payment_status === 'paid' OR 'no_payment_required'
 *     (free trials completing a saved card step).
 *   - The resolved userId comes from Stripe's side (metadata we set at
 *     checkout creation) — the client cannot forge it.
 *   - If metadata.userId is missing (e.g. legacy session from before W3.1),
 *     we fall back to client_reference_id, then fail closed.
 *
 * Returns: { token, refreshToken, user, subscription } on success,
 *          { error, code } on failure. Never throws.
 */
async function verifyCheckoutSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return { error: 'session_id is required', code: 'missing_session_id' };
  }
  // Stripe session IDs are cs_test_... or cs_live_.... Reject anything else
  // up front — avoids a pointless Stripe API call on obvious garbage.
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return { error: 'invalid session_id format', code: 'invalid_session_id' };
  }

  const stripe = getStripe();
  if (!stripe) {
    return { error: 'Billing not configured', code: 'stripe_unconfigured' };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    logger.warn('billing.verifyCheckoutSession', `Stripe retrieve failed: ${err.message}`, {
      sessionId: sessionId.slice(0, 20) + '...', stripeCode: err.code,
    });
    return { error: 'Could not verify session', code: 'session_not_found' };
  }

  // Gate on actual payment state. 'unpaid' means the user abandoned or the
  // charge failed — we must NOT mint a token in that case.
  const okStatuses = new Set(['paid', 'no_payment_required']);
  if (!okStatuses.has(session.payment_status)) {
    logger.warn('billing.verifyCheckoutSession', `Session not paid (status=${session.payment_status})`, {
      sessionId: sessionId.slice(0, 20) + '...',
    });
    return { error: 'Payment not completed', code: 'payment_incomplete' };
  }

  // Resolve the userId that was recorded at session creation. Metadata is
  // the primary source; client_reference_id is the fallback for any legacy
  // sessions created before W3.1.
  const metaUserId = session.metadata?.userId;
  const refUserId  = session.client_reference_id;
  const userIdRaw  = metaUserId || refUserId;
  const userId     = userIdRaw != null ? Number(userIdRaw) : null;

  if (!userId || Number.isNaN(userId)) {
    logger.error('billing.verifyCheckoutSession', 'Session missing userId metadata', {
      sessionId: sessionId.slice(0, 20) + '...',
    });
    return { error: 'Session missing user context', code: 'session_no_user' };
  }

  const user = getUserById(userId);
  if (!user) {
    // This can happen if in-memory hydration hasn't run. We don't mint a
    // token for a phantom user — fail closed and let the client fall back
    // to the normal login flow.
    logger.error('billing.verifyCheckoutSession', `User ${userId} not found in store`, {
      sessionId: sessionId.slice(0, 20) + '...',
    });
    return { error: 'User not found', code: 'user_not_found' };
  }

  // Mint a fresh JWT + refresh token so the client can immediately resume
  // an authenticated session without depending on the (possibly expired)
  // cookie or localStorage token.
  let token;
  try {
    token = signToken(user);
  } catch (e) {
    logger.error('billing.verifyCheckoutSession', `signToken failed: ${e.message}`);
    return { error: 'Token signing failed', code: 'token_sign_error' };
  }

  let refresh = null;
  try {
    refresh = await createRefreshToken(user.id);
  } catch (e) {
    // Non-fatal — the access token is enough to resume the session; a
    // refresh cookie can be minted on the next refresh cycle.
    logger.warn('billing.verifyCheckoutSession', `createRefreshToken failed: ${e.message}`);
  }

  const subscription = await getSubscriptionStatus(user.id);

  // Surface displayName at the top level of user so the client doesn't
  // have to dig through settings.profile — the login/register/refresh
  // responses already return it flat; keep this endpoint consistent.
  const safe = safeUser(user);
  safe.displayName = user.settings?.profile?.displayName || null;

  return {
    token,
    refreshToken: refresh?.token || null,
    user: safe,
    subscription,
  };
}

module.exports = {
  createCheckoutSession,
  createPortalSession,
  handleBillingWebhook,
  getSubscriptionStatus,
  validateStripePriceIds,
  verifyCheckoutSession,
};
