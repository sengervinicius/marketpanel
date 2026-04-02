/**
 * middleware/requestTimeout.js — Per-route request timeout guard.
 *
 * Aborts the response with a consistent timeout error if the route handler
 * doesn't respond within the configured time. Also attaches an AbortController
 * to req so upstream fetches can be cancelled.
 */

'use strict';

/**
 * Create a request timeout middleware.
 * @param {number} ms - timeout in milliseconds (default 15000)
 */
function requestTimeout(ms = 15000) {
  return (req, res, next) => {
    // Attach AbortController for upstream fetch cancellation
    const controller = new AbortController();
    req.abortController = controller;
    req.abortSignal = controller.signal;

    const timer = setTimeout(() => {
      controller.abort();
      if (!res.headersSent) {
        res.status(504).json({
          ok: false,
          error: 'upstreamerror',
          message: 'Request timed out',
        });
      }
    }, ms);

    // Clean up timer on response finish
    const cleanup = () => clearTimeout(timer);
    res.on('finish', cleanup);
    res.on('close', cleanup);

    next();
  };
}

module.exports = { requestTimeout };
