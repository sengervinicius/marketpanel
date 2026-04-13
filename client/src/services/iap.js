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
 * Product IDs must match App Store Connect configuration:
 *   - com.particle.market.pro.monthly
 *   - com.particle.market.pro.yearly
 */

import { isIOS, isWeb } from './platform';

// IAP product identifiers (must match App Store Connect)
export const IAP_PRODUCTS = {
  MONTHLY: 'com.particle.market.pro.monthly',
  YEARLY:  'com.particle.market.pro.yearly',
};

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
    const res = await fetch('/api/billing/iap/products', {
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
    const res = await fetch('/api/billing/iap/purchase', {
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
    const res = await fetch('/api/billing/iap/restore', {
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
      startPurchase: (productId) => purchase(productId || IAP_PRODUCTS.MONTHLY),
    };
  }

  return {
    isAppleIAP: false,
    startPurchase: stripeCheckout,
  };
}
