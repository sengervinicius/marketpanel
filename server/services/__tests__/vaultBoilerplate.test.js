/**
 * vaultBoilerplate.test.js — retrieval v2 regression guard (audit §6.4).
 *
 * scoreBoilerplate() is the heuristic that stops greeting headers, analyst
 * contact blocks, disclaimers and TOCs from winning the similarity race
 * against real content. The live failure this exists to fix: the query
 * "what is BofA's outlook for oil prices" returned the report's analyst
 * contact header instead of the outlook section.
 *
 * Contract locked in here:
 *   - pure function, never throws, always returns 0..1
 *   - the BofA-style contact block scores > 0.6 (hard requirement)
 *   - real research prose scores low
 *
 * Run:
 *   node --test server/services/__tests__/vaultBoilerplate.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreBoilerplate } = require('../vaultBoilerplate');

// ── Bounds + robustness ──────────────────────────────────────────────────

test('returns 0 for non-string / empty / tiny input', () => {
  assert.equal(scoreBoilerplate(null), 0);
  assert.equal(scoreBoilerplate(undefined), 0);
  assert.equal(scoreBoilerplate(42), 0);
  assert.equal(scoreBoilerplate(''), 0);
  assert.equal(scoreBoilerplate('short text'), 0); // < 20 chars — don't judge
});

test('always returns a number within [0, 1]', () => {
  const samples = [
    'a'.repeat(5000),
    'good morning good afternoon good evening bom dia boa tarde ' +
      'a@b.com c@d.com e@f.com T: +55 (11) 2188-4375 +55 (11) 2188-4102 ' +
      'important disclosures analyst certification not investment advice ' +
      'Contents ...... 1 Intro ...... 2 Risks ...... 3',
    'Normal sentence about markets and rates in 2026.',
  ];
  for (const s of samples) {
    const v = scoreBoilerplate(s);
    assert.equal(typeof v, 'number');
    assert.ok(v >= 0 && v <= 1, `score ${v} out of range`);
  }
});

// ── The class of failure this must fix (hard requirement from audit) ─────

test('BofA analyst contact header scores > 0.6', () => {
  const bofaHeader =
    'Caio Ribeiro – caio.ribeiro@bofa.com– T: +55 (11) 2188-4375 ' +
    'Leonardo Marcondes – leonardo.marcondes@bofa.com – T: +55 (11) 2188-4102 ' +
    'Research Analysts, BofA Securities Brazil';
  const score = scoreBoilerplate(bofaHeader);
  assert.ok(score > 0.6, `expected > 0.6, got ${score}`);
});

test('minimal single-analyst contact line still registers as boilerplate-ish', () => {
  const line = 'Caio Ribeiro – caio.ribeiro@bofa.com– T: +55 (11) 2188-4375';
  const score = scoreBoilerplate(line);
  assert.ok(score > 0.6, `expected > 0.6, got ${score}`); // email + phone + T:+ + char-mass ratio
});

test('greeting / daily-note opener scores meaningfully', () => {
  const greet = 'Good morning. This is what you need to know today before the market opens in Brazil and abroad.';
  const score = scoreBoilerplate(greet);
  assert.ok(score >= 0.4, `expected >= 0.4, got ${score}`);
});

test('disclaimer block scores high', () => {
  const disc =
    'Important Disclosures: This report is prepared by BofA Securities. ' +
    'Analyst Certification: the analysts hereby certify that the views expressed ' +
    'reflect their personal views. This material is not investment advice and ' +
    'past performance is no guarantee of future results.';
  const score = scoreBoilerplate(disc);
  assert.ok(score >= 0.6, `expected >= 0.6, got ${score}`);
});

test('table-of-contents chunk scores high', () => {
  const toc =
    'Table of Contents  Executive Summary ...... 2  Oil Outlook .......... 5  ' +
    'Valuation ........ 12  Risks .......... 18';
  const score = scoreBoilerplate(toc);
  assert.ok(score >= 0.5, `expected >= 0.5, got ${score}`);
});

// ── Negative example: real content must NOT be penalised ────────────────

test('real research content scores low (< 0.2)', () => {
  const real =
    'We maintain our constructive outlook for oil prices into 2H26, with Brent ' +
    'averaging USD 85/bbl as OPEC+ supply discipline offsets softer Chinese demand. ' +
    'Refining margins should normalize as new capacity ramps in Asia, while ' +
    'Petrobras production growth of 5% supports free cash flow and dividends.';
  const score = scoreBoilerplate(real);
  assert.ok(score < 0.2, `expected < 0.2, got ${score}`);
});

test('PT-BR research content scores low', () => {
  const real =
    'Mantemos visão construtiva para o preço do petróleo no segundo semestre, ' +
    'com o Brent em média de US$ 85 por barril, sustentado pela disciplina de ' +
    'oferta da OPEP+ e pela retomada gradual da demanda asiática.';
  const score = scoreBoilerplate(real);
  assert.ok(score < 0.2, `expected < 0.2, got ${score}`);
});

test('content that merely mentions one email once is only mildly penalised', () => {
  const real =
    'For model details contact the desk at research@bank.com. Our base case assumes ' +
    'Selic at 10.5% by year-end, with inflation converging to the 3.5% target as ' +
    'services disinflation continues and the output gap widens through 2026.';
  const score = scoreBoilerplate(real);
  assert.ok(score <= 0.3, `expected <= 0.3, got ${score}`);
});
