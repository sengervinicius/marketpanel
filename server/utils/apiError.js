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

// code -> HTTP status
const STATUS_MAP = {
  bad_request:         400,
  unauthorized:        401,
  auth_error:          403,
  forbidden:           403,
  not_found:           404,
  gone:                410,
  rate_limit:          429,
  server_error:        500,
  upstream_error:      502,
  service_unavailable: 503,
};

// HTTP status -> stable code (reverse of the above, for the numeric-arg call style)
const CODE_FOR_STATUS = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  410: 'gone',
  429: 'rate_limit',
  500: 'server_error',
  502: 'upstream_error',
  503: 'service_unavailable',
};

/**
 * Send a consistent JSON error response.
 *
 * #291 W7.1 — supports BOTH call conventions used in the codebase:
 *   (1) sendApiError(res, err, context)             — err is an Error/ProviderError
 *   (2) sendApiError(res, statusCode, message)      — numeric status + human message
 *
 * Convention (2) is what ~166 route call sites actually use. Previously the
 * helper only understood (1), so a numeric second arg fell through to
 * code='server_error' / status=500 and the real message was demoted to the
 * `context` field — i.e. every client validation error was reported as a 500
 * and logged at ERROR. This restores correct status/code/message and tiers the
 * log level by status (4xx -> warn, 5xx -> error) to kill the ERROR spam.
 *
 * @param {import('express').Response} res
 * @param {Error|ProviderError|number} errOrStatus
 * @param {string} contextOrMessage — context (form 1) or message (form 2)
 */
function sendApiError(res, errOrStatus, contextOrMessage = '') {
  if (res.headersSent) {
    logger.warn('sendApiError called after headers sent', {
      detail: contextOrMessage,
      message: (errOrStatus && errOrStatus.message) || String(errOrStatus),
    });
    return;
  }

  let status, code, message, retryAfter = null, context = '';

  if (typeof errOrStatus === 'number') {
    // Form (2): (res, statusCode, message)
    status = errOrStatus;
    code = CODE_FOR_STATUS[status] || (status >= 500 ? 'server_error' : 'error');
    message = contextOrMessage || 'Request failed';
  } else {
    // Form (1): (res, err, context)
    const err = errOrStatus || {};
    code = err.code || 'server_error';
    status = STATUS_MAP[code] || 500;
    message = err.message || 'Internal server error';
    if (err.retryAfter != null) retryAfter = err.retryAfter;
    context = contextOrMessage || '';
  }

  const body = { ok: false, error: code, message };
  if (retryAfter != null) body.retryAfter = retryAfter;
  if (context) body.context = context;

  // Tier the log level by status so client (4xx) errors no longer flood ERROR.
  if (status >= 500) {
    logger.error(context || message, message, { code, status });
  } else {
    logger.warn(context || message || code, { code, status, message });
  }

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

module.exports = { ProviderError, sendApiError, errorHandler, STATUS_MAP, CODE_FOR_STATUS };
