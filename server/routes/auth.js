/**
 * routes/auth.js
 * Authentication endpoints: register, login, me.
 */

const express = require('express');
const router  = express.Router();
const {
  createUser, deleteUser, verifyUser, signToken, safeUser, getUserById, findOrCreateAppleUser,
  findUserByUsername, findUserByEmail, updateUserPassword, createRefreshToken, rotateRefreshToken, revokeUserRefreshTokens,
} = require('../authStore');
const { deleteUserPortfolios } = require('../portfolioStore');
const { deleteUserAlerts }     = require('../alertStore');
const { requireAuth } = require('../authMiddleware');
const { setTokenCookie, clearTokenCookie, REFRESH_COOKIE_NAME, setRefreshCookie, clearRefreshCookie } = require('../utils/cookieHelper');
// W1.5: route all log output through the structured logger so reqId/userId
// propagate into the log stream instead of going straight to stderr.
const logger = require('../utils/logger');

const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per window
  message: { error: 'Too many attempts. Please try again in 15 minutes.', code: 'rate_limited' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Password complexity validation ────────────────────────────────────────────
function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return null;
}

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, password, email } = req.body;
    const user  = await createUser(username, password, email);
    const token = signToken(user);
    setTokenCookie(res, token);
    const refresh = await createRefreshToken(user.id);
    setRefreshCookie(res, refresh.token);
    res.status(201).json({
      ok: true,
      user: { id: user.id, username: user.username, persona: user.persona || null },
      token,
      refreshToken: refresh.token, // In body for mobile Safari where cookies are blocked
      subscription: {
        isPaid:             user.isPaid,
        subscriptionActive: user.subscriptionActive,
        trialEndsAt:        user.trialEndsAt,
      },
    });

    // Send verification email asynchronously (don't block registration)
    if (email) {
      try {
        const crypto = require('crypto');
        const verifyToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
        const pg = require('../db/postgres');
        await pg.query(
          'INSERT INTO email_verifications (token, user_id, email, expires_at, verified, created_at) VALUES ($1, $2, $3, $4, FALSE, $5)',
          [verifyToken, user.id, email, expiresAt, Date.now()]
        );
        const verifyUrl = `${process.env.CLIENT_URL || 'https://the-particle.com'}/#/verify-email/${verifyToken}`;
        const { sendEmail } = require('../services/emailService');
        await sendEmail({
          to: email,
          subject: 'Senger Market — Verify Your Email',
          html: `<p>Welcome to Senger Market! Please verify your email address by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
        });
      } catch (emailErr) {
        logger.error('auth/register', 'Failed to send verification email', { error: emailErr.message });
      }
    }
  } catch (e) {
    res.status(400).json({ error: 'Registration failed. Please try different credentials.', code: 'registration_failed' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const user  = await verifyUser(username, password);
    const token = signToken(user);
    setTokenCookie(res, token);
    const refresh = await createRefreshToken(user.id);
    setRefreshCookie(res, refresh.token);

    res.json({
      ok: true,
      user: { id: user.id, username: user.username, persona: user.persona || null },
      token,
      refreshToken: refresh.token, // In body for mobile Safari where cookies are blocked
      subscription: {
        isPaid:             user.isPaid,
        subscriptionActive: user.subscriptionActive,
        trialEndsAt:        user.trialEndsAt,
      },
      streak: null,
    });
  } catch (e) {
    // Never reveal whether the username or password was wrong (prevents user enumeration)
    res.status(401).json({ error: 'Invalid credentials.', code: 'invalid_credentials' });
  }
});

// GET /api/auth/me — refresh user info
router.get('/me', requireAuth, (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({
    user:  { id: user.id, username: user.username, persona: user.persona || null },
    subscription: {
      isPaid:             user.isPaid,
      subscriptionActive: user.subscriptionActive,
      trialEndsAt:        user.trialEndsAt,
    },
  });
});

// POST /api/auth/reset — request password reset
router.post('/reset', authLimiter, async (req, res) => {
  try {
    const { username, email } = req.body;
    if (!username && !email) {
      return res.status(400).json({ error: 'Username or email is required', code: 'missing_field' });
    }

    // Always return success (don't reveal if account exists)
    res.json({ ok: true, message: 'If an account with that information exists, a password reset link has been sent to the associated email.' });

    // Process reset asynchronously (don't block response)
    const user = username ? findUserByUsername(username) : findUserByEmail(email);
    if (!user || !user.email) return; // silently skip if no user or no email

    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
    const pg = require('../db/postgres');

    await pg.query(
      'INSERT INTO password_resets (token, user_id, expires_at, used, created_at) VALUES ($1, $2, $3, FALSE, $4)',
      [token, user.id, expiresAt, Date.now()]
    );

    const resetUrl = `${process.env.CLIENT_URL || 'https://the-particle.com'}/#/reset-password/${token}`;

    // Send email (best-effort)
    try {
      const { sendEmail } = require('../services/emailService');
      await sendEmail({
        to: user.email,
        subject: 'Senger Market — Password Reset',
        html: `<p>You requested a password reset. Click the link below to set a new password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour. If you did not request this, ignore this email.</p>`,
      });
    } catch (emailErr) {
      logger.error('auth/reset', 'Failed to send reset email', { error: emailErr.message });
    }
  } catch (e) {
    logger.error('auth/reset', 'request handler failed', { error: e.message });
    res.status(500).json({ error: 'Failed to process reset request', code: 'reset_failed' });
  }
});

// POST /api/auth/reset-password — execute password reset with token
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required', code: 'missing_fields' });
    }

    const pwdError = validatePassword(password);
    if (pwdError) {
      return res.status(400).json({ error: pwdError, code: 'weak_password' });
    }

    const pg = require('../db/postgres');
    const result = await pg.query(
      'SELECT token, user_id, expires_at, used FROM password_resets WHERE token = $1',
      [token]
    );

    if (!result || !result.rows || result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link.', code: 'invalid_token' });
    }

    const reset = result.rows[0];
    if (reset.used) {
      return res.status(400).json({ error: 'This reset link has already been used.', code: 'token_used' });
    }
    if (Date.now() > reset.expires_at) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.', code: 'token_expired' });
    }

    // Update password
    await updateUserPassword(reset.user_id, password);

    // Mark token as used
    await pg.query('UPDATE password_resets SET used = TRUE WHERE token = $1', [token]);

    res.json({ ok: true, message: 'Password has been reset successfully. You can now log in with your new password.' });
  } catch (e) {
    logger.error('auth/reset-password', 'handler failed', { error: e.message });
    res.status(500).json({ error: 'Failed to reset password', code: 'reset_failed' });
  }
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

    // Load apple-signin-auth — separate try/catch for module load vs verification
    let appleSignin;
    try {
      appleSignin = require('apple-signin-auth');
    } catch (loadErr) {
      logger.error('auth/apple', 'Failed to load apple-signin-auth module', { error: loadErr.message });
      return res.status(501).json({
        error: 'Apple Sign In is not available on this server. The apple-signin-auth package may not be installed.',
        code: 'module_missing',
      });
    }

    let payload;
    try {
      payload = await appleSignin.verifyIdToken(identityToken, {
        audience: APPLE_CLIENT_ID,
        ignoreExpiration: false,
      });
    } catch (verifyErr) {
      logger.warn('auth/apple', 'Token verification failed', { error: verifyErr.message });
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
    setTokenCookie(res, token);
    const refresh = await createRefreshToken(u.id);
    setRefreshCookie(res, refresh.token);

    res.json({
      ok: true,
      user: { id: u.id, username: u.username },
      token,
      refreshToken: refresh.token, // In body for mobile Safari where cookies are blocked
      subscription: {
        isPaid: u.isPaid,
        subscriptionActive: u.subscriptionActive,
        trialEndsAt: u.trialEndsAt,
      },
    });
  } catch (e) {
    logger.error('auth/apple', 'Unexpected error', { error: e.message });
    res.status(500).json({
      error: 'An unexpected error occurred during Apple Sign In. Please try again.',
      code: 'server_error',
    });
  }
});

// DELETE /api/auth/account — permanently delete account and all data (Apple requirement)
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Delete all user data in parallel
    await Promise.all([
      deleteUserPortfolios(userId),
      deleteUserAlerts(userId),
    ]);

    // Delete the user account last
    const deleted = await deleteUser(userId);
    if (!deleted) {
      return res.status(404).json({ error: 'Account not found', code: 'not_found' });
    }

    res.json({ ok: true, message: 'Account and all associated data have been permanently deleted.' });
  } catch (e) {
    logger.error('auth', 'Account deletion error', { error: e.message });
    res.status(500).json({ error: 'Failed to delete account. Please try again.', code: 'delete_failed' });
  }
});

// POST /api/auth/logout — clear auth cookies and revoke tokens
router.post('/logout', requireAuth, async (req, res) => {
  clearTokenCookie(res);
  clearRefreshCookie(res);
  try {
    await revokeUserRefreshTokens(req.user.id);
  } catch (e) {
    logger.warn('auth/logout', 'Failed to revoke refresh tokens', { error: e.message });
  }
  res.json({ ok: true });
});

// POST /api/auth/verify-email — verify email with token
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required', code: 'missing_token' });
    }

    const pg = require('../db/postgres');
    const result = await pg.query(
      'SELECT token, user_id, email, expires_at, verified FROM email_verifications WHERE token = $1',
      [token]
    );

    if (!result || !result.rows || result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid verification link.', code: 'invalid_token' });
    }

    const verification = result.rows[0];
    if (verification.verified) {
      return res.json({ ok: true, message: 'Email already verified.' });
    }
    if (Date.now() > verification.expires_at) {
      return res.status(400).json({ error: 'Verification link has expired. Please request a new one.', code: 'token_expired' });
    }

    // Mark as verified
    await pg.query('UPDATE email_verifications SET verified = TRUE WHERE token = $1', [token]);

    // Update user's emailVerified status
    const user = getUserById(verification.user_id);
    if (user) {
      user.emailVerified = true;
    }

    // Update in Postgres too
    try {
      await pg.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [verification.user_id]);
    } catch (e) {
      logger.warn('auth/verify-email', 'Postgres update failed', { error: e.message });
    }

    res.json({ ok: true, message: 'Email verified successfully!' });
  } catch (e) {
    logger.error('auth/verify-email', 'handler failed', { error: e.message });
    res.status(500).json({ error: 'Failed to verify email', code: 'verify_failed' });
  }
});

// POST /api/auth/resend-verification — resend verification email
router.post('/resend-verification', requireAuth, async (req, res) => {
  try {
    const user = getUserById(req.user.id);
    if (!user || !user.email) {
      return res.status(400).json({ error: 'No email address on file', code: 'no_email' });
    }
    if (user.emailVerified) {
      return res.json({ ok: true, message: 'Email already verified.' });
    }

    const crypto = require('crypto');
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const pg = require('../db/postgres');

    await pg.query(
      'INSERT INTO email_verifications (token, user_id, email, expires_at, verified, created_at) VALUES ($1, $2, $3, $4, FALSE, $5)',
      [verifyToken, user.id, user.email, expiresAt, Date.now()]
    );

    const verifyUrl = `${process.env.CLIENT_URL || 'https://the-particle.com'}/#/verify-email/${verifyToken}`;
    const { sendEmail } = require('../services/emailService');
    await sendEmail({
      to: user.email,
      subject: 'Senger Market — Verify Your Email',
      html: `<p>Please verify your email address by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
    });

    res.json({ ok: true, message: 'Verification email sent.' });
  } catch (e) {
    logger.error('auth/resend-verification', 'handler failed', { error: e.message });
    res.status(500).json({ error: 'Failed to send verification email', code: 'resend_failed' });
  }
});

// POST /api/auth/refresh — rotate refresh token and issue new access token
// Accepts refresh token from: 1) httpOnly cookie, 2) request body { refreshToken }
// Returns new tokens in both cookies AND response body (for mobile Safari where cookies are blocked)
router.post('/refresh', async (req, res) => {
  try {
    // Priority: cookie first, then request body (mobile fallback)
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token', code: 'no_refresh_token' });
    }

    const result = await rotateRefreshToken(refreshToken);
    if (!result) {
      clearTokenCookie(res);
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'invalid_refresh_token' });
    }

    const user = getUserById(result.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found', code: 'user_not_found' });
    }

    const newAccessToken = signToken(user);
    setTokenCookie(res, newAccessToken);
    setRefreshCookie(res, result.token);

    res.json({
      ok: true,
      token: newAccessToken,
      refreshToken: result.token, // In body for mobile Safari where cookies are blocked
      user: { id: user.id, username: user.username, persona: user.persona || null },
      subscription: {
        isPaid:             user.isPaid,
        subscriptionActive: user.subscriptionActive,
        trialEndsAt:        user.trialEndsAt,
        tier:               user.planTier || 'trial',
      },
    });
  } catch (e) {
    logger.error('auth/refresh', 'handler failed', { error: e.message });
    res.status(500).json({ error: 'Failed to refresh token', code: 'refresh_failed' });
  }
});

module.exports = router;
