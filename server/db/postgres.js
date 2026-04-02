/**
 * db/postgres.js — Postgres connection pool & query helpers.
 *
 * Strategy:
 *   - If POSTGRES_URL is set, create a pg.Pool and expose query helpers.
 *   - If absent, all helpers no-op gracefully (returns null / empty arrays).
 *   - On first connect, runs init.sql to ensure tables exist.
 *   - Callers should always check `isConnected()` or handle null returns.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

let pool = null;

/**
 * Initialise the Postgres pool and run schema init.
 * Safe to call even if POSTGRES_URL is not set — returns false.
 * @returns {boolean} true if connected
 */
async function initPostgres() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    logger.info('postgres', 'POSTGRES_URL not set — Postgres persistence disabled');
    return false;
  }

  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
      ssl: url.includes('sslmode=require') || url.includes('render.com')
        ? { rejectUnauthorized: false }
        : undefined,
    });

    // Verify connectivity
    const client = await pool.connect();
    client.release();

    // Run init SQL to create tables if absent
    const initSQL = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
    await pool.query(initSQL);

    logger.info('postgres', 'Connected and schema initialised');
    return true;
  } catch (e) {
    logger.error('postgres', 'Connection failed — falling back to MongoDB/in-memory', { error: e.message });
    pool = null;
    return false;
  }
}

/** @returns {boolean} */
function isConnected() {
  return pool !== null;
}

/**
 * Run a parameterised query.
 * @param {string} text - SQL with $1, $2, … placeholders
 * @param {any[]} params
 * @returns {import('pg').QueryResult | null}
 */
async function query(text, params = []) {
  if (!pool) return null;
  try {
    return await pool.query(text, params);
  } catch (e) {
    logger.error('postgres', 'Query error', { sql: text.slice(0, 120), error: e.message });
    throw e;
  }
}

/**
 * Get the underlying pool (for transactions).
 * @returns {import('pg').Pool | null}
 */
function getPool() {
  return pool;
}

/**
 * Graceful shutdown.
 */
async function closePostgres() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('postgres', 'Pool closed');
  }
}

module.exports = { initPostgres, isConnected, query, getPool, closePostgres };
