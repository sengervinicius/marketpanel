/**
 * mcp/tools/news.js — R0.1 news-group tool registrations.
 *
 * Group members:
 *   - get_recent_wire            Market wire / headline feed
 *   - web_research               Tavily search, SSRF-allow-listed
 *   - fetch_url                  single URL fetch, SSRF-allow-listed
 *   - search_prediction_markets  Kalshi + Polymarket aggregator
 */

'use strict';

const { registerAll } = require('./_bridge');

const NAMES = [
  'get_recent_wire',
  'web_research',
  'fetch_url',
  'search_prediction_markets',
];

function register(registry) {
  return registerAll(registry, NAMES.map(n => [n, 'news']));
}

module.exports = { register, NAMES };
