# Senger Market Terminal — Backend Architecture

## Overview

A Node.js/Express real-time market data terminal serving multi-asset quotes, charts, macroeconomic data, debt curves, and chat. The backend aggregates data from 10+ public APIs and financial data providers, caches intelligently to avoid rate limits, and streams real-time quotes via WebSocket.

**Stack:** Node.js (ES6), Express, MongoDB (persistence), WebSocket (Polygon.io proxy), bcryptjs (auth), Stripe (billing).

---

## Directory Structure

```
server/
├── index.js                          Express app, middleware, WS bootstrap
├── authMiddleware.js                 JWT verification, subscription checks
├── auth.js                           Password reset, Apple Sign In
├── authStore.js                      User store (MongoDB write-through cache)
├── chatStore.js                      Chat messages (in-memory, Postgres TODO)
├── cache.js                          LRU cache for Yahoo Finance (2000 entries, 60s TTL)
├── polygonProxy.js                   Polygon.io WebSocket → client WS
├── types.js                          Shared TypeScript definitions (Quote, Chart, etc.)
├── subscriptions.json                Feature tier mappings
│
├── routes/
│   ├── market.js                     /api/market/* — quotes, charts, search, fundamentals
│   ├── macro.js                      /api/macro/* — fed funds, unemployment, inflation
│   ├── debt.js                       /api/debt/* — yield curves, credit spreads
│   ├── instruments.js                /api/instruments/* — watchlist, alerts
│   ├── chat.js                       /api/chat/* — messages, presence
│   ├── settings.js                   /api/settings/* — user preferences (prototype pollution safe)
│   ├── users.js                      /api/users/* — profile, subscription
│   ├── billing.js                    /api/billing/* — Stripe checkout, webhook
│   └── auth.js / authRoutes.js       /api/auth/* — register, login, verify, Apple Sign In
│
├── providers/                        Data abstraction layers
│   ├── marketProvider.js             Canonical Quote interface (Yahoo, Polygon, Finnhub, AV)
│   ├── macroProvider.js              FRED, BCB, ECB, Yahoo Finance wrappers
│   ├── debtProvider.js               Yield curves (FRED, ECB SDW, Tesouro Direto, BoE)
│   ├── multiAssetProvider.js         History/chart aggregation
│   ├── bondsProvider.js              Corporate bond search
│   ├── fundsProvider.js              Mutual fund & ETF data
│   ├── fred.js                       FRED API client (rate limit: 120 req/min)
│   └── eulerpool.js                  European stock exchange data (fallback API key)
│
├── utils/
│   ├── validate.js                   Hand-rolled: isTicker, isCountryCode, sanitizeText, parseTickerList
│   ├── apiError.js                   ProviderError class, sendApiError, errorHandler middleware
│   └── logger.js                     Structured logging (info/warn/error), requestLogger middleware
│
└── stores/ (future)
    └── instrumentStore.js            Watchlist, alerts (Postgres TODO)
```

---

## Data Providers

| Provider | Purpose | Auth | Rate Limit | Notes |
|----------|---------|------|-----------|-------|
| **Yahoo Finance** | Quotes, charts, fundamentals, search | Crumb + cookie | 2k req/min | Primary; 2 query hosts for stability |
| **Polygon.io** | Charts, news, search, ticker metadata, mkt status | API key | 5 calls/min free | Real-time WS stream (polygonProxy.js) |
| **Finnhub** | Quote fallback | API key | 60 req/min | Free tier; used if Yahoo is rate-limited |
| **Alpha Vantage** | Quote fallback | API key | 25 req/day | Last resort for stocks |
| **Eulerpool** | European equities (.DE, .L, .PA, .F, .AS, .MC) | Optional API key | Varies | XETRA, LSE, Euronext data |
| **FRED** | Fed Funds rate, credit spreads, US yields | API key (demo) | 120 req/min | Federal Reserve Economic Data |
| **ECB SDW** | Euro area AAA/AA yield curves | None | Unmetered | Statistical Data Warehouse; CSV import |
| **Tesouro Direto** | Brazilian government bonds, DI curve | None | Unmetered | B3 data; CSV/JSON scrape |
| **BCB** | SELIC rate (Brazil) | None | Unmetered | Central Bank of Brazil |
| **US Treasury** | Yield curve (10Y, 5Y, 2Y, 3M) | None | Unmetered | XML feed |
| **Bank of England** | UK yield curve | None | Unmetered | CSV download |

---

## Caching Strategy

### Two-Tier Approach

**Tier 1: LRU Cache (cache.js)**
- Deduplicates concurrent Yahoo Finance requests for the same symbol
- Max 2000 entries; 60s default TTL; 5-min stale window
- Stats: hits, misses, stale served, rate-limited tracked
- 5-min cleanup interval (configurable)

**Tier 2: TTL Map (_ttlCache in market.js)**
- Per-data-type TTLs (stocks 10s, forex 10s, crypto 10s, news 60s, chart 30s, yields 60s, etf 30s)
- In-route caching for Polygon and fallback providers
- Reduces redundant provider calls within same request batch

### Cleanup
- Auto-expires entries; manual eviction on rate-limit errors (serve stale instead of failing)

---

## Authentication & Authorization

**JWT-based with MongoDB persistence:**
- Passwords hashed with bcryptjs (12 rounds, PBKDF2-like security)
- JWT tokens issued on login (30-day expiry; refresh token in `authStore.js` TODO)
- `authMiddleware.js`: JWT verification, `requireAuth()`, `requireActiveSubscription()`
- **Apple Sign In:** OIDC flow, maps `sub` claim to `apple_user_id` in user doc
- **MongoDB write-through:** Every user mutation (create, settings update, subscription change) also persists to MongoDB
- **In-memory fallback:** If `MONGODB_URI` not set, uses in-memory Maps (dev mode)

---

## Real-Time Pipeline (WebSocket)

1. **Polygon.io WS** connects on server start (`connectPolygon()`)
2. **polygonProxy.js** forwards `{T:'Q', sym, p, lv, t}` to subscribed clients
3. **index.js WS handler** receives client subscriptions, syncs to Polygon feed
4. **Chat & Presence:** Typing indicators, "X is online" messages broadcast via same WS
5. Client reconnection: auto-resubscribe to saved symbols

---

## Error Handling

**Centralized via ProviderError and apiError.js:**

- **ProviderError** wraps vendor errors with code + retryAfter
- **Error codes & HTTP status:**
  - `rate_limit` → 429 (with Retry-After header)
  - `auth_error` → 403 (bad API key)
  - `not_found` → 404 (invalid symbol)
  - `bad_request` → 400 (malformed params)
  - `upstream_error` → 502 (vendor error)
  - `server_error` → 500

- **sendApiError(res, err, context)** returns consistent JSON: `{ ok: false, error: code, message }`
- **errorHandler middleware** catches unhandled throws and formats response
- **Stale-while-revalidate:** On rate-limit, serves cached data instead of failing

---

## Input Validation

**Hand-rolled (no external deps) in validate.js:**

- `isTicker(symbol)` — uppercase alphanumeric + special chars (.=-)
- `isCountryCode(code)` — ISO 3166-1 alpha-2 (US, DE, GB, etc.)
- `isUserId(id)` — UUID or hex string format
- `sanitizeText(str)` — whitelist: alphanumeric, space, dash, underscore
- `parseTickerList(str)` — split, trim, validate each
- `clampInt(val, min, max)` — enforce numeric bounds
- `validateBody(obj, schema)` — simple key/type checks
- **Prototype pollution protection:** settings.js strips `__proto__`, `constructor`

---

## Logging

**Structured (logger.js):**

- `logger.info(message, context)` — request IDs, user ID, endpoint
- `logger.warn(message, context)` — rate limits, fallback triggers
- `logger.error(message, context)` — exceptions, upstream failures
- **requestLogger middleware** — logs every HTTP request (method, URL, status, response time)
- All logs include timestamp, context tags

---

## Database

**Current:** MongoDB (users, chat) + in-memory Maps (fast sync reads)
- On startup, `initDB()` loads all users into RAM
- Every write flushes to MongoDB immediately (write-through)
- If `MONGODB_URI` not set, falls back to pure in-memory

**Future:** Postgres (schema stubs in authStore.js, chatStore.js, instrumentStore.js)
- Planned migration for instrument store (watchlists, alerts)
- No breaking change; new features can adopt Postgres first

---

## Billing (Stripe)

- **routes/billing.js** handles checkout sessions, customer portal redirects
- Webhook verification via `STRIPE_WEBHOOK_SECRET`
- Subscription state synced to user doc
- `subscriptions.json` maps plans to feature tiers

---

## Known TODOs

Run `grep -r "TODO" server/ --include="*.js"` to see all:

- `authStore.js`: Postgres schema + refresh token rotation
- `chatStore.js`: Postgres schema for multi-tenant chat
- `marketProvider.js`: Migrate vendor-specific fetch logic from routes/market.js
- `routes/market.js`: Request-level timeouts, per-user rate limiting, configurable TTLs
- `routes/users.js`: Multi-tenant org filtering (Phase 5)
- `routes/chat.js`: Real-time WS integration, spam rate limiting, org scoping

---

**Last Updated:** 2026-03-31 | **Server Version:** Check package.json
