/**
 * services/safeMath.js — Safe arithmetic expression evaluator.
 *
 * Background: Particle AI's comparables workflow ends with a compute step
 * — price / fleet, marketCap / subscribers, EV / EBITDA. Large language
 * models are notoriously unreliable at arithmetic, especially with the
 * exponent-heavy numbers we're working with (market caps in billions,
 * fleets in six figures). The #212 fix is to give the model a `compute`
 * tool so it never does the math itself.
 *
 * Requirements:
 *   - Zero third-party deps (no mathjs) — runs fully offline.
 *   - Evaluates untrusted strings from the model without eval/Function.
 *   - Supports +, -, *, /, %, ^ (power), unary minus, parentheses.
 *   - Named variables: `compute("a/b", { a: 1.2e10, b: 5e5 })` so the
 *     model doesn't have to inline 10-digit numbers into the string.
 *   - Whitelist of common math functions: abs, sqrt, log, log10, exp,
 *     round, floor, ceil, min, max, pow.
 *   - Deterministic, defensive: never throws at the top level — returns
 *     `{ error }` instead. That keeps the tool dispatcher simple.
 *
 * Grammar (recursive descent):
 *     expression = term (('+' | '-') term)*
 *     term       = power (('*' | '/' | '%') power)*
 *     power      = unary ('^' power)?                // right-associative
 *     unary      = ('+' | '-') unary | primary
 *     primary    = number | identifier | '(' expression ')' | func_call
 *     func_call  = identifier '(' (expression (',' expression)*)? ')'
 *
 * Limits:
 *   - Expression length capped at 500 chars.
 *   - Variable count capped at 64.
 *   - No identifiers not in the variables map or the function whitelist.
 */

'use strict';

const MAX_EXPRESSION_LENGTH = 500;
const MAX_VARIABLES = 64;

// Whitelisted functions — name → (args[]) => number.
const FUNCTIONS = {
  abs:   (a)    => Math.abs(a),
  sqrt:  (a)    => Math.sqrt(a),
  log:   (a)    => Math.log(a),     // natural log
  ln:    (a)    => Math.log(a),     // alias
  log10: (a)    => Math.log10(a),
  log2:  (a)    => Math.log2(a),
  exp:   (a)    => Math.exp(a),
  round: (a, d) => {
    const digits = Number.isFinite(d) ? Math.floor(d) : 0;
    const m = Math.pow(10, digits);
    return Math.round(a * m) / m;
  },
  floor: (a) => Math.floor(a),
  ceil:  (a) => Math.ceil(a),
  min:   (...args) => Math.min(...args),
  max:   (...args) => Math.max(...args),
  pow:   (a, b) => Math.pow(a, b),
};

// Whitelisted constants.
const CONSTANTS = {
  pi: Math.PI,
  e:  Math.E,
};

// ── Tokenizer ─────────────────────────────────────────────────────────
function tokenize(expr) {
  const tokens = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const ch = expr[i];
    // whitespace
    if (/\s/.test(ch)) { i++; continue; }
    // number (int, float, scientific: 1.5e-3)
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(expr[i + 1] || ''))) {
      let j = i;
      while (j < n && /[0-9.]/.test(expr[j])) j++;
      // optional exponent
      if (j < n && (expr[j] === 'e' || expr[j] === 'E')) {
        j++;
        if (j < n && (expr[j] === '+' || expr[j] === '-')) j++;
        while (j < n && /[0-9]/.test(expr[j])) j++;
      }
      const raw = expr.slice(i, j);
      const num = Number(raw);
      if (!Number.isFinite(num)) throw new Error(`invalid number: ${raw}`);
      tokens.push({ type: 'number', value: num });
      i = j;
      continue;
    }
    // identifier (variable or function name)
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(expr[j])) j++;
      tokens.push({ type: 'ident', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    // operators + punctuation
    if ('+-*/%^(),'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    throw new Error(`unexpected character '${ch}' at position ${i}`);
  }
  return tokens;
}

// ── Parser + evaluator (single pass, no AST) ──────────────────────────
function makeParser(tokens, variables) {
  let pos = 0;

  function peek() { return tokens[pos]; }
  function eat(type, value) {
    const t = tokens[pos];
    if (!t || t.type !== type || (value !== undefined && t.value !== value)) return null;
    pos++;
    return t;
  }
  function expect(type, value) {
    const t = eat(type, value);
    if (!t) {
      const got = tokens[pos] ? `${tokens[pos].type}:${tokens[pos].value}` : 'end-of-input';
      throw new Error(`expected ${type}${value !== undefined ? ` '${value}'` : ''}, got ${got}`);
    }
    return t;
  }

  function parseExpression() {
    let left = parseTerm();
    for (;;) {
      const t = peek();
      if (t && t.type === 'op' && (t.value === '+' || t.value === '-')) {
        pos++;
        const right = parseTerm();
        left = t.value === '+' ? left + right : left - right;
      } else break;
    }
    return left;
  }

  function parseTerm() {
    let left = parsePower();
    for (;;) {
      const t = peek();
      if (t && t.type === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        pos++;
        const right = parsePower();
        if (t.value === '*') left = left * right;
        else if (t.value === '/') {
          if (right === 0) throw new Error('division by zero');
          left = left / right;
        } else {
          if (right === 0) throw new Error('modulo by zero');
          left = left % right;
        }
      } else break;
    }
    return left;
  }

  // Right-associative
  function parsePower() {
    const base = parseUnary();
    const t = peek();
    if (t && t.type === 'op' && t.value === '^') {
      pos++;
      const exp = parsePower();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary() {
    const t = peek();
    if (t && t.type === 'op' && (t.value === '-' || t.value === '+')) {
      pos++;
      const v = parseUnary();
      return t.value === '-' ? -v : v;
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = tokens[pos];
    if (!t) throw new Error('unexpected end of expression');

    if (t.type === 'number') {
      pos++;
      return t.value;
    }

    if (t.type === 'ident') {
      pos++;
      // Function call?
      const next = peek();
      if (next && next.type === 'op' && next.value === '(') {
        pos++; // consume '('
        const args = [];
        if (!(peek() && peek().type === 'op' && peek().value === ')')) {
          args.push(parseExpression());
          while (eat('op', ',')) args.push(parseExpression());
        }
        expect('op', ')');
        const fn = FUNCTIONS[t.value];
        if (!fn) throw new Error(`unknown function: ${t.value}`);
        const out = fn(...args);
        if (!Number.isFinite(out)) throw new Error(`function ${t.value} produced non-finite result`);
        return out;
      }
      // Variable or constant lookup.
      if (variables && Object.prototype.hasOwnProperty.call(variables, t.value)) {
        const v = variables[t.value];
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new Error(`variable '${t.value}' is not a finite number`);
        }
        return v;
      }
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, t.value)) {
        return CONSTANTS[t.value];
      }
      throw new Error(`unknown identifier: ${t.value}`);
    }

    if (t.type === 'op' && t.value === '(') {
      pos++;
      const v = parseExpression();
      expect('op', ')');
      return v;
    }

    throw new Error(`unexpected token '${t.value}' at position ${pos}`);
  }

  return { parseExpression, isDone: () => pos >= tokens.length };
}

/**
 * Evaluate a math expression string safely.
 *
 * @param {string} expression - e.g. "a / b * 100"
 * @param {Object} [variables] - { a: 1e9, b: 5e5 }
 * @returns {{ result: number } | { error: string }}
 */
function evaluate(expression, variables) {
  if (typeof expression !== 'string') {
    return { error: 'expression must be a string' };
  }
  const trimmed = expression.trim();
  if (!trimmed) return { error: 'expression is empty' };
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    return { error: `expression too long (max ${MAX_EXPRESSION_LENGTH} chars)` };
  }

  if (variables != null) {
    if (typeof variables !== 'object' || Array.isArray(variables)) {
      return { error: 'variables must be an object map' };
    }
    const keys = Object.keys(variables);
    if (keys.length > MAX_VARIABLES) {
      return { error: `too many variables (max ${MAX_VARIABLES})` };
    }
    for (const k of keys) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
        return { error: `invalid variable name: ${k}` };
      }
      const v = variables[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { error: `variable '${k}' must be a finite number` };
      }
    }
  }

  let tokens;
  try { tokens = tokenize(trimmed); }
  catch (e) { return { error: e.message || 'tokenizer error' }; }

  const parser = makeParser(tokens, variables || {});
  let value;
  try { value = parser.parseExpression(); }
  catch (e) { return { error: e.message || 'parse error' }; }

  if (!parser.isDone()) {
    return { error: 'unexpected trailing tokens — check parentheses and operators' };
  }
  if (!Number.isFinite(value)) {
    return { error: 'result is not a finite number' };
  }
  return { result: value };
}

module.exports = {
  evaluate,
  FUNCTIONS,
  CONSTANTS,
  MAX_EXPRESSION_LENGTH,
  MAX_VARIABLES,
};
