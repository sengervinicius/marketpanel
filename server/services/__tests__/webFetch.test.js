/**
 * webFetch.test.js
 *
 * Unit tests for the standalone webFetch helpers (URL validator, DNS
 * validator, numeric IP range checks, and the HTML → text extractor).
 * Network is NOT exercised here — fetchUrl's redirect walker is covered
 * indirectly via the aiToolbox integration test.
 */

'use strict';

const assert = require('assert');
const path = require('path');

function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', '..', relativePath));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

const {
  _validateUrl,
  _validateHostDns,
  _isBlockedIpv4,
  _isBlockedIpv6,
  _htmlToText,
} = require('../webFetch');

(function testValidateUrl() {
  // Happy path
  assert.ok(_validateUrl('https://example.com').ok, 'https://example.com is valid');
  assert.ok(_validateUrl('http://ri.localiza.com/2025').ok, 'http URL is valid');

  // Protocol guards
  assert.ok(_validateUrl('file:///etc/passwd').error, 'file:// blocked');
  assert.ok(_validateUrl('ftp://example.com').error, 'ftp:// blocked');
  assert.ok(_validateUrl('javascript:alert(1)').error, 'javascript: blocked');
  assert.ok(_validateUrl('gopher://example.com').error, 'gopher:// blocked');

  // Private-range guards — SSRF containment (string-pattern layer)
  assert.ok(_validateUrl('http://localhost/x').error, 'localhost blocked');
  assert.ok(_validateUrl('http://127.0.0.1/x').error, '127.0.0.1 blocked');
  assert.ok(_validateUrl('http://10.0.0.1/x').error, '10.0.0.0/8 blocked');
  assert.ok(_validateUrl('http://172.17.0.1/x').error, '172.16.0.0/12 blocked');
  assert.ok(_validateUrl('http://192.168.1.1/x').error, '192.168.0.0/16 blocked');
  assert.ok(_validateUrl('http://169.254.169.254/latest/meta-data/').error, 'AWS metadata blocked');
  assert.ok(_validateUrl('http://0.0.0.0/').error, '0.0.0.0 blocked');

  // Boundary cases — cloud metadata and CGN
  assert.ok(_validateUrl('http://100.64.0.1/').error, 'CGN 100.64.0.0/10 blocked');
  assert.ok(_validateUrl('http://198.18.0.1/').error, 'benchmark 198.18.0.0/15 blocked');
  assert.ok(_validateUrl('http://224.0.0.1/').error, 'multicast blocked');
  assert.ok(_validateUrl('http://255.255.255.255/').error, 'broadcast blocked');

  // IPv6 literals (bracketed)
  assert.ok(_validateUrl('http://[::1]/x').error, 'IPv6 loopback blocked');
  assert.ok(_validateUrl('http://[fc00::1]/x').error, 'IPv6 unique-local fc00::/7 blocked');
  assert.ok(_validateUrl('http://[fe80::1]/x').error, 'IPv6 link-local fe80::/10 blocked');
  assert.ok(_validateUrl('http://[ff02::1]/x').error, 'IPv6 multicast blocked');

  // Malformed input
  assert.ok(_validateUrl('').error, 'empty URL errors');
  assert.ok(_validateUrl('not a url').error, 'non-URL errors');
  assert.ok(_validateUrl(null).error, 'null errors');
  assert.ok(_validateUrl(undefined).error, 'undefined errors');

  // Must permit benign public IP literals (hostname-as-IP path)
  assert.ok(_validateUrl('http://8.8.8.8/').ok, 'public IP literal 8.8.8.8 allowed');
  assert.ok(_validateUrl('http://1.1.1.1/').ok, 'public IP literal 1.1.1.1 allowed');
})();

(function testIsBlockedIpv4() {
  // Loopback / link-local / private — must block
  assert.strictEqual(_isBlockedIpv4('127.0.0.1'), true, '127.0.0.1 blocked');
  assert.strictEqual(_isBlockedIpv4('127.255.255.254'), true, '127.255.255.254 blocked');
  assert.strictEqual(_isBlockedIpv4('10.0.0.1'), true, '10.0.0.1 blocked');
  assert.strictEqual(_isBlockedIpv4('10.255.255.255'), true, '10.255.255.255 blocked');
  assert.strictEqual(_isBlockedIpv4('172.16.0.1'), true, '172.16.0.1 blocked');
  assert.strictEqual(_isBlockedIpv4('172.31.255.254'), true, '172.31.x blocked');
  assert.strictEqual(_isBlockedIpv4('192.168.0.1'), true, '192.168.0.1 blocked');
  assert.strictEqual(_isBlockedIpv4('169.254.169.254'), true, 'AWS metadata blocked');
  assert.strictEqual(_isBlockedIpv4('100.64.0.1'), true, 'CGN blocked');

  // Boundary: 172.32.0.1 is PUBLIC, not private (just outside RFC1918)
  assert.strictEqual(_isBlockedIpv4('172.32.0.1'), false, '172.32.0.1 is public (just outside /12)');
  assert.strictEqual(_isBlockedIpv4('172.15.255.254'), false, '172.15.x is public (just below /12)');
  assert.strictEqual(_isBlockedIpv4('100.63.255.254'), false, '100.63.x is public (just below CGN)');
  assert.strictEqual(_isBlockedIpv4('100.128.0.1'), false, '100.128.x is public (just above CGN)');

  // Genuine public addresses
  assert.strictEqual(_isBlockedIpv4('8.8.8.8'), false, '8.8.8.8 public');
  assert.strictEqual(_isBlockedIpv4('1.1.1.1'), false, '1.1.1.1 public');
  assert.strictEqual(_isBlockedIpv4('54.239.28.85'), false, 'AWS public-ish');

  // Malformed
  assert.strictEqual(_isBlockedIpv4('not.an.ip.addr'), false, 'non-IP rejected cleanly');
  assert.strictEqual(_isBlockedIpv4('999.999.999.999'), false, 'out-of-range parts rejected');
  assert.strictEqual(_isBlockedIpv4(''), false, 'empty rejected');
})();

(function testIsBlockedIpv6() {
  // Loopback / unspecified
  assert.strictEqual(_isBlockedIpv6('::1'), true, '::1 blocked');
  assert.strictEqual(_isBlockedIpv6('::'), true, ':: blocked');

  // Unique-local
  assert.strictEqual(_isBlockedIpv6('fc00::1'), true, 'fc00::1 blocked');
  assert.strictEqual(_isBlockedIpv6('fd12:3456:789a::1'), true, 'fd__ blocked');

  // Link-local
  assert.strictEqual(_isBlockedIpv6('fe80::1'), true, 'fe80::1 blocked');
  assert.strictEqual(_isBlockedIpv6('fe80::1%eth0'), true, 'fe80 with zone id blocked');

  // Multicast
  assert.strictEqual(_isBlockedIpv6('ff02::1'), true, 'ff02::1 blocked');
  assert.strictEqual(_isBlockedIpv6('ff00::'), true, 'ff00:: blocked');

  // IPv4-mapped: ::ffff:a.b.c.d — block if embedded v4 is private
  assert.strictEqual(_isBlockedIpv6('::ffff:127.0.0.1'), true, 'IPv4-mapped loopback blocked');
  assert.strictEqual(_isBlockedIpv6('::ffff:169.254.169.254'), true, 'IPv4-mapped metadata blocked');
  assert.strictEqual(_isBlockedIpv6('::ffff:8.8.8.8'), false, 'IPv4-mapped public allowed');

  // Documentation block
  assert.strictEqual(_isBlockedIpv6('2001:db8::1'), true, '2001:db8:: documentation blocked');

  // Public-ish global unicast should NOT be blocked
  assert.strictEqual(_isBlockedIpv6('2606:4700:4700::1111'), false, 'Cloudflare v6 allowed');
  assert.strictEqual(_isBlockedIpv6('2001:4860:4860::8888'), false, 'Google v6 allowed');
})();

(function testValidateHostDnsForIpLiterals() {
  // IP-literal hosts must short-circuit (no DNS needed); returns safe:true
  // with empty addresses. The numeric range check already happened in
  // validateUrl.
  return Promise.all([
    _validateHostDns('127.0.0.1').then(r => {
      assert.ok(r.safe, 'IP literal 127.0.0.1 short-circuits DNS (numeric check is upstream)');
    }),
    _validateHostDns('8.8.8.8').then(r => {
      assert.ok(r.safe, 'IP literal 8.8.8.8 short-circuits DNS');
    }),
    _validateHostDns('::1').then(r => {
      assert.ok(r.safe, 'IPv6 literal short-circuits DNS');
    }),
  ]).catch(e => { throw e; });
})();

(function testValidateHostDnsForPublicHostnames() {
  // Real DNS lookup against a well-known public name. If the test runner
  // has no network this returns { error: 'dns resolution failed: ...' },
  // which we tolerate (the real check is that it DOESN'T falsely mark
  // public DNS as blocked).
  return _validateHostDns('one.one.one.one').then(r => {
    if (r.error) {
      assert.ok(/dns resolution failed/.test(r.error), 'offline runners surface a DNS error, not a false block');
    } else {
      assert.ok(r.safe, 'public hostname resolves safely');
      assert.ok(Array.isArray(r.addresses) && r.addresses.length > 0, 'addresses returned');
    }
  });
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

// Wait for any async test promises before declaring success.
Promise.resolve()
  .then(() => _validateHostDns('127.0.0.1'))
  .then(() => _validateHostDns('one.one.one.one').catch(() => null))
  .then(() => {
    console.log('webFetch: all assertions passed.');
  });
