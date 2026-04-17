/**
 * services/providerFallback.js — W3.2 provider-tier fallback ladder.
 *
 * Market-data calls should try providers in a defined order, recording
 * latency + error rates per provider per domain. This module gives the
 * rest of the codebase one function:
 *
 *     const result = await tryLadder('equity.quote', symbol, ladder);
 *
 * where `ladder` is an array of `async (symbol) => { price, ts, raw }`
 * functions. The service:
 *
 *   1. Tries each in order with a per-attempt timeout (default 3s)
 *   2. Records success/failure counts + latency histogram per provider
 *   3. Applies a 30-second circuit breaker on repeated 5xx/timeout
 *   4. Exposes `providerHealth()` so /metrics and /admin can inspect
 *
 * The ladder is not persisted — it's evaluated lazily on every call so
 * that an operator can flip env vars (e.g. TWELVE_ENABLED=0) mid-flight
 * and the next request immediately honours it.
 */

'use strict';

const logger = require('../utils/logger');

const DEFAULT_TIMEOUT_MS = 3000;
const BREAKER_OPEN_MS    = 30_000;
const BREAKER_THRESHOLD  = 5;   // 5 consecutive failures trip the breaker

// per-provider stats: { attempts, successes, failures, lastErrorAt, breakerOpenUntil }
const _providerStats = new Map();

function _stats(name) {
  let s = _providerStats.get(name);
  if (!s) {
    s = { attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0,
          p50LatencyMs: 0, lastErrorAt: 0, breakerOpenUntil: 0, lastError: null };
    _providerStats.set(name, s);
  }
  return s;
}

function _isBreakerOpen(name) {
  const s = _stats(name);
  return s.breakerOpenUntil > Date.now();
}

function _recordSuccess(name, ms) {
  const s = _stats(name);
  s.attempts += 1; s.successes += 1; s.consecutiveFailures = 0;
  // Streaming exponential p50-ish smoothing — cheap and close enough for
  // observability; /metrics uses the prom histogram for the real distribution.
  s.p50LatencyMs = Math.round(s.p50LatencyMs ? (s.p50LatencyMs * 0.8 + ms * 0.2) : ms);
}

function _recordFailure(name, err) {
  const s = _stats(name);
  s.attempts += 1; s.failures += 1; s.consecutiveFailures += 1;
  s.lastError = String(err && err.message || err);
  s.lastErrorAt = Date.now();
  if (s.consecutiveFailures >= BREAKER_THRESHOLD) {
    s.breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
    logger.warn('providerFallback', `breaker OPEN for ${name}`, {
      provider: name, consecutiveFailures: s.consecutiveFailures,
      openUntil: new Date(s.breakerOpenUntil).toISOString(),
    });
  }
}

async function _withTimeout(promise, ms, name) {
  let timer;
  const timeoutErr = new Error(`timeout:${name}:${ms}ms`);
  const timeoutP = new Promise((_, rej) => { timer = setTimeout(() => rej(timeoutErr), ms); });
  try { return await Promise.race([promise, timeoutP]); }
  finally { clearTimeout(timer); }
}

/**
 * @param {string} domain  — e.g. 'equity.quote'
 * @param {any}    input   — the input passed to each step
 * @param {Array<{ name: string, call: (input) => Promise<any>, timeoutMs?: number }>} ladder
 */
async function tryLadder(domain, input, ladder) {
  const errors = [];
  for (const step of ladder) {
    if (_isBreakerOpen(step.name)) {
      errors.push({ name: step.name, error: 'breaker-open' });
      continue;
    }
    const started = Date.now();
    try {
      const result = await _withTimeout(step.call(input), step.timeoutMs || DEFAULT_TIMEOUT_MS, step.name);
      _recordSuccess(step.name, Date.now() - started);
      if (result != null) {
        return { ok: true, provider: step.name, data: result, attempts: errors.length + 1 };
      }
      _recordFailure(step.name, new Error('empty-result'));
      errors.push({ name: step.name, error: 'empty-result' });
    } catch (e) {
      _recordFailure(step.name, e);
      errors.push({ name: step.name, error: e.message || String(e) });
    }
  }
  logger.warn('providerFallback', 'all providers failed', {
    domain, attempts: ladder.length, errors,
  });
  return { ok: false, provider: null, data: null, attempts: errors.length, errors };
}

/** Snapshot of every known provider for metrics + admin dashboards. */
function providerHealth() {
  const out = {};
  for (const [name, s] of _providerStats.entries()) {
    out[name] = {
      attempts:  s.attempts,
      successes: s.successes,
      failures:  s.failures,
      successRate: s.attempts ? +(s.successes / s.attempts).toFixed(4) : 1,
      p50LatencyMs: s.p50LatencyMs,
      breakerOpen: _isBreakerOpen(name),
      lastError: s.lastError,
      lastErrorAt: s.lastErrorAt ? new Date(s.lastErrorAt).toISOString() : null,
    };
  }
  return out;
}

/** Test hook — reset all counters + breakers. */
function _reset() { _providerStats.clear(); }

module.exports = { tryLadder, providerHealth, _reset };
