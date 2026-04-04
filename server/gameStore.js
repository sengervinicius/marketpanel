/**
 * gameStore.js
 *
 * Server-side game profile + trade persistence (write-through to MongoDB).
 *
 * Strategy: Same pattern as portfolioStore.js —
 *   - In-memory Maps are the primary read source.
 *   - On startup, initGameDB() loads all documents from MongoDB.
 *   - Every write also goes to MongoDB so data survives restarts/redeploys.
 *   - If MongoDB is not configured, falls back to in-memory only (dev mode).
 *
 * Collections:
 *   "gameProfiles" — one document per user (virtual $1M portfolio)
 *   "gameTrades"   — one document per executed trade
 */

const pg = require('./db/postgres');

// ── In-memory stores (primary read) ─────────────────────────────────────────
const gameProfilesByUserId = new Map(); // userId (number) → gameProfile document
const tradesByUserId = new Map();       // userId (number) → [trade, ...]

// ── MongoDB handles ─────────────────────────────────────────────────────────
let gameProfilesCollection = null;
let gameTradesCollection = null;

/**
 * Create a fresh game profile for a new player.
 */
function createDefaultProfile(userId) {
  const now = new Date().toISOString();
  return {
    userId: Number(userId),
    startedAt: now,
    startBalance: 1_000_000,
    cash: 1_000_000,
    equity: 1_000_000,
    positions: [],
    realizedPnl: 0,
    peakEquity: 1_000_000,
    troughEquity: 1_000_000,
    totalReturnPct: 0,
    cashMultiple: 1.0,
    lastUpdatedAt: now,
    snapshots: [{ asOf: now, equity: 1_000_000, totalReturnPct: 0 }],
  };
}

/**
 * Initialise MongoDB collections for game data.
 * Called from index.js after other stores init.
 * @param {import('mongodb').Db|null} db
 */
async function initGameDB(db) {
  // Postgres hydration (primary if available)
  if (pg.isConnected()) {
    try {
      const res = await pg.query('SELECT * FROM game_profiles');
      if (res && res.rows.length > 0) {
        for (const row of res.rows) {
          const doc = {
            userId: Number(row.user_id),
            startedAt: row.started_at,
            startBalance: row.start_balance || 1_000_000,
            cash: row.cash ?? 1_000_000,
            equity: row.equity ?? 1_000_000,
            positions: row.positions || [],
            realizedPnl: row.realized_pnl || 0,
            peakEquity: row.peak_equity ?? 1_000_000,
            troughEquity: row.trough_equity ?? 1_000_000,
            totalReturnPct: row.total_return_pct || 0,
            cashMultiple: row.cash_multiple || 1.0,
            lastUpdatedAt: row.updated_at,
            snapshots: row.snapshots || [],
          };
          gameProfilesByUserId.set(doc.userId, doc);
        }
        console.log(`[gameStore] Hydrated ${res.rows.length} game profile(s) from Postgres`);
      }
    } catch (e) {
      // Table may not exist yet — that's fine
      if (!e.message.includes('does not exist')) {
        console.error('[gameStore] Postgres hydration failed:', e.message);
      }
    }
  }

  if (!db) {
    if (!pg.isConnected()) console.log('[gameStore] No MongoDB — game data is in-memory only');
    return;
  }

  try {
    gameProfilesCollection = db.collection('gameProfiles');
    await gameProfilesCollection.createIndex({ userId: 1 }, { unique: true });

    const docs = await gameProfilesCollection.find({}).toArray();
    for (const doc of docs) {
      const clean = { ...doc };
      delete clean._id;
      gameProfilesByUserId.set(Number(clean.userId), clean);
    }
    console.log(`[gameStore] Loaded ${docs.length} game profile(s) from MongoDB`);
  } catch (e) {
    console.error('[gameStore] MongoDB gameProfiles init failed:', e.message);
    gameProfilesCollection = null;
  }

  try {
    gameTradesCollection = db.collection('gameTrades');
    await gameTradesCollection.createIndex({ userId: 1, createdAt: -1 });

    // Load recent trades into memory (last 100 per user)
    const trades = await gameTradesCollection.find({}).sort({ createdAt: -1 }).limit(5000).toArray();
    for (const t of trades) {
      const uid = Number(t.userId);
      delete t._id;
      if (!tradesByUserId.has(uid)) tradesByUserId.set(uid, []);
      tradesByUserId.get(uid).push(t);
    }
    console.log(`[gameStore] Loaded ${trades.length} game trade(s) from MongoDB`);
  } catch (e) {
    console.error('[gameStore] MongoDB gameTrades init failed:', e.message);
    gameTradesCollection = null;
  }
}

// ── Persist helpers ─────────────────────────────────────────────────────────

async function persistProfile(userId, doc) {
  const uid = Number(userId);

  if (gameProfilesCollection) {
    try {
      const { _id, ...rest } = doc;
      await gameProfilesCollection.replaceOne(
        { userId: uid }, { ...rest, userId: uid }, { upsert: true },
      );
    } catch (e) {
      console.error(`[gameStore] MongoDB profile write error (user ${uid}):`, e.message);
    }
  }

  if (pg.isConnected()) {
    try {
      await pg.query(`
        INSERT INTO game_profiles (user_id, started_at, start_balance, cash, equity, positions,
          realized_pnl, peak_equity, trough_equity, total_return_pct, cash_multiple, updated_at, snapshots)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (user_id) DO UPDATE SET
          cash=EXCLUDED.cash, equity=EXCLUDED.equity, positions=EXCLUDED.positions,
          realized_pnl=EXCLUDED.realized_pnl, peak_equity=EXCLUDED.peak_equity,
          trough_equity=EXCLUDED.trough_equity, total_return_pct=EXCLUDED.total_return_pct,
          cash_multiple=EXCLUDED.cash_multiple, updated_at=EXCLUDED.updated_at, snapshots=EXCLUDED.snapshots
      `, [uid, doc.startedAt, doc.startBalance, doc.cash, doc.equity,
          JSON.stringify(doc.positions), doc.realizedPnl, doc.peakEquity, doc.troughEquity,
          doc.totalReturnPct, doc.cashMultiple, doc.lastUpdatedAt, JSON.stringify(doc.snapshots)]);
    } catch (e) {
      console.error(`[gameStore] Postgres profile write error (user ${uid}):`, e.message);
    }
  }
}

async function persistTrade(trade) {
  if (gameTradesCollection) {
    try {
      await gameTradesCollection.insertOne({ ...trade });
    } catch (e) {
      console.error(`[gameStore] MongoDB trade write error:`, e.message);
    }
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Get the game profile for a user. Returns null if not initialised.
 */
function getGameProfile(userId) {
  return gameProfilesByUserId.get(Number(userId)) || null;
}

/**
 * Get or create game profile (lazy init).
 */
async function getOrCreateGameProfile(userId) {
  const uid = Number(userId);
  let profile = gameProfilesByUserId.get(uid);
  if (!profile) {
    profile = createDefaultProfile(uid);
    gameProfilesByUserId.set(uid, profile);
    await persistProfile(uid, profile);
  }
  return profile;
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Save a game profile (after trade execution, etc).
 */
async function saveGameProfile(userId, profile) {
  const uid = Number(userId);
  profile.userId = uid;
  gameProfilesByUserId.set(uid, profile);
  await persistProfile(uid, profile);
}

/**
 * Record a trade and add to in-memory cache.
 */
async function addGameTrade(trade) {
  const uid = Number(trade.userId);
  if (!tradesByUserId.has(uid)) tradesByUserId.set(uid, []);
  tradesByUserId.get(uid).unshift(trade); // newest first

  // Trim in-memory to 200 per user
  const userTrades = tradesByUserId.get(uid);
  if (userTrades.length > 200) tradesByUserId.set(uid, userTrades.slice(0, 200));

  await persistTrade(trade);
}

/**
 * Get trades for a user, newest first.
 */
function getGameTrades(userId, limit = 50, offset = 0) {
  const trades = tradesByUserId.get(Number(userId)) || [];
  return trades.slice(offset, offset + limit);
}

/**
 * Get total trade count for a user.
 */
function getGameTradeCount(userId) {
  return (tradesByUserId.get(Number(userId)) || []).length;
}

/**
 * Get all game profiles (for leaderboard computation).
 */
function getAllGameProfiles() {
  return Array.from(gameProfilesByUserId.values());
}

module.exports = {
  initGameDB,
  createDefaultProfile,
  getGameProfile,
  getOrCreateGameProfile,
  saveGameProfile,
  addGameTrade,
  getGameTrades,
  getGameTradeCount,
  getAllGameProfiles,
};
