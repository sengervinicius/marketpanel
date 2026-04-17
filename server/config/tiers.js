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
    vaultDocuments: 5,           // max PDFs in private vault
    vaultPagesTotal: 100,        // approximate page cap
    aiQueriesPerDay: 15,
    deepAnalysisPerDay: 3,
    aiTokensPerDay: 50000,       // W1.2: daily token budget (in + out combined)
    morningBrief: 'basic',       // market-only (no vault enrichment)
    predictionMarkets: 'view',   // view only, no alerts
    centralVaultAccess: 'read',
    price: { monthly: 0, annual: 0 },
  },

  // ── New Particle — $29/mo ────────────────────────────────────────────────
  new_particle: {
    label: 'New Particle',
    vaultDocuments: 50,          // 50 PDFs stored
    vaultPagesTotal: 2000,
    aiQueriesPerDay: 50,
    deepAnalysisPerDay: 10,
    aiTokensPerDay: 300000,      // W1.2: daily token budget
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
    vaultDocuments: 250,         // 250 PDFs stored
    vaultPagesTotal: 10000,
    aiQueriesPerDay: 200,
    deepAnalysisPerDay: 50,
    aiTokensPerDay: 1000000,     // W1.2: daily token budget (1M)
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
    aiTokensPerDay: 5000000,    // W1.2: daily token budget (5M — high but not unlimited)
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
  // Try tier-specific env var first
  if (tier && tier.stripePriceEnv) {
    const envVar = tier.stripePriceEnv[cycle];
    if (envVar && process.env[envVar]) return process.env[envVar];
  }
  // Fallback: legacy single-price env vars (STRIPE_PRICE_ID / STRIPE_ANNUAL_PRICE_ID)
  if (cycle === 'annual' && process.env.STRIPE_ANNUAL_PRICE_ID) return process.env.STRIPE_ANNUAL_PRICE_ID;
  return process.env.STRIPE_PRICE_ID || null;
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
