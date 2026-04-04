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

  // ── Leaderboard precompute: every 4 hours + on start ────────────────
  const { computeLeaderboards, computeGameLeaderboards } = require('./leaderboards');
  registerJob('leaderboard-compute', '0 */4 * * *', () => {
    computeLeaderboards();
    computeGameLeaderboards();
  }, { runOnStart: true });

  // ── Share-card cleanup: every 5 minutes ──────────────────────────────
  const { cleanupCards } = require('./cardCleanup');
  registerJob('share-card-cleanup', '*/5 * * * *', cleanupCards);

  // ── Alert evaluation: every 45 seconds ──────────────────────────────
  // Alert scheduler uses internal heartbeat loop because it needs sub-minute
  // cadence. We just start it here for central management.
  const { startAlertScheduler } = require('../alertScheduler');
  startAlertScheduler(port);

  logger.info('scheduler', `All jobs initialised (${registered.size} cron + alert heartbeat)`);
}

module.exports = { registerJob, stopAll, initJobs };
