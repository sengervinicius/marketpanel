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
 *   - URL is validated — only http(s), no file://, no IP literals, no
 *     localhost. This tool runs server-side and will be reachable by the
 *     agent loop, so SSRF containment matters.
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

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
const USER_AGENT = 'ParticleTerminal/1.0 (+https://the-particle.com; research bot)';

// Private / internal address guards — block SSRF.
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

function validateUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); }
  catch { return { error: 'invalid URL' }; }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { error: `unsupported protocol: ${u.protocol}` };
  }
  const host = u.hostname;
  if (!host) return { error: 'missing host' };
  for (const pat of BLOCKED_HOST_PATTERNS) {
    if (pat.test(host)) return { error: `blocked host: ${host}` };
  }
  return { ok: true, url: u };
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
  const v = validateUrl(rawUrl);
  if (v.error) return { error: v.error };

  const maxChars = Math.min(MAX_TEXT_CHARS, Math.max(500, Number(opts.maxChars) || MAX_TEXT_CHARS));
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(v.url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      follow: 5,
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn('webFetch', `HTTP ${res.status}`, { url: v.url.toString(), status: res.status });
      return { error: `HTTP ${res.status}`, url: v.url.toString() };
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    // Read into buffer with size ceiling. node-fetch v2 doesn't honour
    // size on all edge cases, so double-check after read.
    const buf = await res.buffer();
    if (buf.length > MAX_BYTES) {
      return { error: `response too large: ${buf.length} bytes`, url: v.url.toString() };
    }

    // PDF branch — route through pdf-parse.
    if (contentType.includes('application/pdf') || v.url.pathname.toLowerCase().endsWith('.pdf')) {
      const pp = pdfParse();
      if (!pp) return { error: 'pdf-parse unavailable', url: v.url.toString() };
      try {
        const parsed = await pp(buf, { max: 30 }); // cap pages for safety
        const text = (parsed.text || '').slice(0, maxChars);
        return {
          url: v.url.toString(),
          title: (parsed.info && parsed.info.Title) || v.url.pathname.split('/').pop() || '',
          text,
          contentType: 'application/pdf',
          pages: parsed.numpages || null,
          bytes: buf.length,
          truncated: (parsed.text || '').length > maxChars,
          source: 'pdf-parse',
          asOf: new Date().toISOString(),
        };
      } catch (e) {
        return { error: `pdf parse failed: ${e.message}`, url: v.url.toString() };
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
      url: v.url.toString(),
      title,
      text,
      contentType: contentType || 'text/html',
      bytes: buf.length,
      truncated,
      source: 'webFetch',
      asOf: new Date().toISOString(),
    };
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
  _htmlToText: htmlToText,
};
