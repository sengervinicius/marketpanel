#!/usr/bin/env node
/**
 * delete-user.js — Permanently delete a user account by email.
 *
 * Usage:
 *   POSTGRES_URL=<url> node scripts/delete-user.js senger.vinicius@gmail.com
 *
 * Deletes all associated data:
 *   - refresh_tokens, password_resets, email_verifications, user_behavior (no cascade)
 *   - portfolios, alerts, vault_documents, vault_chunks, user_memories, action_feedback (cascade)
 *   - The user row itself
 */

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/delete-user.js <email>');
  process.exit(1);
}

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error('ERROR: POSTGRES_URL environment variable not set');
  process.exit(1);
}

const { Pool } = require('pg');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    // 1. Find the user
    const userResult = await pool.query('SELECT id, username, email, plan_tier, is_paid FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      console.log(`No user found with email: ${email}`);
      process.exit(0);
    }

    const user = userResult.rows[0];
    console.log(`Found user: id=${user.id}, username=${user.username}, email=${user.email}, tier=${user.plan_tier}, paid=${user.is_paid}`);

    const userId = user.id;

    // 2. Delete non-cascading tables first
    const nonCascade = [
      'refresh_tokens',
      'password_resets',
      'email_verifications',
      'user_behavior',
    ];

    for (const table of nonCascade) {
      try {
        const r = await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
        console.log(`  Deleted ${r.rowCount} rows from ${table}`);
      } catch (err) {
        // Table may not exist
        console.log(`  Skipped ${table} (${err.message})`);
      }
    }

    // 3. Delete the user (cascading handles: portfolios, alerts, vault_documents, vault_chunks, user_memories, action_feedback)
    const deleteResult = await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    console.log(`\nDeleted user ${user.username} (${user.email}) — ${deleteResult.rowCount} row(s) removed`);
    console.log('Cascading delete handled: portfolios, alerts, vault_documents, vault_chunks, user_memories, action_feedback');

    console.log('\nDone. User can now re-register with the same email.');
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
