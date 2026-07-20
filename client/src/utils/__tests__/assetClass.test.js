// node --test — Phase S W1 item 4: pure asset-class classifier.
// Run: node --test client/src/utils/__tests__/assetClass.test.js
//
// MIRROR NOTE: server/utils/__tests__/assetClass.test.js runs the SAME
// cases against the CommonJS mirror. Add cases in both files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSET_CLASSES, ASSET_CLASS_IDS, classifyAssetClass, assetClassLabel,
} from '../assetClass.js';

test('bucket order is EQ / FI / CRYPTO / FX / COMM (render + Brief order)', () => {
  assert.deepEqual(ASSET_CLASS_IDS, ['EQ', 'FI', 'CRYPTO', 'FX', 'COMM']);
  assert.deepEqual(ASSET_CLASSES.map(c => c.label),
    ['EQUITIES', 'FIXED INCOME', 'CRYPTO', 'FX & MACRO', 'COMMODITIES']);
});

test('symbol shape: X: prefix and known crypto pairs -> CRYPTO', () => {
  assert.equal(classifyAssetClass('X:BTCUSD'), 'CRYPTO');
  assert.equal(classifyAssetClass('BTCUSD'), 'CRYPTO');
  assert.equal(classifyAssetClass('ETHUSDT'), 'CRYPTO');
  assert.equal(classifyAssetClass('SOLBRL'), 'CRYPTO');
  assert.equal(classifyAssetClass('dogeusd'), 'CRYPTO'); // case-insensitive
});

test('symbol shape: C: prefix and ISO currency pairs -> FX & MACRO', () => {
  assert.equal(classifyAssetClass('C:EURUSD'), 'FX');
  assert.equal(classifyAssetClass('EURUSD'), 'FX');
  assert.equal(classifyAssetClass('USDBRL'), 'FX');
  assert.equal(classifyAssetClass('GBPBRL'), 'FX');
});

test('6-letter tickers that are NOT two ISO legs stay equities', () => {
  assert.equal(classifyAssetClass('ABCDEF'), 'EQ');
  assert.equal(classifyAssetClass('GOOGL'), 'EQ');
  assert.equal(classifyAssetClass('USDXYZ'), 'EQ'); // one bad leg
});

test('symbol shape: =F futures -> COMMODITIES', () => {
  assert.equal(classifyAssetClass('GC=F'), 'COMM');
  assert.equal(classifyAssetClass('CL=F'), 'COMM');
  assert.equal(classifyAssetClass('BZ=F'), 'COMM');
  assert.equal(classifyAssetClass('ZW=F'), 'COMM');
});

test('symbol shape: ^ indices/yields -> FX & MACRO bucket', () => {
  assert.equal(classifyAssetClass('^GSPC'), 'FX');
  assert.equal(classifyAssetClass('^BVSP'), 'FX');
  assert.equal(classifyAssetClass('^TNX'), 'FX');
});

test('bond-ish tickers -> FIXED INCOME (incl. .SA-suffixed B3 FI ETFs)', () => {
  assert.equal(classifyAssetClass('TLT'), 'FI');
  assert.equal(classifyAssetClass('HYG'), 'FI');
  assert.equal(classifyAssetClass('LQD'), 'FI');
  assert.equal(classifyAssetClass('AGG'), 'FI');
  assert.equal(classifyAssetClass('IMAB11.SA'), 'FI');
});

test('commodity ETFs (no =F shape) -> COMMODITIES', () => {
  assert.equal(classifyAssetClass('GLD'), 'COMM');
  assert.equal(classifyAssetClass('USO'), 'COMM');
  assert.equal(classifyAssetClass('CORN'), 'COMM');
});

test('.SA and plain tickers default to EQUITIES', () => {
  assert.equal(classifyAssetClass('AAPL'), 'EQ');
  assert.equal(classifyAssetClass('BRK-B'), 'EQ');
  assert.equal(classifyAssetClass('PETR4.SA'), 'EQ');
  assert.equal(classifyAssetClass('HGLG11.SA'), 'EQ');
  assert.equal(classifyAssetClass(''), 'EQ');
  assert.equal(classifyAssetClass(null), 'EQ');
});

test('instrument-metadata hints classify bond-ish/unknown symbols', () => {
  assert.equal(classifyAssetClass('LFT26', { instrumentType: 'BOND' }), 'FI');
  assert.equal(classifyAssetClass('NTNB35', { instrumentType: 'TREASURY' }), 'FI');
  assert.equal(classifyAssetClass('SOMETHING', { instrumentType: 'FUT' }), 'COMM');
  // Shape beats hint: an ISO pair is FX even if the hint says crypto.
  assert.equal(classifyAssetClass('EURUSD', { instrumentType: 'CRYPTO' }), 'FX');
});

test('per-symbol override wins over every rule; invalid overrides ignored', () => {
  assert.equal(classifyAssetClass('TLT', { override: 'EQ' }), 'EQ');
  assert.equal(classifyAssetClass('AAPL', { override: 'FI' }), 'FI');
  assert.equal(classifyAssetClass('X:BTCUSD', { override: 'COMM' }), 'COMM');
  assert.equal(classifyAssetClass('AAPL', { override: 'NONSENSE' }), 'EQ');
  assert.equal(classifyAssetClass('TLT', { override: '' }), 'FI');
});

test('assetClassLabel maps ids to section labels', () => {
  assert.equal(assetClassLabel('FI'), 'FIXED INCOME');
  assert.equal(assetClassLabel('COMM'), 'COMMODITIES');
  assert.equal(assetClassLabel('nope'), 'nope');
});
