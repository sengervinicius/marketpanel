/**
 * portfolioStore.js
 *
 * Server-side portfolio persistence (write-through to MongoDB).
 *
 * Strategy: Same pattern as authStore —
 *   - In-memory Maps are the primary read source.
 *   - On startup, initPortfolioDB() loads all documents from MongoDB.
 *   - Every write also goes to MongoDB so data survives restarts/redeploys.
 *   - If MongoDB is not configured, falls back to in-memory only (dev mode).
 *
 * Schema:
 *   Collection: "portfolios"
 *   Document shape (one per user):
 *   {
 *     userId:      number,           // references authStore user.id
 *     version:     1,
 *     portfolios:  [{ id, name, subportfolios: [{ id, name }] }],
 *     positions:   [{ id, symbol, portfolioId, subportfolioId, investedAmount,
 *                     quantity, entryPrice, currency, note, createdAt }],
 *     updatedAt:   string (ISO),
 *     createdAt:   string (ISO),
 *   }
 */

const pg = require('./db/postgres');

// ── In-memory store (primary read) ───────────────────────────────────────────
const portfoliosByUserId = new Map(); // userId (number) → portfolio document

// ── MongoDB handle ───────────────────────────────────────────────────────────
let portfoliosCollection = null;

/**
 * Initialise MongoDB collection for portfolios.
 * Called from index.js after authStore.initDB().
 * @param {import('mongodb').Db} db - The MongoDB database instance
 */
async function initPortfolioDB(db) {
  // Postgres hydration (primary if available)
  if (pg.isConnected()) {
    try {
      const res = await pg.query('SELECT * FROM portfolios');
      if (res && res.rows.length > 0) {
        for (const row of res.rows) {
          const doc = {
            userId: Number(row.user_id),
            version: row.version || 1,
            portfolios: row.portfolios || [],
            positions: row.positions || [],
            updatedAt: row.updated_at,
            createdAt: row.created_at,
          };
          portfoliosByUserId.set(doc.userId, doc);
        }
        console.log(`[portfolioStore] Hydrated ${res.rows.length} portfolio(s) from Postgres`);
      }
    } catch (e) {
      // Postgres hydration failed — continuing with empty store
    }
  }

  if (!db) {
    if (!pg.isConnected()) console.log('[portfolioStore] No MongoDB — portfolio data is in-memory only');
    return;
  }
  try {
    portfoliosCollection = db.collection('portfolios');
    await portfoliosCollection.createIndex({ userId: 1 }, { unique: true });

    // Load all portfolio documents into memory
    const docs = await portfoliosCollection.find({}).toArray();
    for (const doc of docs) {
      const clean = { ...doc };
      delete clean._id;
      portfoliosByUserId.set(Number(clean.userId), clean);
    }
    console.log(`[portfolioStore] Loaded ${docs.length} portfolio document(s) from MongoDB`);
  } catch (e) {
    // MongoDB portfolios collection not available
    portfoliosCollection = null;
  }
}

// ── Persist helper ───────────────────────────────────────────────────────────
async function persistPortfolio(userId, doc) {
  const uid = Number(userId);
  // MongoDB
  if (portfoliosCollection) {
    try {
      const { _id, ...rest } = doc;
      await portfoliosCollection.replaceOne(
        { userId: uid }, { ...rest, userId: uid }, { upsert: true },
      );
    } catch (e) {
      // Portfolio write failed — retrying on next update
    }
  }
  // Postgres
  if (pg.isConnected()) {
    try {
      await pg.query(`
        INSERT INTO portfolios (user_id, version, portfolios, positions, updated_at, created_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (user_id) DO UPDATE SET
          version=EXCLUDED.version, portfolios=EXCLUDED.portfolios,
          positions=EXCLUDED.positions, updated_at=EXCLUDED.updated_at
      `, [uid, doc.version || 1, JSON.stringify(doc.portfolios || []),
          JSON.stringify(doc.positions || []), doc.updatedAt, doc.createdAt]);
    } catch (e) {
      // Postgres write failed — retrying on next update
    }
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Get the full portfolio tree for a user.
 * @param {number} userId
 * @returns {object|null} Portfolio document or null if none exists
 */
function getPortfolio(userId) {
  return portfoliosByUserId.get(Number(userId)) || null;
}

// ── Write (full sync) ────────────────────────────────────────────────────────

/**
 * Replace the entire portfolio state for a user (last-write-wins).
 * This is the primary write path — the frontend sends its full state and
 * the server stores it as the new canonical version.
 *
 * @param {number} userId
 * @param {object} data - The full portfolio state from the frontend
 * @returns {object} The persisted document
 */
async function syncPortfolio(userId, data) {
  const now = new Date().toISOString();
  const existing = portfoliosByUserId.get(Number(userId));

  const doc = {
    userId: Number(userId),
    version: data.version || 1,
    portfolios: Array.isArray(data.portfolios) ? data.portfolios : [],
    positions: Array.isArray(data.positions) ? data.positions : [],
    updatedAt: now,
    createdAt: existing?.createdAt || now,
  };

  // Validate basic structure
  if (doc.positions.length > 500) {
    throw new Error('Too many positions (max 500)');
  }
  for (const p of doc.portfolios) {
    if (!p.id || !p.name) throw new Error('Invalid portfolio: missing id or name');
  }
  for (const pos of doc.positions) {
    if (!pos.id || !pos.symbol) throw new Error('Invalid position: missing id or symbol');
  }

  portfoliosByUserId.set(Number(userId), doc);
  await persistPortfolio(userId, doc);
  return doc;
}

// ── Granular deletes ─────────────────────────────────────────────────────────

/**
 * Remove a single position by ID.
 * @param {number} userId
 * @param {string} positionId
 * @returns {boolean} true if found and removed
 */
async function removePosition(userId, positionId) {
  const doc = portfoliosByUserId.get(Number(userId));
  if (!doc) return false;

  const before = doc.positions.length;
  doc.positions = doc.positions.filter(p => p.id !== positionId);
  if (doc.positions.length === before) return false;

  doc.updatedAt = new Date().toISOString();
  await persistPortfolio(userId, doc);
  return true;
}

/**
 * Remove an entire portfolio and all its positions.
 * @param {number} userId
 * @param {string} portfolioId
 * @returns {boolean} true if found and removed
 */
async function removePortfolioById(userId, portfolioId) {
  const doc = portfoliosByUserId.get(Number(userId));
  if (!doc) return false;

  const before = doc.portfolios.length;
  doc.portfolios = doc.portfolios.filter(p => p.id !== portfolioId);
  if (doc.portfolios.length === before) return false;

  // Also remove positions that belonged to the deleted portfolio
  doc.positions = doc.positions.filter(p => p.portfolioId !== portfolioId);
  doc.updatedAt = new Date().toISOString();
  await persistPortfolio(userId, doc);
  return true;
}

/**
 * Delete all portfolio data for a user (account deletion).
 */
async function deleteUserPortfolios(userId) {
  const uid = Number(userId);
  portfoliosByUserId.delete(uid);
  if (portfoliosCollection) {
    try { await portfoliosCollection.deleteMany({ userId: uid }); }
    catch (e) { /* Delete failed */ }
  }
  if (pg.isConnected()) {
    try { await pg.query('DELETE FROM portfolios WHERE user_id = $1', [uid]); }
    catch (e) { /* Delete failed */ }
  }
}

module.exports = {
  initPortfolioDB,
  getPortfolio,
  syncPortfolio,
  removePosition,
  removePortfolioById,
  deleteUserPortfolios,
};
