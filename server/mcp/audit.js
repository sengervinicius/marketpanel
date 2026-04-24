/**
 * mcp/audit.js — R0.1 MCP tool-call audit trail.
 *
 * Writes one line per tool invocation:
 *   - structured-log line via logger.info('mcp', …) — always.
 *   - optional DB row insert into mcp_audit (migration ships in R0.1-b).
 *     Best-effort: a DB failure MUST NOT fail the tool call.
 *
 * The audit writer is fire-and-forget. registry.call() kicks it off and
 * returns immediately without awaiting.
 *
 * PII posture: we log argument KEYS and a truncated preview of values,
 * never full values. Tool arguments often include ticker strings (safe)
 * but also sometimes user queries (can contain PII); the 128-char cap
 * per value is the same rule search logs use.
 */

'use strict';

const logger = require('../utils/logger');

const MAX_ARG_PREVIEW_CHARS = 128;

function summariseArgs(args) {
  if (!args || typeof args !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (v == null) { out[k] = v; continue; }
    if (typeof v === 'string') {
      out[k] = v.length > MAX_ARG_PREVIEW_CHARS
        ? v.slice(0, MAX_ARG_PREVIEW_CHARS) + '…'
        : v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else {
      // Collapse arrays/objects to their shape.
      try {
        const s = JSON.stringify(v);
        out[k] = s.length > MAX_ARG_PREVIEW_CHARS
          ? s.slice(0, MAX_ARG_PREVIEW_CHARS) + '…'
          : s;
      } catch {
        out[k] = '[unserialisable]';
      }
    }
  }
  return out;
}

function write({ userId, tool, group, status, latencyMs, resultBytes, args }) {
  // 1. Structured log line — cheapest, always on.
  try {
    logger.info('mcp', 'tool.call', {
      userId: userId || null,
      tool,
      group,
      status,
      latencyMs,
      resultBytes: resultBytes ?? null,
      args: summariseArgs(args),
    });
  } catch (_) { /* never throw from audit */ }

  // 2. DB insert is enabled in R0.1-b once the mcp_audit table exists.
  //    Leaving the hook in place so the migration flip is a one-file change.
}

module.exports = { write, summariseArgs, MAX_ARG_PREVIEW_CHARS };
