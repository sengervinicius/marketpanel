/**
 * routes/auth.js
 * Authentication endpoints: register, login, me.
 */

const express = require('express');
const router  = express.Router();
const {
  createUser, verifyUser, signToken, safeUser, getUserById, findOrCreateAppleUser,
} = require('../authStore');
const { requireAuth } = require('../authMiddleware');

const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per window
  message: { error: 'Too many attempts. Please try again in 15 minutes.', code: 'rate_limited' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res) => {
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
router.post('/login', authLimiter, async (req, res) => {
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

// POST /api/auth/apple
router.post('/apple', authLimiter, async (req, res) => {
  try {
    // Accept identityToken from client (matches Apple's id_token)
    const identityToken = req.body.identityToken || req.body.id_token;
    const appleUser = req.body.user || null;

    if (!identityToken) {
      return res.status(400).json({ error: 'identityToken is required', code: 'missing_token' });
    }

    const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID;
    if (!APPLE_CLIENT_ID) {
      return res.status(501).json({
        error: 'Apple Sign In is not configured on this server. Set APPLE_CLIENT_ID env var.',
        code: 'not_configured',
      });
    }

    let payload;
    try {
      const appleSignin = require('apple-signin-auth');
      payload = await appleSignin.verifyIdToken(identityToken, {
        audience: APPLE_CLIENT_ID,
        ignoreExpiration: false,
      });
    } catch (verifyErr) {
      console.error('[auth/apple] Token verification failed:', verifyErr.message);
      return res.status(401).json({
        error: 'Apple identity token is invalid or expired. Please try signing in again.',
        code: 'token_invalid',
      });
    }

    const appleUserId = payload.sub;
    const email = payload.email || appleUser?.email || null;
    const firstName = appleUser?.name?.firstName || null;

    const u = await findOrCreateAppleUser(appleUserId, email, firstName);
    const token = signToken(u);

    res.json({
      ok: true,
      user: { id: u.id, username: u.username },
      token,
      subscription: {
        isPaid: u.isPaid,
        subscriptionActive: u.subscriptionActive,
        trialEndsAt: u.trialEndsAt,
      },
    });
  } catch (e) {
    console.error('[auth/apple] Unexpected error:', e.message);
    res.status(500).json({
      error: 'An unexpected error occurred during Apple Sign In. Please try again.',
      code: 'server_error',
    });
  }
});

module.exports = router;
