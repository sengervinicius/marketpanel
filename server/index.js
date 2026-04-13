require('dotenv').config();

// ── Sentry error monitoring ───────────────────────────────────────────────────
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
  });
  console.log('[INFO] Sentry error monitoring initialized');
} else {
  console.warn('[WARN] SENTRY_DSN not set — error monitoring disabled. Set it in Render environment.');
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { createServer } = require('http');
const WebSocket = require('ws');
const { connectPolygon, computeFeedHealth } = require('./polygonProxy');
const { connectTwelveData } = require('./twelvedataWs');
const { feedRouter, initFeedRouter } = require('./routes/feed');
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
const anomaliesRoutes   = require('./routes/anomalies');
const iapRoutes         = require('./routes/iap');
const searchRoutes      = require('./routes/search');
const bondsRoutes       = require('./routes/bonds');
const derivativesRoutes = require('./routes/derivatives');
const gamificationRoutes = require('./routes/gamification');
const missionsRoutes     = require('./routes/missions');
const discordRoutes     = require('./routes/discord');
const screenerRoutes        = require('./routes/screener');
const screenerPresetRoutes  = require('./routes/screenerPresets');
const optionsRoutes         = require('./routes/options');
const leaderboardRoutes = require('./routes/leaderboard');
const earningsRoutes        = require('./routes/earnings');
const shareRoutes       = require('./routes/share');
const referralRoutes    = require('./routes/referrals');
const notificationRoutes = require('./routes/notifications');
const gameRoutes        = require('./routes/game');
const screenTickerRoutes = require('./routes/screenTickers');
const { requireAuth, requireActiveSubscription } = require('./authMiddleware');
const logger = require('./utils/logger');
const { requestLogger } = require('./utils/logger');
const { errorHandler } = require('./utils/apiError');
const { rateLimitByUser } = require('./middleware/rateLimitByUser');
const { rateLimitByIP } = require('./middleware/rateLimitByIP');
const { requestTimeout } = require('./middleware/requestTimeout');
const { initPostgres, isConnected: pgConnected } = require('./db/postgres');
const { initRedis, isConnected: redisConnected } = require('./cache/redisClient');
const { initJobs, stopAll: stopJobs } = require('./jobs/index');
const chatStore     = require('./chatStore');
const { getUserById, seedUsersFromEnv, initDB } = require('./authStore');
const { verifyToken } = require('./authStore');
const { initPortfolioDB } = require('./portfolioStore');
const { initAlertDB } = require('./alertStore');
const { initGameDB } = require('./gameStore');
require('./jobs/markToMarket'); // batch mark-to-market (self-scheduling)
const { init: initMarketContext } = require('./services/marketContextBuilder');
const { init: initPredictions } = require('./services/predictionAggregator');
const predictionsRoutes = require('./routes/predictions');
const { init: initWire } = require('./services/wireGenerator');
const { init: initMorningBrief } = require('./services/morningBrief');
const wireRoutes = require('./routes/wire');
const { init: initBehavior } = require('./services/behaviorTracker');
const behaviorRoutes = require('./routes/behavior');
const { init: initDeepAnalysis } = require('./services/deepAnalysis');
const anomalyScanner = require('./services/anomalyScanner');
const { init: initVault } = require('./services/vault');
const vaultRoutes = require('./routes/vault');
const modelRouter = require('./services/modelRouter');
const earningsAnalyzer = require('./services/earningsAnalyzer');

const app = express();

// In production, restrict CORS to explicit CLIENT_URL + known deploy origins.
// Warn loudly if CLIENT_URL is not set, but don't crash the process.
let ALLOWED_ORIGINS;
if (process.env.NODE_ENV === 'production') {
  if (!process.env.CLIENT_URL) {
    console.error('[FATAL] PRODUCTION MODE: CLIENT_URL is required but not set.');
    console.error('[FATAL] Set CLIENT_URL in Render environment to https://app.sengermarket.com');
    console.error('[FATAL] Falling back to hardcoded known origins — set CLIENT_URL ASAP.');
    // Never use wildcard '*' — hardcode known production origins as safety net
    ALLOWED_ORIGINS = [
      'https://app.sengermarket.com',
      'https://senger-client.onrender.com',
    ];
  } else {
    // Allow both the custom domain and the original Render URL during transition
    ALLOWED_ORIGINS = [
      process.env.CLIENT_URL,
      'https://senger-client.onrender.com',
      'https://app.sengermarket.com',
    ].filter((v, i, a) => a.indexOf(v) === i); // deduplicate
    console.log('[INFO] PRODUCTION MODE: CORS restricted to', ALLOWED_ORIGINS);
  }
} else {
  // Development: allow localhost origins + CLIENT_URL if set
  ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    ...(process.env.CLIENT_URL ? [process.env.CLIENT_URL] : []),
  ];
}

app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
}));

// ── Security headers (Helmet) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://appleid.cdn-apple.com", "https://js.stripe.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://senger-server.onrender.com", "wss://senger-server.onrender.com", "https://app.sengermarket.com", "https://api.stripe.com", "https://appleid.cdn-apple.com"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://appleid.apple.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow third-party resources (Stripe)
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }, // 2 years
}));

// NOTE: express.json() is applied globally EXCEPT for billing/webhook (needs raw body)
app.use((req, res, next) => {
  if (req.originalUrl === '/api/billing/webhook') return next();
  express.json()(req, res, next);
});

app.use(cookieParser());

app.use(requestLogger);

// ── Static file serving ───────────────────────────────────────────────────────
const path = require('path');
app.use('/cards', express.static(path.join(__dirname, 'public', 'cards'), { maxAge: '30m' }));

// ── Apple Pay domain verification (proxied from Stripe — always up to date) ──
app.get('/.well-known/apple-developer-merchantid-domain-association', async (req, res) => {
  try {
    const response = await fetch('https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association');
    if (!response.ok) throw new Error(`Stripe returned ${response.status}`);
    res.set('Content-Type', 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=86400'); // cache 24h
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('[apple-pay] Failed to proxy verification file:', err.message);
    res.status(502).send('Failed to fetch Apple Pay verification file');
  }
});

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
    postgres: pgConnected() ? 'connected' : (process.env.POSTGRES_URL ? 'configured' : 'disabled'),
    redis: redisConnected() ? 'connected' : (process.env.REDIS_URL ? 'configured' : 'disabled'),
    stripe: process.env.STRIPE_SECRET_KEY ? 'configured' : 'unconfigured',
  },
  ai: {
    perplexity: process.env.PERPLEXITY_API_KEY ? 'OK' : 'MISSING KEY',
    anthropic: process.env.ANTHROPIC_API_KEY ? 'OK' : 'MISSING KEY',
    openai: process.env.OPENAI_API_KEY ? 'OK (embeddings)' : 'MISSING KEY (vault degraded)',
    modelRouter: 'active',
    routeMap: Object.keys(modelRouter.ROUTE_MAP),
  },
}));
app.use('/api/auth', authRoutes);

// ── Admin endpoint removed for production (Phase 7 security hardening) ──────

// ── Protected routes ───────────────────────────────────────────────────────────
// Stripe webhook: MUST be before requireAuth — Stripe cannot authenticate as a user.
// Raw body parsing is handled inside the route (express.raw).
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const { handleBillingWebhook } = require('./billing');
  handleBillingWebhook(req, res);
});
// Billing: auth required for all other endpoints (create-session, status, portal)
app.use('/api/billing', requireAuth, billingRoutes);
// Apple IAP: mounted under /api/billing/iap (auth handled per-route inside)
app.use('/api/billing/iap', iapRoutes);

// Settings: auth required (no subscription check — need settings even on expired trial)
app.use('/api/settings', requireAuth, settingsRoutes);

// Users (chat search): auth required
app.use('/api/users', requireAuth, usersRoutes);

// Chat REST: auth + subscription required + rate limit
app.use('/api/chat', requireAuth, requireActiveSubscription,
  rateLimitByIP({ max: 120, windowMs: 60000 }),
  chatRoutes);

// Debt data: auth + subscription required + rate limit
app.use('/api/debt', requireAuth, requireActiveSubscription,
  rateLimitByIP({ max: 30, windowMs: 60000 }),
  debtRoutes);

// Macro data: auth + subscription required + rate limit + timeout
app.use('/api/macro', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'macro', windowSec: 60, max: 15 }),
  requestTimeout(20000),
  macroRoutes);

// Instrument registry: auth required (no subscription — needed for search from login page context)
app.use('/api/instruments', requireAuth, instrumentsRoutes);

// Screen tickers: auth required (dynamic ticker resolution for sector screens)
app.use('/api/screen-tickers', requireAuth, screenTickerRoutes);

// Screener: auth + subscription required + rate limit + timeout
app.use('/api/screener', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'screener', windowSec: 60, max: 10 }),
  requestTimeout(20000),
  screenerRoutes);
app.use('/api/screener/presets', requireAuth, screenerPresetRoutes);

// Options: auth + subscription required + rate limit + timeout
app.use('/api/options', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'options', windowSec: 60, max: 20 }),
  requestTimeout(15000),
  optionsRoutes);

// Portfolio: auth required (no subscription check — need portfolio even on expired trial)
app.use('/api/portfolio', requireAuth, portfolioRoutes);

// Alerts: auth required (no subscription check — alerts are a core feature)
app.use('/api/alerts', requireAuth, alertRoutes);

// Anomalies: auth required (no subscription check — anomaly detection is a core feature)
app.use('/api/anomalies', requireAuth, anomaliesRoutes);

// Game: auth required (no subscription check — game is free tier)
app.use('/api/game', requireAuth, gameRoutes);

// Legacy stubs (no-op) for removed gamification system
app.use('/api/gamification', requireAuth, gamificationRoutes);
app.use('/api/missions', requireAuth, missionsRoutes);
app.use('/api/discord', requireAuth, discordRoutes);
app.use('/api/leaderboard', requireAuth, leaderboardRoutes);
app.use('/api/share', requireAuth,
  rateLimitByUser({ key: 'share', windowSec: 60, max: 5 }),
  requestTimeout(15000),
  shareRoutes);
app.use('/api/referrals', requireAuth, referralRoutes);
app.use('/api/notifications', requireAuth, notificationRoutes);

// Bonds: auth + subscription required + rate limit + timeout
app.use('/api/bonds', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'bonds', windowSec: 60, max: 20 }),
  requestTimeout(15000),
  bondsRoutes);

// Derivatives: auth + subscription required + rate limit + timeout
app.use('/api/derivatives', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'derivatives', windowSec: 60, max: 20 }),
  requestTimeout(15000),
  derivativesRoutes);

// AI Search: auth + subscription required + rate limit + timeout
// Increased from 20s to 25s — internal data (8s max) + LLM (10s) needs headroom
app.use('/api/search', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'search', windowSec: 60, max: 15 }),
  requestTimeout(25000),
  searchRoutes);

// Prediction markets: auth + subscription required
app.use('/api/predictions', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'predictions', windowSec: 60, max: 30 }),
  requestTimeout(15000),
  predictionsRoutes);

// Wire & Morning Brief: auth + subscription required
app.use('/api/wire', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'wire', windowSec: 60, max: 30 }),
  requestTimeout(20000),
  wireRoutes);

// Behavioral tracking: auth required, high rate limit (fire-and-forget)
app.use('/api/behavior', requireAuth,
  rateLimitByUser({ key: 'behavior', windowSec: 60, max: 60 }),
  requestTimeout(10000),
  behaviorRoutes);

// Private Knowledge Vault: auth + subscription required
app.use('/api/vault', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'vault', windowSec: 60, max: 10 }),
  requestTimeout(30000),
  vaultRoutes);

// Earnings analysis: auth + subscription required
app.use('/api/earnings', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'earnings', windowSec: 60, max: 10 }),
  requestTimeout(15000),
  earningsRoutes);

// Feed health: no auth required (public endpoint for monitoring)
app.use('/api/feed', feedRouter);

// Market data: auth + subscription required + rate limit + timeout
app.use('/api', requireAuth, requireActiveSubscription,
  rateLimitByIP({ max: 120, windowMs: 60000 }),
  requestTimeout(15000), marketRoutes);

// Sentry error handler (must be before other error handlers)
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

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
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [process.env.CLIENT_URL, 'https://senger-client.onrender.com', 'https://app.sengermarket.com'].filter(Boolean)
    : ['https://senger-client.onrender.com', 'https://app.sengermarket.com', 'http://localhost:5173', 'http://localhost:3000'];
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

    // Send current feed status immediately so the client doesn't have to wait
    // for the next periodic feedHealth broadcast (up to 2s delay)
    if (marketState.feedMeta) {
      const { computeFeedHealth } = require('./polygonProxy');
      ws.send(JSON.stringify({
        type: 'feedHealth',
        feeds: ['stocks', 'forex', 'crypto'].map(f => computeFeedHealth(f, marketState)),
      }));
    }
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
connectTwelveData(marketState, broadcast); // S5.7: International equity streaming

// Late-bind marketState + computeFeedHealth into the feed router
initFeedRouter(marketState, computeFeedHealth);

// Late-bind marketState + user stores into the AI context builder
const { getPortfolio } = require('./portfolioStore');
initMarketContext({ marketState, getUserById, getPortfolio });

// Start prediction market aggregator (polls Kalshi + Polymarket every 2 min)
initPredictions();

// Start Wire generator (AI market commentary every 7 min during market hours)
initWire({ marketState });

// Start Morning Brief service (daily brief at 9:15 AM ET)
initMorningBrief({ marketState, getUserById, getPortfolio });

// Start behavioral intelligence tracker
initBehavior({ mergeSettings: require('./authStore').mergeSettings, getUserById });

// Initialize deep analysis tools (portfolio autopsy, counter-thesis, scenario)
initDeepAnalysis({ marketState, getPortfolio, getUserById });

// Initialize earnings analyzer (auto-triggered after earnings calls)
earningsAnalyzer.init({ marketState, getPortfolio, getUserById });

// Helper to collect all user watchlists for anomaly scanner
function getAllWatchlists() {
  const { getAllUsersWithPersona } = require('./authStore');
  const watchlistsByUserId = {};
  for (const user of getAllUsersWithPersona()) {
    if (user.settings && Array.isArray(user.settings.watchlist)) {
      watchlistsByUserId[user.id] = user.settings.watchlist;
    } else {
      watchlistsByUserId[user.id] = [];
    }
  }
  return watchlistsByUserId;
}

// Start anomaly detection scanner (every 10 minutes)
anomalyScanner.init({ marketState, getWatchlists: getAllWatchlists });

// Initialize vault service (private knowledge management)
initVault({ openaiKey: process.env.OPENAI_API_KEY });

// Boot sequence: Postgres → Redis → MongoDB → seed → jobs → HTTP server
async function boot() {
  // Validate required environment variables
  const required    = ['JWT_SECRET'];
  const recommended = ['POLYGON_API_KEY', 'CLIENT_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    logger.error('boot', `Missing env vars: ${missing.join(', ')} — auth will not work until these are set in Render environment.`);
    if (process.env.NODE_ENV === 'production') {
      logger.error('boot', 'Go to Render Dashboard → senger-market-server → Environment and set JWT_SECRET.');
    }
  }
  recommended.filter(k => !process.env[k]).forEach(k => {
    logger.warn('boot', `${k} not set — some features will be limited`);
  });

  // Production-specific security checks
  if (process.env.NODE_ENV === 'production') {
    // Warn if JWT_SECRET is default or weak
    const jwtSecret = process.env.JWT_SECRET || '';
    if (!jwtSecret || jwtSecret.length < 16 || jwtSecret === 'dev-secret-key') {
      logger.warn('boot', '[SECURITY] JWT_SECRET is weak or default. Use a strong, random 32+ character secret in production.');
    }
    // Warn if POLYGON_API_KEY is not configured
    if (!process.env.POLYGON_API_KEY) {
      logger.warn('boot', '[SECURITY] POLYGON_API_KEY is not set. Market data features will be unavailable or degraded.');
    }
  }

  // 1. Platform services (optional — app works without them)
  await initPostgres();
  await initRedis();

  // Initialize vault tables (private knowledge management)
  try {
    const vault = require('./services/vault');
    await vault.ensureTable();
  } catch (e) {
    logger.warn('boot', 'Vault table initialization failed (vault disabled)', { error: e.message });
  }

  const { initEmail } = require('./services/emailService');
  initEmail();

  // 2. Data stores (Postgres hydration first if connected, then MongoDB)
  const mongoDB = await initDB();  // connect MongoDB, load users into memory
  await initPortfolioDB(mongoDB);  // load portfolio data
  await initAlertDB(mongoDB);      // load alert data
  await initGameDB(mongoDB);       // load game profiles + trades
  await seedUsersFromEnv();        // create any SEED_USERS accounts if missing

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    logger.info('boot', 'Senger Market Terminal — Server');
    logger.info('boot', `REST  → http://localhost:${PORT}/api`);
    logger.info('boot', `WS    → ws://localhost:${PORT}/ws`);
    logger.info('boot', `ENV   → ${process.env.NODE_ENV || 'development'}`);
    logger.info('boot', `Postgres: ${pgConnected() ? 'connected' : 'disabled'} | Redis: ${redisConnected() ? 'connected' : 'disabled'}`);

    // AI service health check
    logger.info('boot', `AI Services: Perplexity=${process.env.PERPLEXITY_API_KEY ? 'OK' : 'MISSING'} | Anthropic=${process.env.ANTHROPIC_API_KEY ? 'OK' : 'MISSING'} | OpenAI=${process.env.OPENAI_API_KEY ? 'OK' : 'MISSING'}`);
    logger.info('boot', `Model Router: active | Routes: ${Object.keys(modelRouter.ROUTE_MAP).join(', ')}`);

    // 3. Start all background jobs (leaderboard, card cleanup, alert scheduler)
    initJobs({ port: PORT });
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info('boot', `${signal} received — shutting down`);
    stopJobs();
    anomalyScanner.stop();
    server.close();
    const { closePostgres } = require('./db/postgres');
    const { closeRedis } = require('./cache/redisClient');
    await closePostgres();
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Prevent crashes from unhandled promise rejections and uncaught exceptions
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('unhandledRejection', reason?.message || String(reason), { stack: reason?.stack });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', err.message, { stack: err.stack });
    // Give logger time to flush, then exit
    setTimeout(() => process.exit(1), 1000);
  });
}

boot();
