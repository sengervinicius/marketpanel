/**
 * mcp/contracts.js — R0.1 tool-shape validation + result envelopes.
 *
 * The registry accepts tools that look like:
 *
 *   {
 *     name:         string (non-empty, ^[a-z][a-z0-9_]*$)
 *     group:        string (must be a known group)
 *     description:  string (non-empty)
 *     input_schema: object (JSON Schema; kept identical to the existing
 *                           aiToolbox entries so Claude's tool-use API
 *                           reads them verbatim)
 *     output_hint?: string (optional one-line shape description)
 *     execute:      async (args, ctx) => result
 *   }
 *
 * We deliberately DO NOT introduce zod here (see README). JSON Schema is
 * what Claude's API consumes and what every existing tool already uses.
 *
 * Result envelope: execute() returns a plain, JSON-serialisable object.
 * Errors are RETURNED as { error: string }, not thrown. The registry
 * ALSO catches thrown errors and converts them to { error } to preserve
 * the existing dispatchTool() contract — so legacy handlers that throw
 * continue to work without modification.
 *
 * MAX_TOOL_PAYLOAD_BYTES is the same 12 KB cap the existing dispatcher
 * uses. Keep both in lockstep; a future commit can pull it into this
 * module and have aiToolbox import it from here.
 */

'use strict';

const { assertGroup } = require('./groups');

const MAX_TOOL_PAYLOAD_BYTES = 12 * 1024;
const NAME_RE = /^[a-z][a-z0-9_]*$/;

function assertTool(tool) {
  if (!tool || typeof tool !== 'object') {
    throw new Error('mcp: tool definition must be a non-null object');
  }
  const { name, group, description, input_schema: inputSchema, execute } = tool;
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`mcp: tool.name must match ${NAME_RE} (got ${JSON.stringify(name)})`);
  }
  if (typeof group !== 'string') {
    throw new Error(`mcp: tool.group must be a string (tool=${name})`);
  }
  assertGroup(group);
  if (typeof description !== 'string' || !description.trim()) {
    throw new Error(`mcp: tool.description required (tool=${name})`);
  }
  if (!inputSchema || typeof inputSchema !== 'object') {
    throw new Error(`mcp: tool.input_schema must be a JSON Schema object (tool=${name})`);
  }
  if (typeof execute !== 'function') {
    throw new Error(`mcp: tool.execute must be an async function (tool=${name})`);
  }
}

/**
 * Return a safe, truncated envelope if the result exceeds the payload
 * cap. Identical shape to the existing aiToolbox dispatcher so the
 * Anthropic tool-use loop sees no difference.
 */
function truncatedEnvelope(serialised) {
  return {
    truncated: true,
    originalBytes: serialised.length,
    note: `result truncated to ${MAX_TOOL_PAYLOAD_BYTES} bytes`,
    preview: serialised.slice(0, MAX_TOOL_PAYLOAD_BYTES),
  };
}

/**
 * Classify the result produced by execute() for metric/audit labelling.
 * Returns one of: 'ok' | 'error' | 'truncated'.
 */
function classify(result) {
  if (result && typeof result === 'object') {
    if (typeof result.error === 'string') return 'error';
    if (result.truncated === true) return 'truncated';
  }
  return 'ok';
}

module.exports = {
  MAX_TOOL_PAYLOAD_BYTES,
  assertTool,
  truncatedEnvelope,
  classify,
};
