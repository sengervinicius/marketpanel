/**
 * mcp/registry.js — R0.1 internal MCP tool registry.
 *
 * A Map<name, tool> with:
 *   - register(tool): validate shape, store. Idempotent on deep-equal
 *     re-registration; throws on conflicting re-registration (fail-fast
 *     at boot).
 *   - list({ group? }): enumerate registered tools, optionally filtered.
 *   - call(name, args, ctx): wrap tool.execute() with try/catch, payload
 *     truncation, metrics, and audit. Return envelope IDENTICAL to the
 *     existing aiToolbox.dispatchTool() return shape so a later
 *     shadow-mode wiring (R0.1-b) can run both paths in parallel with
 *     a straight deep-equal check.
 *
 * The registry is intentionally instance-based (no singleton export).
 * server/mcp/index.js creates one instance, registers tools from every
 * group, and exports that single instance. A test file can build its
 * own instance with only a handful of fake tools without polluting the
 * module cache.
 */

'use strict';

const { assertTool, truncatedEnvelope, classify, MAX_TOOL_PAYLOAD_BYTES } = require('./contracts');
const metrics = require('./metrics');
const audit = require('./audit');

class Registry {
  constructor() {
    /** @type {Map<string, object>} */
    this._tools = new Map();
  }

  register(tool) {
    assertTool(tool);
    const existing = this._tools.get(tool.name);
    if (existing) {
      // Allow identical re-registration (hot-reload in dev). Disallow
      // mismatched re-registration — a silent override is how tool
      // behaviour diverges unexpectedly.
      if (existing === tool) return tool;
      throw new Error(
        `mcp: tool "${tool.name}" already registered with a different definition`,
      );
    }
    this._tools.set(tool.name, tool);
    return tool;
  }

  get(name) {
    return this._tools.get(name) || null;
  }

  list({ group } = {}) {
    const all = Array.from(this._tools.values());
    if (!group) return all;
    return all.filter(t => t.group === group);
  }

  size() {
    return this._tools.size;
  }

  /**
   * Public names-only list. Handy for persona-agent allow-lists.
   */
  names({ group } = {}) {
    return this.list({ group }).map(t => t.name);
  }

  /**
   * Invoke a tool. Returns a plain, JSON-serialisable envelope.
   *
   * Contract (identical to the existing aiToolbox.dispatchTool):
   *   - Unknown tool → { error: `unknown tool: ${name}` }
   *   - Handler throws → { error: <message> }
   *   - Handler returns successfully but serialises past the cap →
   *     { truncated: true, originalBytes, note, preview }
   *   - Otherwise → whatever the handler returned.
   *
   * ctx = { userId?: number|string } — passed through to the handler.
   */
  async call(name, args, ctx = {}) {
    const tool = this._tools.get(name);
    if (!tool) return { error: `unknown tool: ${name}` };

    const t0 = Date.now();
    let result;
    try {
      result = await tool.execute(args || {}, ctx || {});
    } catch (e) {
      result = { error: e?.message || 'tool threw' };
    }

    // Enforce payload cap. Same envelope shape as aiToolbox.dispatchTool
    // so downstream code reads { truncated, preview, … } the same way.
    let serialised;
    try {
      serialised = JSON.stringify(result);
      if (serialised && serialised.length > MAX_TOOL_PAYLOAD_BYTES) {
        result = truncatedEnvelope(serialised);
        serialised = JSON.stringify(result);
      }
    } catch (_) {
      // Non-serialisable handler output. Mirror the legacy behaviour:
      // let JSON.stringify throw upstream when the tool-loop packs it.
      // We still record a call with status=error for observability.
      result = { error: 'non-serialisable tool result' };
      serialised = JSON.stringify(result);
    }

    const latencyMs = Date.now() - t0;
    const status = classify(result);

    metrics.observeCall({
      tool: name,
      group: tool.group,
      status,
      durationSeconds: latencyMs / 1000,
    });

    // Audit write is fire-and-forget.
    audit.write({
      userId: ctx.userId,
      tool: name,
      group: tool.group,
      status,
      latencyMs,
      resultBytes: serialised ? serialised.length : null,
      args,
    });

    return result;
  }
}

module.exports = { Registry };
