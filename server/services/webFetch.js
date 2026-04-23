/**
 * services/webFetch.js
 *
 * Fetch a single URL and return cleaned, model-readable text. The second
 * half of the web-research capability: `web_research` returns ranked URLs,
 * `fetch_url` reads one of them in detail so the AI can pull fleet size,
 * headcount, ARR, store count, or any operational KPI that lives on an
 * IR page / 10-K / 20-F / press release / regulator filing.
 *
 * Design:
 *   - No new deps. Uses node-fetch (already pinned) and a minimal inline
 *     HTML → text pass. cheerio/html-to-text would be nicer but this file
 *     runs inside the AI tool budget and we want it boring.
 *   - PDFs are routed through pdf-parse (already a dep) so filings and
 *     earnings releases work end-to-end.
 *   - Hard caps on timeout (10s), response size (2 MB), and returned-text
 *     length (12 KB) so a runaway page can't burn the tool payload budget.
 *
 * SSRF containment (#238 / P1.3, D5.1):
 *   An LLM agent loop can be tricked into reading a URL that resolves to a
 *   private address — most famously 169.254.169.254, the AWS/GCP metadata
 *   service, but any loopback / RFC1918 / link-local / multicast / reserved
 *   block is equally bad. A string-pattern hostname check (old behaviour)
 *   does NOT catch:
 *     (a) a public hostname like evil.example.com that resolves to 127.0.0.1
 *     (b) decimal / octal / hex encoded IPs (http://2130706433 = 127.0.0.1)
 *     (c) a public URL that 302-redirects to a private address
 *   So the hardening here is:
 *     1. Parse the URL, reject non-http(s)
 *     2. Resolve the hostname via DNS, reject if ANY resolved address
 *        falls in a blocked numeric range (IPv4 or IPv6)
 *     3. Follow redirects manually (redirect:'manual'), re-validating each
 *        hop's hostname + resolved IPs
 *     4. Cap hops at 5, timeout 10s, response size 2 MB
 *     5. Log SSRF attempts to Sentry with url + resolvedIp so we can spot
 *        prompt-injection in the wild
 */

'use strict';

const fetch = require('node-fetch');
const dns = require('dns').promises;
const logger = require('../utils/logger');

// Sentry is loaded lazily so this module stays unit-testable without the
// full server boot. If Sentry isn't wired (tests, CLI), the capture no-ops.
let _Sentry = null;
function sentry() {
  if (_Sentry !== null) return _Sentry;
  try { _Sentry = require('@sentry/node'); } catch { _Sentry = false; }
  return _Sentry;
}

// Lazy: pdf-parse pulls a fair bit of memory; only load when needed.
let _pdfParse = null;
function pdfParse() {
  if (_pdfParse !== null) return _pdfParse;
  try { _pdfParse = require('pdf-parse'); } catch (_) { _pdfParse = false; }
  return _pdfParse;
}

const FETCH_TIMEOUT_MS   = 10_000;
const MAX_BYTES          = 2 * 1024 * 1024;     // 2 MB on the wire
const MAX_TEXT_CHARS     = 12_000;              // returned to the model
const MAX_REDIRECTS      = 5;
const USER_AGENT = 'ParticleTerminal/1.0 (+https://the-particle.com; research bot)';

// Fast-path string patterns — cheap first-line reject before we spend a
// DNS lookup. The real defence is the numeric IP check below; this just
// catches the obvious cases without round-tripping to a resolver.
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc/i,        // fc00::/7 unique-local IPv6
  /^fe[89ab]/i,  // fe80::/10 link-local IPv6
];

// ── Numeric IP range checks ─────────────────────────────────────────────
// IPv4 blocked ranges, as [networkInt, prefixLen]. Parsed from CIDR.
const IPV4_BLOCKED_CIDRS = [
  ['0.0.0.0',       8],   // "this host"
  ['10.0.0.0',      8],   // RFC1918 private
  ['100.64.0.0',    10],  // CGN (RFC6598) — reserved, not routable externally
  ['127.0.0.0',     8],   // loopback
  ['169.254.0.0',   16],  // link-local (INCLUDES 169.254.169.254 cloud metadata)
  ['172.16.0.0',    12],  // RFC1918 private
  ['192.0.0.0',     24],  // IETF protocol assignments
  ['192.0.2.0',     24],  // TEST-NET-1
  ['192.168.0.0',   16],  // RFC1918 private
  ['198.18.0.0',    15],  // benchmark (RFC2544)
  ['198.51.100.0',  24],  // TEST-NET-2
  ['203.0.113.0',   24],  // TEST-NET-3
  ['224.0.0.0',     4],   // multicast
  ['240.0.0.0',     4],   // reserved (includes 255.255.255.255 broadcast)
];

function ipv4ToInt(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedIpv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  for (const [net, bits] of IPV4_BLOCKED_CIDRS) {
    const netInt = ipv4ToInt(net);
    const mask   = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((n & mask) === (netInt & mask)) return true;
  }
  return false;
}

// IPv6: normalise and check against canonical blocked prefixes. We treat
// IPv4-mapped IPv6 (::ffff:a.b.c.d) by extracting the embedded IPv4 and
// running it through isBlockedIpv4, which is what cloud metadata checks
// historically missed.
function isBlockedIpv6(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const lower = ip.toLowerCase().replace(/%.+$/, ''); // strip zone id

  // IPv4-mapped: ::ffff:127.0.0.1
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  // Unspecified / loopback
  if (lower === '::' || lower === '::0' || lower === '::1') return true;

  // Unique-local fc00::/7 — first byte 0xfc or 0xfd
  if (/^fc[0-9a-f]{0,2}:/.test(lower) || /^fd[0-9a-f]{0,2}:/.test(lower)) return true;

  // Link-local fe80::/10 — high 10 bits are 1111111010
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true;

  // Multicast ff00::/8
  if (/^ff[0-9a-f]{1,2}:/.test(lower)) return true;

  // Discard / reserved
  if (lower === '100::' || lower.startsWith('100:')) return true;
  if (lower.startsWith('2001:db8:')) return true; // documentation

  return false;
}

function isBlockedIp(ip, family) {
  if (!ip) return false;
  if (family === 4 || (!family && /^\d+\.\d+\.\d+\.\d+$/.test(ip))) return isBlockedIpv4(ip);
  return isBlockedIpv6(ip);
}

function validateUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); }
  catch { return { error: 'invalid URL' }; }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { error: `unsupported protocol: ${u.protocol}` };
  }
  const host = u.hostname;
  if (!host) return { error: 'missing host' };

  // Strip bracket syntax for IPv6 ([::1] → ::1) before matching.
  const hostBare = host.replace(/^\[|\]$/g, '');

  for (const pat of BLOCKED_HOST_PATTERNS) {
    if (pat.test(hostBare)) return { error: `blocked host: ${host}` };
  }

  // If the hostname IS a literal IP, run the numeric check right here and
  // don't bother with DNS. This catches decimal (http://2130706433) and
  // octal (http://0177.0.0.1) that URL() normalises to dotted form.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostBare)) {
    if (isBlockedIpv4(hostBare)) return { error: `blocked IP: ${hostBare}` };
  } else if (/:/.test(hostBare)) {
    if (isBlockedIpv6(hostBare)) return { error: `blocked IP: ${hostBare}` };
  }

  return { ok: true, url: u };
}

/**
 * Resolve the hostname and verify no address falls in a blocked range.
 * Returns { safe, addresses } on success or { error, blockedIp } on reject.
 * Uses verbatim:true so we see the ACTUAL order the kernel would connect
 * to — if any of them is private, we block, since the kernel may pick it.
 */
async function validateHostDns(hostname) {
  // IP literal — already validated by validateUrl, nothing to resolve.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /:/.test(hostname.replace(/^\[|\]$/g, ''))) {
    return { safe: true, addresses: [] };
  }
  let results;
  try {
    results = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (e) {
    return { error: `dns resolution failed: ${e.code || e.message}` };
  }
  if (!Array.isArray(results) || results.length === 0) {
    return { error: `dns resolution returned no addresses for ${hostname}` };
  }
  for (const r of results) {
    if (isBlockedIp(r.address, r.family)) {
      return { error: `hostname ${hostname} resolved to blocked address ${r.address}`, blockedIp: r.address };
    }
  }
  return { safe: true, addresses: results.map(r => r.address) };
}

function reportSsrfAttempt(kind, detail) {
  try {
    logger.warn('webFetch', `SSRF attempt blocked: ${kind}`, detail);
  } catch { /* logger can't be the reason we fail */ }
  const S = sentry();
  if (S && typeof S.captureMessage === 'function') {
    try {
      S.captureMessage(`webFetch SSRF blocked: ${kind}`, {
        level: 'warning',
        tags: { module: 'webFetch', ssrfKind: kind },
        extra: detail,
      });
    } catch { /* never throw from the guard */ }
  }
}

/**
 * Strip HTML down to readable prose. Not perfect — doesn't respect
 * <article> vs <nav> semantics perfectly — but good enough to hand the
 * model an IR page or 10-K HTML exhibit. For regulatory filings the user
 * will usually end up at a PDF anyway, which goes through pdf-parse.
 */
function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  let s = html;

  // Remove <script>, <style>, <noscript>, <iframe>, <svg>, <nav>, <aside>,
  // <header>, <footer>, <form> blocks entirely (including their contents).
  s = s.replace(/<(script|style|noscript|iframe|svg|nav|aside|header|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // Extract <title> once before tag-stripping so we can prepend it.
  let title = '';
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  if (titleMatch) title = decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim();

  // Convert structural tags to newlines so paragraphs don't collide.
  s = s.replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|blockquote|pre)\b[^>]*>/gi, '\n');

  // Drop every remaining tag.
  s = s.replace(/<[^>]+>/g, ' ');

  // Decode entities.
  s = decodeEntities(s);

  // Collapse whitespace; preserve paragraph breaks.
  s = s.replace(/[ \t]+/g, ' ')
       .replace(/\s*\n\s*/g, '\n')
       .replace(/\n{3,}/g, '\n\n')
       .trim();

  return { title, text: s };
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ' '; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ' '; }
    });
}

/**
 * Fetch a URL and return cleaned text content.
 *
 * @param {string} rawUrl
 * @param {object} [opts]
 * @param {number} [opts.maxChars]  cap returned text (default 12 KB)
 * @returns {Promise<{url, title, text, contentType, bytes, truncated, source} | {error}>}
 */
async function fetchUrl(rawUrl, opts = {}) {
  const v0 = validateUrl(rawUrl);
  if (v0.error) {
    if (/blocked (host|IP):/.test(v0.error)) {
      reportSsrfAttempt('url-literal', { url: rawUrl, reason: v0.error });
    }
    return { error: v0.error };
  }

  // DNS-level validation BEFORE the first request — catches public
  // hostnames that resolve to private IPs.
  const dnsCheck = await validateHostDns(v0.url.hostname.replace(/^\[|\]$/g, ''));
  if (dnsCheck.error) {
    if (dnsCheck.blockedIp) {
      reportSsrfAttempt('dns-resolves-private', {
        url: rawUrl, hostname: v0.url.hostname, resolvedIp: dnsCheck.blockedIp,
      });
    }
    return { error: dnsCheck.error };
  }

  const maxChars = Math.min(MAX_TEXT_CHARS, Math.max(500, Number(opts.maxChars) || MAX_TEXT_CHARS));
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let currentUrl = v0.url.toString();
  let hops = 0;
  try {
    while (true) {
      const res = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8',
        },
        redirect: 'manual',        // we walk redirects by hand so each hop is re-validated
        signal: controller.signal,
        compress: true,
      });

      // Manual redirect handling — re-validate each hop against SSRF guards.
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        hops += 1;
        if (hops > MAX_REDIRECTS) {
          return { error: `too many redirects (>${MAX_REDIRECTS})`, url: currentUrl };
        }
        let nextUrl;
        try { nextUrl = new URL(res.headers.get('location'), currentUrl).toString(); }
        catch { return { error: `invalid redirect target from ${currentUrl}` }; }

        const vHop = validateUrl(nextUrl);
        if (vHop.error) {
          reportSsrfAttempt('redirect-to-private', { from: currentUrl, to: nextUrl, reason: vHop.error });
          return { error: `redirect blocked: ${vHop.error}`, url: nextUrl };
        }
        const hopHost = vHop.url.hostname.replace(/^\[|\]$/g, '');
        const hopDns = await validateHostDns(hopHost);
        if (hopDns.error) {
          reportSsrfAttempt('redirect-dns-private', {
            from: currentUrl, to: nextUrl, hostname: hopHost, resolvedIp: hopDns.blockedIp,
          });
          return { error: `redirect blocked: ${hopDns.error}`, url: nextUrl };
        }
        currentUrl = vHop.url.toString();
        continue;
      }

      if (!res.ok) {
        logger.warn('webFetch', `HTTP ${res.status}`, { url: currentUrl, status: res.status });
        return { error: `HTTP ${res.status}`, url: currentUrl };
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();

      // Read into buffer with size ceiling. node-fetch v2 doesn't honour
      // size on all edge cases, so double-check after read.
      const buf = await res.buffer();
      if (buf.length > MAX_BYTES) {
        return { error: `response too large: ${buf.length} bytes`, url: currentUrl };
      }

      // PDF branch — route through pdf-parse.
      const urlObj = new URL(currentUrl);
      if (contentType.includes('application/pdf') || urlObj.pathname.toLowerCase().endsWith('.pdf')) {
        const pp = pdfParse();
        if (!pp) return { error: 'pdf-parse unavailable', url: currentUrl };
        try {
          const parsed = await pp(buf, { max: 30 }); // cap pages for safety
          const text = (parsed.text || '').slice(0, maxChars);
          return {
            url: currentUrl,
            title: (parsed.info && parsed.info.Title) || urlObj.pathname.split('/').pop() || '',
            text,
            contentType: 'application/pdf',
            pages: parsed.numpages || null,
            bytes: buf.length,
            truncated: (parsed.text || '').length > maxChars,
            source: 'pdf-parse',
            asOf: new Date().toISOString(),
          };
        } catch (e) {
          return { error: `pdf parse failed: ${e.message}`, url: currentUrl };
        }
      }

      // HTML / plain text branch.
      const raw = buf.toString('utf8');
      let title = '';
      let text = '';
      if (contentType.includes('text/html') || /^\s*</.test(raw)) {
        const r = htmlToText(raw);
        title = r.title || '';
        text = r.text || '';
      } else {
        text = raw;
      }
      const truncated = text.length > maxChars;
      if (truncated) text = text.slice(0, maxChars);

      return {
        url: currentUrl,
        title,
        text,
        contentType: contentType || 'text/html',
        bytes: buf.length,
        truncated,
        source: 'webFetch',
        asOf: new Date().toISOString(),
      };
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      return { error: `timeout after ${FETCH_TIMEOUT_MS}ms`, url: rawUrl };
    }
    logger.warn('webFetch', 'fetch failed', { url: rawUrl, error: e.message });
    return { error: e.message || 'fetch failed', url: rawUrl };
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  fetchUrl,
  // Exported for unit tests:
  _validateUrl: validateUrl,
  _validateHostDns: validateHostDns,
  _isBlockedIpv4: isBlockedIpv4,
  _isBlockedIpv6: isBlockedIpv6,
  _htmlToText: htmlToText,
};
