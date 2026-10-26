/**
 * honestyGuard.test.js — #292 Wave 4
 *
 * The 26-Oct incident was a hundred small lies: fetch time stamped as
 * market time, a missing change rendered as 0.00%, an invented rate
 * when a fetch failed. This test is the lint rule the sweep asked for:
 * it counts the patterns in server code that produce those lies and
 * fails if the count GROWS. Known remaining sites are allow-listed by
 * count per file; shrink the baseline when you fix one.
 *
 * Patterns:
 *   A  `asOf|updatedAt|timestamp|lastUpdated` set from new Date()/Date.now()
 *      in a payload that carries market values (fetch time ≠ market time)
 *   B  `change|changePct|changePercent|price|yield|rate` defaulted with ?? 0 / || 0
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['routes', 'providers', 'services', 'adapters'];

const PATTERNS = {
  A: /\b(asOf|updatedAt|timestamp|lastUpdated)\s*:\s*(new Date\(\)(\.toISOString\(\))?|Date\.now\(\))/g,
  B: /\b(todaysChange|todaysChangePerc|changePct|changePercent|change|price|yield|rate)\s*:\s*[^,\n]*?(\?\?|\|\|)\s*0\b/g,
};

// Baseline as of 26 Oct 2026 (after Waves 0–4c). Lower is the only direction.
const BASELINE = {
  A: 57,
  B: 6,
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function count(pattern) {
  const hits = [];
  for (const d of SCAN_DIRS) {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) continue;
    for (const f of walk(full)) {
      const src = fs.readFileSync(f, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (line.includes('fetchedAt') || line.includes('generatedAt') || line.includes('computedAt')) return;
        if (pattern.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
        pattern.lastIndex = 0;
      });
    }
  }
  return hits;
}

test('honesty guard A: clock-stamped market timestamps do not increase', () => {
  const hits = count(PATTERNS.A);
  assert.ok(hits.length <= BASELINE.A,
    `asOf/updatedAt/timestamp stamped from the clock: ${hits.length} > baseline ${BASELINE.A}. New sites:\n  ${hits.join('\n  ')}\nUse the provider's own time, or null, and name fetch time fetchedAt.`);
});

test('honesty guard B: zero-as-default on market fields does not increase', () => {
  const hits = count(PATTERNS.B);
  assert.ok(hits.length <= BASELINE.B,
    `change/price/yield defaulted to 0: ${hits.length} > baseline ${BASELINE.B}. New sites:\n  ${hits.join('\n  ')}\nUnknown is null, rendered as "--", never 0.`);
});
