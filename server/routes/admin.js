/**
 * server/routes/admin.js
 * Admin analytics dashboard endpoints
 * All endpoints require admin authentication via requireAdmin middleware
 */

const express = require('express');
const { requireAdmin } = require('../authMiddleware');
const pg = require('../db/postgres');
const authStore = require('../authStore');

const router = express.Router();

// Middleware: Admin check applied to all routes in this file
router.use(requireAdmin);

/**
 * GET /api/admin/stats
 * Overview statistics for the dashboard
 */
router.get('/stats', async (req, res) => {
  try {
    // Total users
    const totalUsersRes = await pg.query('SELECT COUNT(*) as count FROM users');
    const totalUsers = parseInt(totalUsersRes.rows[0]?.count || 0, 10);

    // Active users (last 7 days) - based on user_behavior table
    const activeUsersRes = await pg.query(
      `SELECT COUNT(DISTINCT user_id) as count
       FROM user_behavior
       WHERE created_at > NOW() - INTERVAL '7 days'`
    );
    const activeUsers = parseInt(activeUsersRes.rows[0]?.count || 0, 10);

    // Paid users
    const paidUsersRes = await pg.query('SELECT COUNT(*) as count FROM users WHERE is_paid = true');
    const paidUsers = parseInt(paidUsersRes.rows[0]?.count || 0, 10);

    // Total vault documents
    const vaultDocsRes = await pg.query('SELECT COUNT(*) as count FROM vault_documents');
    const vaultDocs = parseInt(vaultDocsRes.rows[0]?.count || 0, 10);

    // Total vault chunks (storage proxy)
    const vaultChunksRes = await pg.query('SELECT COUNT(*) as count FROM vault_chunks');
    const vaultChunks = parseInt(vaultChunksRes.rows[0]?.count || 0, 10);

    // Estimate storage (chunks * ~1KB average per chunk)
    const storageEstimateGB = (vaultChunks / 1000000).toFixed(2);

    // Total AI queries (from action_feedback)
    const queriesRes = await pg.query('SELECT COUNT(*) as count FROM action_feedback');
    const totalQueries = parseInt(queriesRes.rows[0]?.count || 0, 10);

    // Total memories
    const memoriesRes = await pg.query('SELECT COUNT(*) as count FROM user_memories');
    const totalMemories = parseInt(memoriesRes.rows[0]?.count || 0, 10);

    // User growth last 30 days (daily signups)
    const growthRes = await pg.query(
      `SELECT DATE(TO_TIMESTAMP(created_at / 1000)) as signup_date, COUNT(*) as count
       FROM users
       WHERE created_at > (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT - (86400000 * 30)
       GROUP BY DATE(TO_TIMESTAMP(created_at / 1000))
       ORDER BY signup_date ASC`
    );
    const userGrowth = growthRes.rows.map(row => ({
      date: row.signup_date,
      signups: parseInt(row.count, 10),
    }));

    res.json({
      totalUsers,
      activeUsers,
      paidUsers,
      vaultDocs,
      vaultChunks,
      storageEstimateGB,
      totalQueries,
      totalMemories,
      userGrowth,
    });
  } catch (err) {
    console.error('[admin] /stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/usage
 * AI usage breakdown (queries, models, response times, top tickers)
 */
router.get('/usage', async (req, res) => {
  try {
    // Queries per day (last 30 days)
    const queriesPerDayRes = await pg.query(
      `SELECT DATE(created_at) as query_date, COUNT(*) as count
       FROM action_feedback
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY query_date ASC`
    );
    const queriesPerDay = queriesPerDayRes.rows.map(row => ({
      date: row.query_date,
      queries: parseInt(row.count, 10),
    }));

    // Model usage distribution (if action_type contains model info)
    const modelUsageRes = await pg.query(
      `SELECT action_type, COUNT(*) as count
       FROM action_feedback
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY action_type
       ORDER BY count DESC
       LIMIT 10`
    );
    const modelUsage = modelUsageRes.rows.map(row => ({
      model: row.action_type || 'unknown',
      count: parseInt(row.count, 10),
    }));

    // Top queried tickers
    const topTickersRes = await pg.query(
      `SELECT ticker, COUNT(*) as count
       FROM action_feedback
       WHERE ticker IS NOT NULL AND ticker != ''
       AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY ticker
       ORDER BY count DESC
       LIMIT 20`
    );
    const topTickers = topTickersRes.rows.map(row => ({
      ticker: row.ticker,
      count: parseInt(row.count, 10),
    }));

    // Peak usage hours (0-23)
    const peakHoursRes = await pg.query(
      `SELECT EXTRACT(HOUR FROM created_at)::INTEGER as hour, COUNT(*) as count
       FROM action_feedback
       WHERE created_at > NOW() - INTERVAL '7 days'
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY hour ASC`
    );
    const peakHours = Array(24).fill(0);
    peakHoursRes.rows.forEach(row => {
      peakHours[row.hour] = parseInt(row.count, 10);
    });

    res.json({
      queriesPerDay,
      modelUsage,
      topTickers,
      peakHours,
      avgResponseTime: null, // Not logged currently
    });
  } catch (err) {
    console.error('[admin] /usage error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/users
 * Paginated user list with engagement metrics
 */
router.get('/users', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || 50, 10), 500);
    const offset = parseInt(req.query.offset || 0, 10);
    const search = req.query.search || '';

    let whereClause = '';
    const params = [];
    if (search && search.trim()) {
      whereClause = 'WHERE LOWER(username) LIKE $1 OR LOWER(email) LIKE $1';
      params.push(`%${search.toLowerCase()}%`);
    }

    // Get total count
    const countRes = await pg.query(
      `SELECT COUNT(*) as count FROM users ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count || 0, 10);

    // Get paginated users with engagement stats
    const offset_param_idx = params.length + 1;
    const limit_param_idx = params.length + 2;
    params.push(offset, limit);

    const usersRes = await pg.query(
      `SELECT
         u.id, u.username, u.email, u.plan_tier, u.created_at,
         u.is_paid, u.subscription_active,
         (SELECT COUNT(*) FROM vault_documents WHERE user_id = u.id) as vault_doc_count,
         (SELECT COUNT(*) FROM user_memories WHERE user_id = u.id) as memory_count,
         (SELECT MAX(created_at) FROM user_behavior WHERE user_id = u.id) as last_active
       FROM users u
       ${whereClause}
       ORDER BY u.created_at DESC
       OFFSET $${offset_param_idx} LIMIT $${limit_param_idx}`,
      params
    );

    const users = usersRes.rows.map(row => ({
      id: row.id,
      username: row.username,
      email: row.email,
      planTier: row.plan_tier,
      isPaid: row.is_paid,
      subscriptionActive: row.subscription_active,
      createdAt: row.created_at,
      vaultDocCount: parseInt(row.vault_doc_count, 10),
      memoryCount: parseInt(row.memory_count, 10),
      lastActive: row.last_active,
    }));

    res.json({
      users,
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[admin] /users error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/health
 * System health and database status
 */
router.get('/health', async (req, res) => {
  try {
    const startTime = Date.now();

    // Database connection status
    let dbStatus = 'disconnected';
    let tableCounts = {};
    try {
      await pg.query('SELECT 1');
      dbStatus = 'connected';

      // Get table row counts
      const tables = [
        'users',
        'vault_documents',
        'vault_chunks',
        'user_memories',
        'action_feedback',
        'vault_signals',
        'portfolios',
        'alerts',
      ];

      for (const table of tables) {
        try {
          const countRes = await pg.query(`SELECT COUNT(*) as count FROM ${table}`);
          tableCounts[table] = parseInt(countRes.rows[0]?.count || 0, 10);
        } catch (e) {
          tableCounts[table] = null; // Table might not exist
        }
      }
    } catch (e) {
      console.error('[admin/health] DB query failed:', e.message);
    }

    // Memory usage
    const memUsage = process.memoryUsage();
    const memoryUsage = {
      heapUsedMB: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
      heapTotalMB: (memUsage.heapTotal / 1024 / 1024).toFixed(2),
      rssMB: (memUsage.rss / 1024 / 1024).toFixed(2),
    };

    const dbQueryTime = Date.now() - startTime;

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        queryTimeMs: dbQueryTime,
        tables: tableCounts,
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage,
      },
    });
  } catch (err) {
    console.error('[admin] /health error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/heatmap
 * Query heatmap: hours of day × days of week
 */
router.get('/heatmap', async (req, res) => {
  try {
    // Get query counts by hour and day of week (last 30 days)
    const heatmapRes = await pg.query(
      `SELECT
         EXTRACT(DOW FROM created_at)::INTEGER as day_of_week,
         EXTRACT(HOUR FROM created_at)::INTEGER as hour_of_day,
         COUNT(*) as count
       FROM action_feedback
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY day_of_week, hour_of_day
       ORDER BY day_of_week, hour_of_day`
    );

    // Build heatmap grid (7 days x 24 hours)
    const heatmap = Array(7)
      .fill(null)
      .map(() => Array(24).fill(0));

    heatmapRes.rows.forEach(row => {
      const dow = row.day_of_week; // 0 = Sunday
      const hour = row.hour_of_day;
      heatmap[dow][hour] = parseInt(row.count, 10);
    });

    res.json({ heatmap });
  } catch (err) {
    console.error('[admin] /heatmap error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/reset-user-settings
 * Reset a user's settings to defaults (preserves account, auth, subscription).
 * Body: { username: string }
 */
router.post('/reset-user-settings', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'username is required' });

    const user = authStore.findUserByUsername(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Reset settings to defaults using mergeSettings with a full overwrite
    const defaults = authStore.defaultSettings();
    // Overwrite the entire settings object
    user.settings = defaults;
    // Persist to MongoDB + Postgres
    await authStore.persistUser(user);

    res.json({ ok: true, message: `Settings reset for ${username}`, settings: defaults });
  } catch (err) {
    console.error('[admin] /reset-user-settings error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/admin/delete-user/:email
 * Permanently delete a user account and all associated data.
 * Admin only. Use with caution.
 */
router.delete('/delete-user/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    // Find user
    const userResult = await pg.query('SELECT id, username, email, plan_tier FROM users WHERE email = $1', [email]);
    if (!userResult.rows || userResult.rows.length === 0) {
      return res.status(404).json({ error: `No user found with email: ${email}` });
    }

    const user = userResult.rows[0];
    const userId = user.id;
    console.log(`[admin] Deleting user: id=${userId}, username=${user.username}, email=${user.email}`);

    // Delete non-cascading tables
    const tables = ['refresh_tokens', 'password_resets', 'email_verifications', 'user_behavior'];
    for (const table of tables) {
      try { await pg.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]); } catch {}
    }

    // Delete user — try in-memory first (also does Postgres + Mongo), fall back to direct SQL
    const deleted = await authStore.deleteUser(userId);
    if (!deleted) {
      // User not in memory — delete directly from Postgres (cascades handle related tables)
      await pg.query('DELETE FROM users WHERE id = $1', [userId]);
    }

    console.log(`[admin] User deleted: ${user.username} (${user.email})`);
    res.json({ ok: true, message: `User ${user.username} (${email}) permanently deleted`, userId });
  } catch (err) {
    console.error('[admin] delete-user error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
