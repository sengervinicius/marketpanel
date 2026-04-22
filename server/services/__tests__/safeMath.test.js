/**
 * safeMath.test.js — evaluator correctness + safety pins.
 *
 * The compute tool is only as good as this evaluator. It has to:
 *   1. Get basic arithmetic right, including operator precedence.
 *   2. Handle the scale of numbers the model will actually pass
 *      (market caps in billions, fleets in 5-6 digits).
 *   3. Reject anything that looks like code injection — no eval, no
 *      Function, no Object prototype reach-through.
 *   4. Return { error } rather than throwing, so dispatchTool stays
 *      simple.
 */

'use strict';

const assert = require('assert');
const { evaluate } = require('../safeMath');

function eq(expr, expected, opts) {
  const out = evaluate(expr, opts && opts.variables);
  assert.ok(!out.error, `${expr} → errored: ${out.error}`);
  const diff = Math.abs(out.result - expected);
  const tol = opts && opts.tolerance != null ? opts.tolerance : 1e-9;
  assert.ok(diff <= tol, `${expr} → ${out.result}, expected ${expected} (diff ${diff})`);
}

function errs(expr, pattern, variables) {
  const out = evaluate(expr, variables);
  assert.ok(out.error, `${expr} should error but got ${out.result}`);
  if (pattern) assert.match(out.error, pattern, `${expr} error should match ${pattern} — got: ${out.error}`);
}

// ── 1. Basic arithmetic + precedence ─────────────────────────────────
eq('1 + 1', 2);
eq('2 * 3 + 4', 10);
eq('2 + 3 * 4', 14);
eq('(2 + 3) * 4', 20);
eq('100 / 4', 25);
eq('10 - 3 - 2', 5);        // left-assoc
eq('10 / 2 / 5', 1);
eq('2 ^ 10', 1024);
eq('2 ^ 3 ^ 2', 512);       // right-assoc: 2^(3^2) = 2^9
eq('-5 + 3', -2);
eq('-(2 + 3)', -5);
eq('+5', 5);
eq('10 % 3', 1);

// Scientific notation, big numbers — the scale we actually deal with.
eq('1.5e9', 1.5e9);
eq('3.2e10 / 500000', 64000);
eq('1.5e-3 * 1000', 1.5);

// ── 2. Functions ─────────────────────────────────────────────────────
eq('sqrt(16)', 4);
eq('abs(-7)', 7);
eq('round(3.14159)', 3);
eq('round(3.14159, 2)', 3.14);
eq('round(1234.5678, 0)', 1235);
eq('min(1, 2, 3)', 1);
eq('max(1, 2, 3)', 3);
eq('pow(2, 10)', 1024);
eq('floor(3.9)', 3);
eq('ceil(3.1)', 4);
eq('log(e)', 1);
eq('log10(1000)', 3);
eq('exp(0)', 1);

// Nested
eq('sqrt(abs(-16))', 4);
eq('min(max(1, 2), max(3, 4))', 2);

// ── 3. Variables ─────────────────────────────────────────────────────
eq('a + b', 5, { variables: { a: 2, b: 3 } });
eq('price / fleet', 300, { variables: { price: 1.5e10, fleet: 5e7 } });
eq('x * 100', 42, { variables: { x: 0.42 } });

// Real-world: HTZ-style market cap / fleet size
eq('mc / fleet', 11000, { variables: { mc: 5.5e9, fleet: 500000 } });

// Multi-var
eq('(mc1 / fleet1) / (mc2 / fleet2)', 2, {
  variables: { mc1: 100, fleet1: 10, mc2: 50, fleet2: 10 },
});

// Constants
eq('pi * 2', Math.PI * 2, { tolerance: 1e-12 });
eq('e', Math.E);

// ── 4. Error cases ──────────────────────────────────────────────────
errs('1 / 0', /division by zero/i);
errs('10 % 0', /modulo by zero/i);
errs('2 +', /unexpected end/i);
errs('(1 + 2', /expected.*\)/i);
errs('1 + ) 2', /unexpected/i);
errs('foo + 1', /unknown identifier/i);
errs('foo(1)', /unknown function/i);
errs('sqrt(-1)', /non-finite/i);      // NaN, rejected
errs('', /empty/i);
errs('   ', /empty/i);
errs('@#$', /unexpected character/i);
errs('1.2.3', /invalid number/i);

// Code-injection defenses — these should never be interpreted. The
// specific error varies (unknown identifier, unknown function, bad
// token) but they must all error.
errs('__proto__');
errs('constructor("return process")');
errs('require("fs")');
errs('process.exit(0)');
errs('eval("1+1")');
errs('this.foo');
errs('1; 2');
errs('1 || 2');
errs('1 && 2');

// Variable hygiene
errs('a + b', /unknown identifier/i);                    // missing variables
errs('x', null, { x: Infinity });                        // infinity rejected
errs('x', null, { x: NaN });                             // NaN rejected
errs('x', null, { 'bad-name': 1 });                      // invalid var name

// Non-string expression
(function () {
  const out = evaluate(42);
  assert.ok(out.error && /must be a string/i.test(out.error), 'non-string → error');
})();

// Oversized expression
(function () {
  const long = '1 + '.repeat(200) + '1';  // ~800 chars
  const out = evaluate(long);
  assert.ok(out.error && /too long/i.test(out.error), 'oversized → error');
})();

// Too many variables
(function () {
  const vars = {};
  for (let i = 0; i < 100; i++) vars[`v${i}`] = i;
  const out = evaluate('v0 + v1', vars);
  assert.ok(out.error && /too many variables/i.test(out.error), 'variable flood → error');
})();

// Variables as array (not object)
(function () {
  const out = evaluate('1 + 1', [1, 2, 3]);
  assert.ok(out.error && /variables must be an object/i.test(out.error));
})();

// Non-numeric variable value
(function () {
  const out = evaluate('a + 1', { a: 'two' });
  assert.ok(out.error && /finite number/i.test(out.error));
})();

// Result non-finite — 1/(1-1) → division by zero caught above; check exp overflow
errs('exp(1000)', /non-finite/i);

console.log('safeMath.test.js OK (53 assertions)');
