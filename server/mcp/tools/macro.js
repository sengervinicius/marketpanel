/**
 * mcp/tools/macro.js — R0.1 macro-group tool registrations.
 *
 * Group members:
 *   - get_macro_snapshot   country-level CPI / policy rate / GDP / unemployment
 *   - get_brazil_macro     BCB series, specific to BR (SELIC, IPCA, cambial)
 *   - get_market_regime    risk-on/off regime classification
 *   - run_scenario         what-if scenario engine
 */

'use strict';

const { registerAll } = require('./_bridge');

const NAMES = [
  'get_macro_snapshot',
  'get_brazil_macro',
  'get_market_regime',
  'run_scenario',
  'lookup_series_global', // R1.1 DBnomics adapter
];

function register(registry) {
  return registerAll(registry, NAMES.map(n => [n, 'macro']));
}

module.exports = { register, NAMES };
