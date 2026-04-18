/**
 * brokerPdfImporter.test.js — W6.6 template-extractor tests.
 *
 * We do NOT load a fixture PDF here — pdf-parse is exercised in integration
 * tests. These tests hit the template extractors directly on realistic text
 * blobs so the regexes can be iterated without binary fixtures in git.
 *
 * Usage: node server/services/__tests__/brokerPdfImporter.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const { _findTemplate, TEMPLATES } = require('../brokerPdfImporter');

function t(name, fn) {
  try { fn(); console.log(`  ok — ${name}`); }
  catch (e) { console.error(`  FAIL — ${name}: ${e.message}`); process.exitCode = 1; }
}

const xp    = TEMPLATES.find(t => t.name === 'XP Investimentos BR');
const hl    = TEMPLATES.find(t => t.name === 'Hargreaves Lansdown UK');

// ── fingerprint detection ───────────────────────────────────────────────────
console.log('brokerPdfImporter._findTemplate');

t('detects XP Investimentos fingerprint', () => {
  const text = 'Extrato Mensal XP INVESTIMENTOS CCTVM S.A. Posição Consolidada 31/12/2024';
  assert.equal(_findTemplate(text)?.name, 'XP Investimentos BR');
});

t('detects Hargreaves Lansdown fingerprint', () => {
  const text = 'Hargreaves Lansdown Investment Report - December 2024';
  assert.equal(_findTemplate(text)?.name, 'Hargreaves Lansdown UK');
});

t('returns null for unknown broker', () => {
  const text = 'Random PDF content from a broker we don\'t support yet.';
  assert.equal(_findTemplate(text), null);
});

// ── XP Investimentos extractor ──────────────────────────────────────────────
console.log('brokerPdfImporter TEMPLATES[XP].extract');

t('XP — extracts 3-line holdings table', () => {
  const text = [
    'XP INVESTIMENTOS CCTVM S.A.',
    'Posição Consolidada',
    '',
    'PETR4  100  R$ 30,50  R$ 3.050,00',
    'VALE3  200  R$ 65,20  R$ 13.040,00',
    'ITUB4   50  R$ 28,10  R$ 1.405,00',
  ].join('\n');
  const rows = xp.extract(text);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].symbol, 'PETR4');
  assert.equal(rows[0].quantity, 100);
  assert.equal(rows[0].entryPrice, 30.5);
  assert.equal(rows[0].investedAmount, 3050);
  assert.equal(rows[1].symbol, 'VALE3');
  assert.equal(rows[1].investedAmount, 13040);
});

t('XP — skips non-matching lines', () => {
  const text = [
    'Header row',
    'PETR4  100  R$ 30,50  R$ 3.050,00',
    'Subtotal: R$ 3.050,00',
  ].join('\n');
  const rows = xp.extract(text);
  assert.equal(rows.length, 1);
});

// ── Hargreaves Lansdown extractor ───────────────────────────────────────────
console.log('brokerPdfImporter TEMPLATES[HL].extract');

t('HL — extracts two UK equity rows', () => {
  const text = [
    'Hargreaves Lansdown — Investment Report',
    '',
    'Lloyds Banking Group plc   LLOY   1,000   £0.48    £480.00',
    'BP plc                     BP     500     £4.50    £2,250.00',
  ].join('\n');
  const rows = hl.extract(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].symbol, 'LLOY');
  assert.equal(rows[0].quantity, 1000);
  assert.equal(rows[0].entryPrice, 0.48);
  assert.equal(rows[0].investedAmount, 480);
  assert.equal(rows[1].symbol, 'BP');
  assert.equal(rows[1].investedAmount, 2250);
});

t('HL — ignores lines without three £-prefixed figures', () => {
  const text = [
    'Summary Table',
    'Lloyds Banking Group plc   LLOY   1,000   £0.48    £480.00',
    'Total holdings: £480.00',
  ].join('\n');
  const rows = hl.extract(text);
  assert.equal(rows.length, 1);
});

console.log('\n— done —');
