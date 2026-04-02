require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const WebSocket = require('ws');
const { connectPolygon } = require('./polygonProxy');
const marketRoutes      = require('./routes/market/index');
const authRoutes        = require('./routes/auth');
const settingsRoutes    = require('./routes/settings');
const usersRoutes       = require('./routes/users');
const chatRoutes        = require('./routes/chat');
const billingRoutes     = require('./routes/billing');
const debtRoutes        = require('./routes/debt');
const instrumentsRoutes = require('./routes/instruments');
const macroRoutes       = require('./routes/macro');
const portfolioRoutes   = require('./routes/portfolio');
const alertRoutes       = require('./routes/alerts');
const iapRoutes         = require('./routes/iap');
const searchRoutes      = require('./routes/search');
const gamificationRoutes = require('./routes/gamification');
const missionsRoutes     = require('./routes/missions');
const discordRoutes     = require('./routes/discord');
const screenerRoutes        = require('./routes/screener');
const screenerPresetRoutes  = require('./routes/screenerPresets');
const optionsRoutes         = require('./routes/options');
const leaderboardRoutes = require('./routes/leaderboard');
const { requireAuth, requireActiveSubscription } = require('./authMiddleware');
const logger = require('./utils/logger');
const { requestLogger } = require('./utils/logger');
const { errorHandler } = require('./utils/apiError');
const chatStore     = require('./chatStore');
const { getUserById, seedUsersFromEnv, initDB } = require('./authStore');
const { verifyToken } = require('./authStore');
const { initPortfolioDB } = require('./portfolioStore');
const { initAlertDB } = require('./alertStore');
const { startAlertScheduler } = require('./alertScheduler');
require('./jobs/leaderboards'); // starts leaderboard cron

const app = express();

// In production, prefer an explicit CLIENT_URL for strict CORS.
// If absent we fall back to permissive '*' and log a loud warning rather than
// crashing the process — a missing CLIENT_URL should not take the whole service down.
const ALLOWED_ORIGIN = process.env.CLIENT_URL || '*';
if (!process.env.CLIENT_URL && process.env.NODE_ENV === 'production') {
  console.warn('[WARN] CLIENT_URL not set — CORS is permissive (*). Set CLIENT_URL in Render env vars.');
}
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
}));

// NOTE: express.json() is applied globally EXCEPT for billing/webhook (needs raw body)
app.use((req, res, next) => {
  if (req.originalUrl === '/api/billing/webhook') return next();
  express.json()(req, res, next);
});

app.use(requestLogger);

// ── Public routes ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  version: process.env.npm_package_version || '1.0.0',
  time: new Date().toISOString(),
  uptime: process.uptime(),
  providers: {
    polygon: process.env.POLYGON_API_KEY ? 'configured' : 'unconfigured',
    yahoo: 'unknown',
    finnhub: process.env.FINNHUB_API_KEY ? 'configured' : 'unconfigured',
    alphavantage: process.env.ALPHA_VANTAGE_KEY ? 'configured' : 'unconfigured',
    eulerpool: process.env.EULERPOOL_API_KEY ? 'configured' : 'unconfigured',
    fred: process.env.FRED_API_KEY ? 'configured' : 'public_csv',
    mongodb: process.env.MONGODB_URI ? 'configured' : 'in_memory',
    stripe: process.env.STRIPE_SECRET_KEY ? 'configured' : 'unconfigured',
  },
}));
app.use('/api/auth', authRoutes);

// ── Protected routes ───────────────────────────────────────────────────────────
// Billing: auth required, subscription check is inside (create-session / status)
app.use('/api/billing', requireAuth, billingRoutes);
// Apple IAP: mounted under /api/billing/iap (auth handled per-route inside)
app.use('/api/billing/iap', iapRoutes);

// Settings: auth required (no subscription check — need settings even on expired trial)
app.use('/api/settings', requireAuth, settingsRoutes);

// Users (chat search): auth required
app.use('/api/users', requireAuth, usersRoutes);

// Chat REST: auth + subscription required
app.use('/api/chat', requireAuth, requireActiveSubscription, chatRoutes);

// Debt data: auth + subscription required
app.use('/api/debt', requireAuth, requireActiveSubscription, debtRoutes);

// Macro data: auth + subscription required
app.use('/api/macro', requireAuth, requireActiveSubscription, macroRoutes);

// Instrument registry: auth required (no subscription — needed for search from login page context)
app.use('/api/instruments', requireAuth, instrumentsRoutes);

// Screener: auth + subscription required
app.use('/api/screener', requireAuth, requireActiveSubscription, screenerRoutes);
app.use('/api/screener/presets', requireAuth, screenerPresetRoutes);

// Options: auth + subscription required
app.use('/api/options', requireAuth, requireActiveSubscription, optionsRoutes);

// Portfolio: auth required (no subscription check — need portfolio even on expired trial)
app.use('/api/portfolio', requireAuth, portfolioRoutes);

// Alerts: auth required (no subscription check — alerts are a core feature)
app.use('/api/alerts', requireAuth, alertRoutes);

// Gamification: auth required (no subscription check — XP is a core feature)
app.use('/api/gamification', requireAuth, gamificationRoutes);
app.use('/api/missions', requireAuth, missionsRoutes);
app.use('/api/discord', requireAuth, discordRoutes);
app.use('/api/leaderboard', requireAuth, leaderboardRoutes);

// AI Search: auth + subscription required
app.use('/api/search', requireAuth, requireActiveSubscription, searchRoutes);

// Market data: auth + subscription required
app.use('/api', requireAuth, requireActiveSubscription, marketRoutes);

app.use(errorHandler);

// ── HTTP server ────────────────────────────────────────────────────────────────
const server = createServer(app);

// ── WebSocket server ───────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server, path: '/ws' });

// In-memory market state
const marketState = {
  stocks:   {},
  forex:    {},
  crypto:   {},
  lastUpdate: Date.now(),
};

// WS client registry: ws → { userId }
const clients = new Map();

wss.on('connection', (ws, req) => {
  // ── Origin validation ──────────────────────────────────────────────
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'https://senger-client.onrender.com',
    'http://localhost:5173',
    'http://localhost:3000',
  ];
  if (origin && !allowedOrigins.includes(origin)) {
    console.warn(`[WS] Rejected connection from disallowed origin: ${origin}`);
    ws.close(1008, 'Origin not allowed');
    return;
  }

  // ── Authenticate WS via ?token= query param ───────────────────────
  const url    = new URL(req.url, 'ws://localhost');
  const token  = url.searchParams.get('token') || '';
  let userId   = null;
  let username = null;

  try {
    if (token) {
      const payload = verifyToken(token);
      userId   = payload.id;
      username = payload.username;
    }
  } catch (err) {
    // Invalid token — close connection
    console.warn(`[WS] Invalid token rejected: ${err.message}`);
    ws.close(4001, 'Invalid token');
    return;
  }

  if (!userId) {
    console.warn('[WS] Connection rejected: no token provided');
    ws.close(4001, 'Authentication required');
    return;
  }

  clients.set(ws, { userId, username });
  console.log(`[WS] Client connected (user: ${username}). Total: ${clients.size}`);

  // Track online presence
  chatStore.setOnline(userId);
  // Notify other users this user is online
  for (const [client, info] of clients) {
    if (client.readyState === WebSocket.OPEN && info.userId !== userId) {
      client.send(JSON.stringify({ type: 'presence', userId, online: true }));
    }
  }

  // Send full snapshot on connect
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'snapshot', data: marketState }));
  }

  // Rate limit: max 30 messages per 10 seconds per client
  let msgCount = 0;
  const msgResetInterval = setInterval(() => { msgCount = 0; }, 10000);

  ws.on('message', (raw) => {
    try {
      // Size limit: 2KB max
      if (raw.length > 2048) {
        ws.send(JSON.stringify({ type: 'error', message: 'Message too large (max 2KB)' }));
        return;
      }

      msgCount++;
      if (msgCount > 30) {
        ws.send(JSON.stringify({ type: 'error', message: 'Rate limited. Slow down.' }));
        return;
      }

      const msg = JSON.parse(raw);

      // Respond to client heartbeat pings
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
        return;
      }

      // Live DM chat over WS
      if (msg.type === 'chat_message') {
        const { toUserId, text } = msg;
        if (!toUserId || !text) return;
        // Validate text length
        if (typeof text !== 'string' || text.length > 1000) {
          ws.send(JSON.stringify({ type: 'error', message: 'Message text too long (max 1000 chars)' }));
          return;
        }
        // Validate toUserId exists
        const recipient = getUserById(Number(toUserId));
        if (!recipient) {
          ws.send(JSON.stringify({ type: 'error', message: 'Recipient not found' }));
          return;
        }

        const savedMsg = chatStore.addMessage(userId, Number(toUserId), text.trim());

        // Deliver to sender + recipient
        for (const [client, info] of clients) {
          if (client.readyState !== WebSocket.OPEN) continue;
          if (info.userId === userId || info.userId === Number(toUserId)) {
            client.send(JSON.stringify({ type: 'chat_message', message: savedMsg }));
          }
        }
      }

      // Typing indicator
      if (msg.type === 'typing') {
        const { toUserId, isTyping } = msg;
        if (!toUserId) return;
        const convId = chatStore.getConversationId(userId, Number(toUserId));
        if (isTyping) {
          chatStore.setTyping(convId, userId);
        } else {
          chatStore.clearTyping(convId, userId);
        }
        // Forward typing status to the other user
        for (const [client, info] of clients) {
          if (client.readyState !== WebSocket.OPEN) continue;
          if (info.userId === Number(toUserId)) {
            client.send(JSON.stringify({ type: 'typing', fromUserId: userId, isTyping }));
          }
        }
      }

      // Read receipt
      if (msg.type === 'mark_read') {
        const { otherUserId } = msg;
        if (!otherUserId) return;
        const readIds = chatStore.markRead(userId, Number(otherUserId));
        if (readIds.length > 0) {
          // Notify the other user their messages were read
          for (const [client, info] of clients) {
            if (client.readyState !== WebSocket.OPEN) continue;
            if (info.userId === Number(otherUserId)) {
              client.send(JSON.stringify({ type: 'messages_read', byUserId: userId, messageIds: readIds }));
            }
          }
        }
      }
    } catch (e) {
      console.warn('[WS] Message parse error:', e.message);
    }
  });

  ws.on('close', () => {
    clearInterval(msgResetInterval);
    chatStore.setOffline(userId);
    // Check if user has no more connections before broadcasting offline
    if (!chatStore.isOnline(userId)) {
      for (const [client, info] of clients) {
        if (client.readyState === WebSocket.OPEN && info.userId !== userId) {
          client.send(JSON.stringify({ type: 'presence', userId, online: false }));
        }
      }
    }
    clients.delete(ws);
    console.log(`[WS] Client disconnected. Total: ${clients.size}`);
  });

  ws.on('error', (err) => {
    clearInterval(msgResetInterval);
    console.error('[WS] Client error:', err.message);
    chatStore.setOffline(userId);
    // Check if user has no more connections before broadcasting offline
    if (!chatStore.isOnline(userId)) {
      for (const [client, info] of clients) {
        if (client.readyState === WebSocket.OPEN && info.userId !== userId) {
          client.send(JSON.stringify({ type: 'presence', userId, online: false }));
        }
      }
    }
    clients.delete(ws);
  });
});

function broadcast(update) {
  if (clients.size === 0) return;
  const msg = JSON.stringify(update);
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

connectPolygon(marketState, broadcast);

// Boot sequence: connect DB → seed env users → start HTTP server
async function boot() {
  // Validate required environment variables
  const required    = ['JWT_SECRET'];
  const recommended = ['POLYGON_API_KEY', 'CLIENT_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    // Log a loud warning but don't crash — auth routes will return 500 for
    // JWT operations, but the server stays alive and health checks respond.
    logger.error(`Missing env vars: ${missing.join(', ')} — auth will not work until these are set in Render environment.`);
    if (process.env.NODE_ENV === 'production') {
      logger.error('Go to Render Dashboard → senger-market-server → Environment and set JWT_SECRET.');
    }
  }
  recommended.filter(k => !process.env[k]).forEach(k => {
    logger.warn(`${k} not set — some features will be limited`);
  });

  const mongoDB = await initDB();  // connect MongoDB, load users into memory
  await initPortfolioDB(mongoDB);  // load portfolio data (uses same MongoDB instance)
  await initAlertDB(mongoDB);      // load alert data (uses same MongoDB instance)
  await seedUsersFromEnv();        // create any SEED_USERS accounts if missing
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    logger.info('Senger Market Terminal — Server');
    logger.info(`REST  → http://localhost:${PORT}/api`);
    logger.info(`WS    → ws://localhost:${PORT}/ws`);
    logger.info(`ENV   → ${process.env.NODE_ENV || 'development'}`);

    // Start alert evaluation scheduler after server is listening
    startAlertScheduler(PORT);
  });
}

boot();
