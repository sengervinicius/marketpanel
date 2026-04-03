'use strict';

const logger = require('./logger');

/**
 * Standardized provider/API error.
 * Tracks error code and optional retryAfter for rate limits.
 */
class ProviderError extends Error {
  constructor(message, code = 'server_error', retryAfter = null) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;           // 'rate_limit' | 'auth_error' | 'not_found' | 'upstream_error' | 'server_error'
    this.retryAfter = retryAfter;
  }
}

const STATUS_MAP = {
  rate_limit:     429,
  auth_error:     403,
  not_found:      404,
  bad_request:    400,
  upstream_error: 502,
  server_error:   500,
};

/**
 * Send a consistent JSON error response.
 * @param {import('express').Response} res
 * @param {Error} err
 * @param {string} context — e.g. '/api/snapshot/stocks'
 */
function sendApiError(res, err, context = '') {
  if (res.headersSent) {
    logger.warn('sendApiError called after headers sent', { context, message: err.message });
    return;
  }
  const code = err.code || 'server_error';
  const status = STATUS_MAP[code] || 500;
  const body = {
    ok: false,
    error: code,
    message: err.message || 'Internal server error',
  };
  if (err.retryAfter != null) body.retryAfter = err.retryAfter;
  if (context) body.context = context;
  if (context) logger.error(context, err.message, { code, status });
  return res.status(status).json(body);
}

/**
 * Express error handler middleware (last middleware in chain).
 */
function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    logger.warn('errorHandler: headers already sent', { path: req.path, message: err.message });
    return;
  }
  logger.error('unhandled', err.message, { path: req.path, reqId: req.reqId });
  return sendApiError(res, err, req.path);
}

module.exports = { ProviderError, sendApiError, errorHandler };
