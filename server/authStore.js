/**
 * authStore.js
 *
 * User store with MongoDB persistence (write-through cache).
 *
 * Strategy:
 *   - In-memory Maps are the primary read source (fast, synchronous).
 *   - On startup, initDB() loads all documents from MongoDB into the Maps.
 *   - Every write (createUser, mergeSettings, updateSubscription) also writes
 *     the full user document to MongoDB, so data survives restarts/redeploys.
 *   - If MONGODB_URI is not set, falls back to pure in-memory (dev mode).
 */

// TODO(db): Proposed Postgres schema for user persistence
//
// CREATE TABLE users (
//   id                    SERIAL PRIMARY KEY,
//   username              TEXT UNIQUE NOT NULL,
//   email                 TEXT UNIQUE,
//   hash                  TEXT NOT NULL,
//   apple_user_id         TEXT UNIQUE,
//   settings              JSONB DEFAULT '{}',
//   is_paid               BOOLEAN DEFAULT FALSE,
//   subscription_active   BOOLEAN DEFAULT TRUE,
//   trial_ends_at         BIGINT,
//   stripe_customer_id    TEXT,
//   stripe_subscription_id TEXT,
//   created_at            BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
// );
// CREATE INDEX idx_users_username ON users(LOWER(username));
// CREATE INDEX idx_users_email ON users(LOWER(email));
// CREATE INDEX idx_users_stripe ON users(stripe_customer_id);
//
// Migration path:
//   1. Current: MongoDB + in-memory Maps (write-through)
//   2. Next: Add Postgres adapter behind POSTGRES_URI env var
//   3. Keep identical function signatures (createUser, findUser, etc.)
//   4. Swap Map reads for SQL queries, keep in-memory cache for hot path
//   5. Eventually deprecate MongoDB layer

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const pg     = require('./db/postgres');

const JWT_SECRET = process.env.JWT_SECRET || 'INSECURE_PLACEHOLDER_SET_JWT_SECRET_IN_ENV';
if (!process.env.JWT_SECRET) {
  console.error('[ERROR] JWT_SECRET not set — using insecure placeholder. Go to Render Dashboard → senger-market-server → Environment and add JWT_SECRET.');
}

// ── In-memory store (primary read source) ────────────────────────────────────
const usersByUsername = new Map();   // username_lower → user object
const usersById       = new Map();   // id (number) → user object
let   nextId          = 1;

// ── MongoDB handles ──────────────────────────────────────────────────────────
let usersCollection = null;          // null when MongoDB is not configured

// ── Default settings ─────────────────────────────────────────────────────────
function defaultSettings() {
  return {
    theme:               'dark',
    onboardingCompleted: false,
    selectedPresetId:    null,
    defaultStartPage:    '/',
    watchlist:           [],
    panels: {
      brazilB3:     { title: 'Brazil B3',      symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA','B3SA3.SA','MGLU3.SA','BBAS3.SA'] },
      usEquities:   { title: 'US Equities',    symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB','VALE','PBR','ITUB','BBD','ABEV','ERJ','BRFS','SUZ'] },
      globalIndices:{ title: 'Global Indexes', symbols: ['SPY','QQQ','DIA','IWM','EWZ','EEM','FXI','EWJ'] },
      forex:        { title: 'FX / Rates',     symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN','BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD'] },
      crypto:       { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD'] },
      commodities:  { title: 'Commodities',    symbols: ['GLD','SLV','USO','UNG','CORN','WEAT'] },
      debt:         { title: 'Debt Markets',   symbols: [] },
    },
    layout: {
      desktopRows: [
        ['charts',        'usEquities',  'forex'],
        ['globalIndices', 'brazilB3',    'commodities', 'crypto'],
        ['debt',          'search',      'news',        'watchlist', 'chat'],
      ],
      mobileTabs: ['home', 'charts', 'watchlist', 'search', 'news'],
    },
    home: {
      sections: [
        { id: 'indexes',     title: 'US Indexes',  symbols: ['SPY','QQQ','DIA'] },
        { id: 'forex',       title: 'FX',          symbols: ['EURUSD','USDBRL','USDJPY'] },
        { id: 'crypto',      title: 'Crypto',      symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
        { id: 'commodities', title: 'Commodities', symbols: ['GLD','USO','SLV'] },
      ],
    },
    charts: {
      symbols: ['SPY', 'QQQ'],
      primary: 'SPY',
    },
  };
}

// ── MongoDB persistence helpers ───────────────────────────────────────────────

/**
 * Persist (upsert) a user object to MongoDB.
 * Strips the Mongo _id before re-inserting to avoid conflicts.
 * No-ops gracefully if MongoDB is not connected.
 */
async function persistUser(user) {
  // MongoDB write-through
  if (usersCollection) {
    try {
      const { _id, ...doc } = user;
      await usersCollection.replaceOne(
        { username_lower: user.username.toLowerCase() },
        { ...doc, username_lower: user.username.toLowerCase() },
        { upsert: true },
      );
    } catch (e) {
      console.error('[authStore] MongoDB write error:', e.message);
    }
  }

  // Postgres write-through
  if (pg.isConnected()) {
    try {
      await pg.query(`
        INSERT INTO users (id, username, email, hash, apple_user_id, settings, is_paid,
          subscription_active, trial_ends_at, stripe_customer_id, stripe_subscription_id,
          persona, gamification, referral_code, referred_by, referral_rewards, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (id) DO UPDATE SET
          username=EXCLUDED.username, email=EXCLUDED.email, hash=EXCLUDED.hash,
          apple_user_id=EXCLUDED.apple_user_id, settings=EXCLUDED.settings,
          is_paid=EXCLUDED.is_paid, subscription_active=EXCLUDED.subscription_active,
          trial_ends_at=EXCLUDED.trial_ends_at, stripe_customer_id=EXCLUDED.stripe_customer_id,
          stripe_subscription_id=EXCLUDED.stripe_subscription_id, persona=EXCLUDED.persona,
          gamification=EXCLUDED.gamification, referral_code=EXCLUDED.referral_code,
          referred_by=EXCLUDED.referred_by, referral_rewards=EXCLUDED.referral_rewards
      `, [
        user.id, user.username, user.email || null, user.hash,
        user.appleUserId || null,
        JSON.stringify(user.settings || {}),
        user.isPaid || false, user.subscriptionActive ?? true,
        user.trialEndsAt || null, user.stripeCustomerId || null,
        user.stripeSubscriptionId || null,
        JSON.stringify(user.persona || {}),
        JSON.stringify(user.gamification || {}),
        user.referralCode || null, user.referredBy || null,
        JSON.stringify(user.referralRewards || {}),
        user.createdAt || Date.now(),
      ]);
    } catch (e) {
      console.error('[authStore] Postgres write error:', e.message);
    }
  }
}

/**
 * Hydrate in-memory Maps from Postgres.
 * Called after Postgres is connected, before MongoDB fallback.
 */
async function hydrateFromPostgres() {
  if (!pg.isConnected()) return false;
  try {
    const res = await pg.query('SELECT * FROM users ORDER BY id');
    if (!res || res.rows.length === 0) return false;
    for (const row of res.rows) {
      const user = {
        id: row.id,
        username: row.username,
        email: row.email || null,
        hash: row.hash,
        appleUserId: row.apple_user_id || null,
        settings: row.settings || defaultSettings(),
        isPaid: row.is_paid || false,
        subscriptionActive: row.subscription_active ?? true,
        trialEndsAt: row.trial_ends_at ? Number(row.trial_ends_at) : null,
        stripeCustomerId: row.stripe_customer_id || null,
        stripeSubscriptionId: row.stripe_subscription_id || null,
        persona: row.persona || defaultPersona(),
        gamification: row.gamification || defaultGamification(),
        referralCode: row.referral_code || null,
        referredBy: row.referred_by || null,
        referralRewards: row.referral_rewards || { invited: 0, xpEarned: 0 },
        createdAt: row.created_at ? Number(row.created_at) : Date.now(),
      };
      const key = user.username.toLowerCase();
      usersByUsername.set(key, user);
      usersById.set(Number(user.id), user);
      if (Number(user.id) >= nextId) nextId = Number(user.id) + 1;
    }
    console.log(`[authStore] Hydrated ${res.rows.length} user(s) from Postgres`);
    return true;
  } catch (e) {
    console.error('[authStore] Postgres hydration failed:', e.message);
    return false;
  }
}

// ── Database initialisation ───────────────────────────────────────────────────

/**
 * Connect to MongoDB and load all users into the in-memory Maps.
 * Also hydrates from Postgres if available (Postgres takes priority).
 * Must be awaited before the server starts accepting requests.
 */
async function initDB() {
  // Try Postgres hydration first (if available)
  const pgHydrated = await hydrateFromPostgres();

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    if (!pgHydrated) {
      console.log('[authStore] No MONGODB_URI or POSTGRES_URL — using in-memory store (data will not persist across restarts)');
    }
    return null;
  }

  // If Postgres already hydrated, still connect MongoDB for backward compat writes
  if (pgHydrated) {
    console.log('[authStore] Postgres is primary store; MongoDB connected as secondary');
  }

  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
    await client.connect();

    const dbName = process.env.MONGODB_DB || 'senger';
    const mongoDB = client.db(dbName);
    usersCollection = mongoDB.collection('users');

    // Ensure unique index on username_lower
    await usersCollection.createIndex({ username_lower: 1 }, { unique: true });

    // Ensure unique index on email
    await usersCollection.createIndex({ email: 1 }, { unique: true, sparse: true });

    // Load all existing users into in-memory Maps
    const saved = await usersCollection.find({}).toArray();
    for (const doc of saved) {
      const user = { ...doc };
      delete user._id;
      delete user.username_lower; // internal-only field
      const key = user.username.toLowerCase();
      usersByUsername.set(key, user);
      usersById.set(Number(user.id), user);
      if (Number(user.id) >= nextId) nextId = Number(user.id) + 1;
    }

    console.log(`[authStore] MongoDB connected (${dbName}) — loaded ${saved.length} user(s)`);
    return mongoDB; // Return db instance so other stores can use it
  } catch (e) {
    console.error('[authStore] MongoDB connection failed — running in-memory only:', e.message);
    usersCollection = null;
    return null;
  }
}

// ── Seed users from SEED_USERS env var ───────────────────────────────────────

/**
 * Read SEED_USERS=username1:password1,username2:password2 from environment.
 * Creates those users if they don't already exist (either in MongoDB or in-memory).
 * Seeded accounts get subscriptionActive=true and a 1-year trial.
 */
async function seedUsersFromEnv() {
  const raw = process.env.SEED_USERS || '';
  if (!raw.trim()) return;

  const entries = raw.split(',').map(s => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx < 0) continue;
    const username = entry.slice(0, colonIdx).trim();
    const password = entry.slice(colonIdx + 1).trim();
    if (!username || !password) continue;

    const key = username.toLowerCase();
    if (usersByUsername.has(key)) {
      const existingUser = usersByUsername.get(key);
      const hash = await bcrypt.hash(password, 12);
      const now = Date.now();
      existingUser.hash = hash;
      existingUser.isPaid = true;
      existingUser.subscriptionActive = true;
      existingUser.trialEndsAt = now + 365 * 24 * 60 * 60 * 1000;
      await persistUser(existingUser);
      console.log(`[authStore] Seed: updated existing user '${username}' to admin status`);
      continue;
    }

    try {
      const hash = await bcrypt.hash(password, 12);
      const now  = Date.now();
      const id   = nextId++;
      const user = {
        id,
        username,
        hash,
        settings:             defaultSettings(),
        isPaid:               true,
        subscriptionActive:   true,
        trialEndsAt:          now + 365 * 24 * 60 * 60 * 1000,
        stripeCustomerId:     null,
        stripeSubscriptionId: null,
        persona:              defaultPersona(),
        gamification:         defaultGamification(),
        createdAt:            now,
      };
      usersByUsername.set(key, user);
      usersById.set(id, user);
      await persistUser(user);
      console.log(`[authStore] Seeded user: '${username}'`);
    } catch (e) {
      console.error(`[authStore] Failed to seed '${username}':`, e.message);
    }
  }
}

// ── Default persona & gamification ────────────────────────────────────────────

function defaultPersona() {
  return {
    type: null,
    avatarStyle: 'illustrated',
    customization: { backgroundColor: null, borderStyle: 'none', badgeSize: 'medium' },
    stats: { totalReturn: 0, sharpeRatio: 0, bestMonth: 0, worstMonth: 0, winRate: 0, avgHoldingPeriod: 0, weeklyReturn: 0 },
    achievements: [],
  };
}

function defaultGamification() {
  return { xp: 0, level: 1, lastXpEventAt: null };
}

// ── User CRUD ─────────────────────────────────────────────────────────────────

async function createUser(username, passwordPlain, email) {
  const key = username.toLowerCase();
  if (!username || !passwordPlain)   throw new Error('Username and password required');
  if (username.length < 3)           throw new Error('Username must be at least 3 characters');
  if (passwordPlain.length < 8)      throw new Error('Password must be at least 8 characters');
  if (usersByUsername.has(key))      throw new Error('Username taken');

  // Validate and check email uniqueness if provided
  if (email) {
    const emailLower = email.toLowerCase();
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }
    // Check for email uniqueness
    for (const u of usersByUsername.values()) {
      if (u.email && u.email.toLowerCase() === emailLower) {
        throw new Error('Email already registered');
      }
    }
  }

  const hash = await bcrypt.hash(passwordPlain, 12);
  const now  = Date.now();
  const id   = nextId++;
  const user = {
    id,
    username,
    email:                email || null,
    hash,
    settings:             defaultSettings(),
    isPaid:               false,
    subscriptionActive:   true,
    trialEndsAt:          now + 2 * 24 * 60 * 60 * 1000, // 2-day trial
    stripeCustomerId:     null,
    stripeSubscriptionId: null,
    persona:              defaultPersona(),
    gamification:         defaultGamification(),
    referralCode:         generateReferralCode(),
    referredBy:           null,
    referralRewards:      { invited: 0, xpEarned: 0 },
    createdAt:            now,
  };

  usersByUsername.set(key, user);
  usersById.set(id, user);
  await persistUser(user); // write-through to MongoDB
  return user;
}

function findUserByUsername(username) {
  return usersByUsername.get(username.toLowerCase()) || null;
}

function getUserById(id) {
  return usersById.get(Number(id)) || null;
}

async function verifyUser(username, passwordPlain) {
  const user = findUserByUsername(username);
  if (!user) throw new Error('No account found with that username.');
  const ok = await bcrypt.compare(passwordPlain, user.hash);
  if (!ok) throw new Error('Incorrect password. Try again.');
  return user;
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ── User search (for chat) ────────────────────────────────────────────────────

function listUsers(query, excludeId) {
  const q = (query || '').toLowerCase();
  const results = [];
  for (const user of usersByUsername.values()) {
    if (user.id === excludeId) continue;
    if (!q || user.username.toLowerCase().includes(q)) {
      results.push({ id: user.id, username: user.username });
    }
  }
  return results.slice(0, 20);
}

/**
 * Return all users that have a persona type set (for leaderboard computation).
 * Returns full user objects — caller should only expose safe fields.
 */
function getAllUsersWithPersona() {
  const results = [];
  for (const user of usersById.values()) {
    if (user.persona && user.persona.type) {
      results.push(user);
    }
  }
  return results;
}

function findUserByStripeCustomerId(customerId) {
  for (const user of usersById.values()) {
    if (user.stripeCustomerId === customerId) return user;
  }
  return null;
}

// ── Settings ──────────────────────────────────────────────────────────────────

/**
 * Deep-merge partial settings into a user's settings object, then persist.
 */
async function mergeSettings(userId, partial) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found');
  const s = user.settings;

  // Deep merge panels
  if (partial.panels) {
    s.panels = {
      ...s.panels,
      ...Object.fromEntries(
        Object.entries(partial.panels).map(([k, v]) => [k, { ...(s.panels[k] || {}), ...v }])
      ),
    };
  }

  // Deep merge layout
  if (partial.layout) {
    s.layout = { ...(s.layout || {}), ...partial.layout };
  }

  // Deep merge home
  if (partial.home) {
    s.home = { ...(s.home || {}), ...partial.home };
  }

  // Deep merge charts
  if (partial.charts) {
    s.charts = { ...(s.charts || {}), ...partial.charts };
  }

  // Shallow merge the rest (theme, onboardingCompleted, watchlist, etc.)
  const { panels, layout, home, charts, ...rest } = partial;
  Object.assign(s, rest);

  await persistUser(user); // write-through to MongoDB
  return s;
}

// ── Subscription ──────────────────────────────────────────────────────────────

async function updateSubscription(userId, fields) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found');
  Object.assign(user, fields);
  await persistUser(user); // write-through to MongoDB
  return user;
}

// ── Account deletion ─────────────────────────────────────────────────────────

/**
 * Permanently delete a user from in-memory Maps and MongoDB.
 * Returns true if the user existed and was deleted.
 */
async function deleteUser(userId) {
  const id = Number(userId);
  const user = usersById.get(id);
  if (!user) return false;

  const key = user.username.toLowerCase();
  usersByUsername.delete(key);
  usersById.delete(id);

  if (usersCollection) {
    try {
      await usersCollection.deleteOne({ username_lower: key });
    } catch (e) {
      console.error('[authStore] MongoDB delete error:', e.message);
    }
  }
  if (pg.isConnected()) {
    try { await pg.query('DELETE FROM users WHERE id = $1', [id]); }
    catch (e) { console.error('[authStore] Postgres delete error:', e.message); }
  }

  console.log(`[authStore] Deleted user id=${id} username=${user.username}`);
  return true;
}

// ── Safe export (no password hash) ───────────────────────────────────────────

function safeUser(user) {
  const { hash, ...safe } = user;
  return safe;
}

// ── Apple Sign In ─────────────────────────────────────────────────────────

async function findOrCreateAppleUser(appleUserId, email, firstName) {
  // Search existing users for matching appleUserId
  for (const user of usersById.values()) {
    if (user.appleUserId === appleUserId) return user;
  }

  // Build a username from email or appleUserId
  let baseUsername = firstName
    ? firstName.toLowerCase().replace(/[^a-z0-9]/g, '')
    : email
      ? email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '')
      : 'apple_' + appleUserId.slice(-8);
  if (baseUsername.length < 3) baseUsername = 'user_' + appleUserId.slice(-6);

  // Ensure uniqueness
  let username = baseUsername;
  let suffix = 2;
  while (usersByUsername.has(username.toLowerCase())) {
    username = baseUsername + '_' + suffix++;
  }

  const hash = await bcrypt.hash(Math.random().toString(36), 10); // dummy hash
  const now  = Date.now();
  const id   = nextId++;
  const user = {
    id,
    username,
    hash,
    appleUserId,
    email: email || null,
    settings:             defaultSettings(),
    isPaid:               false,
    subscriptionActive:   true,
    trialEndsAt:          now + 2 * 24 * 60 * 60 * 1000,
    stripeCustomerId:     null,
    stripeSubscriptionId: null,
    createdAt:            now,
  };

  usersByUsername.set(username.toLowerCase(), user);
  usersById.set(id, user);
  await persistUser(user);
  return user;
}

// ── Persona update ────────────────────────────────────────────────────────────

async function updatePersona(userId, partial) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found');
  if (!user.persona) user.persona = defaultPersona();
  if (partial.type !== undefined)       user.persona.type = partial.type;
  if (partial.avatarStyle !== undefined) user.persona.avatarStyle = partial.avatarStyle;
  if (partial.customization)            user.persona.customization = { ...user.persona.customization, ...partial.customization };
  await persistUser(user);
  return user.persona;
}

// ── Generic user update (for Discord, etc.) ────────────────────────────────
async function updateUser(userId, partial) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found');
  Object.assign(user, partial);
  await persistUser(user);
  return user;
}

// ── Referral system ─────────────────────────────────────────────────────────

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 ambiguity
  let code = 'SGR-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/**
 * Find a user by their referral code.
 */
function findUserByReferralCode(code) {
  if (!code) return null;
  const upper = code.toUpperCase().trim();
  for (const u of usersById.values()) {
    if (u.referralCode === upper) return u;
  }
  return null;
}

/**
 * Redeem a referral code for a user. Awards referral bonus.
 * @returns {{ referrer, invitee, xpAwarded }} on success
 */
async function redeemReferral(userId, referralCode) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found');
  if (user.referredBy) throw new Error('Already redeemed a referral code');

  const upper = referralCode.toUpperCase().trim();
  if (user.referralCode === upper) throw new Error('Cannot use your own referral code');

  const referrer = findUserByReferralCode(upper);
  if (!referrer) throw new Error('Invalid referral code');

  // Mark invitee
  user.referredBy = referrer.id;

  // Reward referrer
  if (!referrer.referralRewards) referrer.referralRewards = { invited: 0, xpEarned: 0 };
  referrer.referralRewards.invited += 1;

  await persistUser(user);
  await persistUser(referrer);

  return { referrer: referrer.username, invitee: user.username, xpAwarded: 0 };
}

/**
 * Get referral status for a user.
 */
function getReferralStatus(userId) {
  const user = getUserById(userId);
  if (!user) return null;

  // Backfill referral fields for older users
  if (!user.referralCode) user.referralCode = generateReferralCode();
  if (!user.referralRewards) user.referralRewards = { invited: 0, xpEarned: 0 };

  return {
    referralCode: user.referralCode,
    referredBy:   user.referredBy,
    invited:      user.referralRewards.invited,
    xpEarned:     user.referralRewards.xpEarned,
  };
}

// ── Gamification update ──────────────────────────────────────────────────────

async function addXp(userId, amount) {
  // Legacy no-op: gamification has been removed
  return { xp: 0, level: 1, lastXpEventAt: null };
}

module.exports = {
  initDB,
  createUser,
  deleteUser,
  findUserByUsername,
  getUserById,
  verifyUser,
  signToken,
  verifyToken,
  listUsers,
  mergeSettings,
  updateSubscription,
  updatePersona,
  addXp,
  safeUser,
  seedUsersFromEnv,
  findOrCreateAppleUser,
  findUserByStripeCustomerId,
  updateUser,
  getAllUsersWithPersona,
  findUserByReferralCode,
  redeemReferral,
  getReferralStatus,
};
