/**
 * server/adapters/registry.js
 * ─────────────────────────────────────────────────────────────────────
 * Singleton AdapterRegistry for the server. Registers every concrete
 * adapter at first use. The quality harness and the router both call
 * getRegistry() and then .get(name) or .route(market, assetClass, cap).
 *
 * Adapter registration is order-independent; route() uses the declared
 * confidence to build the chain. To add a new adapter, require it here
 * and call registry.register(adapter).
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

const { AdapterRegistry } = require('./contract');

let _registry = null;

function buildRegistry() {
  const registry = new AdapterRegistry();

  // Wave 1 adapters
  registry.register(require('./polygonAdapter'));

  // Wave 2 adapters
  registry.register(require('./finnhubAdapter'));

  // Wave 6 adapters
  //   - ecbSdmxAdapter: EU AAA sovereign curve, no API key required
  registry.register(require('./ecbSdmxAdapter'));

  // Wave 7 corrective adapters
  //   - asianRssAdapter: Nikkei Asia / SCMP / KED Global news feeds
  //     for TSE / HKEX / KRX equities. Closes v2-audit line
  //     "canonical NewsEvent parsers for Nikkei, Korea Economic
  //     Daily, SCMP".
  registry.register(require('./asianRssAdapter'));

  // Future (stubbed imports — uncomment as each adapter lands):
  // registry.register(require('./twelvedataAdapter'));
  // registry.register(require('./eulerpoolAdapter'));
  // registry.register(require('./unusualWhalesAdapter'));
  // registry.register(require('./sonarAdapter'));
  // registry.register(require('./fredAdapter'));

  return registry;
}

/**
 * Returns (and lazily constructs) the process-wide registry.
 * @returns {AdapterRegistry}
 */
function getRegistry() {
  if (!_registry) _registry = buildRegistry();
  return _registry;
}

module.exports = { getRegistry };
