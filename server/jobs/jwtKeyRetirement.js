/**
 * jobs/jwtKeyRetirement.js — #249 P3.5 / D5.3
 *
 * Automates the "retire PREVIOUS key" step that the JWT rotation runbook
 * (docs/RUNBOOK_JWT_ROTATION.md, step 6) leaves to an operator. Once the
 * grace window closes, the PREVIOUS key is unmounted from the in-memory
 * JWT_KEYS map in authStore, so the process stops accepting tokens signed
 * with the old kid. The env-var itself is not touched — that's still a
 * manual hygiene step, but the blast radius from a leaked retired key
 * collapses to "nothing served by this process".
 *
 * Retirement triggers when BOTH of these conditions hold:
 *   1. PREVIOUS has been loaded (i.e. exists) for at least
 *      JWT_PREVIOUS_GRACE_MS (default: 2h). The runbook minimum is 30 min;
 *      we default higher to absorb clock skew, retry backoff, and any
 *      straggler refresh flow we have not instrumented.
 *   2. PREVIOUS has not been used for a successful verification in at
 *      least JWT_PREVIOUS_IDLE_MS (default: 30 min). Belt-and-suspenders:
 *      if a client is still presenting an old-kid token we hold off.
 *
 * Env overrides (both optional, both in ms):
 *   JWT_PREVIOUS_GRACE_MS  — minimum age before retirement
 *   JWT_PREVIOUS_IDLE_MS   — minimum time since last verification
 *
 * The cron is scheduled from jobs/index.js to run every 15 minutes.
 * `runOnce()` is exported for tests and for the legacy startup hook.
 */

'use strict';

const logger = require('../utils/logger');
const authStore = require('../authStore');

const DEFAULT_GRACE_MS = 2 * 60 * 60 * 1000;  // 2h
const DEFAULT_IDLE_MS  = 30 * 60 * 1000;      // 30m

function parseDurationMs(envValue, fallback) {
  if (!envValue) return fallback;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * Run one retirement pass.
 * @param {{ now?: number, graceMs?: number, idleMs?: number }} [opts]
 * @returns {{ retired: boolean, reason: string, state: object }}
 */
function runOnce(opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const graceMs = typeof opts.graceMs === 'number'
    ? opts.graceMs
    : parseDurationMs(process.env.JWT_PREVIOUS_GRACE_MS, DEFAULT_GRACE_MS);
  const idleMs = typeof opts.idleMs === 'number'
    ? opts.idleMs
    : parseDurationMs(process.env.JWT_PREVIOUS_IDLE_MS, DEFAULT_IDLE_MS);

  const state = authStore.getJwtKeyState();
  if (!state.previousKid) {
    return { retired: false, reason: 'no_previous_key', state };
  }

  const ageMs = state.previousLoadedAt == null
    ? 0
    : now - state.previousLoadedAt;
  if (ageMs < graceMs) {
    return {
      retired: false,
      reason: 'grace_window_open',
      state: { ...state, ageMs, graceMs },
    };
  }

  // Idle check: if the key was used in the idle window, hold off.
  if (state.previousLastUsedAt != null) {
    const idleSince = now - state.previousLastUsedAt;
    if (idleSince < idleMs) {
      return {
        retired: false,
        reason: 'recent_verification',
        state: { ...state, idleSince, idleMs },
      };
    }
  }

  const retired = authStore.retirePreviousKey();
  if (retired) {
    logger.info('jwtKeyRetirement', 'Retired PREVIOUS JWT key', {
      retiredKid: state.previousKid,
      ageMs,
      graceMs,
      idleMs,
    });
  }
  return { retired, reason: retired ? 'retired' : 'no_op', state };
}

module.exports = { runOnce };
