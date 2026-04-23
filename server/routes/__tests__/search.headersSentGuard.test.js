/**
 * search.headersSentGuard.test.js
 *
 * #220 — Every async catch block in routes/search.js that responds to the
 * client MUST check `res.headersSent` before trying another write. Without
 * that check, a late-AbortController abort (or a socket write error) that
 * propagates into the catch AFTER `res.json()` has already been flushed
 * triggers the fatal "Cannot set headers after they are sent" unhandled
 * rejection observed in Sentry on commit 10e9bd8.
 *
 * The guard is one line — `if (res.headersSent) return;` — but it has to
 * appear at the top of every catch block that might write to res. Since
 * search.js has 13 such blocks, a static shape test is the cheapest way
 * to pin that none of them drifts back to the vulnerable form on a
 * future refactor.
 *
 * Run:
 *   node --test server/routes/__tests__/search.headersSentGuard.test.js
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const SEARCH_PATH = path.join(__dirname, '..', 'search.js');
const SEARCH_SRC  = fs.readFileSync(SEARCH_PATH, 'utf8');

test('#220 every `err.name === AbortError` branch in search.js has a res.headersSent guard above it', () => {
  const lines = SEARCH_SRC.split('\n');

  // Find every line that looks like: if (err.name === 'AbortError') ...
  const abortBranches = [];
  lines.forEach((line, idx) => {
    if (/if\s*\(\s*err\.name\s*===\s*'AbortError'\s*\)/.test(line)) {
      abortBranches.push({ lineNo: idx + 1, text: line });
    }
  });

  assert.ok(abortBranches.length >= 12,
    `expected at least 12 AbortError branches in search.js, saw ${abortBranches.length}`);

  // Every AbortError branch must be preceded (within 5 lines) by the guard:
  //   if (res.headersSent) return;
  const GUARD_WINDOW = 5;
  const failures = [];
  for (const b of abortBranches) {
    const start = Math.max(0, b.lineNo - 1 - GUARD_WINDOW);
    const slice = lines.slice(start, b.lineNo - 1).join('\n');
    // Accept either form:
    //   if (res.headersSent) return;                 // short-circuit guard
    //   if (!res.headersSent) { return res.status... } // inverted SSE pattern
    const hasGuard = /if\s*\(\s*!?\s*res\.headersSent\s*\)/.test(slice);
    if (!hasGuard) failures.push(b);
  }

  assert.deepEqual(
    failures,
    [],
    `these AbortError branches are missing the res.headersSent guard:\n${failures.map(f => `  line ${f.lineNo}: ${f.text.trim()}`).join('\n')}`,
  );
});

test('#220 every catch block in search.js that writes to res is guarded', () => {
  // Stronger invariant: any catch block that contains `res.status(` or
  // `res.json(` must start with the res.headersSent guard. This catches
  // non-AbortError handlers that also write through the catch.
  const lines = SEARCH_SRC.split('\n');

  const catchStarts = [];
  lines.forEach((line, idx) => {
    if (/^\s*}\s*catch\s*\(\s*err\s*\)\s*\{\s*$/.test(line)) {
      catchStarts.push({ lineNo: idx + 1, text: line });
    }
  });

  // For each catch start, scan forward until the matching `}` (naive —
  // walk until a line that's just `  }` or a new `} catch` or EOF).
  const failures = [];
  for (const c of catchStarts) {
    const body = [];
    for (let i = c.lineNo; i < lines.length; i++) {
      const l = lines[i];
      // Stop at end-of-catch: a line that's exactly the closing brace
      // at the same indent level as the opening `} catch`.
      if (/^\s*}\s*(finally|$)/.test(l) && body.length > 0) break;
      body.push(l);
    }
    const joined = body.join('\n');
    const writesToRes = /res\.(status|json|send|write|end)\b/.test(joined);
    if (!writesToRes) continue;
    // Accept either form — see test 1:
    //   if (res.headersSent) return;                 // short-circuit guard
    //   if (!res.headersSent) { return res.status... } // inverted SSE pattern
    const hasGuard = /if\s*\(\s*!?\s*res\.headersSent\s*\)/.test(joined);
    if (!hasGuard) failures.push(c);
  }

  assert.deepEqual(
    failures,
    [],
    `these catch blocks write to res but lack the res.headersSent guard:\n${failures.map(f => `  line ${f.lineNo}`).join('\n')}`,
  );
});

test('#220 the comment tag "#220" appears on every guard so grep-based audits find them', () => {
  // Lightweight discoverability check — each added guard has a matching
  // "#220" comment so future maintainers can `git grep '#220'` and see
  // the full cohort.
  const guardHits   = (SEARCH_SRC.match(/if\s*\(\s*res\.headersSent\s*\)\s*return/g) || []).length;
  const commentHits = (SEARCH_SRC.match(/#220/g) || []).length;
  assert.ok(
    commentHits >= guardHits,
    `expected at least ${guardHits} "#220" comments (one per guard), saw ${commentHits}`,
  );
});
