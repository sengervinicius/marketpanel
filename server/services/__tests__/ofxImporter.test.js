/**
 * ofxImporter.test.js — W6.6 OFX parser tests.
 * Usage: node server/services/__tests__/ofxImporter.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const { parse, _extract, _coerceNumber } = require('../ofxImporter');

function t(name, fn) {
  try { fn(); console.log(`  ok — ${name}`); }
  catch (e) { console.error(`  FAIL — ${name}: ${e.message}`); process.exitCode = 1; }
}

// ── helpers ────────────────────────────────────────────────────────────────
console.log('ofxImporter helpers');

t('_coerceNumber simple float', () => assert.equal(_coerceNumber('123.45'), 123.45));
t('_coerceNumber negative', () => assert.equal(_coerceNumber('-10.00'), -10));
t('_coerceNumber empty', () => assert.equal(_coerceNumber(''), null));

t('_extract handles SGML unterminated values', () => {
  assert.equal(_extract('CURDEF', '<CURDEF>USD\n<DTASOF>20240101'), 'USD');
});
t('_extract handles XML closed values', () => {
  assert.equal(_extract('CURDEF', '<CURDEF>BRL</CURDEF>'), 'BRL');
});

// ── OFX 2.0 XML flavour ─────────────────────────────────────────────────────
console.log('ofxImporter.parse (OFX 2.x XML)');

const OFX_XML = `<?xml version="1.0"?>
<?OFX OFXHEADER="200" VERSION="200" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <INVSTMTMSGSRSV1>
    <INVSTMTTRNRS>
      <INVSTMTRS>
        <DTASOF>20240115</DTASOF>
        <CURDEF>USD</CURDEF>
        <INVPOSLIST>
          <POSSTOCK>
            <INVPOS>
              <SECID>
                <UNIQUEID>037833100</UNIQUEID>
                <UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE>
              </SECID>
              <HELDINACCT>CASH</HELDINACCT>
              <POSTYPE>LONG</POSTYPE>
              <UNITS>10</UNITS>
              <UNITPRICE>185.50</UNITPRICE>
              <MKTVAL>1855.00</MKTVAL>
            </INVPOS>
            <TICKER>AAPL</TICKER>
          </POSSTOCK>
          <POSSTOCK>
            <INVPOS>
              <UNITS>5</UNITS>
              <UNITPRICE>420.00</UNITPRICE>
            </INVPOS>
            <TICKER>MSFT</TICKER>
          </POSSTOCK>
        </INVPOSLIST>
      </INVSTMTRS>
    </INVSTMTTRNRS>
  </INVSTMTMSGSRSV1>
</OFX>`;

t('parses OFX 2.x with two POSSTOCK holdings', () => {
  const { positions, rejected, warnings, currency } = parse(OFX_XML, { portfolioId: 'p1' });
  assert.equal(positions.length, 2);
  assert.equal(rejected.length, 0);
  assert.equal(currency, 'USD');
  assert.equal(positions[0].symbol, 'AAPL');
  assert.equal(positions[0].quantity, 10);
  assert.equal(positions[0].entryPrice, 185.5);
  assert.equal(positions[0].investedAmount, 1855);
  assert.equal(positions[0].portfolioId, 'p1');
  assert.equal(positions[0].source, 'ofx_import');
  assert.ok(!warnings.includes('ofx_had_no_invposlist'));
});

// ── OFX 1.x SGML flavour ────────────────────────────────────────────────────
console.log('ofxImporter.parse (OFX 1.x SGML)');

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII

<OFX>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<INVSTMTRS>
<CURDEF>USD
<INVPOSLIST>
<POSSTOCK>
<INVPOS>
<UNITS>100
<UNITPRICE>50.25
<MKTVAL>5025.00
</INVPOS>
<TICKER>GOOG
</POSSTOCK>
</INVPOSLIST>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
</OFX>`;

t('parses OFX 1.x SGML flavour', () => {
  const { positions } = parse(OFX_SGML);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].symbol, 'GOOG');
  assert.equal(positions[0].quantity, 100);
  assert.equal(positions[0].entryPrice, 50.25);
  assert.equal(positions[0].investedAmount, 5025);
});

// ── error / edge cases ─────────────────────────────────────────────────────
console.log('ofxImporter.parse error paths');

t('rejects non-OFX input', () => {
  assert.throws(() => parse('<html><body>not OFX</body></html>'), /ofx_parse_failed/);
});

t('flags non-equity security types as unsupported', () => {
  const ofx = `<OFX><INVPOSLIST>
    <POSMF><TICKER>VTSAX</TICKER><UNITS>10</UNITS><UNITPRICE>100</UNITPRICE></POSMF>
    <POSOPT><TICKER>AAPLOPT</TICKER><UNITS>1</UNITS></POSOPT>
  </INVPOSLIST></OFX>`;
  const { positions, rejected } = parse(ofx);
  assert.equal(positions.length, 0);
  assert.equal(rejected.filter(r => r.reason === 'unsupported_security_type').length, 2);
});

t('falls back to MKTVAL when qty+price missing', () => {
  const ofx = `<OFX><INVPOSLIST><POSSTOCK>
    <INVPOS><MKTVAL>999.99</MKTVAL></INVPOS>
    <TICKER>AMZN</TICKER>
  </POSSTOCK></INVPOSLIST></OFX>`;
  const { positions } = parse(ofx);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].investedAmount, 999.99);
});

t('empty OFX warns but does not throw', () => {
  const ofx = `<OFX></OFX>`;
  const { positions, warnings } = parse(ofx);
  assert.equal(positions.length, 0);
  assert.ok(warnings.includes('ofx_had_no_invposlist'));
});

console.log('\n— done —');
