/**
 * utils/metrics.js — W1.4 Prometheus metrics.
 *
 * Exposes a prom-client registry with the counters/gauges/histograms we
 * need to hit the SLOs defined in docs/SLOs.md. The /metrics endpoint is
 * wired from server/index.js behind an IP allow-list so the scraper can
 * reach it but anonymous browsers cannot.
 *
 * Fail-safe: if prom-client is not installed we export no-op shims so the
 * server still boots. The npm dependency was added in W1.4; on a stale
 * install the feature silently degrades rather than crashing.
 */

'use strict';

let client = null;
try { client = require('prom-client'); } catch (_) { /* optional at runtime */ }

// No-op shim used when prom-client is absent.
const noop = () => {};
const NOOP = {
  inc: noop, dec: noop, set: noop, observe: noop,
  startTimer: () => () => 0,
  labels: () => NOOP,
};

let registry = null;
const metrics = {
  enabled: false,
  registry: null,
  http_requests_total:     NOOP,
  http_request_duration:   NOOP,
  http_in_flight:          NOOP,
  ws_connections_open:     NOOP,
  ws_messages_sent:        NOOP,
  ws_messages_dropped:     NOOP,
  ws_buffered_amount_peak: NOOP,
  db_query_duration:       NOOP,
  db_query_errors:         NOOP,
  db_pool_in_use:          NOOP,
  ai_calls_total:          NOOP,
  ai_tokens_total:         NOOP,
  ai_cost_cents_total:     NOOP,
  ai_monthly_spend_cents:  NOOP,
  ai_kill_switch_state:    NOOP,
  // #251 P3.2 — central provider budget metrics
  provider_requests_total:      NOOP,
  provider_rate_limited_total:  NOOP,
  provider_budget_remaining:    NOOP,
  provider_budget_used_pct:     NOOP,
};

if (client) {
  registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry, prefix: 'particle_' });

  metrics.http_requests_total = new client.Counter({
    name: 'particle_http_requests_total',
    help: 'HTTP requests by route, method, and response class.',
    labelNames: ['route', 'method', 'status'],
    registers: [registry],
  });
  metrics.http_request_duration = new client.Histogram({
    name: 'particle_http_request_duration_seconds',
    help: 'Express request duration per route.',
    labelNames: ['route', 'method', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
  });
  metrics.http_in_flight = new client.Gauge({
    name: 'particle_http_in_flight',
    help: 'Currently in-flight HTTP requests.',
    registers: [registry],
  });

  metrics.ws_connections_open = new client.Gauge({
    name: 'particle_ws_connections_open',
    help: 'Open WebSocket connections.',
    registers: [registry],
  });
  metrics.ws_messages_sent = new client.Counter({
    name: 'particle_ws_messages_sent_total',
    help: 'Outbound WebSocket messages successfully sent.',
    registers: [registry],
  });
  metrics.ws_messages_dropped = new client.Counter({
    name: 'particle_ws_messages_dropped_total',
    help: 'Outbound WebSocket messages dropped/terminated due to backpressure.',
    registers: [registry],
  });
  metrics.ws_buffered_amount_peak = new client.Gauge({
    name: 'particle_ws_buffered_amount_peak_bytes',
    help: 'Peak per-socket outbound buffer observed this scrape interval.',
    registers: [registry],
  });

  metrics.db_query_duration = new client.Histogram({
    name: 'particle_db_query_duration_seconds',
    help: 'Postgres query duration by labeled query-kind.',
    labelNames: ['kind'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });
  metrics.db_query_errors = new client.Counter({
    name: 'particle_db_query_errors_total',
    help: 'Postgres query errors by labeled query-kind.',
    labelNames: ['kind', 'code'],
    registers: [registry],
  });
  metrics.db_pool_in_use = new client.Gauge({
    name: 'particle_db_pool_in_use',
    help: 'Postgres connections checked out from the pool.',
    registers: [registry],
  });

  metrics.ai_calls_total = new client.Counter({
    name: 'particle_ai_calls_total',
    help: 'AI provider calls by model and tier.',
    labelNames: ['model', 'tier', 'outcome'],
    registers: [registry],
  });
  metrics.ai_tokens_total = new client.Counter({
    name: 'particle_ai_tokens_total',
    help: 'AI tokens billed by model and direction.',
    labelNames: ['model', 'direction'],
    registers: [registry],
  });
  metrics.ai_cost_cents_total = new client.Counter({
    name: 'particle_ai_cost_cents_total',
    help: 'AI cost in cents by model and tier.',
    labelNames: ['model', 'tier'],
    registers: [registry],
  });
  metrics.ai_monthly_spend_cents = new client.Gauge({
    name: 'particle_ai_monthly_spend_cents',
    help: 'Month-to-date org-wide AI spend in cents.',
    registers: [registry],
  });
  metrics.ai_kill_switch_state = new client.Gauge({
    name: 'particle_ai_kill_switch_state',
    help: '1 when a kill-switch is active (force_haiku or block_all_ai), else 0.',
    labelNames: ['kind'],
    registers: [registry],
  });

  // #251 P3.2 — central provider budget observability
  metrics.provider_requests_total = new client.Counter({
    name: 'particle_provider_requests_total',
    help: 'Upstream market-data provider requests by outcome.',
    labelNames: ['provider', 'outcome'],
    registers: [registry],
  });
  metrics.provider_rate_limited_total = new client.Counter({
    name: 'particle_provider_rate_limited_total',
    help: 'Upstream market-data provider 429s.',
    labelNames: ['provider'],
    registers: [registry],
  });
  metrics.provider_budget_remaining = new client.Gauge({
    name: 'particle_provider_budget_remaining',
    help: 'Remaining requests in the declared provider budget window.',
    labelNames: ['provider'],
    registers: [registry],
  });
  metrics.provider_budget_used_pct = new client.Gauge({
    name: 'particle_provider_budget_used_pct',
    help: 'Fraction of the declared provider budget window consumed [0,1].',
    labelNames: ['provider'],
    registers: [registry],
  });

  metrics.enabled = true;
  metrics.registry = registry;
}

/**
 * Express middleware that labels each request with its route template (not
 * the full URL with IDs in it) and records count + duration + in-flight.
 * Attach near the top of the middleware stack, after `req.id` is set by
 * requestLogger so traces can be joined on reqId.
 */
function metricsMiddleware(req, res, next) {
  if (!metrics.enabled) return next();
  const start = process.hrtime.bigint();
  metrics.http_in_flight.inc();
  res.on('finish', () => {
    metrics.http_in_flight.dec();
    // Express populates req.route.path on match; unknown paths roll up as "other".
    const route = (req.route?.path) || (req.baseUrl && req.path ? req.baseUrl + req.path : 'other');
    const method = req.method || 'GET';
    const status = String(res.statusCode);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
    try {
      metrics.http_requests_total.labels(route, method, status).inc();
      metrics.http_request_duration.labels(route, method, status).observe(elapsed);
    } catch (_) { /* labels threw */ }
  });
  next();
}

/**
 * Express handler for /metrics. Returns Prometheus text-exposition format.
 * The caller should mount this behind an auth/IP allow-list.
 */
async function metricsHandler(req, res) {
  if (!metrics.enabled || !registry) {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(503).send('# metrics disabled\n');
  }
  try {
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (e) {
    res.setHeader('Content-Type', 'text/plain');
    res.status(500).send(`# error: ${e.message}\n`);
  }
}

module.exports = {
  metrics,
  metricsMiddleware,
  metricsHandler,
};
