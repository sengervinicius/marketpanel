/**
 * auth.js
 * User authentication with bcrypt hashing and JWT tokens.
 *
 * NOTE: User data is stored in memory. For production, use a real database (MongoDB, PostgreSQL, etc.)
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const users = new Map(); // username → { username, hash, createdAt }

/**
 * Register a new user.
 * @param {string} username - The username
 * @param {string} passwordPlain - The plaintext password
 * @returns {Object} { username }
 * @throws {Error} If username is already taken
 */
async function registerUser(username, passwordPlain) {
  if (!username || !passwordPlain) {
    throw new Error('Username and password required');
  }
  if (users.has(username)) {
    throw new Error('Username taken');
  }
  const hash = await bcrypt.hash(passwordPlain, 12);
  users.set(username, {
    username,
    hash,
    createdAt: Date.now(),
  });
  return { username };
}

/**
 * Authenticate a user and return a JWT token.
 * @param {string} username - The username
 * @param {string} passwordPlain - The plaintext password
 * @returns {Object} { username, token }
 * @throws {Error} If credentials are invalid
 */
async function authenticateUser(username, passwordPlain) {
  if (!username || !passwordPlain) {
    throw new Error('Username and password required');
  }
  const user = users.get(username);
  if (!user) {
    throw new Error('Invalid credentials');
  }
  const ok = await bcrypt.compare(passwordPlain, user.hash);
  if (!ok) {
    throw new Error('Invalid credentials');
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  return { username, token };
}

/**
 * Verify a JWT token and return the decoded payload.
 * @param {string} token - The JWT token
 * @returns {Object} { username, ... } decoded payload
 * @throws {Error} If token is invalid or expired
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  registerUser,
  authenticateUser,
  verifyToken,
};
