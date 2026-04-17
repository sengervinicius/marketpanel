/**
 * aiCostLedger.js — W1.2 AI usage accounting.
 *
 * Persists every model call to the `ai_usage_ledger` table with token counts
 * and derived cost in cents. Provides the read-side used by the quota gate,
 * the org-wide kill-switch watchdog, and the admin dashboard.
 *
 * Pricing table is the single source of truth; update it when upstream
 * providers change list prices. All numbers here are USD per 1M tokens.
 *
 * Fallback behavior: if Postgres is unavailable, we still return the
 * in-memory day-bucket totals so quota enforcement degrades gracefully
 * instead of failing open on the wallet.
 */

'use strict';

const pg = require('../db/postgres');
const logger = require('../utils/logger');
// W1.4: prom-client wiring. NOOP shim exported if prom-client isn't installed.
const { metrics: promMetrics } = require('../utils/metrics');

// Quick tier lookup for the ai_calls_total / ai_cost_cents_total labels. We
// don't want to require tiers.js here because it hasn't historically been
// available; caller can pass tier on recordUsage if they want finer labels.
function _modelTier(model) {
  if (!model) return 'unknown';
  if (/haiku/i.test(model))            return 'cheap';
  if (/sonnet/i.test(model))           return 'premium';
  if (/sonar-pro|sonar_pro/i.test(model)) return 'premium';
  if (/sonar/i.test(model))            return 'cheap';
  return 'other';
}

// ── Model cost table ──────────────────────────────────────────────────────
// USD per 1,000,000 tokens. Source: anthropic.com/pricing, perplexity.ai/pricing
// (2026-04-17). Keep synced with modelRouter.PROVIDERS.
const MODEL_PRICING = {
  // Anthropic
  'claude-sonnet-4-20250514':   { in: 3.00,   out: 15.00 },
  'claude-haiku-4-5-20251001':  { in: 1.00,   out:  5.00 },
  'claude-3-5-sonnet':          { in: 3.00,   out: 15.00 }, // legacy alias
  'claude-3-5-haiku':           { in: 0.80,   out:  4.00 }, // legacy alias
  // Perplexity (approximate; sonar is bundled so we estimate from published tiers)
  'sonar':                      { in: 1.00,   out:  1.00 },
  'sonar-pro':                  { in: 3.00,   out: 15.00 },
  // Unknown fallback — charged like Sonnet to bias safe
  '__default__':                { in: 3.00,   out: 15.00 },
};

/**
 * Cost in cents for a given (model, tokens_in, tokens_out) tuple.
 * Returns a float; the DB column is NUMERIC(14,4) so fractional cents persist.
 */
function costCents(model, tokensIn, tokensOut) {
  const p = MODEL_PRICING[model] || MODEL_PRICING.__default__;
  // USD per 1M tokens → cents per 1 token = p / 10000
  const cents = (tokensIn * p.in + tokensOut * p.out) / 10000;
  return Math.max(0, cents);
}

// ── In-memory day bucket (fallback when PG down) ──────────────────────────
// Keyed by `${userId}:${dayISO}`; values are cumulative { tokensIn, tokensOut, cents }.
const _memBucket = new Map();
const MEM_MAX = 20000;

function _bucketKey(userId, day) { return `${userId}:${day}`; }
function _today() { return new Date().toISOString().slice(0, 10); }

function _memRecord(userId, model, tokensIn, tokensOut) {
  const k = _bucketKey(userId, _today());
  let r = _memBucket.get(k);
  if (!r) {
    if (_memBucket.size > MEM_MAX) _memBucket.clear();
    r = { tokensIn: 0, tokensOut: 0, cents: 0, calls: 0 };
    _memBucket.set(k, r);
  }
  r.tokensIn += tokensIn;
  r.tokensOut += tokensOut;
  r.cents += costCents(model, tokensIn, tokensOut);
  r.calls += 1;
  return r;
}

function _memDailyTokens(userId) {
  const r = _memBucket.get(_bucketKey(userId, _today()));
  if (!r) return 0;
  return r.tokensIn + r.tokensOut;
}

// ── Write path ────────────────────────────────────────────────────────────

/**
 * Record a completed model call. Fire-and-forget — never throws.
 *
 * @param {number} userId         — authenticated user id
 * @param {string} model          — provider.model string (e.g. 'sonar-pro')
 * @param {number} tokensIn       — prompt tokens
 * @param {number} tokensOut      — completion tokens
 */
async function recordUsage(userId, model, tokensIn = 0, tokensOut = 0) {
  if (!userId || !model) return;
  tokensIn = Math.max(0, Math.round(Number(tokensIn) || 0));
  tokensOut = Math.max(0, Math.round(Number(tokensOut) || 0));
  if (tokensIn === 0 && tokensOut === 0) return;

  // Always update memory bucket so quota gate keeps working if PG is down.
  _memRecord(userId, model, tokensIn, tokensOut);

  const tier = _modelTier(model);
  const cents = costCents(model, tokensIn, tokensOut);
  // Prom counters — safe no-ops when prom-client is absent.
  try {
    promMetrics.ai_calls_total.labels(model, tier, 'ok').inc();
    if (tokensIn > 0)  promMetrics.ai_tokens_total.labels(model, 'in').inc(tokensIn);
    if (tokensOut > 0) promMetrics.ai_tokens_total.labels(model, 'out').inc(tokensOut);
    if (cents > 0)     promMetrics.ai_cost_cents_total.labels(model, tier).inc(cents);
  } catch (_) { /* labels may throw on malformed model strings */ }

  if (!pg.isConnected || !pg.isConnected()) return;
  try {
    await pg.query(
      `INSERT INTO ai_usage_ledger (user_id, day, model, tokens_in, tokens_out, calls, cents, last_at)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, 1, $5, NOW())
       ON CONFLICT (user_id, day, model) DO UPDATE
         SET tokens_in  = ai_usage_ledger.tokens_in  + EXCLUDED.tokens_in,
             tokens_out = ai_usage_ledger.tokens_out + EXCLUDED.tokens_out,
             calls      = ai_usage_ledger.calls + 1,
             cents      = ai_usage_ledger.cents + EXCLUDED.cents,
             last_at    = NOW()`,
      [userId, model, tokensIn, tokensOut, cents]
    );
  } catch (e) {
    logger.warn('aiCostLedger', 'Failed to persist usage row', {
      userId, model, error: e.message,
    });
  }
}

// ── Read path ─────────────────────────────────────────────────────────────

/**
 * Total tokens (in + out) a user has consumed today across all models.
 * Used by the quota gate.
 */
async function getDailyTokens(userId) {
  if (!userId) return 0;
  if (pg.isConnected && pg.isConnected()) {
    try {
      const r = await pg.query(
        `SELECT COALESCE(SUM(tokens_in + tokens_out), 0)::BIGINT AS total
           FROM ai_usage_ledger
          WHERE user_id = $1 AND day = CURRENT_DATE`,
        [userId]
      );
      return Number(r.rows?.[0]?.total || 0);
    } catch (e) {
      logger.warn('aiCostLedger', 'getDailyTokens fell back to memory', { error: e.message });
    }
  }
  return _memDailyTokens(userId);
}

/**
 * Month-to-date org spend in cents (all users, all models).
 * Used by the kill-switch watchdog.
 */
async function getMonthlyCents() {
  if (!pg.isConnected || !pg.isConnected()) return 0;
  try {
    const r = await pg.query(
      `SELECT COALESCE(SUM(cents), 0)::NUMERIC AS cents
         FROM ai_usage_ledger
        WHERE day >= date_trunc('month', CURRENT_DATE)`
    );
    return Number(r.rows?.[0]?.cents || 0);
  } catch (e) {
    logger.warn('aiCostLedger', 'getMonthlyCents failed', { error: e.message });
    return 0;
  }
}

/**
 * Top-N users by 30-day spend. Returns [{userId, email, cents, tokens, calls, models:[...]}].
 */
async function topSpenders(limit = 20, windowDays = 30) {
  if (!pg.isConnected || !pg.isConnected()) return [];
  try {
    const r = await pg.query(
      `SELECT u.id AS user_id,
              u.username AS email,
              SUM(l.cents)::NUMERIC AS cents,
              SUM(l.tokens_in + l.tokens_out)::BIGINT AS tokens,
              SUM(l.calls)::INTEGER AS calls,
              array_agg(DISTINCT l.model) AS models
         FROM ai_usage_ledger l
         LEFT JOIN users u ON u.id = l.user_id
        WHERE l.day >= CURRENT_DATE - ($2::INTEGER) * INTERVAL '1 day'
        GROUP BY u.id, u.username
        ORDER BY cents DESC
        LIMIT $1`,
      [limit, windowDays]
    );
    return (r.rows || []).map(row => ({
      userId:  row.user_id,
      email:   row.email,
      cents:   Number(row.cents),
      tokens:  Number(row.tokens),
      calls:   Number(row.calls),
      models:  row.models || [],
    }));
  } catch (e) {
    logger.warn('aiCostLedger', 'topSpenders failed', { error: e.message });
    return [];
  }
}

/**
 * Per-user daily report for the admin dashboard: rolling 14-day spend,
 * per-user mean + stddev so we can flag >3σ outliers.
 */
async function anomalyReport(windowDays = 14) {
  if (!pg.isConnected || !pg.isConnected()) return [];
  try {
    const r = await pg.query(
      `WITH daily AS (
         SELECT user_id, day, SUM(cents) AS cents
           FROM ai_usage_ledger
          WHERE day >= CURRENT_DATE - ($1::INTEGER) * INTERVAL '1 day'
          GROUP BY user_id, day
       )
       SELECT user_id,
              AVG(cents)::NUMERIC         AS mean_cents,
              STDDEV(cents)::NUMERIC      AS stddev_cents,
              MAX(cents)::NUMERIC         AS peak_cents
         FROM daily
        GROUP BY user_id
        HAVING COUNT(*) >= 3`,
      [windowDays]
    );
    return (r.rows || []).map(row => ({
      userId:   row.user_id,
      mean:     Number(row.mean_cents),
      stddev:   Number(row.stddev_cents),
      peak:     Number(row.peak_cents),
      isOutlier: Number(row.peak_cents) > (Number(row.mean_cents) + 3 * Number(row.stddev_cents || 0)),
    }));
  } catch (e) {
    logger.warn('aiCostLedger', 'anomalyReport failed', { error: e.message });
    return [];
  }
}

// ── Kill-switch state cache ───────────────────────────────────────────────

let _killSwitchCache = {
  forceHaiku: false,
  blockAllAI: false,
  reason: null,
  monthlyBudgetCents: 100000, // $1,000 default
  checkedAt: 0,
};
const KILLSWITCH_TTL = 15 * 1000; // re-read every 15s

async function readKillSwitch() {
  const now = Date.now();
  if (now - _killSwitchCache.checkedAt < KILLSWITCH_TTL) {
    return _killSwitchCache;
  }
  if (!pg.isConnected || !pg.isConnected()) {
    _killSwitchCache.checkedAt = now;
    return _killSwitchCache;
  }
  try {
    const r = await pg.query(
      `SELECT force_haiku, block_all_ai, reason, monthly_budget_cents
         FROM ai_kill_switch WHERE singleton = TRUE`
    );
    const row = r.rows?.[0];
    if (row) {
      _killSwitchCache = {
        forceHaiku:         !!row.force_haiku,
        blockAllAI:         !!row.block_all_ai,
        reason:             row.reason || null,
        monthlyBudgetCents: Number(row.monthly_budget_cents) || 100000,
        checkedAt:          now,
      };
    }
  } catch (e) {
    logger.warn('aiCostLedger', 'readKillSwitch failed', { error: e.message });
    _killSwitchCache.checkedAt = now;
  }
  return _killSwitchCache;
}

async function tripKillSwitch({ forceHaiku, blockAllAI, reason, trippedBy }) {
  if (!pg.isConnected || !pg.isConnected()) {
    _killSwitchCache = { ..._killSwitchCache, forceHaiku: !!forceHaiku, blockAllAI: !!blockAllAI, reason, checkedAt: Date.now() };
    return;
  }
  try {
    await pg.query(
      `UPDATE ai_kill_switch
          SET force_haiku = $1,
              block_all_ai = $2,
              reason = $3,
              tripped_at = NOW(),
              tripped_by = $4,
              updated_at = NOW()
        WHERE singleton = TRUE`,
      [!!forceHaiku, !!blockAllAI, reason || null, trippedBy || 'budget_watchdog']
    );
    // Force refresh on next read
    _killSwitchCache.checkedAt = 0;
    logger.warn('aiCostLedger', 'Kill-switch tripped', { forceHaiku, blockAllAI, reason, trippedBy });
  } catch (e) {
    logger.error('aiCostLedger', 'Failed to persist kill-switch', { error: e.message });
  }
}

// ── Budget watchdog ───────────────────────────────────────────────────────
// Runs every 5 minutes. If MTD spend exceeds 80% of the configured monthly
// budget, flips force_haiku = TRUE (keeps cheap model available). At 100%
// flips block_all_ai = TRUE. Automatically recovers at month boundary.

async function runBudgetWatchdogOnce() {
  try {
    const cents = await getMonthlyCents();
    const ks = await readKillSwitch();
    const budget = ks.monthlyBudgetCents || 100000;
    const pct = budget > 0 ? cents / budget : 0;

    // W1.4: publish MTD spend + current kill-switch state as gauges so
    // Prometheus/Grafana can alert and draw the "percent of budget" chart.
    try {
      promMetrics.ai_monthly_spend_cents.set(Number(cents) || 0);
      promMetrics.ai_kill_switch_state.labels('force_haiku').set(ks.forceHaiku ? 1 : 0);
      promMetrics.ai_kill_switch_state.labels('block_all_ai').set(ks.blockAllAI ? 1 : 0);
    } catch (_) {}

    if (pct >= 1.0 && !ks.blockAllAI) {
      await tripKillSwitch({
        forceHaiku: true,
        blockAllAI: true,
        reason: `Monthly AI budget exceeded: $${(cents / 100).toFixed(2)} of $${(budget / 100).toFixed(2)}`,
        trippedBy: 'budget_watchdog',
      });
    } else if (pct >= 0.8 && !ks.forceHaiku) {
      await tripKillSwitch({
        forceHaiku: true,
        blockAllAI: false,
        reason: `Monthly AI budget at ${(pct * 100).toFixed(1)}% — routing to Haiku until next cycle`,
        trippedBy: 'budget_watchdog',
      });
    }
  } catch (e) {
    logger.warn('aiCostLedger', 'budget watchdog failed', { error: e.message });
  }
}

function startBudgetWatchdog() {
  // Run shortly after boot and then every 5 minutes.
  setTimeout(() => { runBudgetWatchdogOnce().catch(() => {}); }, 30 * 1000).unref();
  setInterval(() => { runBudgetWatchdogOnce().catch(() => {}); }, 5 * 60 * 1000).unref();
}

module.exports = {
  MODEL_PRICING,
  costCents,
  recordUsage,
  getDailyTokens,
  getMonthlyCents,
  topSpenders,
  anomalyReport,
  readKillSwitch,
  tripKillSwitch,
  runBudgetWatchdogOnce,
  startBudgetWatchdog,
};
