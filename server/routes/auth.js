/**
 * routes/auth.js
 * Authentication endpoints: register, login, me.
 */

const express = require('express');
const router  = express.Router();
const {
  createUser, verifyUser, signToken, safeUser, getUserById,
} = require('../authStore');
const { requireAuth } = require('../authMiddleware');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user  = await createUser(username, password);
    const token = signToken(user);
    res.status(201).json({
      ok: true,
      user: { id: user.id, username: user.username },
      token,
      subscription: {
        isPaid:             user.isPaid,
        subscriptionActive: user.subscriptionActive,
        trialEndsAt:        user.trialEndsAt,
      },
    });
  } catch (e) {
    const status = e.message === 'Username taken' ? 409 : 400;
    res.status(status).json({ error: e.message, code: 'register_failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user  = await verifyUser(username, password);
    const token = signToken(user);
    res.json({
      ok: true,
      user: { id: user.id, username: user.username },
      token,
      subscription: {
        isPaid:             user.isPaid,
        subscriptionActive: user.subscriptionActive,
        trialEndsAt:        user.trialEndsAt,
      },
    });
  } catch (e) {
    res.status(401).json({ error: e.message, code: 'invalid_credentials' });
  }
});

// GET /api/auth/me — refresh user info
router.get('/me', requireAuth, (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({
    user:  { id: user.id, username: user.username },
    subscription: {
      isPaid:             user.isPaid,
      subscriptionActive: user.subscriptionActive,
      trialEndsAt:        user.trialEndsAt,
    },
  });
});

module.exports = router;
