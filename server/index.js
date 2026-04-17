require('dotenv').config();

// ── Phase 4: Global crash handlers (must be first) ────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.stack || err.message || err);
  // Attempt graceful shutdown
  try { require('./db/postgres').getPool()?.end(); } catch {}
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason?.stack || reason?.message || reason);
});

// ── Sentry error monitoring (W0.3) ────────────────────────────────────────────
// Init as early as possible so uncaught-exception and unhandled-rejection
// handlers (registered above) can still report to Sentry via captureException.
// Release tag uses RENDER_GIT_COMMIT (Render sets this automatically) or falls
// back to SENTRY_RELEASE / GIT_COMMIT when present.
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  const release =
    process.env.SENTRY_RELEASE ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    undefined;
  Sentry.init({
    dsn:               process.env.SENTRY_DSN,
    environment:       process.env.NODE_ENV || 'development',
    release,
    tracesSampleRate:  Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    // Do not attach request bodies automatically — we redact PII via the
    // logger and do not want payloads leaking to Sentry either.
    sendDefaultPii: false,
    beforeSend(event) {
      // Defence in depth: scrub any authorization/cookie headers that might
      // have been picked up by the integrations.
      try {
        if (event?.request?.headers) {
          for (const k of Object.keys(event.request.headers)) {
            const lk = k.toLowerCase();
            if (lk === 'authorization' || lk === 'cookie' || lk === 'set-cookie' || lk === 'x-api-key') {
              event.request.headers[k] = '[REDACTED]';
            }
          }
        }
      } catch { /* never throw from beforeSend */ }
      return event;
    },
  });
  console.log(`[INFO] Sentry error monitoring initialized (release=${release || 'unset'})`);

  // Forward previously-registered process handlers into Sentry too.
  process.on('uncaughtException', (err) => { try { Sentry.captureException(err); } catch {} });
  process.on('unhandledRejection', (reason) => {
    try { Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason))); } catch {}
  });
} else {
  console.warn('[WARN] SENTRY_DSN not set — error monitoring disabled. Set it in Render environment.');
}

const express = require('express');
const compression = require('compression');
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
const discordRoutes     = require('./routes/discord');
const screenerRoutes        = require('./routes/screener');
const screenerPresetRoutes  = require('./routes/screenerPresets');
const optionsRoutes         = require('./routes/options');
const earningsRoutes        = require('./routes/earnings');
const shareRoutes       = require('./routes/share');
const notificationRoutes = require('./routes/notifications');
const screenTickerRoutes = require('./routes/screenTickers');
const edgarRoutes       = require('./routes/edgar');
const signalRoutes      = require('./routes/signals');
const briefRoutes       = require('./routes/brief');
const riskRoutes        = require('./routes/risk');
const unusualWhalesRoutes = require('./routes/unusualWhales');
const adminRoutes = require('./routes/admin');
const privacyRoutes = require('./routes/privacy');       // W1.1 LGPD DSAR
const adminDebugRoutes = require('./routes/adminDebug'); // W4.1 on-call debug
const { requireAuth, requireActiveSubscription, requireAdmin } = require('./authMiddleware');
const logger = require('./utils/logger');
const { requestLogger, correlationSync } = require('./utils/logger');
const wsBackpressure = require('./utils/wsBackpressure');
const { metricsMiddleware, metricsHandler, metrics: promMetrics } = require('./utils/metrics');
const { errorHandler } = require('./utils/apiError');
const { rateLimitByUser } = require('./middleware/rateLimitByUser');
const { rateLimitByIP } = require('./middleware/rateLimitByIP');
const { requestTimeout } = require('./middleware/requestTimeout');
const { csrfProtect } = require('./middleware/csrfProtect');
const { initPostgres, isConnected: pgConnected } = require('./db/postgres');
const { initRedis, isConnected: redisConnected } = require('./cache/redisClient');
const { initJobs, stopAll: stopJobs } = require('./jobs/index');
const chatStore     = require('./chatStore');
const { getUserById, seedUsersFromEnv, initDB } = require('./authStore');
const { verifyToken } = require('./authStore');
const { initPortfolioDB } = require('./portfolioStore');
const { initAlertDB } = require('./alertStore');
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
const vaultSignalsRoutes = require('./routes/vaultSignals');
const { initializeBackgroundJob: initVaultSignalsJob } = require('./services/vaultSignals');
const modelRouter = require('./services/modelRouter');
const insightEngine = require('./services/insightEngine');
const insightsRoutes = require('./routes/insights');
const earningsAnalyzer = require('./services/earningsAnalyzer');
const cache = require('./cache');
const { init: initSignalMonitor } = require('./services/signalMonitor');

const app = express();

// ── Gzip/Brotli compression — reduces JSON payload sizes by ~70% ─────────────
app.use(compression({
  level: 6,           // good balance of speed vs compression ratio
  threshold: 1024,    // only compress responses > 1KB
  filter: (req, res) => {
    // Don't compress WebSocket upgrade requests or SSE streams
    if (req.headers['accept'] === 'text/event-stream') return false;
    return compression.filter(req, res);
  },
}));

// Phase 1 Security: Removed VAULT-DEBUG logger that exposed auth header info.
// Request logging is handled by the structured logger middleware.

// In production, restrict CORS to explicit CLIENT_URL + known deploy origins.
// Warn loudly if CLIENT_URL is not set, but don't crash the process.
let ALLOWED_ORIGINS;
if (process.env.NODE_ENV === 'production') {
  if (!process.env.CLIENT_URL) {
    console.error('[FATAL] PRODUCTION MODE: CLIENT_URL is required but not set.');
    console.error('[FATAL] Set CLIENT_URL in Render environment to https://the-particle.com');
    console.error('[FATAL] Falling back to hardcoded known origins — set CLIENT_URL ASAP.');
    // Never use wildcard '*' — hardcode known production origins as safety net
    ALLOWED_ORIGINS = [
      'https://the-particle.com',
      'https://senger-client.onrender.com',
    ];
  } else {
    // Allow both the custom domain and the original Render URL during transition
    ALLOWED_ORIGINS = [
      process.env.CLIENT_URL,
      'https://the-particle.com',
      'https://senger-client.onrender.com',
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
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    console.error(`[CORS] Blocked request from origin: ${origin} | Allowed: ${ALLOWED_ORIGINS.join(', ')}`);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
}));

// ── Security headers (Helmet) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://appleid.cdn-apple.com", "https://js.stripe.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://senger-server.onrender.com", "wss://senger-server.onrender.com", "https://the-particle.com", "https://api.stripe.com", "https://appleid.cdn-apple.com"],
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
  express.json({ limit: '1mb' })(req, res, next);
});

app.use(cookieParser());

app.use(requestLogger);

// W1.4 — prom-client RED metrics per route. Runs after requestLogger so
// reqId is available for correlation in logs.
app.use(metricsMiddleware);

// W1.5 — After auth middleware runs (which populates req.userId) and a route
// matches (populates req.route.path), sync userId/route back into the ALS
// store so downstream service-layer logs are tagged with them. Safe to mount
// here because auth middleware is applied per-route below.
app.use(correlationSync);

// W0.3 — Tag Sentry scope with (non-PII) user/tier/route for every request
// that already has authentication populated. On unauthenticated routes this
// middleware is a no-op.
const { sentryTagUser } = require('./middleware/sentryContext');
app.use(sentryTagUser);

// CSRF protection — blocks plain-form cross-origin state-mutating requests
app.use(csrfProtect);

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

// W1.4: /metrics endpoint for Prometheus. Guarded by an IP allow-list so it
// isn't exposed to the public internet. Defaults to loopback + RFC1918 ranges;
// production should additionally require a bearer token via METRICS_TOKEN.
const METRICS_ALLOW_RAW = process.env.METRICS_IP_ALLOWLIST ||
  '127.0.0.1,::1,10.,172.16.,172.17.,172.18.,172.19.,172.20.,172.21.,172.22.,172.23.,172.24.,172.25.,172.26.,172.27.,172.28.,172.29.,172.30.,172.31.,192.168.';
const METRICS_ALLOWED = METRICS_ALLOW_RAW.split(',').map(s => s.trim()).filter(Boolean);
const METRICS_TOKEN = process.env.METRICS_TOKEN || '';

function metricsGate(req, res, next) {
  // Bearer-token path: if a token is configured, a matching Authorization
  // header lets the caller in regardless of source IP (for Render's scraper).
  if (METRICS_TOKEN) {
    const h = req.headers.authorization || '';
    if (h === `Bearer ${METRICS_TOKEN}`) return next();
  }
  // IP allow-list. Trust proxy is already configured so req.ip is correct.
  const ip = (req.ip || '').replace(/^::ffff:/, '');
  const ok = METRICS_ALLOWED.some(prefix => ip === prefix || ip.startsWith(prefix));
  if (!ok) {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(403).send('# forbidden\n');
  }
  next();
}
app.get('/metrics', metricsGate, metricsHandler);

// Minimal public health check (no detailed API key or provider info)
app.get('/health', async (req, res) => {
  // DB connectivity check
  let dbConnected = false;
  try {
    const pool = require('./db/postgres').getPool();
    if (pool) {
      const result = await pool.query('SELECT 1');
      dbConnected = result?.rows?.length > 0;
    }
  } catch { dbConnected = false; }

  // Market data age (most recent tick across all feeds)
  let marketDataAge = null;
  try {
    const feeds = ['polygon', 'twelvedata'];
    for (const feed of feeds) {
      const lastTick = marketState?.feedMeta?.[feed]?.lastTickAt;
      if (lastTick && (!marketDataAge || lastTick > marketDataAge)) {
        marketDataAge = lastTick;
      }
    }
    if (marketDataAge) marketDataAge = Date.now() - marketDataAge; // ms since last tick
  } catch {}

  // WS client count
  let wsClients = 0;
  try { wsClients = wss?.clients?.size || 0; } catch {}

  // Phase 5: Per-feed health summary
  let feeds = {};
  try {
    const feedNames = ['stocks', 'forex', 'crypto', 'twelvedata'];
    for (const f of feedNames) {
      const meta = marketState?.feedMeta?.[f];
      if (meta) {
        feeds[f] = {
          lastTickAgeMs: meta.lastTickAt ? Date.now() - meta.lastTickAt : null,
          reconnects: meta.reconnects || 0,
          lastError: meta.lastError || null,
        };
      }
    }
  } catch {}

  const overall = dbConnected ? 'ok' : 'degraded';
  res.json({
    status: overall,
    uptime: process.uptime(),
    dbConnected,
    marketDataAgeMs: marketDataAge,
    wsClients,
    feeds,
    timestamp: new Date().toISOString(),
  });
});
app.use('/api/auth', authRoutes);

// ── Admin endpoint removed for production (Phase 7 security hardening) ──────

// ── Admin Dashboard Routes (requires auth) ──────────────────────────────────
app.use('/api/admin', requireAuth, adminRoutes);
app.use('/api/admin/debug', requireAuth, adminDebugRoutes);  // W4.1 on-call surface

// ── Admin health endpoint (provider status only — requires admin auth) ──
// Note: Does not expose API key names or values, only availability status
app.get('/api/admin/provider-health', requireAdmin, (req, res) => res.json({
  status: 'ok',
  version: process.env.npm_package_version || '1.0.0',
  time: new Date().toISOString(),
  uptime: process.uptime(),
  database: pgConnected() ? 'ok' : 'not_configured',
  cache: redisConnected() ? 'ok' : 'not_configured',
  payments: process.env.STRIPE_SECRET_KEY ? 'ok' : 'not_configured',
}));

// ── Protected routes ───────────────────────────────────────────────────────────
// Stripe webhook: MUST be before requireAuth — Stripe cannot authenticate as a user.
// Raw body parsing is handled inside the route (express.raw).
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const { handleBillingWebhook } = require('./billing');
  handleBillingWebhook(req, res);
});
// Billing: /tiers is public (PricingModal fetches without auth token)
app.get('/api/billing/tiers', (req, res) => {
  const { TIERS } = require('./config/tiers');
  const tiers = Object.entries(TIERS)
    .filter(([key]) => key !== 'trial')
    .map(([key, tier]) => ({
      id: key,
      label: tier.label,
      price: tier.price,
      features: {
        vaultDocuments: tier.vaultDocuments === -1 ? 'Unlimited' : tier.vaultDocuments,
        aiQueriesPerDay: tier.aiQueriesPerDay === -1 ? 'Unlimited' : tier.aiQueriesPerDay,
        deepAnalysisPerDay: tier.deepAnalysisPerDay === -1 ? 'Unlimited' : tier.deepAnalysisPerDay,
        morningBrief: tier.morningBrief,
        predictionMarkets: tier.predictionMarkets,
        centralVaultAccess: tier.centralVaultAccess,
      },
    }));
  res.json({ tiers });
});
// Billing: auth required for create-session, status, portal
app.use('/api/billing', requireAuth, billingRoutes);
// Apple IAP: mounted under /api/billing/iap (auth handled per-route inside)
app.use('/api/billing/iap', iapRoutes);

// Settings: auth required (no subscription check — need settings even on expired trial)
app.use('/api/settings', requireAuth,
  rateLimitByUser({ key: 'settings', windowSec: 60, max: 20 }),
  settingsRoutes);

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

// Portfolio: auth required + rate limit (no subscription check — need portfolio even on expired trial)
app.use('/api/portfolio', requireAuth,
  rateLimitByUser({ key: 'portfolio', windowSec: 60, max: 30 }),
  portfolioRoutes);

// Alerts: auth required + rate limit (no subscription check — alerts are a core feature)
app.use('/api/alerts', requireAuth,
  rateLimitByUser({ key: 'alerts', windowSec: 60, max: 30 }),
  alertRoutes);

// Anomalies: auth required (no subscription check — anomaly detection is a core feature)
app.use('/api/anomalies', requireAuth, anomaliesRoutes);

// Discord routes
app.use('/api/discord', requireAuth, discordRoutes);

// Share: auth required + rate limit + timeout
app.use('/api/share', requireAuth,
  rateLimitByUser({ key: 'share', windowSec: 60, max: 5 }),
  requestTimeout(15000),
  shareRoutes);

// Notifications
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

// Proactive Insights: auth + subscription required (Phase 7)
app.use('/api/insights', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'insights', windowSec: 60, max: 30 }),
  requestTimeout(15000),
  insightsRoutes);

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

// Vault Signals: cross-user document clustering (auth required)
app.use('/api/vault-signals', requireAuth,
  rateLimitByUser({ key: 'vault-signals', windowSec: 60, max: 20 }),
  requestTimeout(10000),
  vaultSignalsRoutes);

// Earnings analysis: auth + subscription required
app.use('/api/earnings', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'earnings', windowSec: 60, max: 10 }),
  requestTimeout(15000),
  earningsRoutes);

// Signal Monitor: auth + subscription required
app.use('/api/signals', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'signals', windowSec: 60, max: 30 }),
  requestTimeout(10000),
  signalRoutes);

// Morning Brief: auth + subscription required
app.use('/api/brief', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'brief', windowSec: 60, max: 10 }),
  requestTimeout(25000),
  briefRoutes);

// SEC EDGAR: auth + subscription required (free external API, no rate limit pressure)
app.use('/api/edgar', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'edgar', windowSec: 60, max: 20 }),
  requestTimeout(15000),
  edgarRoutes);

// Unusual Whales: auth + subscription required, options flow and dark pool data
app.use('/api/unusual-whales', requireAuth, requireActiveSubscription,
  rateLimitByUser({ key: 'unusual-whales', windowSec: 60, max: 30 }),
  requestTimeout(15000),
  unusualWhalesRoutes);

// Risk analytics: auth required (no subscription — risk analysis is core feature)
// Rate limit: 20 req/min per user, timeout: 30s (Polygon API calls)
app.use('/api/risk', requireAuth,
  rateLimitByUser({ key: 'risk', windowSec: 60, max: 20 }),
  requestTimeout(30000),
  riskRoutes);

// Feed health: no auth required (public endpoint for monitoring)
app.use('/api/feed', feedRouter);

// W1.1 LGPD — data-subject endpoints. The privacy router implements its own
// auth split (public data-map + DPO contact form, authenticated /me, etc.)
// so we do not mount requireAuth at the prefix.
app.use('/api/privacy', privacyRoutes);

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

// WebSocket connection rate limiting: IP → { count, resetTime }
const wsRateLimitMap = new Map();
const WS_RATE_LIMIT_MAX = 5; // max connections per IP per minute
const WS_RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const WS_RATE_LIMIT_MAP_CAP = 10000; // hard cap to prevent memory exhaustion

function checkWSRateLimit(ip) {
  const now = Date.now();
  let entry = wsRateLimitMap.get(ip);

  if (!entry || now > entry.resetTime) {
    // Evict expired entries when map grows large (every 100th new entry)
    if (wsRateLimitMap.size > 500 && wsRateLimitMap.size % 100 === 0) {
      for (const [key, val] of wsRateLimitMap) {
        if (now > val.resetTime) wsRateLimitMap.delete(key);
      }
    }
    // Hard cap: if still too large after eviction, reject to prevent DoS
    if (wsRateLimitMap.size >= WS_RATE_LIMIT_MAP_CAP) {
      return false;
    }
    entry = { count: 0, resetTime: now + WS_RATE_LIMIT_WINDOW };
    wsRateLimitMap.set(ip, entry);
  }

  entry.count++;
  if (entry.count > WS_RATE_LIMIT_MAX) {
    return false; // Rate limit exceeded
  }
  return true; // OK
}

// Periodic cleanup: evict all expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of wsRateLimitMap) {
    if (now > val.resetTime) wsRateLimitMap.delete(key);
  }
}, 5 * 60 * 1000).unref();

wss.on('connection', (ws, req) => {
  // ── Rate limit by IP (max 5 connections per minute) ────────────────
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  if (!checkWSRateLimit(clientIp)) {
    logger.warn('ws', 'Rate limit exceeded', { ip: clientIp });
    ws.close(1008, 'Rate limit exceeded');
    return;
  }

  // ── Origin validation ──────────────────────────────────────────────
  const origin = req.headers.origin || '';
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [process.env.CLIENT_URL, 'https://the-particle.com', 'https://senger-client.onrender.com'].filter(Boolean)
    : ['https://the-particle.com', 'https://senger-client.onrender.com', 'http://localhost:5173', 'http://localhost:3000'];
  if (origin && !allowedOrigins.includes(origin)) {
    logger.warn('ws', 'Rejected connection from disallowed origin', { origin });
    ws.close(1008, 'Origin not allowed');
    return;
  }

  // ── Authenticate WS via httpOnly cookie (primary) or ?token= query param (fallback) ───────────────────────
  const url = new URL(req.url, 'ws://localhost');

  // Parse cookies from upgrade request
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, v] = c.trim().split('=');
    if (k && v) cookies[k] = decodeURIComponent(v);
  });

  // Try cookie first (secure), fall back to query param (deprecated)
  const token = cookies['senger_token'] || url.searchParams.get('token') || '';

  // Log deprecation warning if token came from query param
  if (url.searchParams.get('token') && !cookies['senger_token']) {
    logger.warn('ws', 'Deprecated: token in URL query. Client should use cookie auth.');
  }

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
    logger.warn('ws', 'Invalid token rejected', { reason: err.message });
    ws.close(4001, 'Invalid token');
    return;
  }

  if (!userId) {
    logger.warn('ws', 'Connection rejected: no token provided');
    ws.close(4001, 'Authentication required');
    return;
  }

  // W1.8: per-user connection cap. Reject excess with 1008; the existing
  // client will exponentially back off and this one gets closed cleanly.
  if (!wsBackpressure.registerConnection(ws, userId)) {
    ws.close(1008, 'Too many concurrent connections');
    return;
  }

  clients.set(ws, { userId, username });
  logger.info('ws', 'Client connected', { userId, total: clients.size });

  // Track online presence (Phase 4: wrapped in try-catch to prevent orphaned sockets)
  try {
    chatStore.setOnline(userId);
    for (const [client, info] of clients) {
      if (client.readyState === WebSocket.OPEN && info.userId !== userId) {
        client.send(JSON.stringify({ type: 'presence', userId, online: true }));
      }
    }
  } catch (e) {
    logger.error('ws', 'chatStore.setOnline error', { error: e.message, userId });
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
    try {
      chatStore.setOffline(userId);
      if (!chatStore.isOnline(userId)) {
        for (const [client, info] of clients) {
          if (client.readyState === WebSocket.OPEN && info.userId !== userId) {
            wsBackpressure.safeSend(client, JSON.stringify({ type: 'presence', userId, online: false }));
          }
        }
      }
    } catch (e) {
      logger.error('ws', 'chatStore.setOffline error on close', { error: e.message, userId });
    }
    clients.delete(ws);
    wsBackpressure.unregisterConnection(ws, userId);
    logger.info('ws', 'Client disconnected', { userId, total: clients.size });
  });

  ws.on('error', (err) => {
    clearInterval(msgResetInterval);
    logger.error('ws', 'Client error', { error: err.message });
    try {
      chatStore.setOffline(userId);
      if (!chatStore.isOnline(userId)) {
        for (const [client, info] of clients) {
          if (client.readyState === WebSocket.OPEN && info.userId !== userId) {
            wsBackpressure.safeSend(client, JSON.stringify({ type: 'presence', userId, online: false }));
          }
        }
      }
    } catch (e) {
      logger.error('ws', 'chatStore.setOffline error on ws error', { error: e.message, userId });
    }
    clients.delete(ws);
    wsBackpressure.unregisterConnection(ws, userId);
  });
});

function broadcast(update) {
  if (clients.size === 0) return;
  const msg = JSON.stringify(update);
  for (const [ws, info] of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    // If update specifies userId, only send to that user
    if (update.userId && info.userId !== update.userId) continue;
    // W1.8: safeSend enforces per-connection outbound buffer cap and will
    // kick a slow client rather than let it drag every other client down.
    wsBackpressure.safeSend(ws, msg);
  }
}

// Phase 4: Circuit breaker with exponential backoff for market data connections
function connectWithRetry(name, connectFn, ...args) {
  let delay = 1000;
  const maxDelay = 60000;
  const attempt = () => {
    try {
      connectFn(...args);
      logger.info('startup', `${name} connected`);
    } catch (err) {
      logger.error('startup', `${name} failed, retrying in ${delay / 1000}s`, { error: err.message });
      setTimeout(attempt, delay);
      delay = Math.min(delay * 2, maxDelay);
    }
  };
  attempt();
}
connectWithRetry('Polygon', connectPolygon, marketState, broadcast);
connectWithRetry('TwelveData', connectTwelveData, marketState, broadcast);

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

// Start Signal Monitor (real-time signal detection with WebSocket push)
initSignalMonitor({ marketState, getWatchlists: getAllWatchlists, broadcast });

// Initialize vault service (private knowledge management)
initVault({
  openaiKey: process.env.OPENAI_API_KEY,
  voyageKey: process.env.VOYAGE_API_KEY,
  cohereKey: process.env.COHERE_API_KEY,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
});
logger.info('boot', `Vault init: openai=${!!process.env.OPENAI_API_KEY}, voyage=${!!process.env.VOYAGE_API_KEY}, cohere=${!!process.env.COHERE_API_KEY}, anthropic=${!!process.env.ANTHROPIC_API_KEY}`);

// Initialize memory manager service (two-tier conversation memory)
const memoryManager = require('./services/memoryManager');
memoryManager.startCleanupTimers();
logger.info('boot', 'Memory manager initialized with cleanup timers');

// Phase 5: Initialize typed conversation memory service
const conversationMemory = require('./services/conversationMemory');
conversationMemory.ensureTable().catch(() => {});
conversationMemory.startCleanupTimer();
logger.info('boot', 'Conversation memory service initialized');

// Phase 7: Initialize proactive insight engine
insightEngine.init({ anthropicKey: process.env.ANTHROPIC_API_KEY });
insightEngine.start();
logger.info('boot', 'Insight engine initialized and scanner started');

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
    // FAIL if JWT_SECRET is not set or is too short
    const jwtSecret = process.env.JWT_SECRET || '';
    if (!jwtSecret) {
      logger.error('boot', '[FATAL] PRODUCTION MODE: JWT_SECRET is required but not set.');
      logger.error('boot', '[FATAL] Go to Render Dashboard → senger-market-server → Environment and add JWT_SECRET (minimum 16 characters).');
      process.exit(1);
    }
    if (jwtSecret.length < 16) {
      logger.error('boot', '[FATAL] PRODUCTION MODE: JWT_SECRET must be at least 16 characters. Current length: ' + jwtSecret.length);
      logger.error('boot', '[FATAL] Use a strong, random 32+ character secret. Go to Render Dashboard and update JWT_SECRET.');
      process.exit(1);
    }
    // Warn if POLYGON_API_KEY is not configured
    if (!process.env.POLYGON_API_KEY) {
      logger.warn('boot', '[SECURITY] POLYGON_API_KEY is not set. Market data features will be unavailable or degraded.');
    }
    // Warn if STRIPE_WEBHOOK_SECRET is not configured
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      logger.warn('boot', '[SECURITY] STRIPE_WEBHOOK_SECRET is not set. Billing webhooks will not be processed. Set it in Render environment.');
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

  // Initialize vault signals background job (cross-user signal detection)
  try {
    const vaultSignalsJob = initVaultSignalsJob();
    vaultSignalsJob.start();
    logger.info('boot', 'Vault signals background job started');
  } catch (e) {
    logger.warn('boot', 'Vault signals job initialization failed', { error: e.message });
  }

  // W1.2: AI cost watchdog. Trips force_haiku at 80% of monthly budget,
  // block_all_ai at 100%. Reads AI_MONTHLY_BUDGET_CENTS (default 100000 = $1k).
  try {
    const { startBudgetWatchdog } = require('./services/aiCostLedger');
    startBudgetWatchdog();
    logger.info('boot', 'AI budget watchdog started');
  } catch (e) {
    logger.warn('boot', 'AI budget watchdog failed to start', { error: e.message });
  }

  const { initEmail } = require('./services/emailService');
  initEmail();

  // 2. Data stores (Postgres hydration first if connected, then MongoDB)
  const mongoDB = await initDB();  // connect MongoDB, load users into memory
  await initPortfolioDB(mongoDB);  // load portfolio data
  await initAlertDB(mongoDB);      // load alert data
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
    logger.info('boot', `Model Router: active | Routes: ${Object.keys(modelRouter?.ROUTE_MAP || {}).join(', ')}`);

    // 3. Start all background jobs (leaderboard, card cleanup, alert scheduler)
    initJobs({ port: PORT });
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info('boot', `${signal} received — shutting down`);
    stopJobs();
    anomalyScanner.stop();
    cache.destroy();
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
