/**
 * authRoutes.js
 * DEPRECATED: This file is no longer used. Use routes/auth.js instead.
 * Kept for backwards compatibility but should be removed in a future cleanup.
 *
 * REST API endpoints for user authentication (register, login).
 */

const express = require('express');
const router = express.Router();
const { registerUser, authenticateUser } = require('../auth');

/**
 * POST /api/auth/register
 * Register a new user.
 *
 * Request body: { username, password }
 * Response: { ok: true, user: { username } } or { error, code }
 */
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        error: 'username and password required',
        code: 'bad_request',
      });
    }
    const user = await registerUser(username, password);
    res.json({ ok: true, user });
  } catch (e) {
    const status = e.message === 'Username taken' ? 409 : 400;
    res.status(status).json({
      error: e.message,
      code: e.message === 'Username taken' ? 'username_taken' : 'bad_request',
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate a user and return a JWT token.
 *
 * Request body: { username, password }
 * Response: { ok: true, username, token } or { error, code }
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        error: 'username and password required',
        code: 'bad_request',
      });
    }
    const result = await authenticateUser(username, password);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(401).json({
      error: e.message,
      code: 'invalid_credentials',
    });
  }
});

module.exports = router;
