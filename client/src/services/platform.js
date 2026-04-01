/**
 * platform.js
 *
 * Runtime platform detection for Capacitor native vs web.
 * Used to route billing through Apple IAP (iOS) vs Stripe (web/Android).
 */

import { Capacitor } from '@capacitor/core';

/** @returns {'ios' | 'android' | 'web'} */
export function getPlatform() {
  return Capacitor.getPlatform();
}

/** True when running inside a native iOS app (Capacitor) */
export function isIOS() {
  return Capacitor.getPlatform() === 'ios';
}

/** True when running inside a native Android app */
export function isAndroid() {
  return Capacitor.getPlatform() === 'android';
}

/** True when running in a browser (not wrapped) */
export function isWeb() {
  return Capacitor.getPlatform() === 'web';
}

/** True when running inside any native wrapper */
export function isNative() {
  return Capacitor.isNativePlatform();
}
