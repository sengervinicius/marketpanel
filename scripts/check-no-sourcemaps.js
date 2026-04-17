#!/usr/bin/env node
/**
 * scripts/check-no-sourcemaps.js
 *
 * W0.2 — Fails CI if the production Vite build shipped any .map files.
 * Source maps are uploaded to Sentry for symbolication but must not be
 * served from the client bundle in production.
 *
 * Ignores: node_modules, coverage, test output.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');

const IGNORE_DIRS = new Set(['node_modules', 'coverage', '.git']);
const hits = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      hits.push(full);
    }
  }
}

if (!fs.existsSync(CLIENT_DIST)) {
  console.log(`[sourcemap-check] ${CLIENT_DIST} does not exist — skipping (run \`npm run build\` first).`);
  process.exit(0);
}

walk(CLIENT_DIST);

if (hits.length > 0) {
  console.error('[sourcemap-check] FAIL — found .map files in client/dist:');
  for (const f of hits) console.error('  ' + path.relative(ROOT, f));
  console.error('[sourcemap-check] In production, set build.sourcemap: "hidden" in vite.config.js');
  console.error('[sourcemap-check] Hidden sourcemaps are generated for Sentry upload but excluded from the shipped bundle.');
  process.exit(1);
}

console.log('[sourcemap-check] OK — no .map files in client/dist.');
