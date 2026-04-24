/**
 * mcp/tools/_bridge.js — R0.1 helper to lift an existing aiToolbox tool
 * into an MCP registry entry.
 *
 * The canonical tool definitions + handlers live in
 * server/services/aiToolbox.js. We deliberately DO NOT duplicate those
 * JSON Schemas or function bodies here — duplication drifts, drift
 * hides bugs. Instead, the bridge reads the existing TOOLS array and
 * HANDLERS map and produces a registry-shaped object with a `group`
 * attached.
 *
 * If a name is missing from either TOOLS or HANDLERS, boot fails hard
 * so we notice during CI rather than at request time.
 */

'use strict';

const aiToolbox = require('../../services/aiToolbox');

function buildEntry(name, group) {
  const def = (aiToolbox.TOOLS || []).find(t => t.name === name);
  if (!def) {
    throw new Error(`mcp/bridge: no aiToolbox TOOLS entry named "${name}"`);
  }
  const handler = (aiToolbox.HANDLERS || {})[name];
  if (typeof handler !== 'function') {
    throw new Error(`mcp/bridge: no aiToolbox HANDLERS entry for "${name}"`);
  }
  return {
    name: def.name,
    group,
    description: def.description,
    input_schema: def.input_schema,
    execute: (args, ctx) => handler(args || {}, ctx || {}),
  };
}

/**
 * Register every (name → group) pair with the registry. Returns the
 * list of entries added, so group files can assert size in tests.
 */
function registerAll(registry, pairs) {
  const added = [];
  for (const [name, group] of pairs) {
    const entry = buildEntry(name, group);
    registry.register(entry);
    added.push(entry);
  }
  return added;
}

module.exports = { buildEntry, registerAll };
