/**
 * utils/providerBudget.js — #251 P3.2 / D4.2
 *
 * Central declaration of per-provider rate-limit budgets + a small
 * observation API that every call site can use to report:
 *
 *   - an attempted request                    (observe(provider, 'attempt'))
 *   - a provider-side rate-limit bounce (429) (observe(provider, 'rate_limited'))
 *   - a successful upstream response          (observe(provider, 'ok'))
 *   - any other failure                        (observe(provider, 'error'))
 *
 * Counts are kept in a sliding-window ring per provider (bucket = 10s,
 * default window = 15 min) and also fed to Prometheus counters/gauges so
 * Grafana can alert on "budget burn rate" long before we actually hit the
 * provider's quota and start 429-ing users.
 *
 * Budget declarations are intentionally human-readable (comment + literal
 * value) rather than loaded from env — the goal is a single greppable
 * source of truth we can audit during an incident. Changing a number is a
 * code review, which is the right friction for a quota that we care about.
 *
 * This module ONLY observes — it does NOT block requests. Enforcement
 * (returning 503 before we hit the provider ceiling) is a future step;
 * the observability is the prerequisite for knowing where to draw the
 * line. Until then, the existing lib/requestQueue throttles stay in
 * place as the first line of defence.
 */

'use strict';

const { metrics: promMetrics } = require('./metrics');

// ── Budget table ────────────────────────────────────────────────────────
// Numbers reflect the free-tier ceilings for each provider as of April
// 2026. When upgrading a plan or renegotiating, update the value here
// AND bump the window if the vendor reports it differently.
const PROVIDER_BUDGETS = Object.freeze({
  polygon:       { limit: 5,    windowMs: 60_000,             note: 'free tier: 5 req/min' },
  twelvedata:    { limit: 800,  windowMs: 24 * 60 * 60_000,   note: 'free tier: 800 req/day' },
  finnhub:       { limit: 60,   windowMs: 60_000,             note: 'free tier: 60 req/min' },
  alphavantage:  { limit: 25,   windowMs: 24 * 60 * 60_000,   note: 'free tier: 25 req/day' },
  eulerpool:     { limit: 3000, windowMs: 24 * 60 * 60_000,   note: 'paid tier: 3k req/day' },
  yahoo:         { limit: 2000, windowMs: 60 * 60_000,        note: 'unofficial: ~2k req/hr soft cap' },
  brapi:         { limit: 2000, windowMs: 24 * 60 * 60_000,   note: 'free tier: 2k req/day' },
  fred:          { limit: 120,  windowMs: 60_000,             note: 'free tier: 120 req/min' },
  bcb:           { limit: 10,   windowMs: 1_000,              note: 'public SDMX: 10 req/s soft cap' },
  tavily:        { limit: 1000, windowMs: 30 * 24 * 60 * 60_000, note: 'paid tier: 1k req/month' },
});

const BUCKET_MS = 10_000; // 10s buckets — enough resolution for the 1-min budgets

// provider → { buckets: Map<bucketIdx, {attempt,ok,rate_limited,error}>, meta }
const state = new Map();

function bucketIndex(ts) {
  return Math.floor(ts / BUCKET_MS);
}

function getProviderState(provider) {
  let s = state.get(provider);
  if (!s) {
    s = { buckets: new Map() };
    state.set(provider, s);
  }
  return s;
}

function trimOldBuckets(s, now, windowMs) {
  const oldest = bucketIndex(now - windowMs);
  for (const idx of s.buckets.keys()) {
    if (idx < oldest) s.buckets.delete(idx);
  }
}

/**
 * Record a provider observation. Outcomes: 'attempt', 'ok', 'rate_limited', 'error'.
 * Unknown outcomes are recorded as 'error' so we don't lose the signal.
 */
function observe(provider, outcome) {
  if (!provider) return;
  const key = String(provider).toLowerCase();
  const now = Date.now();
  const s = getProviderState(key);
  const idx = bucketIndex(now);
  let bucket = s.buckets.get(idx);
  if (!bucket) {
    bucket = { attempt: 0, ok: 0, rate_limited: 0, error: 0 };
    s.buckets.set(idx, bucket);
  }
  const normalized = ['attempt', 'ok', 'rate_limited', 'error'].includes(outcome)
    ? outcome
    : 'error';
  bucket[normalized] += 1;

  // Feed Prometheus counters so Grafana/alertmanager see the same signal.
  try {
    if (promMetrics.provider_requests_total?.labels) {
      promMetrics.provider_requests_total.labels(key, normalized).inc();
    }
    if (normalized === 'rate_limited' && promMetrics.provider_rate_limited_total?.labels) {
      promMetrics.provider_rate_limited_total.labels(key).inc();
    }
  } catch (_) { /* labels threw */ }
}

/**
 * Count attempts for a provider inside its declared window.
 * Returns { limit, used, remaining, windowMs, pct } or null if unknown provider.
 */
function usage(provider) {
  const key = String(provider || '').toLowerCase();
  const budget = PROVIDER_BUDGETS[key];
  if (!budget) return null;

  const now = Date.now();
  const s = getProviderState(key);
  trimOldBuckets(s, now, budget.windowMs);

  const since = bucketIndex(now - budget.windowMs);
  let used = 0;
  for (const [idx, bucket] of s.buckets) {
    if (idx >= since) used += bucket.attempt;
  }
  const remaining = Math.max(0, budget.limit - used);
  const pct = budget.limit > 0 ? Math.min(1, used / budget.limit) : 0;

  // Publish to Prometheus gauge on every read.
  try {
    if (promMetrics.provider_budget_remaining?.labels) {
      promMetrics.provider_budget_remaining.labels(key).set(remaining);
    }
    if (promMetrics.provider_budget_used_pct?.labels) {
      promMetrics.provider_budget_used_pct.labels(key).set(pct);
    }
  } catch (_) { /* labels threw */ }

  return { limit: budget.limit, used, remaining, windowMs: budget.windowMs, pct };
}

/**
 * Snapshot of every declared provider's current usage — intended for an
 * admin dashboard or a /metrics-like JSON endpoint.
 */
function getSummary() {
  const out = {};
  for (const key of Object.keys(PROVIDER_BUDGETS)) {
    out[key] = { ...PROVIDER_BUDGETS[key], ...(usage(key) || {}) };
  }
  return out;
}

/**
 * Reset in-memory state — for tests.
 */
function _resetForTests() {
  state.clear();
}

module.exports = {
  PROVIDER_BUDGETS,
  observe,
  usage,
  getSummary,
  _resetForTests,
};
