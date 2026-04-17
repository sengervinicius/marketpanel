#!/usr/bin/env node
/**
 * scripts/check-bundle-size.js — W5.2 client bundle-size budget.
 *
 * Runs after `vite build` in CI. Fails the build if any asset in
 * client/dist/assets exceeds its per-pattern budget. Budgets are
 * rough guardrails, not optimisation targets — adjust on purpose,
 * not by accident.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DIST_DIR = path.join(__dirname, '..', 'client', 'dist', 'assets');

// pattern → max bytes (uncompressed, because brotli comparison is noisy)
const BUDGETS = [
  { pattern: /\.js$/,  max: 1_500_000, label: 'JS bundle' },
  { pattern: /\.css$/, max:   300_000, label: 'CSS bundle' },
  { pattern: /\.(png|jpe?g|svg|webp)$/, max: 500_000, label: 'Image' },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) walk(p, out);
    else out.push({ path: p, bytes: stat.size });
  }
  return out;
}

const files = walk(DIST_DIR);
if (!files.length) {
  console.error(`[bundle-size] no assets found at ${DIST_DIR}`);
  process.exit(2);
}

const overages = [];
for (const f of files) {
  for (const b of BUDGETS) {
    if (b.pattern.test(f.path) && f.bytes > b.max) {
      overages.push({ file: path.relative(DIST_DIR, f.path), bytes: f.bytes, max: b.max, label: b.label });
    }
  }
}

if (overages.length) {
  console.error(`[bundle-size] ${overages.length} overage(s):`);
  for (const o of overages) {
    const mb  = (o.bytes / 1024 / 1024).toFixed(2);
    const max = (o.max / 1024 / 1024).toFixed(2);
    console.error(`  ✗ ${o.label}: ${o.file} = ${mb}MB (limit ${max}MB)`);
  }
  process.exit(1);
}

console.log(`[bundle-size] ok — ${files.length} asset(s) checked, all within budget`);
