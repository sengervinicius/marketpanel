/**
 * mcp/tools/compute.js — R0.1 compute-group tool registrations.
 *
 * Group members:
 *   - compute                    Sanity-check arithmetic
 *   - describe_portfolio_import  CSV canonical schema helper
 *
 * R2.2 + R2.3 will extend this group with HRP (skfolio) and GARCH
 * (arch) tools once those Python workers ship.
 */

'use strict';

const { registerAll } = require('./_bridge');

const NAMES = [
  'compute',
  'describe_portfolio_import',
];

function register(registry) {
  return registerAll(registry, NAMES.map(n => [n, 'compute']));
}

module.exports = { register, NAMES };
