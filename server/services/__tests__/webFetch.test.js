/**
 * webFetch.test.js
 *
 * Unit tests for the standalone webFetch helpers (URL validator and the
 * HTML → text extractor). These are exercised end-to-end via the
 * aiToolbox.webResearch test with a stubbed implementation; here we test
 * the real logic — no network, no Tavily, just the guardrails and
 * parsing.
 */

'use strict';

const assert = require('assert');
const path = require('path');

function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', '..', relativePath));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

const { _validateUrl, _htmlToText } = require('../webFetch');

(function testValidateUrl() {
  // Happy path
  assert.ok(_validateUrl('https://example.com').ok, 'https://example.com is valid');
  assert.ok(_validateUrl('http://ri.localiza.com/2025').ok, 'http URL is valid');

  // Protocol guards
  assert.ok(_validateUrl('file:///etc/passwd').error, 'file:// blocked');
  assert.ok(_validateUrl('ftp://example.com').error, 'ftp:// blocked');
  assert.ok(_validateUrl('javascript:alert(1)').error, 'javascript: blocked');

  // Private-range guards — SSRF containment
  assert.ok(_validateUrl('http://localhost/x').error, 'localhost blocked');
  assert.ok(_validateUrl('http://127.0.0.1/x').error, '127.0.0.1 blocked');
  assert.ok(_validateUrl('http://10.0.0.1/x').error, '10.0.0.0/8 blocked');
  assert.ok(_validateUrl('http://172.17.0.1/x').error, '172.16.0.0/12 blocked');
  assert.ok(_validateUrl('http://192.168.1.1/x').error, '192.168.0.0/16 blocked');
  assert.ok(_validateUrl('http://169.254.169.254/x').error, 'AWS metadata blocked');

  // Malformed input
  assert.ok(_validateUrl('').error, 'empty URL errors');
  assert.ok(_validateUrl('not a url').error, 'non-URL errors');
  assert.ok(_validateUrl(null).error, 'null errors');
})();

(function testHtmlToText() {
  const html = `<!DOCTYPE html><html><head>
    <title>Localiza RI — 2025 Annual Report</title>
    <style>body { color: red; }</style>
    <script>var x = 1;</script>
  </head>
  <body>
    <nav>Home | About | Contact</nav>
    <header><h1>Masthead</h1></header>
    <main>
      <h1>2025 Annual Report</h1>
      <p>Localiza ended 2025 with a total fleet of <strong>612,000</strong> vehicles across Latin America.</p>
      <p>Revenue grew 14% to R$ 45 billion.</p>
      <ul>
        <li>Brazil: 480,000 vehicles</li>
        <li>Mexico: 85,000 vehicles</li>
      </ul>
    </main>
    <footer>© 2025 Localiza S.A.</footer>
  </body></html>`;
  const out = _htmlToText(html);

  assert.strictEqual(out.title, 'Localiza RI — 2025 Annual Report', 'title extracted');
  assert.ok(out.text.includes('612,000'), 'fleet number preserved');
  assert.ok(out.text.includes('R$ 45 billion'), 'currency amount preserved');
  assert.ok(out.text.includes('Brazil: 480,000 vehicles'), 'list item preserved');

  // Navigation / header / footer / style / script content stripped
  assert.ok(!out.text.toLowerCase().includes('home | about | contact'), 'nav stripped');
  assert.ok(!out.text.toLowerCase().includes('masthead'), 'header stripped');
  assert.ok(!out.text.toLowerCase().includes('© 2025 localiza'), 'footer stripped');
  assert.ok(!out.text.includes('color: red'), 'style content stripped');
  assert.ok(!out.text.includes('var x = 1'), 'script content stripped');

  // No stray tag fragments leaking through
  assert.ok(!/<[a-z]/i.test(out.text), 'no HTML tags in output');
})();

(function testHtmlEntities() {
  const html = '<html><body><p>Price &amp; fleet: R$&nbsp;45&#160;bn &mdash; up 14%. &#x201C;Strong year&#x201D;.</p></body></html>';
  const out = _htmlToText(html);
  assert.ok(out.text.includes('&') && !out.text.includes('&amp;'), '&amp; decoded');
  assert.ok(!out.text.includes('&nbsp;') && !out.text.includes('&#160;'), 'nbsp decoded');
  assert.ok(out.text.includes('"Strong year"') || out.text.includes('\u201CStrong year\u201D'), 'smart quotes decoded');
})();

(function testEmptyHtml() {
  const out = _htmlToText('');
  assert.strictEqual(out, '', 'empty input returns empty');
})();

console.log('webFetch: all assertions passed.');
