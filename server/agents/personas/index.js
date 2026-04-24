/**
 * personas/index.js — R0.3 persona catalogue.
 *
 * Each persona is validated at load time (sanity on shape). Exports
 * the map and a public-summary serialiser for the client-facing
 * /api/personas list endpoint.
 */

'use strict';

const buffett = require('./buffett');
const graham  = require('./graham');
const lynch   = require('./lynch');
const munger  = require('./munger');
const klarman = require('./klarman');
const marks   = require('./marks');

const ALL = [buffett, graham, lynch, munger, klarman, marks];

function validatePersona(p) {
  const need = ['id', 'name', 'method_doc_url', 'one_liner', 'system_prompt', 'rubric', 'required_tools'];
  for (const key of need) {
    if (p[key] == null || (typeof p[key] === 'string' && !p[key].trim())) {
      throw new Error(`persona "${p.id || '??'}" missing field: ${key}`);
    }
  }
  if (!Array.isArray(p.required_tools) || p.required_tools.length === 0) {
    throw new Error(`persona "${p.id}" required_tools must be non-empty array`);
  }
  if (!p.rubric || !Array.isArray(p.rubric.dimensions) || p.rubric.dimensions.length === 0) {
    throw new Error(`persona "${p.id}" rubric.dimensions must be non-empty array`);
  }
  const sum = p.rubric.dimensions.reduce((a, d) => a + Number(d.weight || 0), 0);
  if (Math.abs(sum - 1) > 0.01) {
    throw new Error(`persona "${p.id}" rubric weights sum to ${sum.toFixed(3)}, expected 1.0`);
  }
}

for (const p of ALL) validatePersona(p);

const BY_ID = Object.freeze(Object.fromEntries(ALL.map(p => [p.id, p])));

/**
 * Public summary — the shape the client persona picker receives.
 * Deliberately excludes the full system_prompt (large; not needed
 * client-side, and we don't want to surface raw prompts in the UI).
 */
function publicSummary(p) {
  return {
    id: p.id,
    name: p.name,
    era: p.era,
    one_liner: p.one_liner,
    lens: p.lens,
    method_doc_url: p.method_doc_url,
    rubric_dimensions: p.rubric.dimensions.map(d => ({ name: d.name, weight: d.weight })),
    required_tools: p.required_tools,
  };
}

function list() {
  return ALL.map(publicSummary);
}

function get(id) {
  return BY_ID[id] || null;
}

module.exports = { ALL, BY_ID, list, get, publicSummary, validatePersona };
