/**
 * iap.js
 *
 * Apple In-App Purchase service for iOS native builds.
 *
 * Backed by @capgo/native-purchases (StoreKit 2, pure Capacitor -- no Cordova, so
 * it integrates with this project's SPM setup). The plugin presents Apple's real
 * payment sheet and returns a Transaction carrying the base64 App Store receipt,
 * which we forward to the server as `receiptData` for verification against
 * Apple's verifyReceipt API.
 *
 * HISTORY -- worth knowing, because the previous version looked finished and was
 * not: purchase() used to POST only { productId } to the server while a comment
 * claimed "StoreKit purchase is handled natively via Capacitor plugin". No such
 * plugin was installed and there was no StoreKit code anywhere in the iOS target,
 * so no payment sheet was ever shown. The server (correctly) fails closed without
 * a receipt, so every purchase attempt returned 400 "Receipt data is required."
 * An advertised subscription that cannot be bought is an App Review 2.1 rejection.
 *
 * This module provides a unified billing interface:
 *   - On iOS: Apple IAP via StoreKit 2
 *   - On web/Android: falls back to Stripe checkout (existing flow)
 *
 * Product IDs must match App Store Connect configuration (six auto-renewable
 * subscriptions — one monthly + one annual per paid tier):
 *   new_particle:     com.theparticle.app.new.monthly     / com.theparticle.app.new.annual
 *   dark_particle:    com.theparticle.app.dark.monthly    / com.theparticle.app.dark.annual
 *   nuclear_particle: com.theparticle.app.nuclear.monthly / com.theparticle.app.nuclear.annual
 */

import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';
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
    const ids = Object.values(IAP_PRODUCTS);
    const { products } = await NativePurchases.getProducts({ productIdentifiers: ids });
    // Apple's own localised price strings -- never our hardcoded numbers. A price
    // that disagrees with the App Store sheet is a 2.3.1 problem.
    return (products || []).map((p) => ({
      id: p.identifier,
      title: p.title,
      description: p.description,
      price: p.priceString,
      priceAmount: p.price,
      currencyCode: p.currencyCode,
    }));
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

  let tx;
  try {
    // 1. Present Apple's payment sheet. This throws if the user cancels.
    tx = await NativePurchases.purchaseProduct({
      productIdentifier: productId,
      // PURCHASE_TYPE is a STRING enum ('subs' / 'inapp'), not a number. Passing 1
      // here silently mis-typed every purchase.
      productType: PURCHASE_TYPE.SUBS,
    });
  } catch (e) {
    const msg = String(e?.message || e || '');
    // A cancel is not an error worth showing as a failure.
    if (/cancel/i.test(msg)) return { ok: false, cancelled: true };
    console.error('[iap] StoreKit purchase error:', msg);
    return { ok: false, error: msg || 'The App Store could not complete the purchase.' };
  }

  // 2. Hand the receipt to our server, which verifies it with Apple before
  //    granting anything. Without receiptData the server rejects by design.
  const receiptData = tx?.receipt || null;
  if (!receiptData) {
    return {
      ok: false,
      error: 'The App Store did not return a receipt. If you were charged, use Restore purchases.',
    };
  }

  try {
    const res = await apiFetch('/api/billing/iap/purchase', {
      method: 'POST',
      body: JSON.stringify({
        productId,
        receiptData,
        transactionId: tx?.transactionId || null,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'We could not verify the purchase.');
    }

    return { ok: true };
  } catch (e) {
    // The charge succeeded at Apple but our verification failed. Say so plainly
    // and point at Restore, which re-runs verification -- do not imply the user
    // was not charged.
    console.error('[iap] verification error:', e.message);
    return {
      ok: false,
      error: `${e.message} Your purchase went through with Apple — open Restore purchases to finish activating it.`,
    };
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
    // #292 W5-B2 — the server used to be a stub, so this only called
    // AppStore.sync() and posted an empty body. Now: sync, then read the
    // device's subscription transactions via getPurchases() and send the
    // receipt of the most relevant one. The server verifies with Apple and
    // activates on THIS account if the entitlement is unexpired.
    let receiptData = null;
    let productId = null;
    let transactionId = null;

    if (isIOS()) {
      try {
        await NativePurchases.restorePurchases(); // AppStore.sync()
      } catch (e) {
        console.warn('[iap] StoreKit restore warning:', e?.message || e);
      }
      try {
        const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.SUBS });
        const known = new Set(Object.values(IAP_PRODUCTS));
        const mine = (purchases || []).filter(t => t && known.has(t.productIdentifier));
        // Prefer an active one; otherwise the latest by expiration so the
        // server can tell "lapsed" from "never subscribed".
        mine.sort((a, b) => {
          if (!!a.isActive !== !!b.isActive) return a.isActive ? -1 : 1;
          return new Date(b.expirationDate || 0) - new Date(a.expirationDate || 0);
        });
        const best = mine[0];
        if (best) {
          receiptData = best.receipt || null;
          productId = best.productIdentifier || null;
          transactionId = best.transactionId || null;
        }
      } catch (e) {
        console.warn('[iap] getPurchases warning:', e?.message || e);
      }
    }

    const res = await apiFetch('/api/billing/iap/restore', {
      method: 'POST',
      body: JSON.stringify({ receiptData, productId, transactionId }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Restore failed');
    }

    return {
      ok: true,
      restored: !!data.restored,
      lapsed: !!data.lapsed,
      tier: data.tier || null,
      message: data.message || null,
    };
  } catch (e) {
    console.error('[iap] restore error:', e.message);
    return { ok: false, restored: false, error: e.message };
  }
}

/**
 * Whether this device can actually transact. Used to hide purchase UI rather
 * than let a user tap a button that cannot work.
 */
export async function isBillingAvailable() {
  if (!isIOS()) return false;
  try {
    const { isBillingSupported } = await NativePurchases.isBillingSupported();
    return !!isBillingSupported;
  } catch {
    return false;
  }
}
