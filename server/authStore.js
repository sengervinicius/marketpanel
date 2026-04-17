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

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] PRODUCTION MODE: JWT_SECRET is required but not set.');
    console.error('[FATAL] Go to Render Dashboard → senger-market-server → Environment and add JWT_SECRET (minimum 16 characters).');
    process.exit(1);
  } else {
    console.warn('[WARN] JWT_SECRET not set — using development mode. Set JWT_SECRET in .env for proper security.');
  }
}

// ── In-memory store (primary read source) ────────────────────────────────────
const usersByUsername = new Map();   // username_lower → user object
const usersById       = new Map();   // id (number) → user object
let   nextId          = 1;
const loginAttempts   = new Map();   // username -> { count, lockedUntil }

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
      usEquities:   { title: 'US Equities',    symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB','GS','WMT','LLY'] },
      globalIndices:{ title: 'Global Indexes',  symbols: ['SPY','QQQ','DIA','EWZ','EEM','VGK','EWJ','FXI'] },
      forex:        { title: 'FX / Rates',      symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN','AUDUSD','USDCAD'], hiddenSubsections: ['crypto'] },
      crypto:       { title: 'Crypto',          symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD'] },
      commodities:  { title: 'Commodities',     symbols: ['BZ=F','GLD','SLV','USO','UNG','CORN','WEAT','SOYB','CPER','BHP'] },
      brazilB3:     { title: 'Brazil B3',       symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA','B3SA3.SA','MGLU3.SA','BBAS3.SA','GGBR4.SA','SUZB3.SA'] },
      debt:         { title: 'Yields & Rates',  symbols: [] },
    },
    layout: {
      desktopRows: [
        ['charts',       'usEquities',    'globalIndices'],
        ['forex',        'commodities',   'crypto',  'brazilB3'],
        ['debt',         'news',          'optionsFlow',  'watchlist'],
      ],
      mobileTabs: ['home', 'charts', 'watchlist', 'search', 'news'],
    },
    home: {
      sections: [
        { id: 'indexes',     title: 'US Equities',     symbols: ['SPY','QQQ','DIA','AAPL','MSFT','NVDA','TSLA','AMZN'] },
        { id: 'global',      title: 'Global Indexes',   symbols: ['EWZ','EEM','VGK','EWJ','FXI','EFA','IWM'] },
        { id: 'forex',       title: 'FX Markets',       symbols: ['EURUSD','USDJPY','GBPUSD','USDBRL','USDCNY','USDCHF'] },
        { id: 'crypto',      title: 'Crypto',           symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD'] },
        { id: 'commodities', title: 'Commodities',      symbols: ['BZ=F','GLD','SLV','USO','UNG','CORN'] },
        { id: 'brazilB3',    title: 'Brazil B3',        symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','WEGE3.SA','B3SA3.SA','ABEV3.SA','BBAS3.SA'] },
      ],
    },
    charts: {
      symbols: ['SPY', 'QQQ', 'C:EURUSD', 'C:USDJPY', 'GLD', 'USO', 'EEM', 'EWZ', 'X:BTCUSD', 'VGK'],
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
      // MongoDB write failure — will attempt Postgres fallback
    }
  }

  // Postgres write-through
  if (pg.isConnected()) {
    try {
      await pg.query(`
        INSERT INTO users (id, username, email, email_verified, hash, apple_user_id, settings, is_paid,
          subscription_active, trial_ends_at, stripe_customer_id, stripe_subscription_id,
          persona, referral_code, referred_by, referral_rewards, plan_tier, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (id) DO UPDATE SET
          username=EXCLUDED.username, email=EXCLUDED.email, email_verified=EXCLUDED.email_verified,
          hash=EXCLUDED.hash, apple_user_id=EXCLUDED.apple_user_id, settings=EXCLUDED.settings,
          is_paid=EXCLUDED.is_paid, subscription_active=EXCLUDED.subscription_active,
          trial_ends_at=EXCLUDED.trial_ends_at, stripe_customer_id=EXCLUDED.stripe_customer_id,
          stripe_subscription_id=EXCLUDED.stripe_subscription_id, persona=EXCLUDED.persona,
          referral_code=EXCLUDED.referral_code,
          referred_by=EXCLUDED.referred_by, referral_rewards=EXCLUDED.referral_rewards,
          plan_tier=EXCLUDED.plan_tier
      `, [
        user.id, user.username, user.email || null, user.emailVerified || false, user.hash,
        user.appleUserId || null,
        JSON.stringify(user.settings || {}),
        user.isPaid || false, user.subscriptionActive ?? true,
        user.trialEndsAt || null, user.stripeCustomerId || null,
        user.stripeSubscriptionId || null,
        JSON.stringify(user.persona || {}),
        user.referralCode || null, user.referredBy || null,
        JSON.stringify(user.referralRewards || {}),
        user.planTier || 'trial',
        user.createdAt || Date.now(),
      ]);
    } catch (e) {
      // Postgres write failure — data will be retained in memory
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
        emailVerified: row.email_verified || false,
        hash: row.hash,
        appleUserId: row.apple_user_id || null,
        settings: row.settings || defaultSettings(),
        isPaid: row.is_paid || false,
        subscriptionActive: row.subscription_active ?? true,
        trialEndsAt: row.trial_ends_at ? Number(row.trial_ends_at) : null,
        stripeCustomerId: row.stripe_customer_id || null,
        stripeSubscriptionId: row.stripe_subscription_id || null,
        persona: row.persona || defaultPersona(),
        referralCode: row.referral_code || null,
        referredBy: row.referred_by || null,
        referralRewards: row.referral_rewards || { invited: 0, xpEarned: 0 },
        planTier: row.plan_tier || 'trial',
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
  // Idempotent migration: add plan_tier column if missing
  if (pg.isConnected()) {
    try {
      await pg.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'trial'`);
    } catch (e) { /* column may already exist — safe to ignore */ }
  }

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
        createdAt:            now,
      };
      usersByUsername.set(key, user);
      usersById.set(id, user);
      await persistUser(user);
    } catch (e) {
      // Seed user failed — continuing with other users
    }
  }
}

// ── Default persona ────────────────────────────────────────────

function defaultPersona() {
  return {
    type: null,
    avatarStyle: 'illustrated',
    customization: { backgroundColor: null, borderStyle: 'none', badgeSize: 'medium' },
    stats: { totalReturn: 0, sharpeRatio: 0, bestMonth: 0, worstMonth: 0, winRate: 0, avgHoldingPeriod: 0, weeklyReturn: 0 },
    achievements: [],
  };
}

// ── Password validation ──────────────────────────────────────────────────────────

function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return null;
}

// ── User CRUD ─────────────────────────────────────────────────────────────────

async function createUser(username, passwordPlain, email) {
  const key = username.toLowerCase();
  if (!username || !passwordPlain)   throw new Error('Username and password required');
  if (username.length < 3)           throw new Error('Username must be at least 3 characters');

  const pwdError = validatePassword(passwordPlain);
  if (pwdError) throw new Error(pwdError);

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

  // Check if this email has already used a trial (trial abuse prevention)
  // This check happens BEFORE granting a trial to prevent bypass
  let grantTrial = true;
  if (email) {
    try {
      const pgResult = await pg.query('SELECT email FROM used_trials WHERE LOWER(email) = LOWER($1)', [email]);
      if (pgResult && pgResult.rows && pgResult.rows.length > 0) {
        // Email already had a trial — don't grant another one
        grantTrial = false;
      }
    } catch (e) {
      // Don't block registration if trial-check fails, but log it
      console.warn('[authStore] Trial abuse check failed:', e.message);
    }
  }

  const user = {
    id,
    username,
    email:                email || null,
    emailVerified:        false,
    hash,
    settings:             defaultSettings(),
    isPaid:               false,
    subscriptionActive:   true,
    trialEndsAt:          grantTrial ? now + (parseInt(process.env.TRIAL_DAYS, 10) || 14) * 24 * 60 * 60 * 1000 : now, // Only grant trial if email hasn't been used before
    stripeCustomerId:     null,
    stripeSubscriptionId: null,
    persona:              defaultPersona(),
    referralCode:         generateReferralCode(),
    referredBy:           null,
    referralRewards:      { invited: 0, xpEarned: 0 },
    createdAt:            now,
  };

  usersByUsername.set(key, user);
  usersById.set(id, user);
  await persistUser(user); // write-through to MongoDB

  // Record trial usage to prevent re-registration abuse
  if (email && grantTrial) {
    try {
      await pg.query('INSERT INTO used_trials (email, first_trial_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [email, now]);
    } catch (e) {
      // Don't block registration if recording trial fails
      console.warn('[authStore] Failed to record trial usage:', e.message);
    }
  }

  return user;
}

function findUserByUsername(username) {
  return usersByUsername.get(username.toLowerCase()) || null;
}

function findUserByEmail(email) {
  if (!email) return null;
  const lower = email.toLowerCase();
  for (const user of usersById.values()) {
    if (user.email && user.email.toLowerCase() === lower) return user;
  }
  return null;
}

function getUserById(id) {
  return usersById.get(Number(id)) || null;
}

async function verifyUser(username, passwordPlain) {
  const key = username.toLowerCase();

  // Check account lockout
  const attempts = loginAttempts.get(key);
  if (attempts && attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
    const waitSec = Math.ceil((attempts.lockedUntil - Date.now()) / 1000);
    throw new Error(`Account temporarily locked. Try again in ${waitSec} seconds.`);
  }

  const user = findUserByUsername(username);
  if (!user) {
    // Constant-time: still run bcrypt compare against a dummy hash so timing
    // doesn't reveal whether the username exists.
    await bcrypt.compare(passwordPlain, '$2a$12$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    recordFailedLogin(key);
    throw new Error('Invalid credentials.');
  }
  const ok = await bcrypt.compare(passwordPlain, user.hash);
  if (!ok) {
    recordFailedLogin(key);
    throw new Error('Invalid credentials.');
  }

  // Success — clear failed attempts
  loginAttempts.delete(key);
  return user;
}

// Hard cap + TTL eviction to prevent memory exhaustion from brute-force attempts
// against random usernames (each unique username creates an entry).
const LOGIN_ATTEMPTS_MAX = 100000;
const LOGIN_ATTEMPTS_TTL_MS = 2 * 60 * 60 * 1000; // 2h (covers longest 1h lockout)

function recordFailedLogin(key) {
  const now = Date.now();

  // Emergency eviction if we're approaching the cap: drop entries whose lockout
  // has expired. If still full, reject silently (caller won't lock account but
  // bcrypt.compare timing is already constant so brute force is still hard).
  if (loginAttempts.size >= LOGIN_ATTEMPTS_MAX) {
    for (const [k, v] of loginAttempts) {
      if (!v.lockedUntil || now > v.lockedUntil + LOGIN_ATTEMPTS_TTL_MS) {
        loginAttempts.delete(k);
        if (loginAttempts.size < LOGIN_ATTEMPTS_MAX * 0.9) break;
      }
    }
    if (loginAttempts.size >= LOGIN_ATTEMPTS_MAX) return;
  }

  const attempts = loginAttempts.get(key) || { count: 0, lockedUntil: null, lastAttemptAt: now };
  attempts.count += 1;
  attempts.lastAttemptAt = now;

  if (attempts.count >= 10) {
    attempts.lockedUntil = now + 60 * 60 * 1000; // 1 hour lockout
  } else if (attempts.count >= 5) {
    attempts.lockedUntil = now + 15 * 60 * 1000; // 15 min lockout
  }

  loginAttempts.set(key, attempts);
}

// Periodic cleanup of stale entries (runs every 15 min).
// .unref() so it doesn't keep the process alive in tests.
const _loginAttemptsCleanup = setInterval(() => {
  const now = Date.now();
  let evicted = 0;
  for (const [k, v] of loginAttempts) {
    const ageMs = now - (v.lastAttemptAt || 0);
    const unlocked = !v.lockedUntil || now > v.lockedUntil;
    if (unlocked && ageMs > LOGIN_ATTEMPTS_TTL_MS) {
      loginAttempts.delete(k);
      evicted++;
    }
  }
  if (evicted > 0) {
    try { require('./utils/logger').info('authStore', 'loginAttempts cleanup', { evicted, remaining: loginAttempts.size }); } catch {}
  }
}, 15 * 60 * 1000);
if (_loginAttemptsCleanup.unref) _loginAttemptsCleanup.unref();

// ── Token helpers ─────────────────────────────────────────────────────────────

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '15m', algorithm: 'HS256' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

/**
 * Create a refresh token for a user.
 * Returns { token, familyId, expiresAt }
 */
async function createRefreshToken(userId) {
  const crypto = require('crypto');
  const token = crypto.randomBytes(64).toString('hex');
  const familyId = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const now = Date.now();

  if (pg.isConnected()) {
    try {
      await pg.query(
        'INSERT INTO refresh_tokens (token, user_id, family_id, expires_at, revoked, created_at) VALUES ($1, $2, $3, $4, FALSE, $5)',
        [token, userId, familyId, expiresAt, now]
      );
    } catch (e) {
      console.error('[authStore] createRefreshToken failed:', e.message);
      throw e;
    }
  }

  return { token, familyId, expiresAt };
}

/**
 * Rotate a refresh token (one-time use, replay-attack detection).
 * Returns { token, userId, familyId, expiresAt } on success, null on failure.
 */
async function rotateRefreshToken(oldToken) {
  if (!pg.isConnected()) {
    return null;
  }

  try {
    const result = await pg.query(
      'SELECT token, user_id, family_id, expires_at, revoked FROM refresh_tokens WHERE token = $1',
      [oldToken]
    );

    if (!result || !result.rows || result.rows.length === 0) {
      return null; // Token not found
    }

    const old = result.rows[0];

    // If token was already revoked, this is a replay attack — revoke entire family
    if (old.revoked) {
      const userId = old.user_id;

      // Log the security breach
      console.error(`[SECURITY] Refresh token replay detected for user ${userId}. All sessions revoked.`);

      // Revoke all tokens for this family
      await pg.query('UPDATE refresh_tokens SET revoked = TRUE WHERE family_id = $1', [old.family_id]);

      // Send security alert email
      try {
        const emailService = require('./services/emailService');
        const user = getUserById(userId);

        if (emailService.isConfigured() && user && user.email) {
          await emailService.sendEmail({
            to: user.email,
            subject: 'Security Alert: Suspicious Activity on Your Account',
            html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:24px;border-radius:8px;">
  <div style="border-bottom:2px solid #ff6600;padding-bottom:12px;margin-bottom:16px;">
    <span style="color:#ff6600;font-weight:700;font-size:18px;">SENGER</span>
    <span style="color:#888;font-size:14px;margin-left:8px;">Security Alert</span>
  </div>
  <div style="background:#16213e;padding:16px;border-radius:6px;margin-bottom:16px;">
    <div style="font-size:18px;font-weight:700;color:#fff;">Suspicious Activity Detected</div>
    <div style="margin-top:12px;font-size:14px;line-height:1.6;color:#e0e0e0;">
      <p>A potentially compromised session was detected on your account. As a precaution, we have signed you out of all active sessions.</p>
      <p><strong>What happened?</strong> An attempt was made to reuse an old session token, which may indicate unauthorized access.</p>
      <p><strong>What to do:</strong> If you didn't authorize this sign-out, please change your password immediately and review your account activity.</p>
    </div>
  </div>
  <a href="${process.env.CLIENT_URL || 'https://senger-client.onrender.com'}" style="display:inline-block;background:#ff6600;color:#fff;padding:8px 20px;border-radius:4px;text-decoration:none;font-weight:600;font-size:14px;">Go to Account</a>
  <div style="margin-top:16px;font-size:11px;color:#555;">If you have questions, please contact our support team.</div>
</div>`,
            text: 'Security Alert: A potentially compromised session was detected on your account. All active sessions have been signed out as a precaution. If this wasn\'t you, please change your password immediately.',
          });
        }
      } catch (emailErr) {
        console.error('[SECURITY] Failed to send breach notification email:', emailErr.message);
      }

      return null;
    }

    if (Date.now() > old.expires_at) {
      return null; // Expired
    }

    // Revoke old token
    await pg.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1', [oldToken]);

    // Issue new token in same family
    const crypto = require('crypto');
    const newToken = crypto.randomBytes(64).toString('hex');
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    await pg.query(
      'INSERT INTO refresh_tokens (token, user_id, family_id, expires_at, revoked, created_at) VALUES ($1, $2, $3, $4, FALSE, $5)',
      [newToken, old.user_id, old.family_id, expiresAt, now]
    );

    return { token: newToken, userId: old.user_id, familyId: old.family_id, expiresAt };
  } catch (e) {
    console.error('[authStore] rotateRefreshToken failed:', e.message);
    return null;
  }
}

/**
 * Revoke all refresh tokens for a user (logout).
 */
async function revokeUserRefreshTokens(userId) {
  if (!pg.isConnected()) {
    return;
  }

  try {
    await pg.query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [userId]);
  } catch (e) {
    console.error('[authStore] revokeUserRefreshTokens failed:', e.message);
  }
}

async function updateUserPassword(userId, newPassword) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found');
  const hash = await bcrypt.hash(newPassword, 12);
  user.hash = hash;
  usersById.set(user.id, user);
  usersByUsername.set(user.username.toLowerCase(), user);
  await persistUser(user);
  // Also update Postgres directly
  if (pg.isConnected()) {
    try {
      await pg.query('UPDATE users SET hash = $1 WHERE id = $2', [hash, user.id]);
    } catch (e) {
      console.error('[authStore] updateUserPassword Postgres update failed:', e.message);
    }
  }
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
  let user = getUserById(userId);

  if (user) {
    // Normal path: update in-memory + persist
    Object.assign(user, fields);
    await persistUser(user);
    return user;
  }

  // User not in memory (e.g. MongoDB hydration failed or user not yet cached).
  // Write directly to MongoDB so subscription state is persisted for next hydration.
  console.warn(`[authStore] updateSubscription: user ${userId} not in memory — writing directly to MongoDB`);
  if (usersCollection) {
    try {
      await usersCollection.updateOne(
        { id: Number(userId) },
        { $set: fields },
        { upsert: false },
      );
    } catch (e) {
      console.error(`[authStore] updateSubscription MongoDB direct write failed:`, e.message);
    }
  }

  // Return a minimal object so callers don't break
  return { id: userId, ...fields };
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
    emailVerified:        false,
    settings:             defaultSettings(),
    isPaid:               false,
    subscriptionActive:   true,
    trialEndsAt:          now + (parseInt(process.env.TRIAL_DAYS, 10) || 14) * 24 * 60 * 60 * 1000,
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



module.exports = {
  initDB,
  createUser,
  deleteUser,
  findUserByUsername,
  findUserByEmail,
  getUserById,
  verifyUser,
  signToken,
  verifyToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeUserRefreshTokens,
  updateUserPassword,
  listUsers,
  mergeSettings,
  updateSubscription,
  updatePersona,
  safeUser,
  seedUsersFromEnv,
  findOrCreateAppleUser,
  findUserByStripeCustomerId,
  updateUser,
  getAllUsersWithPersona,
  findUserByReferralCode,
  defaultSettings,
  persistUser,
};
