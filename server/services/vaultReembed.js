/**
 * vaultReembed.js — W4.4.
 *
 * Idempotent, resumable background job that re-embeds vault chunks which
 * were embedded under a provider that no longer matches the active one.
 *
 * Why this exists:
 *   When the team flips the active embedding provider (e.g. env var
 *   VAULT_EMBEDDING_PROVIDER from 'openai' to 'voyage'), every existing
 *   chunk was embedded under the old provider. After W4.3 removed the
 *   silent cross-provider retrieval fallback, those chunks become
 *   invisible under the new provider — they need re-embedding. Without
 *   this job, Vinicius would have to truncate vault_chunks and re-ingest
 *   every document from source, which is disruptive, slow, and loses
 *   Vault Signals history.
 *
 * Safety properties:
 *   - **Idempotent**: the SELECT uses `embedding_provider != targetProvider`,
 *     so already-migrated rows are skipped automatically. Safe to re-run.
 *   - **Resumable**: each batch commits its updates. A crash mid-job leaves
 *     the table in a consistent mixed state; the next run finishes it.
 *   - **Rate-safe**: processes at most `batchSize` chunks per API round;
 *     the injected `embedFn` is expected to throttle underneath.
 *   - **Poll-friendly**: returns progress after every batch so a caller
 *     (admin UI, CLI, cron) can render a live progress bar.
 *   - **No HTTP wiring here**: exposing this as a route would be
 *     operationally dangerous (a bug in auth or CSRF could let anyone
 *     kick off a whole-vault re-embed that costs real money). Wiring to
 *     a protected admin route is a separate slice.
 *
 * Dependency injection for tests:
 *   Callers pass in `embedFn`, `pgHandle`, and optionally `log`. Tests
 *   use mocks so we don't have to spin up OpenAI / Voyage / Postgres.
 */
'use strict';

const crypto = require('crypto');
const realPg = require('../db/postgres');
const realLogger = require('../utils/logger');

/** Default batch size — enough to amortise API overhead without risking
 *  a single failed batch wiping out too much work. */
const DEFAULT_BATCH_SIZE = 50;

/** Cap the total number of batches per run so a runaway job can't
 *  silently burn an entire embedding budget. A caller can override. */
const DEFAULT_MAX_BATCHES = 200;

/** Providers we recognise. Anything else is rejected up front. */
const VALID_PROVIDERS = new Set(['openai', 'voyage']);

// ── In-memory job registry ────────────────────────────────────────────────
// Mirrors the shape of vault.js's _ingestionJobs. Jobs are keyed by a
// short random id; callers poll getReembedJob(jobId) for progress.

const _jobs = new Map();
const JOB_TTL_MS = 3600_000; // 1 hour

function _newJobId() {
  return `reembed_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function _pruneOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, j] of _jobs) {
    if (j.finishedAt && j.finishedAt < cutoff) _jobs.delete(id);
  }
}

function _snapshotJob(j) {
  // Return a plain object so callers can't accidentally mutate state.
  return {
    jobId: j.jobId,
    targetProvider: j.targetProvider,
    status: j.status,
    totalCandidates: j.totalCandidates,
    processed: j.processed,
    succeeded: j.succeeded,
    failed: j.failed,
    batchesDone: j.batchesDone,
    error: j.error,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Count chunks that still need re-embedding under `targetProvider`.
 * Returns 0 on DB outage — the job loop will then see "no work to do".
 *
 * @param {string} targetProvider
 * @param {Object} [deps]
 * @returns {Promise<number>}
 */
async function countReembedCandidates(targetProvider, deps = {}) {
  const pg = deps.pg || realPg;
  if (!VALID_PROVIDERS.has(targetProvider)) return 0;
  if (!pg.isConnected()) return 0;
  try {
    const r = await pg.query(
      `SELECT COUNT(*)::int AS n
       FROM vault_chunks
       WHERE COALESCE(embedding_provider, 'unknown') != $1`,
      [targetProvider]
    );
    return r.rows?.[0]?.n || 0;
  } catch (err) {
    (deps.log || realLogger).warn('vaultReembed', 'count failed', { error: err.message });
    return 0;
  }
}

/**
 * Run (or start) a re-embed job.
 *
 * @param {Object} args
 * @param {string} args.targetProvider       - 'openai' | 'voyage'
 * @param {Function} args.embedFn            - async (texts: string[]) => (number[]|null)[]
 * @param {number} [args.batchSize]
 * @param {number} [args.maxBatches]
 * @param {Function} [args.onProgress]       - called with a job snapshot after each batch
 * @param {Object} [deps]                    - { pg, log } for test injection
 * @returns {Promise<Object>} Final job snapshot.
 */
async function runReembedJob(args, deps = {}) {
  const pg = deps.pg || realPg;
  const log = deps.log || realLogger;

  const targetProvider = args?.targetProvider;
  const embedFn = args?.embedFn;
  const batchSize = Number.isInteger(args?.batchSize) && args.batchSize > 0
    ? Math.min(args.batchSize, 500)
    : DEFAULT_BATCH_SIZE;
  const maxBatches = Number.isInteger(args?.maxBatches) && args.maxBatches > 0
    ? args.maxBatches
    : DEFAULT_MAX_BATCHES;

  if (!VALID_PROVIDERS.has(targetProvider)) {
    throw new Error(`Invalid targetProvider: ${JSON.stringify(targetProvider)}`);
  }
  if (typeof embedFn !== 'function') {
    throw new Error('embedFn is required');
  }

  _pruneOldJobs();

  const jobId = _newJobId();
  const job = {
    jobId,
    targetProvider,
    status: 'running',
    totalCandidates: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    batchesDone: 0,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  _jobs.set(jobId, job);

  if (!pg.isConnected()) {
    job.status = 'error';
    job.error = 'postgres not connected';
    job.finishedAt = Date.now();
    return _snapshotJob(job);
  }

  try {
    job.totalCandidates = await countReembedCandidates(targetProvider, deps);

    for (let b = 0; b < maxBatches; b++) {
      // Pull one batch of candidates. Sort by id for deterministic, resumable
      // progress — the next run will find the same rows in the same order.
      const sel = await pg.query(
        `SELECT id, content
         FROM vault_chunks
         WHERE COALESCE(embedding_provider, 'unknown') != $1
         ORDER BY id
         LIMIT $2`,
        [targetProvider, batchSize]
      );
      const rows = sel.rows || [];
      if (rows.length === 0) break;

      const texts = rows.map(r => r.content);
      let embeddings;
      try {
        embeddings = await embedFn(texts);
      } catch (err) {
        log.warn('vaultReembed', 'embedFn threw — aborting batch', {
          error: err.message, jobId, batch: b,
        });
        job.failed += rows.length;
        // Keep loop going — transient errors on one batch shouldn't kill
        // the whole job. But if they persist, maxBatches will bound us.
        job.batchesDone += 1;
        if (typeof args.onProgress === 'function') {
          try { args.onProgress(_snapshotJob(job)); } catch { /* swallow */ }
        }
        continue;
      }

      if (!Array.isArray(embeddings) || embeddings.length !== rows.length) {
        log.warn('vaultReembed', 'embedFn returned wrong shape — skipping batch', {
          jobId, expected: rows.length, got: Array.isArray(embeddings) ? embeddings.length : 'not-array',
        });
        job.failed += rows.length;
        job.batchesDone += 1;
        continue;
      }

      // Apply each embedding individually so one bad vector doesn't poison
      // the whole batch. Pgvector wants an array literal like '[0.1, 0.2, ...]'.
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const vec = embeddings[i];
        if (!Array.isArray(vec) || vec.length === 0) {
          job.failed += 1;
          job.processed += 1;
          continue;
        }
        try {
          await pg.query(
            `UPDATE vault_chunks
             SET embedding = $1::vector,
                 embedding_provider = $2
             WHERE id = $3`,
            [`[${vec.join(',')}]`, targetProvider, row.id]
          );
          job.succeeded += 1;
        } catch (err) {
          log.warn('vaultReembed', 'row update failed', {
            jobId, rowId: row.id, error: err.message,
          });
          job.failed += 1;
        }
        job.processed += 1;
      }

      job.batchesDone += 1;
      if (typeof args.onProgress === 'function') {
        try { args.onProgress(_snapshotJob(job)); } catch { /* swallow */ }
      }

      // If we processed fewer rows than a full batch, we've hit the tail.
      if (rows.length < batchSize) break;
    }

    // Note: we don't set status='complete' unless we actually ran to
    // exhaustion. If maxBatches hit before candidates hit zero, leave
    // status='running' so callers know there's more work.
    const remaining = await countReembedCandidates(targetProvider, deps);
    job.status = remaining === 0 ? 'complete' : 'paused';
  } catch (err) {
    log.error('vaultReembed', 'job loop crashed', { jobId, error: err.message });
    job.status = 'error';
    job.error = err.message;
  }

  job.finishedAt = Date.now();
  return _snapshotJob(job);
}

/**
 * Fetch a live job snapshot by id (for admin progress polling).
 * @returns {Object|null}
 */
function getReembedJob(jobId) {
  const j = _jobs.get(jobId);
  return j ? _snapshotJob(j) : null;
}

/** Used by tests to reset in-memory job registry. */
function _resetForTest() {
  _jobs.clear();
}

module.exports = {
  countReembedCandidates,
  runReembedJob,
  getReembedJob,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_BATCHES,
  VALID_PROVIDERS,
  _resetForTest,
};
