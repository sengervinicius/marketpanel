/**
 * mcp/tools/vault.js — R0.1 vault-group tool registrations.
 *
 * Group members:
 *   - search_vault  Semantic search over the user's personal Vault.
 *
 * Vault ingestion and retrieval pipelines are explicitly NOT modified
 * by R0.1. The MCP registry consumes Vault through this single tool
 * bridge exactly the way aiToolbox did before.
 */

'use strict';

const { registerAll } = require('./_bridge');

const NAMES = ['search_vault'];

function register(registry) {
  return registerAll(registry, NAMES.map(n => [n, 'vault']));
}

module.exports = { register, NAMES };
