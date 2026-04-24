/**
 * mcp/tools/earnings.js — R0.1 earnings-group tool registrations.
 *
 * Group members:
 *   - get_earnings_calendar  Upcoming + recent earnings prints
 *   - list_cvm_filings       CVM (Brazilian SEC) IPE filings
 *
 * R3.1 will extend this group with insider transactions (EDGAR) and
 * earnings transcripts once those providers land.
 */

'use strict';

const { registerAll } = require('./_bridge');

const NAMES = [
  'get_earnings_calendar',
  'list_cvm_filings',
];

function register(registry) {
  return registerAll(registry, NAMES.map(n => [n, 'earnings']));
}

module.exports = { register, NAMES };
