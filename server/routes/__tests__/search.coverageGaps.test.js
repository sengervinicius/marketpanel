/**
 * search.coverageGaps.test.js — regression guard for the declared
 * coverage-gap language in the tool-augmented system prompt.
 *
 * The audit called this out as a P1 deliverable: three specific
 * integrations (B3 options, mainland A-shares, Plaid) are known-blocked
 * on commercial grounds and MUST be stated plainly rather than
 * fabricated. This test pins the prompt wording so a future refactor
 * can't quietly drop the guardrail.
 *
 * We don't boot the Express app — we just scrape the source file for
 * the required phrases. That keeps the test hermetic and cheap.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const searchSrc = fs.readFileSync(
  path.join(__dirname, '..', 'search.js'),
  'utf8',
);

// ── (a) B3 options gap ───────────────────────────────────────────────
// Must name the feed (UP2DATA), say it's not licensed, and redirect to
// the tools we do have (lookup_quote, list_cvm_filings).
assert.ok(
  /B3 OPTIONS|B3\s*options/i.test(searchSrc),
  'search.js must name the B3 options gap explicitly',
);
assert.ok(
  /UP2DATA/i.test(searchSrc),
  'search.js must name the blocked data feed (UP2DATA) so the AI ' +
    'relays the commercial reason honestly',
);
// The source file is JS with string concatenation (' + '), so phrases
// that cross a ' + ' boundary won't match as contiguous text. Match on
// what's certainly inside one string literal.
assert.ok(
  /don't\s+license|do\s+not\s+(?:currently\s+)?license|not\s+licen[sc]e|not\s+wired|not\s+available/i
    .test(searchSrc),
  'search.js must state the B3 options gap as a non-fabrication rule',
);

// ── (b) Chinese A-shares gap ─────────────────────────────────────────
// Must distinguish mainland (Shanghai/Shenzhen) from Hong Kong,
// mention Tushare (the common paid source) and disclaim fabrication.
assert.ok(
  /A-shares|Shanghai|Shenzhen|SHSE|SZSE/i.test(searchSrc),
  'search.js must explicitly call out the A-shares gap',
);
assert.ok(
  /Tushare|Wind\s+terminal/i.test(searchSrc),
  'search.js must reference the commercial A-share data source that is not wired',
);
assert.ok(
  /H-share|Hong\s*Kong|\.HK/i.test(searchSrc),
  'search.js must differentiate partial H-share coverage from A-share gap',
);
assert.ok(
  /never fabricate|do\s+NOT\s+make\s+up|do\s+NOT\s+fabricate/i.test(searchSrc),
  'search.js must explicitly forbid fabrication of Chinese market internals',
);

// ── (c) Plaid / brokerage-sync gap ───────────────────────────────────
// Must state no direct account connection, and redirect to CSV import.
assert.ok(
  /Plaid/i.test(searchSrc),
  'search.js must name Plaid as the blocker for brokerage sync',
);
assert.ok(
  /do\s+NOT\s+connect|don't\s+connect|no\s+Plaid|do\s+not\s+connect\s+to\s+brokerage/i.test(searchSrc),
  'search.js must state plainly that brokerage sync is not available',
);
assert.ok(
  /CSV|upload/i.test(searchSrc),
  'search.js must redirect portfolio-sync asks to the CSV import path',
);
assert.ok(
  /credentials|account\s+numbers?/i.test(searchSrc) &&
    /do\s+NOT\s+ask|never\s+ask/i.test(searchSrc),
  'search.js must explicitly forbid asking the user for credentials or account numbers',
);

// ── Rule-numbering sanity ────────────────────────────────────────────
// The tool-prompt rules are numbered 1..N. Rule 13 should exist and
// carry the DECLARED COVERAGE GAPS heading.
assert.ok(
  /13\.\s*DECLARED COVERAGE GAPS/i.test(searchSrc),
  'rule 13 must exist and be titled DECLARED COVERAGE GAPS',
);

console.log('search.coverageGaps.test.js OK');
