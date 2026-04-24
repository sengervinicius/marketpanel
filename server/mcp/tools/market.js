/**
 * mcp/tools/market.js — R0.1 market-group tool registrations.
 *
 * Imports from the canonical server/services/aiToolbox catalogue via
 * the bridge helper. No duplication of JSON Schemas or handlers.
 *
 * Group members:
 *   - lookup_quote          equities/ETFs/crypto/FX spot lookups
 *   - get_yield_curve       sovereign curves
 *   - list_sovereign_bonds  individual sovereigns
 *   - list_corporate_bonds  corporate bond screen
 *   - get_options_flow      unusual options activity
 *   - list_market_movers    gainers/losers/actives
 *   - lookup_fx             FX pair spot (BCB PTAX + live)
 *   - lookup_commodity      oil, gold, soy, …
 *   - forward_estimates     consensus fwd estimates
 */

'use strict';

const { registerAll } = require('./_bridge');

const NAMES = [
  'lookup_quote',
  'get_yield_curve',
  'list_sovereign_bonds',
  'list_corporate_bonds',
  'get_options_flow',
  'list_market_movers',
  'lookup_fx',
  'lookup_commodity',
  'forward_estimates',
];

function register(registry) {
  return registerAll(registry, NAMES.map(n => [n, 'market']));
}

module.exports = { register, NAMES };
