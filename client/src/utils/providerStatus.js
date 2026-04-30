/**
 * providerStatus.js — #285d
 *
 * Server-side many endpoints return a "graceful empty" shape when their
 * upstream provider is unconfigured or offline:
 *
 *   { ok: true, data: [] | null, source: 'unavailable', message?: '...' }
 *
 * Before this helper, panels only saw `data: []` and rendered as
 * "no data" — leaving the user thinking the market was quiet when in
 * fact the provider had never been wired up. This helper lets panels
 * distinguish three states with one call:
 *
 *   ok          — provider responded normally; data may still be empty,
 *                 but that's a real data signal.
 *   unavailable — provider is unconfigured (env var missing) or offline;
 *                 user-visible banner should explain that.
 *   error       — request itself failed (network, 5xx, parse).
 *
 * Usage:
 *   const status = getProviderStatus(json);
 *   if (status === 'unavailable') {
 *     return <DataUnavailable kind="unavailable" reason={formatProviderMessage(json)} />;
 *   }
 */

'use strict';

/**
 * @param {object|null} data — parsed JSON response or fetch failure
 * @returns {'ok' | 'unavailable' | 'error'}
 */
export function getProviderStatus(data) {
  if (!data || typeof data !== 'object') return 'error';
  if (data.source === 'unavailable') return 'unavailable';
  if (data.ok === false || data.error) return 'error';
  return 'ok';
}

/**
 * Human-readable explanation for non-ok states. Pass the raw response.
 */
export function formatProviderMessage(data) {
  if (!data) return 'Network error — try again in a moment.';
  if (data.source === 'unavailable') {
    if (data.message) return data.message;
    return 'This data source is not currently configured. Contact your admin to enable it.';
  }
  if (data.error) {
    if (typeof data.error === 'string') return `Provider error: ${data.error}`;
    if (data.message) return data.message;
    return 'Provider error. Try again shortly.';
  }
  return 'Unavailable.';
}

/**
 * Convenience predicate — common case where panel just needs a banner
 * trigger.
 */
export function shouldShowUnavailableBanner(data) {
  return getProviderStatus(data) === 'unavailable';
}
