/**
 * mcp/metrics.js — R0.1 Prometheus instruments for the MCP registry.
 *
 * We register two instruments onto the existing server/utils/metrics.js
 * registry so they show up on the same /metrics endpoint scraped by ops:
 *
 *   particle_mcp_tool_calls_total{tool, group, status}
 *     — Counter, bumped once per registry.call() return.
 *       status ∈ {ok, error, truncated}.
 *
 *   particle_mcp_tool_duration_seconds{tool, group}
 *     — Histogram, observed once per call.
 *       Buckets reused from db_query_duration: 5ms..10s.
 *
 * Fail-safe: if prom-client is absent we expose no-op shims, matching
 * the pattern in server/utils/metrics.js so the server still boots in
 * stripped-down test envs.
 */

'use strict';

const baseMetrics = require('../utils/metrics');

// Buckets match server/utils/metrics.js db_query_duration so ops dashboards
// can overlay MCP tool latency next to existing service latency.
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const noop = () => {};
const NOOP = { inc: noop, observe: noop, labels: () => NOOP };

let instruments = {
  enabled: false,
  mcp_tool_calls_total: NOOP,
  mcp_tool_duration_seconds: NOOP,
};

// prom-client: only attempt wiring when the base metrics registry is up.
if (baseMetrics.enabled && baseMetrics.registry) {
  try {
    const client = require('prom-client');
    instruments.mcp_tool_calls_total = new client.Counter({
      name: 'particle_mcp_tool_calls_total',
      help: 'MCP tool invocations by tool, group, and status (ok|error|truncated).',
      labelNames: ['tool', 'group', 'status'],
      registers: [baseMetrics.registry],
    });
    instruments.mcp_tool_duration_seconds = new client.Histogram({
      name: 'particle_mcp_tool_duration_seconds',
      help: 'MCP tool execution latency by tool and group.',
      labelNames: ['tool', 'group'],
      buckets: BUCKETS,
      registers: [baseMetrics.registry],
    });
    instruments.enabled = true;
  } catch (_) {
    // prom-client absent; keep no-op shims.
  }
}

function observeCall({ tool, group, status, durationSeconds }) {
  try {
    instruments.mcp_tool_calls_total.labels(tool, group, status).inc();
    instruments.mcp_tool_duration_seconds.labels(tool, group).observe(durationSeconds);
  } catch (_) {
    // Never let metric emission break a tool call.
  }
}

module.exports = { observeCall, instruments };
