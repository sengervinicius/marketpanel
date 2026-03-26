/**
 * authStore.js
 * Centralised user store with full user model: id, settings, subscription, etc.
 * Uses bcryptjs for password hashing and jsonwebtoken for tokens.
 *
 * NOTE: In-memory only. Replace with a real database for production.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// username (lowercase) → user object
const usersByUsername = new Map();
// id → user object
const usersById = new Map();
let nextId = 1;

/**
 * Default user settings. Merged on registration.
 */
function defaultSettings() {
  return {
    theme: 'dark',
    onboardingCompleted: false,
    watchlist: [],
    panels: {
      brazilB3: { title: 'Brazil B3', symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA','B3SA3.SA','MGLU3.SA','BBAS3.SA'] },
      usEquities: { title: 'US Equities', symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB'] },
      globalIndices: { title: 'Global Indices', symbols: ['SPY','QQQ','DIA','IWM','EWZ','EWW','EEM','FXI','EWJ'] },
      forex: { title: 'FX', symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN'] },
      crypto: { title: 'Crypto', symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD'] },
      commodities: { title: 'Commodities', symbols: ['GLD','SLV','USO','UNG','CORN','WEAT'] },
      debt: { title: 'Debt Markets', symbols: ['US2Y','US5Y','US10Y','US30Y','BR10Y','DE10Y'] },
    },
    layout: {},
  };
}

/**
 * Create a new user.
 */
async function createUser(username, passwordPlain) {
  const key = username.toLowerCase();
  if (!username || !passwordPlain) throw new Error('Username and password required');
  if (username.length < 3) throw new Error('Username must be at least 3 characters');
  if (passwordPlain.length < 6) throw new Error('Password must be at least 6 characters');
  if (usersByUsername.has(key)) throw new Error('Username taken');

  const hash = await bcrypt.hash(passwordPlain, 12);
  const now  = Date.now();
  const id   = nextId++;
  const user = {
    id,
    username,
    hash,
    settings:            defaultSettings(),
    isPaid:              false,
    subscriptionActive:  true,
    trialEndsAt:         now + 2 * 24 * 60 * 60 * 1000, // 2-day trial
    stripeCustomerId:    null,
    stripeSubscriptionId:null,
    createdAt:           now,
  };
  usersByUsername.set(key, user);
  usersById.set(id, user);
  return user;
}

/**
 * Find a user by username (case-insensitive).
 */
function findUserByUsername(username) {
  return usersByUsername.get(username.toLowerCase()) || null;
}

/**
 * Find a user by id.
 */
function getUserById(id) {
  return usersById.get(Number(id)) || null;
}

/**
 * Verify credentials and return JWT if ok.
 */
async function verifyUser(username, passwordPlain) {
  const user = findUserByUsername(username);
  if (!user) throw new Error('Invalid credentials');
  const ok = await bcrypt.compare(passwordPlain, user.hash);
  if (!ok) throw new Error('Invalid credentials');
  return user;
}

/**
 * Issue a signed JWT for user id/username.
 */
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

/**
 * Verify a JWT and return the payload.
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * List users (for chat user search), excluding a given id.
 */
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
 * Deep-merge partial settings into a user's settings object.
 */
function mergeSettings(userId, partial) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found');
  // Shallow merge top-level; deep merge panels
  if (partial.panels) {
    user.settings.panels = {
      ...user.settings.panels,
      ...Object.fromEntries(
        Object.entries(partial.panels).map(([k, v]) => [k, { ...(user.settings.panels[k] || {}), ...v }])
      ),
    };
    const { panels, ...rest } = partial;
    Object.assign(user.settings, rest);
  } else {
    Object.assign(user.settings, partial);
  }
  return user.settings;
}

/**
 * Update subscription fields.
 */
function updateSubscription(userId, fields) {
  const user = getUserById(userId);
  if (!user) throw new Error('User not found');
  Object.assign(user, fields);
  return user;
}

/**
 * Expose safe user info (no hash).
 */
function safeUser(user) {
  const { hash, ...safe } = user;
  return safe;
}

module.exports = {
  createUser,
  findUserByUsername,
  getUserById,
  verifyUser,
  signToken,
  verifyToken,
  listUsers,
  mergeSettings,
  updateSubscription,
  safeUser,
};
