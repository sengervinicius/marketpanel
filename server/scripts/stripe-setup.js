#!/usr/bin/env node
/**
 * stripe-setup.js — Creates Stripe products and prices for all Particle tiers.
 *
 * Run once to set up your Stripe dashboard:
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-setup.js
 *
 * This creates:
 *   - 3 products (New Particle, Dark Particle, Nuclear Particle)
 *   - 6 prices (monthly + annual for each)
 *
 * After running, copy the outputted env vars into your .env file.
 */

const TIERS = {
  new_particle: {
    name: 'New Particle',
    description: 'Essential market intelligence. 50 vault docs, 50 AI queries/day, 10 deep analyses/day.',
    monthly: 2900,  // $29.00
    annual: 29000,  // $290.00 (save ~17%)
  },
  dark_particle: {
    name: 'Dark Particle',
    description: 'Elevated intelligence. 250 vault docs, 200 AI queries/day, 50 deep analyses/day, full morning brief.',
    monthly: 7900,  // $79.00
    annual: 79000,  // $790.00 (save ~17%)
  },
  nuclear_particle: {
    name: 'Nuclear Particle',
    description: 'Unlimited intelligence. Unlimited vault, AI, deep analysis. Full prediction markets. Priority support.',
    monthly: 19900, // $199.00
    annual: 199000, // $1,990.00 (save ~17%)
  },
};

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('Error: STRIPE_SECRET_KEY env var required');
    console.error('Usage: STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-setup.js');
    process.exit(1);
  }

  const stripe = require('stripe')(key);
  const isTest = key.startsWith('sk_test_');
  console.log(`\nUsing Stripe ${isTest ? 'TEST' : 'LIVE'} mode\n`);

  const envVars = {};

  for (const [tierKey, tier] of Object.entries(TIERS)) {
    console.log(`Creating product: ${tier.name}...`);

    // Create product
    const product = await stripe.products.create({
      name: tier.name,
      description: tier.description,
      metadata: { tier: tierKey },
    });
    console.log(`  Product: ${product.id}`);

    // Create monthly price
    const monthlyPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: tier.monthly,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { tier: tierKey, cycle: 'monthly' },
    });
    console.log(`  Monthly price: ${monthlyPrice.id} ($${(tier.monthly / 100).toFixed(2)}/mo)`);

    // Create annual price
    const annualPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: tier.annual,
      currency: 'usd',
      recurring: { interval: 'year' },
      metadata: { tier: tierKey, cycle: 'annual' },
    });
    console.log(`  Annual price: ${annualPrice.id} ($${(tier.annual / 100).toFixed(2)}/yr)\n`);

    // Build env var names
    const envPrefix = `STRIPE_${tierKey.toUpperCase()}`;
    envVars[`${envPrefix}_MONTHLY`] = monthlyPrice.id;
    envVars[`${envPrefix}_ANNUAL`] = annualPrice.id;
  }

  // Output env vars
  console.log('═══════════════════════════════════════════════════════');
  console.log('Add these to your .env file:');
  console.log('═══════════════════════════════════════════════════════\n');

  for (const [key, value] of Object.entries(envVars)) {
    console.log(`${key}=${value}`);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('Done! Products and prices created successfully.');
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
