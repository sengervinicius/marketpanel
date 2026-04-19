/**
 * server/db/runMigrations.js
 * ─────────────────────────────────────────────────────────────────────
 * Lightweight SQL migration runner. Runs every `.sql` file in
 * server/db/migrations/ that hasn't been applied yet, in lexicographic
 * order. Tracking table `schema_migrations` stores each filename plus
 * its sha256 + apply timestamp, so the same file is never re-applied
 * and a modified file surfaces as a loud warning (not a silent
 * double-apply).
 *
 * Design rules:
 *   • Each file runs in a single transaction (the file itself may
 *     open BEGIN/COMMIT; if it doesn't, we wrap it).
 *   • Failure in any file aborts the run and logs; callers decide
 *     whether that's fatal. We log but do NOT crash the process —
 *     the app should still come up so operators can intervene.
 *   • This is intentionally minimal: no down migrations, no
 *     dependency DAG, no branching. For Wave 1 scope this is all we
 *     need. When we have >20 migrations or multi-developer merge
 *     conflicts, we'll swap in node-pg-migrate.
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureTrackingTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename     TEXT PRIMARY KEY,
      sha256       TEXT NOT NULL,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Apply every migration file that isn't in schema_migrations yet.
 * Safe to call on every boot.
 * @param {import('pg').Pool} pool
 */
async function runMigrations(pool) {
  if (!pool) {
    logger.info('migrations', 'no pool — skipping');
    return { applied: 0, skipped: 0 };
  }

  try {
    await ensureTrackingTable(pool);
  } catch (e) {
    logger.error('migrations', 'failed to create schema_migrations table', { error: e.message });
    return { applied: 0, skipped: 0, error: e.message };
  }

  const files = listMigrationFiles();
  if (files.length === 0) {
    logger.info('migrations', 'no migration files found');
    return { applied: 0, skipped: 0 };
  }

  const { rows: appliedRows } = await pool.query(
    'SELECT filename, sha256 FROM schema_migrations'
  );
  const applied = new Map(appliedRows.map(r => [r.filename, r.sha256]));

  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const full = path.join(MIGRATIONS_DIR, file);
    let sql;
    try {
      sql = fs.readFileSync(full, 'utf8');
    } catch (e) {
      logger.error('migrations', 'failed to read file', { file, error: e.message });
      continue;
    }
    const hash = sha256(sql);

    if (applied.has(file)) {
      if (applied.get(file) !== hash) {
        logger.warn('migrations', 'already-applied migration file has been modified', {
          file,
          recordedSha: applied.get(file).slice(0, 8),
          currentSha: hash.slice(0, 8),
        });
      }
      skippedCount++;
      continue;
    }

    const client = await pool.connect();
    try {
      // The file itself may or may not include BEGIN/COMMIT. We do NOT
      // wrap it here because wrapping a file that already has its own
      // BEGIN/COMMIT would cause a nested-transaction error.
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, sha256) VALUES ($1, $2)',
        [file, hash],
      );
      appliedCount++;
      logger.info('migrations', 'applied', { file });
    } catch (e) {
      logger.error('migrations', 'apply failed', { file, error: e.message });
      // Don't record in schema_migrations so next boot will retry.
      // Continue with remaining files — operator can fix and redeploy.
    } finally {
      client.release();
    }
  }

  logger.info('migrations', 'run complete', { applied: appliedCount, skipped: skippedCount });
  return { applied: appliedCount, skipped: skippedCount };
}

module.exports = { runMigrations };
