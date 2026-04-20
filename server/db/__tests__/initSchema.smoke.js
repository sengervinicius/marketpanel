#!/usr/bin/env node
/**
 * initSchema.smoke.js — fresh-Postgres smoke test for init.sql.
 *
 * Runs against a throwaway Postgres instance (TEST_POSTGRES_URL), wipes
 * the public schema, applies every statement in server/db/init.sql, and
 * asserts that:
 *   1. Every statement succeeds.
 *   2. Every required table the app depends on is present.
 *   3. feature_flags has been seeded with the three baseline flags and
 *      ai_chat_enabled defaults to (enabled=TRUE, rollout_pct=100).
 *
 * This is the regression net for the 2026-04-20 incident, where a
 * CREATE INDEX with NOW() in its predicate aborted init.sql mid-run on
 * a fresh DB and `feature_flags` was never created — silently 503'ing
 * /api/search/chat for every user.
 *
 * Expected to run in CI (see .github/workflows/ci.yml → schema-smoke).
 * To run locally:
 *   docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
 *   TEST_POSTGRES_URL='postgres://postgres:postgres@localhost:5432/postgres' \
 *     node server/db/__tests__/initSchema.smoke.js
 *
 * Exit code 0 = healthy; 1 = any failure. Logs every problem explicitly
 * so CI diffs are readable.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const { splitSqlStatements, REQUIRED_TABLES } = require('../postgres');

const REQUIRED_FLAG_SEEDS = ['ai_chat_enabled', 'vault_enabled', 'support_chat_enabled'];

const url = process.env.TEST_POSTGRES_URL;
if (!url) {
  console.error('ERROR: TEST_POSTGRES_URL must be set (e.g. postgres://postgres:postgres@localhost:5432/postgres)');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: url });
  let failures = 0;
  const fail = (msg) => { failures++; console.error('  FAIL —', msg); };
  const ok   = (msg) => { console.log('  ok —', msg); };

  try {
    console.log('schema smoke test');

    // 1. Wipe the public schema so we exercise init.sql on a guaranteed
    //    fresh DB (same conditions as a brand-new Render Postgres).
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    ok('public schema reset');

    // 2. Run every statement in init.sql individually and count failures.
    const initSqlPath = path.join(__dirname, '..', 'init.sql');
    const initSQL = fs.readFileSync(initSqlPath, 'utf8');
    const stmts = splitSqlStatements(initSQL);
    let stmtFailures = 0;
    for (const stmt of stmts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await pool.query(stmt);
      } catch (e) {
        stmtFailures++;
        const preview = stmt.replace(/\s+/g, ' ').slice(0, 160);
        fail(`init.sql statement rejected: ${e.message}\n     stmt: ${preview}`);
      }
    }
    if (stmtFailures === 0) {
      ok(`all ${stmts.length} init.sql statements applied cleanly`);
    }

    // 3. Every table in REQUIRED_TABLES must exist after init.sql.
    const { rows: tableRows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'`
    );
    const present = new Set(tableRows.map(r => r.table_name));
    const missing = REQUIRED_TABLES.filter(t => !present.has(t));
    if (missing.length > 0) {
      fail(`required tables missing after init.sql: ${missing.join(', ')}`);
    } else {
      ok(`all ${REQUIRED_TABLES.length} required tables present`);
    }

    // 4. feature_flags seed must include the three baseline flags, and
    //    ai_chat_enabled must default to (TRUE, 100). If the seed ever
    //    changes to OFF-by-default, we want CI to flag it explicitly.
    if (present.has('feature_flags')) {
      const { rows: flagRows } = await pool.query(
        `SELECT name, enabled, rollout_pct FROM feature_flags ORDER BY name`
      );
      const seedNames = new Set(flagRows.map(r => r.name));
      const missingSeeds = REQUIRED_FLAG_SEEDS.filter(n => !seedNames.has(n));
      if (missingSeeds.length > 0) {
        fail(`feature_flags seed missing rows: ${missingSeeds.join(', ')}`);
      } else {
        ok(`feature_flags seed has all ${REQUIRED_FLAG_SEEDS.length} baseline rows`);
      }
      const aiChat = flagRows.find(r => r.name === 'ai_chat_enabled');
      if (!aiChat || aiChat.enabled !== true || Number(aiChat.rollout_pct) !== 100) {
        fail(`ai_chat_enabled seed wrong: ${JSON.stringify(aiChat)} (expected enabled=true, rollout_pct=100)`);
      } else {
        ok('ai_chat_enabled seeded as (TRUE, 100) — anonymous /api/search/chat will pass');
      }
    }

  } catch (e) {
    fail(`smoke test threw: ${e.message}`);
  } finally {
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} failure(s). init.sql is NOT safe to deploy.`);
    process.exit(1);
  }
  console.log('\n✓ PASS: init.sql is healthy on a fresh Postgres.');
})();
