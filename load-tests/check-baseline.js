#!/usr/bin/env node
/**
 * load-tests/check-baseline.js — W5.4 regression gate.
 *
 * Reads a k6 summary JSON (written by --summary-export) and compares the
 * headline metrics against baseline-budget.json. Fails with a non-zero
 * exit code if any metric violates:
 *
 *   (a) the hard ceiling `max` (or `min` for rate-style metrics), or
 *   (b) the `toleratePct` regression tolerance vs. the stored baseline
 *       (interpreted as: "do not regress more than N% vs. max").
 *
 * This is intentionally dead-simple — no fancy stats — because the k6
 * smoke is deliberately small and we want a boolean PASS/FAIL that a
 * human reading the CI log can understand in 10 seconds.
 *
 * Usage:
 *   node load-tests/check-baseline.js k6-summary.json
 *   node load-tests/check-baseline.js k6-summary.json load-tests/baseline-budget.json
 *
 * Exit codes:
 *   0 = all metrics within budget
 *   1 = at least one metric regressed
 *   2 = bad inputs (file not found, JSON parse error)
 */

'use strict';

const fs = require('fs');
const path = require('path');

function die(code, msg) {
  process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n');
  process.exit(code);
}

function loadJson(p) {
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch (e) { die(2, `[check-baseline] cannot read ${p}: ${e.message}`); }
  try { return JSON.parse(raw); }
  catch (e) { die(2, `[check-baseline] invalid JSON in ${p}: ${e.message}`); }
}

/**
 * Resolve a dotted k6 metric path to the actual number in the summary JSON.
 * k6 exports metrics as:
 *   data.metrics[<name>].values[<stat>]
 * where <name> can include tag filters like "http_req_duration{type:panel}"
 * and <stat> is 'p(95)' | 'p(99)' | 'rate' | 'avg' | 'max' | 'count'.
 *
 * Our budget keys use the flattened form "http_req_duration{type:panel}.p(95)"
 * so we split on the LAST '.' to separate metric name from the stat.
 */
function getMetric(summary, key) {
  const lastDot = key.lastIndexOf('.');
  if (lastDot < 0) return undefined;
  const metricName = key.slice(0, lastDot);
  const stat       = key.slice(lastDot + 1);
  const metrics    = summary?.metrics || {};
  const m          = metrics[metricName];
  if (!m || !m.values) return undefined;
  return m.values[stat];
}

function check(label, observed, budget) {
  if (observed === undefined || observed === null || Number.isNaN(observed)) {
    return { label, status: 'missing', observed };
  }
  // "max" budget (latency/failure-rate): observed must be <= max
  if (typeof budget.max === 'number') {
    const tolerated = budget.max * (1 + (budget.toleratePct || 0) / 100);
    if (observed > tolerated) {
      return { label, status: 'FAIL', observed, budget: budget.max, tolerated };
    }
    return { label, status: 'OK', observed, budget: budget.max };
  }
  // "min" budget (checks.rate): observed must be >= min
  if (typeof budget.min === 'number') {
    const tolerated = budget.min * (1 - (budget.toleratePct || 0) / 100);
    if (observed < tolerated) {
      return { label, status: 'FAIL', observed, budget: budget.min, tolerated };
    }
    return { label, status: 'OK', observed, budget: budget.min };
  }
  return { label, status: 'BAD_BUDGET', budget };
}

function main() {
  const [summaryPath, budgetPath] = process.argv.slice(2);
  if (!summaryPath) {
    die(2, 'Usage: node load-tests/check-baseline.js <k6-summary.json> [baseline-budget.json]');
  }
  const budget = loadJson(budgetPath || path.join(__dirname, 'baseline-budget.json'));
  const summary = loadJson(summaryPath);

  const rows = [];
  let failures = 0, missing = 0;
  for (const [label, b] of Object.entries(budget.baseline || {})) {
    const observed = getMetric(summary, label);
    const r = check(label, observed, b);
    rows.push(r);
    if (r.status === 'FAIL')    failures += 1;
    if (r.status === 'missing') missing  += 1;
  }

  // Pretty-print
  const pad = (s, n) => String(s).padEnd(n);
  process.stdout.write(
    `\nk6 baseline gate — ${new Date().toISOString()}\n` +
    `${pad('metric', 46)} ${pad('observed', 12)} ${pad('budget', 10)} status\n` +
    `${'-'.repeat(46)} ${'-'.repeat(12)} ${'-'.repeat(10)} ------\n`
  );
  for (const r of rows) {
    const obs = r.observed === undefined ? '--' :
      (typeof r.observed === 'number' ? r.observed.toFixed(3) : r.observed);
    const bud = r.budget === undefined ? '--' : r.budget;
    process.stdout.write(`${pad(r.label, 46)} ${pad(obs, 12)} ${pad(bud, 10)} ${r.status}\n`);
  }
  process.stdout.write(
    `\nFAIL=${failures}   MISSING=${missing}   OK=${rows.length - failures - missing}\n`
  );

  if (failures > 0) process.exit(1);
  // Missing metrics are a soft warning: smoke runs don't cover the full scenario
  // so some metrics may not exist. CI invokes with --require-all to promote
  // missing → FAIL for the nightly full run.
  if (missing > 0 && process.argv.includes('--require-all')) process.exit(1);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { getMetric, check };
