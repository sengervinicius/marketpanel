/**
 * mcp/groups.js — R0.1 tool-group catalogue.
 *
 * Groups exist so persona agents (R0.3) and the node editor (R2.4) can
 * enumerate tools by purpose without hard-coding names. Every registered
 * tool MUST belong to exactly one group declared here.
 *
 * Adding a new group: add it to GROUPS, write a matching tools/<name>.js
 * file, register in server/mcp/index.js. No changes to existing tools.
 */

'use strict';

const GROUPS = Object.freeze({
  market: {
    name: 'market',
    description:
      'Real-time and end-of-day market data: equities, FX, commodities, ' +
      'fixed income, options flow, movers, forward estimates.',
  },
  macro: {
    name: 'macro',
    description:
      'Country-level macro series, market regime, scenario analysis.',
  },
  news: {
    name: 'news',
    description:
      'News feed, web research (Tavily), URL fetch, prediction markets.',
  },
  vault: {
    name: 'vault',
    description:
      'Retrieval-augmented search over the user\u2019s ingested research.',
  },
  earnings: {
    name: 'earnings',
    description:
      'Earnings calendar, SEC/CVM filings, transcripts (R3.1).',
  },
  compute: {
    name: 'compute',
    description:
      'Deterministic utilities: arithmetic sanity-check, portfolio import ' +
      'schema, and (R2.2/R2.3) HRP + GARCH once those ship.',
  },
});

const GROUP_NAMES = Object.freeze(Object.keys(GROUPS));

function assertGroup(name) {
  if (!GROUPS[name]) {
    throw new Error(`mcp: unknown group "${name}". Known: ${GROUP_NAMES.join(', ')}`);
  }
}

module.exports = { GROUPS, GROUP_NAMES, assertGroup };
