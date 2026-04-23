/**
 * utils/logger.js — Structured JSON logging for observability.
 *
 * Phase 21: Upgraded from string-based to JSON-structured logs.
 * In production, emits one-line JSON per log event for machine parsing.
 * In development, emits human-readable format for convenience.
 *
 * W0.5: PII/secret redaction — strips sensitive keys (authorization, cookie,
 * password, token, apiKey, email, phone, etc.) from meta before emit.
 * Also scrubs JWT-looking tokens, credit-card-like digit strings, and
 * AWS-style access keys from string values.
 *
 * Every log includes: timestamp, level, context, message.
 * Optional fields: reqId, userId, route, durationMs, provider, cacheHit, fallbackUsed, error.
 */

'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const IS_PROD = process.env.NODE_ENV === 'production';

function shortId() { return Math.random().toString(36).slice(2, 10); }

// ── W1.5: AsyncLocalStorage correlation store ──────────────────────────────
// Every HTTP request runs inside als.run({ reqId, userId, route }) so any
// downstream code (services, DB wrappers, providers) that calls
// logger.info/warn/error automatically has its logs tagged with the request
// correlation id + authenticated user, without threading req through every
// function.  Also exposes helpers for code that wants the ids directly
// (e.g. audit trails, Sentry breadcrumbs).
const als = new AsyncLocalStorage();

/** Return the current context store, or null if outside an HTTP request. */
function getContext() {
  return als.getStore() || null;
}

/**
 * Run `fn` with the given context bound for the whole async subtree.
 * Used by requestLogger but also exported for background workers that want
 * to group their log lines under a synthetic correlation id.
 */
function withContext(ctx, fn) {
  return als.run({ ...ctx }, fn);
}

// -- PII / secret redaction ---------------------------------------------------

/**
 * Key names that should always be redacted regardless of value type.
 * Matched case-insensitively against any object key path component.
 */
const SENSITIVE_KEYS = new Set([
  'authorization', 'auth', 'cookie', 'cookies', 'set-cookie', 'setcookie',
  'x-api-key', 'xapikey', 'apikey', 'api_key', 'x-auth-token',
  'password', 'passwd', 'pwd', 'secret', 'token', 'refreshtoken',
  'refresh_token', 'accesstoken', 'access_token', 'idtoken', 'id_token',
  'jwt', 'sessionid', 'session_id',
  'ssn', 'cpf', 'cnpj', 'tax_id', 'taxid',
  'cardnumber', 'card_number', 'cvv', 'cvc', 'pan',
  'email', 'phone', 'phone_number',
  'stripe_signature', 'stripe-signature',
]);

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi;
const AWS_KEY_RE = /AKIA[0-9A-Z]{16}/g;
// Raw 13–19 digit sequence (credit-card candidates). We don't Luhn-check;
// we just redact conservatively because it's log output.
const CC_RE = /\b(?:\d[ -]?){13,19}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

function scrubString(s) {
  if (typeof s !== 'string') return s;
  if (s.length > 4000) s = s.slice(0, 4000) + '...[truncated]';
  return s
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(AWS_KEY_RE, '[REDACTED_AWS_KEY]')
    .replace(CC_RE, '[REDACTED_CC]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]');
}

function redact(value, depth = 0) {
  // Defensive cap on depth to avoid pathological cycles.
  if (depth > 6) return '[REDACTED_DEEP]';
  if (value == null) return value;

  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message || ''),
      // Stack is helpful but redact tokens that may be embedded
      stack: scrubString(value.stack || ''),
    };
  }

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(String(k).toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }

  return value;
}

/**
 * Core log emitter. Writes structured JSON in production, readable text in dev.
 */
function emit(level, ctx, msg, meta = {}) {
  const safeMeta = redact(meta);
  const safeMsg = typeof msg === 'string' ? scrubString(msg) : msg;

  // W1.5: pull correlation ids from the AsyncLocalStorage store so every
  // log line in a request scope carries reqId + userId automatically.
  const store = als.getStore();
  const correlation = {};
  if (store) {
    if (store.reqId   && !safeMeta.reqId)   correlation.reqId   = store.reqId;
    if (store.userId  && !safeMeta.userId)  correlation.userId  = store.userId;
    if (store.route   && !safeMeta.route)   correlation.route   = store.route;
  }

  const entry = {
    ts: new Date().toISOString(),
    level,
    ctx: ctx || 'app',
    msg: safeMsg || '',
    ...correlation,
    ...safeMeta,
  };

  // Remove undefined values
  for (const k of Object.keys(entry)) {
    if (entry[k] === undefined) delete entry[k];
  }

  if (IS_PROD) {
    // Machine-readable: one-line JSON
    const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
    fn(JSON.stringify(entry));
  } else {
    // Human-readable
    const metaStr = Object.keys(safeMeta).length > 0 ? ' ' + JSON.stringify(safeMeta) : '';
    const line = `${entry.ts} [${level}] [${entry.ctx}] ${entry.msg}${metaStr}`;
    if (level === 'ERROR') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
  }
}

const info  = (ctx, msg, meta) => emit('INFO', ctx, msg, meta);
const warn  = (ctx, msg, meta) => emit('WARN', ctx, msg, meta);
const error = (ctx, msg, meta) => emit('ERROR', ctx, msg, meta);

/**
 * Express request logger middleware.
 * Attaches reqId, logs request completion with timing.
 */
function requestLogger(req, res, next) {
  req.reqId = shortId();
  const start = Date.now();

  // Log on response finish (attached before als.run so it fires even if the
  // handler throws and we pop out of the ALS scope first).
  const onFinish = () => {
    const durationMs = Date.now() - start;
    // Capture the current userId at finish-time — it may have been set by
    // auth middleware AFTER requestLogger opened the scope.
    const meta = {
      reqId: req.reqId,
      method: req.method,
      path: req.originalUrl || req.path,
      status: res.statusCode,
      durationMs,
    };
    if (req.userId) meta.userId = req.userId;

    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    emit(level, 'http', `${req.method} ${req.originalUrl || req.path} ${res.statusCode} ${durationMs}ms`, meta);
  };
  res.on('finish', onFinish);

  // W1.5: run the rest of the request inside an ALS store so any
  // logger.info / logger.warn calls in downstream middleware, services,
  // and DB wrappers pick up reqId/userId/route automatically.
  const ctx = { reqId: req.reqId, userId: req.userId || null, route: null };
  als.run(ctx, () => {
    // Late-bind userId onto the ALS store when auth middleware sets req.userId.
    // We wrap next() so when subsequent middleware mutates req, the store
    // stays in sync for logs emitted from those middleware frames.
    res.on('close', () => {
      try { const s = als.getStore(); if (s && req.userId) s.userId = req.userId; } catch (_) { /* intentional: logger.als.late_userId — ALS store unavailable; nothing to correlate */ void _; }
    });
    next();
  });
}

/**
 * Middleware that keeps the ALS store's userId/route fields in sync with req
 * once downstream middleware (auth, route match) has populated them.
 * Safe to call multiple times; it's a pass-through refresh.
 */
function correlationSync(req, _res, next) {
  const s = als.getStore();
  if (s) {
    if (req.userId)          s.userId = req.userId;
    if (req.route?.path)     s.route  = req.route.path;
    else if (req.originalUrl) s.route = req.originalUrl;
  }
  next();
}

function reqId(req) { return req?.reqId || '--------'; }

module.exports = {
  info, warn, error,
  requestLogger, correlationSync, reqId,
  emit, redact,
  withContext, getContext,
};
