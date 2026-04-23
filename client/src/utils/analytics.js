/**
 * utils/analytics.js — W6.5 product analytics wrapper (PostHog).
 *
 * Design constraints:
 *   - Must respect the LGPD/GDPR/UK-GDPR consent toggle written by
 *     CookieConsentBanner.jsx (localStorage key 'lgpd_consent_v1',
 *     bucket 'analytics').
 *   - Must be a COMPLETE no-op if VITE_POSTHOG_KEY is not set (so local
 *     and CI builds never hit PostHog).
 *   - Must never block the UI: init is fire-and-forget and all public
 *     methods swallow errors.
 *   - Must not send PII. User identification is done by opaque userId only;
 *     email is never passed. Event properties are explicit allow-list.
 *
 * Wire-up:
 *   1. Set VITE_POSTHOG_KEY and (optionally) VITE_POSTHOG_HOST in env.
 *   2. Import once at app bootstrap:
 *        import { initAnalytics } from './utils/analytics';
 *        initAnalytics();
 *   3. At auth completion, call identify(userId, { tier }).
 *   4. For events: track('upgrade_clicked', { from_tier: 'free' }).
 *
 * Events intentionally logged by the rest of the app:
 *   - login_succeeded
 *   - signup_succeeded
 *   - portfolio_imported      { rows_added, rejected_count }
 *   - upgrade_clicked         { from_tier, to_tier }
 *   - chat_message_sent       { model }
 *   - vault_document_added
 *   - feature_gated           { flag, enabled }
 */

import { swallow } from './swallow';

const CONSENT_STORAGE_KEY = 'lgpd_consent_v1';

let _posthog = null;
let _initialised = false;
let _pendingIdentity = null;  // queued until consent + init complete
const _pendingEvents = [];

function hasConsent() {
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!(parsed && parsed.analytics);
  } catch (_) { return false; }
}

function getApiKey() {
  try { return import.meta.env?.VITE_POSTHOG_KEY || ''; }
  catch { return ''; }
}

function getApiHost() {
  try { return import.meta.env?.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com'; }
  catch { return 'https://eu.i.posthog.com'; }
}

/**
 * Initialise PostHog. Safe to call multiple times. Becomes a no-op when:
 *   - VITE_POSTHOG_KEY is absent
 *   - User hasn't granted 'analytics' consent
 *   - Running outside a browser (SSR/tests)
 */
export async function initAnalytics() {
  if (_initialised) return;
  if (typeof window === 'undefined') return;
  const key = getApiKey();
  if (!key) return;                     // no PostHog key configured
  if (!hasConsent()) return;            // user hasn't opted in

  try {
    // Dynamic import so builds without PostHog don't bundle the SDK.
    const mod = await import('posthog-js');
    const posthog = mod.default || mod;
    posthog.init(key, {
      api_host: getApiHost(),
      person_profiles: 'identified_only', // don't create anon profiles
      capture_pageview: true,
      capture_pageleave: true,
      disable_session_recording: true,    // off by default; opt-in separately
      respect_dnt: true,
      autocapture: false,                 // explicit events only — no PII leak
      property_blacklist: ['$ip'],
      loaded: (ph) => {
        // PostHog offers an opt-out even after init; honour consent again.
        if (!hasConsent()) ph.opt_out_capturing();
      },
    });
    _posthog = posthog;
    _initialised = true;

    // Drain queue
    if (_pendingIdentity) {
      try { posthog.identify(_pendingIdentity.id, _pendingIdentity.props); }
      catch (e) { swallow(e, 'util.analytics.identify_drain'); }
      _pendingIdentity = null;
    }
    while (_pendingEvents.length) {
      const [name, props] = _pendingEvents.shift();
      try { posthog.capture(name, props); } catch (e) { swallow(e, 'util.analytics.capture_drain'); }
    }
  } catch (err) {
    // Silently swallow — analytics failure must never break the app.
    console.warn('[analytics] init failed (non-fatal):', err?.message || err);
  }
}

/**
 * Identify the current user by opaque ID plus a small property bag.
 * Do NOT pass email or other PII here.
 */
export function identify(userId, props = {}) {
  if (!userId) return;
  const safe = _allowlistProps(props);
  if (!_initialised) {
    _pendingIdentity = { id: String(userId), props: safe };
    // Kick off init in case the consent flip happened after app boot.
    initAnalytics();
    return;
  }
  try { _posthog.identify(String(userId), safe); } catch (e) { swallow(e, 'util.analytics.identify'); }
}

/**
 * Track a product event with a constrained property bag.
 * Unknown properties are stripped for PII safety.
 */
export function track(eventName, props = {}) {
  if (!eventName) return;
  const safe = _allowlistProps(props);
  if (!_initialised) {
    _pendingEvents.push([eventName, safe]);
    initAnalytics();
    return;
  }
  try { _posthog.capture(eventName, safe); } catch (e) { swallow(e, 'util.analytics.capture'); }
}

/**
 * Reset user identity on logout. No-op if uninitialised.
 */
export function resetIdentity() {
  if (!_initialised) { _pendingIdentity = null; return; }
  try { _posthog.reset(); } catch (e) { swallow(e, 'util.analytics.reset'); }
}

/**
 * Revoke consent at runtime. Call when user flips the cookie banner off.
 * PostHog is instructed to opt out so the rest of this session stops
 * capturing.
 */
export function revokeAnalytics() {
  try {
    if (_posthog && typeof _posthog.opt_out_capturing === 'function') {
      _posthog.opt_out_capturing();
    }
  } catch (e) { swallow(e, 'util.analytics.revoke'); }
  _pendingIdentity = null;
  _pendingEvents.length = 0;
}

// Allow-list of properties we'll forward to PostHog. Anything else is
// stripped. This stops accidental PII leakage.
const ALLOWED_KEYS = new Set([
  'tier', 'plan', 'market', 'locale', 'source', 'from_tier', 'to_tier',
  'model', 'rows_added', 'rejected_count', 'flag', 'enabled',
  'feature', 'duration_ms', 'success', 'error_code',
]);

function _allowlistProps(props) {
  if (!props || typeof props !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    if (v === null || typeof v === 'object') continue;       // scalars only
    if (typeof v === 'string' && v.length > 120) continue;   // no long strings
    out[k] = v;
  }
  return out;
}

export default { initAnalytics, identify, track, resetIdentity, revokeAnalytics };
