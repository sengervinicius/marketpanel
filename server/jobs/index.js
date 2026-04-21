/**
 * jobs/index.js — Central job scheduler.
 *
 * Registers all background jobs with node-cron for predictable scheduling.
 * Wraps each job with duration logging and error handling.
 * Replaces raw setInterval/setTimeout for leaderboard and share-card cleanup.
 * Alert scheduler is kept as a heartbeat but managed from here.
 */

'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');

const registered = new Map(); // name → cronTask

/**
 * Register and start a cron job.
 * @param {string} name - unique job name
 * @param {string} schedule - cron expression (e.g. '0 *\/4 * * *')
 * @param {Function} fn - async function to run
 * @param {{ runOnStart?: boolean }} opts
 */
function registerJob(name, schedule, fn, opts = {}) {
  if (registered.has(name)) {
    logger.warn('scheduler', `Job "${name}" already registered — skipping duplicate`);
    return;
  }

  const wrappedFn = async () => {
    const start = Date.now();
    logger.info('scheduler', `Job "${name}" started`);
    try {
      await fn();
      const durationMs = Date.now() - start;
      logger.info('scheduler', `Job "${name}" completed`, { durationMs });
    } catch (e) {
      const durationMs = Date.now() - start;
      logger.error('scheduler', `Job "${name}" failed`, { durationMs, error: e.message });
    }
  };

  const task = cron.schedule(schedule, wrappedFn, { scheduled: true });
  registered.set(name, task);
  logger.info('scheduler', `Registered job "${name}" (${schedule})`);

  if (opts.runOnStart) {
    // Run after a short delay so the server is fully booted
    setTimeout(wrappedFn, 3000);
  }
}

/**
 * Stop all registered jobs.
 */
function stopAll() {
  for (const [name, task] of registered) {
    task.stop();
    logger.info('scheduler', `Stopped job "${name}"`);
  }
  registered.clear();
}

/**
 * Initialise all platform jobs.
 * Called from index.js after DB init.
 * @param {{ port: number }} ctx
 */
function initJobs(ctx = {}) {
  const { port = 3001 } = ctx;

  // ── Share-card cleanup: every 5 minutes ──────────────────────────────
  const { cleanupCards } = require('./cardCleanup');
  registerJob('share-card-cleanup', '*/5 * * * *', cleanupCards);

  // ── LGPD retention: daily at 03:15 BRT ───────────────────────────────
  // Hard-deletes any user in dsar_erasure_queue whose 30-day grace
  // window has elapsed, and redacts DPO-ticket PII older than 90 days.
  const { runRetentionOnce } = require('./lgpdRetention');
  registerJob('lgpd-retention', '15 6 * * *', runRetentionOnce);  // 03:15 BRT = 06:15 UTC

  // ── Subscription reconciler: hourly (W2.2) ───────────────────────────
  // Compares local users row to Stripe; records drift + auto-corrects.
  const { runOnce: reconcileSubs } = require('./subscriptionReconciler');
  registerJob('subscription-reconciler', '7 * * * *', reconcileSubs);

  // ── IAP reconciler: daily at 03:45 BRT = 06:45 UTC (W5.1) ────────────
  // Re-verifies every active/grace Apple iap_receipts row against Apple's
  // verifyReceipt endpoint and corrects drift (refunds, family-share
  // removals, cancellations Apple's S2S webhook never delivered).
  // Staggered 30min after LGPD retention to avoid compound DB load.
  const { runOnce: reconcileIap } = require('./iapReconciler');
  registerJob('iap-reconciler', '45 6 * * *', reconcileIap);

  // ── Adapter quality probe: daily at 04:30 BRT = 07:30 UTC (W5.5/5.6) ─
  // Runs adapterQualityHarness against every registered adapter's declared
  // capabilities and writes results into coverage_matrix + coverage_probes.
  // This is what populates the /admin/coverage dashboard and unblocks the
  // router's confidence-based adapter selection (W5.7 router hookup).
  // Scheduled 45min after IAP reconciler to spread load.
  const { runProbes } = require('../services/adapterQualityHarness');
  const coverageMatrix = require('../services/coverageMatrix');
  const pg = require('../db/postgres');
  const { getRegistry } = require('../adapters/registry');
  registerJob('adapter-quality-probe', '30 7 * * *', async () => {
    const registry = getRegistry();
    const report = await runProbes({ registry });
    await coverageMatrix.recordProbeRun({ report, pg });
  });

  // ── Regional probe runner: daily at 05:00 BRT = 08:00 UTC (W6.1) ─────
  // The generic adapter-quality-probe above runs ONE probe per capability
  // against a US ticker (quote(AAPL)). That tells us finnhub's quote path
  // works but NOTHING about whether its KRX branch resolves 005930.KS.
  // This runner iterates coverage_matrix rows and calls each adapter with
  // a ticker canonical to THAT exchange (Samsung on KRX, Toyota on TSE,
  // Tencent on HKEX, DBS on SGX, Petrobras on B3, SAP on EU). Only this
  // can earn green streaks on non-US cells and eventually promote them.
  // Staggered 30min after the generic probe to spread load.
  const { runRegionalProbes } = require('../services/regionalProbeRunner');
  registerJob('regional-probe-runner', '0 8 * * *', async () => {
    const registry = getRegistry();
    await runRegionalProbes({ pg, registry });
  });

  // ── Morning Brief dispatcher: every 5 minutes (Phase 10.7) ───────────
  // Walks all users and dispatches their personalized Morning Brief when
  // their local time hits the preferred send window (default 06:30 in
  // their timezone). Idempotent via brief_inbox UNIQUE(user_id, brief_date)
  // so re-ticks the same day are a no-op. Email + inbox channels both
  // respect per-user settings.morningBriefEmail / morningBriefInbox.
  const { runOnce: dispatchMorningBriefs } = require('./morningBriefDispatcher');
  registerJob('morning-brief-dispatcher', '*/5 * * * *', dispatchMorningBriefs);

  // ── Staleness sweep: every minute (W3.3) ─────────────────────────────
  // Emits severity transitions per feed; updates the age gauge consumed
  // by /metrics and /admin/debug.
  const { sweep: stalenessSweep } = require('../services/stalenessMonitor');
  registerJob('staleness-sweep', '* * * * *', stalenessSweep);

  // ── Alert evaluation: every 45 seconds ──────────────────────────────
  // Alert scheduler uses internal heartbeat loop because it needs sub-minute
  // cadence. We just start it here for central management.
  const { startAlertScheduler } = require('../alertScheduler');
  startAlertScheduler(port);

  logger.info('scheduler', `All jobs initialised (${registered.size} cron + alert heartbeat)`);
}

module.exports = { registerJob, stopAll, initJobs };
