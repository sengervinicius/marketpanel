/**
 * utils/logger.js — Structured JSON logging for observability.
 *
 * Phase 21: Upgraded from string-based to JSON-structured logs.
 * In production, emits one-line JSON per log event for machine parsing.
 * In development, emits human-readable format for convenience.
 *
 * Every log includes: timestamp, level, context, message.
 * Optional fields: reqId, userId, route, durationMs, provider, cacheHit, fallbackUsed, error.
 */

'use strict';

const IS_PROD = process.env.NODE_ENV === 'production';

function shortId() { return Math.random().toString(36).slice(2, 10); }

/**
 * Core log emitter. Writes structured JSON in production, readable text in dev.
 */
function emit(level, ctx, msg, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    ctx: ctx || 'app',
    msg: msg || '',
    ...meta,
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
    const metaStr = Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
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

  // Log on response finish
  const onFinish = () => {
    const durationMs = Date.now() - start;
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
  next();
}

function reqId(req) { return req?.reqId || '--------'; }

module.exports = { info, warn, error, requestLogger, reqId, emit };
