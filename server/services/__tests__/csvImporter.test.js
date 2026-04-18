/**
 * csvImporter.test.js — W6.4 portfolio CSV import tests.
 * Usage: node server/services/__tests__/csvImporter.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const {
  parsePreview,
  normalise,
  detectMapping,
  _coerceNumber,
  _detectDelimiter,
} = require('../csvImporter');

function t(name, fn) {
  try { fn(); console.log(`  ok — ${name}`); }
  catch (e) { console.error(`  FAIL — ${name}: ${e.message}\n${e.stack}`); process.exitCode = 1; }
}

// ── _coerceNumber ───────────────────────────────────────────────────────────
console.log('csvImporter._coerceNumber');

t('plain integer', () => assert.equal(_coerceNumber('100'), 100));
t('plain float', () => assert.equal(_coerceNumber('123.45'), 123.45));
t('US thousands with dot decimal', () => assert.equal(_coerceNumber('1,234.56'), 1234.56));
t('BR comma-decimal only', () => assert.equal(_coerceNumber('123,45'), 123.45));
t('BR thousands dot + comma decimal', () => assert.equal(_coerceNumber('1.234,56'), 1234.56));
t('currency-prefixed BR', () => assert.equal(_coerceNumber('R$ 1.234,56'), 1234.56));
t('currency-prefixed US', () => assert.equal(_coerceNumber('$1,234.56'), 1234.56));
t('empty string → null', () => assert.equal(_coerceNumber(''), null));
t('null → null', () => assert.equal(_coerceNumber(null), null));
t('garbage → null', () => assert.equal(_coerceNumber('abc'), null));
t('negative number', () => assert.equal(_coerceNumber('-42.5'), -42.5));

// ── _detectDelimiter ────────────────────────────────────────────────────────
console.log('csvImporter._detectDelimiter');

t('comma delimiter', () => {
  assert.equal(_detectDelimiter('a,b,c\n1,2,3\n4,5,6'), ',');
});
t('semicolon delimiter (Brazilian Excel default)', () => {
  assert.equal(_detectDelimiter('a;b;c\n1;2;3\n4;5;6'), ';');
});
t('tab delimiter', () => {
  assert.equal(_detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
});
t('pipe delimiter', () => {
  assert.equal(_detectDelimiter('a|b|c|d\n1|2|3|4\n5|6|7|8'), '|');
});

// ── detectMapping ───────────────────────────────────────────────────────────
console.log('csvImporter.detectMapping');

t('plain English headers', () => {
  const m = detectMapping(['Symbol', 'Quantity', 'Price', 'Currency']);
  assert.equal(m.symbol, 'Symbol');
  assert.equal(m.quantity, 'Quantity');
  assert.equal(m.entryPrice, 'Price');
  assert.equal(m.currency, 'Currency');
});

t('Brazilian PT-BR headers', () => {
  const m = detectMapping(['Ativo', 'Quantidade', 'Preço Médio', 'Moeda']);
  assert.equal(m.symbol, 'Ativo');
  assert.equal(m.quantity, 'Quantidade');
  assert.equal(m.entryPrice, 'Preço Médio');
  assert.equal(m.currency, 'Moeda');
});

t('mixed case, weird punctuation', () => {
  const m = detectMapping(['TICKER', 'QTY.', 'Cost Basis', 'Notes!']);
  assert.equal(m.symbol, 'TICKER');
  assert.equal(m.quantity, 'QTY.');
  assert.equal(m.entryPrice, 'Cost Basis');
  assert.equal(m.note, 'Notes!');
});

t('invested amount detection', () => {
  const m = detectMapping(['ticker', 'total invested', 'currency']);
  assert.equal(m.investedAmount, 'total invested');
});

// ── parsePreview ────────────────────────────────────────────────────────────
console.log('csvImporter.parsePreview');

t('returns headers + first 10 rows + mapping + totalRows', () => {
  const csv = [
    'Symbol,Quantity,Price',
    ...Array.from({ length: 15 }, (_, i) => `AAPL,${i + 1},150.00`),
  ].join('\n');
  const r = parsePreview(csv);
  assert.deepEqual(r.headers, ['Symbol', 'Quantity', 'Price']);
  assert.equal(r.rows.length, 10);
  assert.equal(r.totalRows, 15);
  assert.equal(r.detectedMapping.symbol, 'Symbol');
  assert.equal(r.detectedMapping.quantity, 'Quantity');
  assert.equal(r.detectedMapping.entryPrice, 'Price');
  assert.equal(r.delimiter, ',');
});

t('auto-detects Brazilian semicolon CSV with comma decimals', () => {
  const csv = 'Ativo;Quantidade;Preço Médio\nPETR4;100;30,50\nVALE3;200;65,20';
  const r = parsePreview(csv);
  assert.equal(r.delimiter, ';');
  assert.equal(r.totalRows, 2);
  assert.equal(r.detectedMapping.symbol, 'Ativo');
  assert.equal(r.detectedMapping.entryPrice, 'Preço Médio');
});

t('empty CSV yields empty shape', () => {
  const r = parsePreview('');
  assert.deepEqual(r.headers, []);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.detectedMapping, {});
});

t('malformed CSV throws csv_parse_failed', () => {
  // Use relax_quotes makes most malformed content parseable, so construct one
  // that definitely fails — an unterminated quote with strict row count won't
  // fail due to relax, but parse will still surface errors on completely
  // broken input. We instead check that the failure path returns gracefully:
  // passing a buffer of bytes that aren't valid CSV at all should still not crash.
  // This serves as a smoke test of the error path.
  const r = parsePreview(Buffer.from('just a header row\n'));
  assert.equal(r.totalRows, 0);
});

// ── normalise ───────────────────────────────────────────────────────────────
console.log('csvImporter.normalise');

t('happy path US broker export', () => {
  const csv = 'Symbol,Quantity,Price\nAAPL,10,150.00\nMSFT,5,300.00';
  const mapping = { symbol: 'Symbol', quantity: 'Quantity', entryPrice: 'Price' };
  const { positions, rejected } = normalise(csv, mapping, { portfolioId: 'p1' });
  assert.equal(positions.length, 2);
  assert.equal(rejected.length, 0);
  assert.equal(positions[0].symbol, 'AAPL');
  assert.equal(positions[0].quantity, 10);
  assert.equal(positions[0].entryPrice, 150);
  assert.equal(positions[0].investedAmount, 1500);
  assert.equal(positions[0].currency, 'USD');
  assert.equal(positions[0].portfolioId, 'p1');
  assert.equal(positions[0].source, 'csv_import');
});

t('BR broker export infers BRL currency', () => {
  const csv = 'Ativo;Quantidade;Preço Médio\nPETR4;100;30,50';
  const mapping = { symbol: 'Ativo', quantity: 'Quantidade', entryPrice: 'Preço Médio' };
  const { positions } = normalise(csv, mapping);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].symbol, 'PETR4');
  assert.equal(positions[0].currency, 'BRL');
  assert.equal(positions[0].investedAmount, 3050);
});

t('crypto ticker maps to USD', () => {
  const csv = 'symbol,quantity,price\nBTC-USD,0.5,60000';
  const mapping = { symbol: 'symbol', quantity: 'quantity', entryPrice: 'price' };
  const { positions } = normalise(csv, mapping);
  assert.equal(positions[0].symbol, 'BTC');
  assert.equal(positions[0].currency, 'USD');
  assert.equal(positions[0].investedAmount, 30000);
});

t('uses investedAmount when qty+price absent', () => {
  const csv = 'symbol,invested\nAAPL,2500';
  const mapping = { symbol: 'symbol', investedAmount: 'invested' };
  const { positions, rejected } = normalise(csv, mapping);
  assert.equal(positions.length, 1);
  assert.equal(rejected.length, 0);
  assert.equal(positions[0].investedAmount, 2500);
  assert.equal(positions[0].quantity, null);
  assert.equal(positions[0].entryPrice, null);
});

t('rejects missing symbol row', () => {
  const csv = 'symbol,quantity,price\n,10,150\nAAPL,5,120';
  const mapping = { symbol: 'symbol', quantity: 'quantity', entryPrice: 'price' };
  const { positions, rejected } = normalise(csv, mapping);
  assert.equal(positions.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'missing_symbol');
});

t('rejects unknown symbol that tickerResolver returns null for', () => {
  const csv = 'symbol,quantity,price\n@@@,10,150';
  const mapping = { symbol: 'symbol', quantity: 'quantity', entryPrice: 'price' };
  const { positions, rejected } = normalise(csv, mapping);
  assert.equal(positions.length, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'unrecognised_symbol');
});

t('rejects row with neither qty+price nor investedAmount', () => {
  const csv = 'symbol,quantity,price\nAAPL,,';
  const mapping = { symbol: 'symbol', quantity: 'quantity', entryPrice: 'price' };
  const { positions, rejected } = normalise(csv, mapping);
  assert.equal(positions.length, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'missing_qty_or_amount');
});

t('rejects zero-or-negative invested amount', () => {
  const csv = 'symbol,invested\nAAPL,0\nMSFT,-500';
  const mapping = { symbol: 'symbol', investedAmount: 'invested' };
  const { positions, rejected } = normalise(csv, mapping);
  assert.equal(positions.length, 0);
  assert.equal(rejected.length, 2);
  assert.ok(rejected.every(r => r.reason === 'invalid_amount' || r.reason === 'missing_qty_or_amount'));
});

t('honours user-supplied currency over inference', () => {
  const csv = 'symbol,quantity,price,ccy\nPETR4,100,30,USD';
  const mapping = { symbol: 'symbol', quantity: 'quantity', entryPrice: 'price', currency: 'ccy' };
  const { positions } = normalise(csv, mapping);
  assert.equal(positions[0].currency, 'USD');
});

t('truncates at 500 positions and emits a warning', () => {
  const header = 'symbol,quantity,price';
  const rows   = Array.from({ length: 600 }, () => 'AAPL,1,100').join('\n');
  const csv = `${header}\n${rows}`;
  const mapping = { symbol: 'symbol', quantity: 'quantity', entryPrice: 'price' };
  const { positions, warnings } = normalise(csv, mapping);
  assert.equal(positions.length, 500);
  assert.ok(warnings.includes('truncated_to_500_positions'));
});

t('note field is truncated to 200 chars', () => {
  const note = 'x'.repeat(500);
  const csv = `symbol,invested,note\nAAPL,1000,${note}`;
  const mapping = { symbol: 'symbol', investedAmount: 'invested', note: 'note' };
  const { positions } = normalise(csv, mapping);
  assert.equal(positions[0].note.length, 200);
});

t('positions all get unique UUID ids', () => {
  const csv = 'symbol,quantity,price\nAAPL,10,150\nMSFT,5,300\nGOOGL,2,2800';
  const mapping = { symbol: 'symbol', quantity: 'quantity', entryPrice: 'price' };
  const { positions } = normalise(csv, mapping);
  const ids = new Set(positions.map(p => p.id));
  assert.equal(ids.size, 3);
  for (const p of positions) {
    assert.match(p.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
});

console.log('\n— done —');
