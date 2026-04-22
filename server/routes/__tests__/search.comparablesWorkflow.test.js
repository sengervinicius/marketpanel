/**
 * search.comparablesWorkflow.test.js — pins the tool-augmented system
 * prompt's rules 19 (WEB RESEARCH) and 20 (COMPARABLES & KPI RATIOS).
 *
 * Background: on 2026-04-22 Particle AI refused a legitimate HTZ / CAR /
 * RENT3 / MOVI3 price-to-fleet comparables question. Root cause was
 * mechanical — the AI had no orchestration pattern for "call quote for
 * each ticker, reach for a primary source on the denominator, compute,
 * present as a table." #211 wrote that workflow into the tool-augmented
 * prompt. This test pins the critical markers so a future refactor
 * can't quietly drop them and regress the behaviour.
 *
 * Same approach as search.coverageGaps.test.js: scrape the source file
 * for required phrases; no Express boot, no network.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const searchSrc = fs.readFileSync(
  path.join(__dirname, '..', 'search.js'),
  'utf8',
);

// ── Rule 19: WEB RESEARCH ────────────────────────────────────────────
assert.ok(
  /19\.\s*WEB RESEARCH/i.test(searchSrc),
  'rule 19 must exist and be titled WEB RESEARCH',
);
assert.ok(
  /web_research/.test(searchSrc) && /fetch_url/.test(searchSrc),
  'rule 19 must reference both web_research and fetch_url by tool name',
);
assert.ok(
  /fleet\s*size|store\s*count|subscriber|ARR|AUM|headcount/i.test(searchSrc),
  'rule 19 must list non-financial KPI examples so the model knows when to reach for it',
);
assert.ok(
  /50\s*web_research|100\s*fetch_url|quota/i.test(searchSrc),
  'rule 19 must mention the daily quota caps so the model budgets calls',
);
assert.ok(
  /TAVILY_API_KEY|web research not configured/i.test(searchSrc),
  'rule 19 must tell the model how to interpret the "not configured" error',
);

// ── Rule 20: COMPARABLES & KPI RATIOS ────────────────────────────────
assert.ok(
  /20\.\s*COMPARABLES/i.test(searchSrc),
  'rule 20 must exist and be titled COMPARABLES',
);
assert.ok(
  /KPI\s*RATIOS?/i.test(searchSrc),
  'rule 20 must frame the workflow as KPI ratios',
);

// The five-step workflow — each step must be named.
assert.ok(/STEP\s*A/.test(searchSrc), 'rule 20 must define STEP A (parallel quote pulls)');
assert.ok(/STEP\s*B/.test(searchSrc), 'rule 20 must define STEP B (read coverage flags)');
assert.ok(/STEP\s*C/.test(searchSrc), 'rule 20 must define STEP C (fetch non-financial KPI)');
assert.ok(/STEP\s*D/.test(searchSrc), 'rule 20 must define STEP D (compute ratio)');
assert.ok(/STEP\s*E/.test(searchSrc), 'rule 20 must define STEP E (present as table)');

// Parallel (not sequential) emphasis — this is what the incident broke on.
assert.ok(
  /parallel|SINGLE\s+tool-use\s+round|batch,\s*not\s+sequential/i.test(searchSrc),
  'rule 20 must stress parallel/batched lookup_quote calls',
);

// Coverage-gap handling.
assert.ok(
  /coverage_gap/.test(searchSrc),
  'rule 20 must reference the coverage_gap flag from the provider chain',
);
assert.ok(
  /gap\s+one\s+ticker|answer\s+the\s+rest|do\s+NOT\s+refuse/i.test(searchSrc),
  'rule 20 must forbid refusing the whole question when one ticker is live-data-dark',
);

// Currency mixing guard — if BRL and USD names are compared, the AI
// must convert via lookup_fx, not ignore the unit.
assert.ok(
  /lookup_fx/.test(searchSrc) && /(USD|BRL|convert|unit)/i.test(searchSrc),
  'rule 20 must instruct conversion via lookup_fx when mixing currencies',
);

// Courtesy layer — user explicitly asked for "extra info on each of the
// names" alongside the ratios.
assert.ok(
  /description|sector|one-line|courtesy/i.test(searchSrc),
  'rule 20 must require a one-line courtesy layer per ticker',
);

// The worked example must reference the incident tickers so the AI
// has a literal template for the failing case.
assert.ok(
  /HTZ.*CAR.*RENT3.*MOVI3|price\s*\/\s*fleet/i.test(searchSrc),
  'rule 20 must include the HTZ/CAR/RENT3/MOVI3 price-per-fleet worked example',
);

// Negative guardrail: when NOT to use the workflow.
assert.ok(
  /WHEN\s+NOT\s+TO\s+USE|single-ticker/i.test(searchSrc),
  'rule 20 must state when the workflow does NOT apply (single-ticker, simple price comparisons)',
);

// ── Rule 21: ARITHMETIC via `compute` ────────────────────────────────
// The #212 fix — make the model stop doing mental math for billion-
// scale ratios.
assert.ok(
  /21\.\s*ARITHMETIC/i.test(searchSrc),
  'rule 21 must exist and be titled ARITHMETIC',
);
assert.ok(
  /`compute`|compute\(/i.test(searchSrc),
  'rule 21 must reference the compute tool by name',
);
assert.ok(
  /variables|\bexpression\b/i.test(searchSrc),
  'rule 21 must explain the expression/variables shape',
);
assert.ok(
  /not a calculator|mental\s+arithmetic|not.*head/i.test(searchSrc),
  'rule 21 must forbid the model from doing arithmetic in its head',
);
// STEP D must have been rewritten to reference compute as well —
// before #212 it just said "show the arithmetic". Now it should tell
// the model to call compute.
assert.ok(
  /STEP\s*D[\s\S]{0,300}compute/i.test(searchSrc),
  'STEP D of rule 20 must now call compute for the ratio arithmetic',
);

console.log('search.comparablesWorkflow.test.js OK');
