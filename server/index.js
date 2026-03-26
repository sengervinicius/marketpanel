require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const WebSocket = require('ws');
const { connectPolygon } = require('./polygonProxy');
const marketRoutes  = require('./routes/market');
const authRoutes    = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const usersRoutes   = require('./routes/users');
const chatRoutes    = require('./routes/chat');
const billingRoutes = require('./routes/billing');
const debtRoutes    = require('./routes/debt');
const { requireAuth, requireActiveSubscription } = require('./authMiddleware');
const chatStore     = require('./chatStore');
const { getUserById, seedUsersFromEnv } = require('./authStore');
const { verifyToken } = require('./authStore');

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));

// NOTE: express.json() is applied globally EXCEPT for billing/webhook (needs raw body)
app.use((req, res, next) => {
  if (req.originalUrl === '/api/billing/webhook') return next();
  express.json()(req, res, next);
});

// ── Public routes ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));
app.use('/api/auth', authRoutes);

// ── Protected routes ───────────────────────────────────────────────────────────
// Billing: auth required, subscription check is inside (create-session / status)
app.use('/api/billing', requireAuth, billingRoutes);

// Settings: auth required (no subscription check — need settings even on expired trial)
app.use('/api/settings', requireAuth, settingsRoutes);

// Users (chat search): auth required
app.use('/api/users', requireAuth, usersRoutes);

// Chat REST: auth + subscription required
app.use('/api/chat', requireAuth, requireActiveSubscription, chatRoutes);

// Debt data: auth + subscription required
app.use('/api/debt', requireAuth, requireActiveSubscription, debtRoutes);

// Market data: auth + subscription required
app.use('/api', requireAuth, requireActiveSubscription, marketRoutes);

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
  // Authenticate WS via ?token= query param or Authorization header
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
  } catch {}

  clients.set(ws, { userId, username });
  console.log(`[WS] Client connected (user: ${username || 'anonymous'}). Total: ${clients.size}`);

  // Send full snapshot on connect
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'snapshot', data: marketState }));
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      // Live DM chat over WS
      if (msg.type === 'chat_message') {
        const { toUserId, text } = msg;
        if (!userId || !toUserId || !text) return;
        const savedMsg = chatStore.addMessage(userId, Number(toUserId), text);

        // Deliver to sender + recipient
        for (const [client, info] of clients) {
          if (client.readyState !== WebSocket.OPEN) continue;
          if (info.userId === userId || info.userId === Number(toUserId)) {
            client.send(JSON.stringify({ type: 'chat_message', message: savedMsg }));
          }
        }
      }
    } catch (e) {
      console.warn('[WS] Message parse error:', e.message);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected. Total: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Client error:', err.message);
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

// Seed users from SEED_USERS env var before accepting requests
seedUsersFromEnv().then(() => {
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`\n🟠 Senger Market Terminal — Server`);
    console.log(`   REST  → http://localhost:${PORT}/api`);
    console.log(`   WS    → ws://localhost:${PORT}/ws`);
    console.log(`   ENV   → ${process.env.NODE_ENV || 'development'}\n`);
  });
});
