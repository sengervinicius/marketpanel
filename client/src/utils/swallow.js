/**
 * utils/swallow.js — Explicit error suppression helper (#244 / P2.2).
 *
 * Replaces ad-hoc `} catch {}` blocks. Every swallow carries a stable
 * code so Sentry / console filters can categorise suppression spikes.
 *
 * Usage:
 *   import { swallow } from '@/utils/swallow';
 *   try { JSON.parse(raw); } catch (e) { swallow(e, 'panel.chart.parse'); }
 *
 * Codes follow <area>.<site> dot-convention, e.g.:
 *   'panel.chart.fetch'
 *   'context.auth.storage'
 *   'hook.wire.abort'
 *
 * DEBUG: set `window.__DEBUG_SWALLOW__ = true` in DevTools to console-
 * print swallows without any code change.
 */

/* eslint-disable no-console */

/**
 * Swallow an error that is safe to ignore.
 * @param {unknown} err   The caught value.
 * @param {string}  code  Stable tag — dot-notation.
 */
export function swallow(err, code = 'unknown') {
  const debug = typeof window !== 'undefined' && window.__DEBUG_SWALLOW__;
  if (!debug) return;
  try {
    // eslint-disable-next-line no-unused-expressions
    console.debug('[swallow]', code, err?.message || String(err));
  } catch {
    /* intentional: console is unavailable in some embedded contexts */
  }
}

export default swallow;
