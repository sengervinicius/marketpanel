/**
 * tiers.js — Particle subscription tier configuration.
 *
 * Three tiers:
 *   new_particle    — $29/mo  (basic)
 *   dark_particle   — $79/mo  (elevated)
 *   nuclear_particle — $199/mo (upscale)
 *
 * Each tier defines hard limits for vault documents, AI queries, and
 * deep analysis calls. Enforcement happens at the route/service layer.
 *
 * Stripe price IDs are set via env vars so they can differ between
 * test and live mode.
 */

const TIERS = {
  // ── Trial / Free (before subscribing) ────────────────────────────────────
  trial: {
    label: 'Trial',
    vaultDocuments: 3,          // max PDFs in private vault
    vaultPagesTotal: 50,        // approximate page cap
    aiQueriesPerDay: 10,
    deepAnalysisPerDay: 2,
    morningBrief: 'basic',      // market-only (no vault enrichment)
    predictionMarkets: 'view',  // view only, no alerts
    centralVaultAccess: 'read',
    price: { monthly: 0, annual: 0 },
  },

  // ── New Particle — $29/mo ────────────────────────────────────────────────
  new_particle: {
    label: 'New Particle',
    vaultDocuments: 10,
    vaultPagesTotal: 500,
    aiQueriesPerDay: 25,
    deepAnalysisPerDay: 5,
    morningBrief: 'basic',
    predictionMarkets: 'view',
    centralVaultAccess: 'read',
    price: { monthly: 29, annual: 290 },
    stripePriceEnv: {
      monthly: 'STRIPE_NEW_PARTICLE_MONTHLY',
      annual:  'STRIPE_NEW_PARTICLE_ANNUAL',
    },
  },

  // ── Dark Particle — $79/mo ──────────────────────────────────────────────
  dark_particle: {
    label: 'Dark Particle',
    vaultDocuments: 50,
    vaultPagesTotal: 2500,
    aiQueriesPerDay: 100,
    deepAnalysisPerDay: 25,
    morningBrief: 'full',       // vault-enriched + behavioral profile
    predictionMarkets: 'alerts',
    centralVaultAccess: 'read',
    price: { monthly: 79, annual: 790 },
    stripePriceEnv: {
      monthly: 'STRIPE_DARK_PARTICLE_MONTHLY',
      annual:  'STRIPE_DARK_PARTICLE_ANNUAL',
    },
  },

  // ── Nuclear Particle — $199/mo ──────────────────────────────────────────
  nuclear_particle: {
    label: 'Nuclear Particle',
    vaultDocuments: -1,         // -1 = unlimited
    vaultPagesTotal: -1,
    aiQueriesPerDay: -1,
    deepAnalysisPerDay: -1,
    morningBrief: 'full',
    predictionMarkets: 'full',  // + custom tracking
    centralVaultAccess: 'suggest', // can suggest additions
    price: { monthly: 199, annual: 1990 },
    stripePriceEnv: {
      monthly: 'STRIPE_NUCLEAR_PARTICLE_MONTHLY',
      annual:  'STRIPE_NUCLEAR_PARTICLE_ANNUAL',
    },
  },
};

// Default tier for new paid users if we can't determine their plan
const DEFAULT_PAID_TIER = 'new_particle';
const DEFAULT_FREE_TIER = 'trial';

/**
 * Get tier config for a user.
 * @param {string} tierKey — one of: trial, new_particle, dark_particle, nuclear_particle
 */
function getTier(tierKey) {
  return TIERS[tierKey] || TIERS[DEFAULT_FREE_TIER];
}

/**
 * Check if a limit is "unlimited" (-1).
 */
function isUnlimited(limit) {
  return limit === -1;
}

/**
 * Resolve the Stripe price ID for a tier + billing cycle.
 * Falls back to the legacy STRIPE_PRICE_ID env var for backward compatibility.
 */
function getStripePriceId(tierKey, cycle = 'monthly') {
  const tier = TIERS[tierKey];
  if (!tier || !tier.stripePriceEnv) return process.env.STRIPE_PRICE_ID || null;
  const envVar = tier.stripePriceEnv[cycle];
  return envVar ? (process.env[envVar] || null) : null;
}

/**
 * Map a Stripe price ID back to a tier key.
 * Used in webhook handlers to determine which tier a subscription belongs to.
 */
function tierFromStripePriceId(priceId) {
  if (!priceId) return DEFAULT_PAID_TIER;
  for (const [key, tier] of Object.entries(TIERS)) {
    if (!tier.stripePriceEnv) continue;
    for (const envName of Object.values(tier.stripePriceEnv)) {
      if (process.env[envName] === priceId) return key;
    }
  }
  // Fallback: legacy single-price setup
  if (priceId === process.env.STRIPE_PRICE_ID) return DEFAULT_PAID_TIER;
  if (priceId === process.env.STRIPE_ANNUAL_PRICE_ID) return DEFAULT_PAID_TIER;
  return DEFAULT_PAID_TIER;
}

module.exports = {
  TIERS,
  DEFAULT_PAID_TIER,
  DEFAULT_FREE_TIER,
  getTier,
  isUnlimited,
  getStripePriceId,
  tierFromStripePriceId,
};
