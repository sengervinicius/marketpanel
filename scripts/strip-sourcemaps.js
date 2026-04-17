#!/usr/bin/env node
/**
 * scripts/strip-sourcemaps.js
 *
 * W0.2 — Deletes every .map file under client/dist/ AFTER they have been
 * uploaded to Sentry for symbolication. Vite's `sourcemap: 'hidden'`
 * generates the maps but does not reference them from the bundle; once
 * Sentry has them, they do not need to ship to users.
 *
 * Run order (CI):
 *   1. npm run build
 *   2. sentry-cli sourcemaps upload (if SENTRY_AUTH_TOKEN present)
 *   3. node scripts/strip-sourcemaps.js
 *   4. npm run sourcemap:check   (enforces the strip)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CLIENT_DIST = path.resolve(__dirname, '..', 'client', 'dist');

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.map')) out.push(full);
  }
  return out;
}

if (!fs.existsSync(CLIENT_DIST)) {
  console.log(`[strip-sourcemaps] ${CLIENT_DIST} does not exist — skipping.`);
  process.exit(0);
}

const maps = walk(CLIENT_DIST);
let bytes = 0;
for (const m of maps) {
  try {
    bytes += fs.statSync(m).size;
    fs.unlinkSync(m);
  } catch (e) {
    console.error(`[strip-sourcemaps] could not delete ${m}: ${e.message}`);
  }
}
console.log(`[strip-sourcemaps] removed ${maps.length} .map files (${(bytes / 1024).toFixed(1)} KiB)`);
