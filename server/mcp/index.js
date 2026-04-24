/**
 * mcp/index.js — R0.1 entry point.
 *
 * Creates a single Registry instance, registers every group's tools,
 * and exports the instance. `server/index.js` (or any consumer) simply
 * requires this module; the registry is ready to call.
 *
 * Registration is synchronous and idempotent — boot order cannot cause
 * a missing-tool error. If any group fails to wire (e.g. bridge can't
 * find a TOOLS entry it expected), boot throws early with a clear
 * message. Better to fail CI than to ship a silently-missing tool.
 */

'use strict';

const { Registry } = require('./registry');

const marketGroup   = require('./tools/market');
const macroGroup    = require('./tools/macro');
const newsGroup     = require('./tools/news');
const vaultGroup    = require('./tools/vault');
const earningsGroup = require('./tools/earnings');
const computeGroup  = require('./tools/compute');

function createDefaultRegistry() {
  const registry = new Registry();
  marketGroup.register(registry);
  macroGroup.register(registry);
  newsGroup.register(registry);
  vaultGroup.register(registry);
  earningsGroup.register(registry);
  computeGroup.register(registry);
  return registry;
}

// Lazy — build on first require so tests that stub modules have a
// chance to do so before the registry snapshots handlers.
let _default = null;
function getDefault() {
  if (!_default) _default = createDefaultRegistry();
  return _default;
}

module.exports = {
  createDefaultRegistry,
  getDefault,
  // Re-exports for convenience — let callers do
  //   const { registry, Registry } = require('server/mcp');
  get registry() { return getDefault(); },
  Registry,
  groups: {
    market: marketGroup,
    macro: macroGroup,
    news: newsGroup,
    vault: vaultGroup,
    earnings: earningsGroup,
    compute: computeGroup,
  },
};
