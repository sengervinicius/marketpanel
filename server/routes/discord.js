/**
 * discord.js — Discord OAuth2 link/callback routes.
 *
 * Env vars (optional — if absent, routes return 501):
 *   DISCORD_CLIENT_ID
 *   DISCORD_CLIENT_SECRET
 *   DISCORD_REDIRECT_URI      (e.g. https://app.example.com/api/discord/callback)
 *   DISCORD_GUILD_ID          (the server to auto-join)
 *   DISCORD_BOT_TOKEN         (bot with guilds.join scope & Manage Server perm)
 */

const express = require('express');
const router = express.Router();
const { getUserById, updateUser } = require('../authStore');
const logger = require('../utils/logger');

const CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI;
const GUILD_ID      = process.env.DISCORD_GUILD_ID;
const BOT_TOKEN     = process.env.DISCORD_BOT_TOKEN;

const DISCORD_API = 'https://discord.com/api/v10';

function isConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

// GET /api/discord/status — check if Discord integration is configured + linked
router.get('/status', (req, res) => {
  if (!isConfigured()) {
    return res.json({ configured: false, linked: false });
  }
  const user = getUserById(req.userId);
  const linked = !!(user?.discord?.id);
  res.json({
    configured: true,
    linked,
    discordUsername: user?.discord?.username || null,
    guildId: GUILD_ID || null,
  });
});

// GET /api/discord/link — redirect user to Discord OAuth2
router.get('/link', (req, res) => {
  if (!isConfigured()) {
    return res.status(501).json({ error: 'Discord integration not configured' });
  }
  const scopes = ['identify'];
  if (GUILD_ID && BOT_TOKEN) scopes.push('guilds.join');

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: scopes.join(' '),
    state: req.userId, // simple state — in production, use a signed JWT
  });
  res.json({ url: `https://discord.com/oauth2/authorize?${params}` });
});

// GET /api/discord/callback — exchange code for token, store Discord info
router.get('/callback', async (req, res) => {
  if (!isConfigured()) {
    return res.status(501).json({ error: 'Discord integration not configured' });
  }

  const { code, state: userId } = req.query;
  if (!code) return res.status(400).json({ error: 'Missing code parameter' });

  try {
    // Exchange code for access token
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      logger.error('discord', 'Token exchange failed', { status: tokenRes.status });
      return res.status(400).json({ error: 'Discord token exchange failed' });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Fetch Discord user info
    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
      return res.status(400).json({ error: 'Failed to fetch Discord user' });
    }
    const discordUser = await userRes.json();

    // Auto-join guild if configured
    if (GUILD_ID && BOT_TOKEN) {
      try {
        await fetch(`${DISCORD_API}/guilds/${GUILD_ID}/members/${discordUser.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ access_token: accessToken }),
        });
      } catch (e) {
        logger.warn('discord', 'Guild join failed', { error: e.message });
        // Non-fatal — user is still linked
      }
    }

    // Persist Discord info on user record
    const user = getUserById(userId);
    if (user) {
      await updateUser(userId, {
        discord: {
          id: discordUser.id,
          username: discordUser.username,
          discriminator: discordUser.discriminator || '0',
          avatar: discordUser.avatar,
          linkedAt: new Date().toISOString(),
        },
      });
    }

    // Redirect back to app with success
    const clientBase = process.env.CLIENT_URL || '/';
    res.redirect(`${clientBase}?discord=linked`);
  } catch (e) {
    logger.error('discord', 'Callback error', { error: e.message });
    res.status(500).json({ error: 'Internal error during Discord linking' });
  }
});

// POST /api/discord/unlink — remove Discord link from user
router.post('/unlink', async (req, res) => {
  const user = getUserById(req.userId);
  if (!user?.discord?.id) {
    return res.json({ ok: true, message: 'Not linked' });
  }
  await updateUser(req.userId, { discord: null });
  res.json({ ok: true });
});

module.exports = router;
