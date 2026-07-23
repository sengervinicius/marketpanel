/**
 * iap.js
 *
 * Apple In-App Purchase service for iOS native builds.
 * Uses the Capacitor Purchases plugin (RevenueCat) or a direct StoreKit bridge.
 *
 * This module provides a unified billing interface:
 *   - On iOS: uses Apple IAP via registerPlugin
 *   - On web/Android: falls back to Stripe checkout (existing flow)
 *
 * Product IDs must match App Store Connect configuration (six auto-renewable
 * subscriptions — one monthly + one annual per paid tier):
 *   new_particle:     com.theparticle.app.new.monthly     / com.theparticle.app.new.annual
 *   dark_particle:    com.theparticle.app.dark.monthly    / com.theparticle.app.dark.annual
 *   nuclear_particle: com.theparticle.app.nuclear.monthly / com.theparticle.app.nuclear.annual
 */

import { isIOS, isWeb } from './platform';

import { apiFetch } from '../utils/api';
// IAP product identifiers (must match App Store Connect + server config/tiers.js)
export const IAP_PRODUCTS = {
  NEW_MONTHLY:     'com.theparticle.app.new.monthly',
  NEW_ANNUAL:      'com.theparticle.app.new.annual',
  DARK_MONTHLY:    'com.theparticle.app.dark.monthly',
  DARK_ANNUAL:     'com.theparticle.app.dark.annual',
  NUCLEAR_MONTHLY: 'com.theparticle.app.nuclear.monthly',
  NUCLEAR_ANNUAL:  'com.theparticle.app.nuclear.annual',
};

// tierKey → { monthly, annual } → product id
const PRODUCT_BY_TIER = {
  new_particle:     { monthly: IAP_PRODUCTS.NEW_MONTHLY,     annual: IAP_PRODUCTS.NEW_ANNUAL },
  dark_particle:    { monthly: IAP_PRODUCTS.DARK_MONTHLY,    annual: IAP_PRODUCTS.DARK_ANNUAL },
  nuclear_particle: { monthly: IAP_PRODUCTS.NUCLEAR_MONTHLY, annual: IAP_PRODUCTS.NUCLEAR_ANNUAL },
};

/**
 * Resolve the Apple IAP product id for a tier + billing cycle.
 * @param {('new_particle'|'dark_particle'|'nuclear_particle')} tierKey
 * @param {('monthly'|'annual')} cycle
 * @returns {string|null}
 */
export function productIdFor(tierKey, cycle = 'monthly') {
  const t = PRODUCT_BY_TIER[tierKey];
  if (!t) return null;
  return t[cycle] || null;
}

/**
 * Check if IAP is available (iOS native only).
 */
export function isIAPAvailable() {
  return isIOS();
}

/**
 * Fetch available products from the App Store.
 * Returns product info including localized prices.
 *
 * @returns {Promise<Array<{id: string, title: string, price: string, priceAmount: number}>>}
 */
export async function getProducts() {
  if (!isIOS()) return [];

  try {
    const token = localStorage.getItem('token');
    const res = await apiFetch('/api/billing/iap/products', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch products');
    const data = await res.json();
    return data.products || [];
  } catch (e) {
    console.error('[iap] getProducts error:', e.message);
    return [];
  }
}

/**
 * Initiate a purchase flow.
 * On iOS: sends the receipt to the server for validation.
 * On web: redirects to Stripe checkout (handled by AuthContext).
 *
 * @param {string} productId — IAP product identifier
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function purchase(productId) {
  if (!isIOS()) {
    return { ok: false, error: 'IAP only available on iOS. Use Stripe checkout.' };
  }

  try {
    // StoreKit purchase is handled natively via Capacitor plugin
    // The native plugin will present the Apple payment sheet
    // After purchase, the receipt is sent to our server for validation
    const token = localStorage.getItem('token');
    const res = await apiFetch('/api/billing/iap/purchase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ productId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Purchase failed');
    }

    return { ok: true };
  } catch (e) {
    console.error('[iap] purchase error:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Restore previous purchases (required by Apple).
 * Checks the server for any existing Apple subscriptions tied to this user.
 *
 * @returns {Promise<{ok: boolean, restored: boolean, error?: string}>}
 */
export async function restorePurchases() {
  try {
    const token = localStorage.getItem('token');
    const res = await apiFetch('/api/billing/iap/restore', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Restore failed');
    }

    const data = await res.json();
    return { ok: true, restored: data.restored || false };
  } catch (e) {
    console.error('[iap] restore error:', e.message);
    return { ok: false, restored: false, error: e.message };
  }
}

/**
 * Get the appropriate billing action based on platform.
 * Returns a function that either starts IAP or Stripe checkout.
 *
 * @param {Function} stripeCheckout — Stripe checkout function from AuthContext
 * @returns {{ startPurchase: Function, isAppleIAP: boolean }}
 */
export function getBillingAction(stripeCheckout) {
  if (isIOS()) {
    return {
      isAppleIAP: true,
      startPurchase: (productId) => purchase(productId || IAP_PRODUCTS.NEW_MONTHLY),
    };
  }

  return {
    isAppleIAP: false,
    startPurchase: stripeCheckout,
  };
}
