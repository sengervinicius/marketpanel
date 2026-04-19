/**
 * server/parsers/newsParser.js — Wave 2 (WS5.1)
 *
 * Canonical news parsers. Every upstream news shape (Finnhub
 * `/company-news` + `/news`, Polygon `/v2/reference/news`, generic
 * RSS feeds — Bloomberg, Financial Times, Reuters — and Perplexity
 * Sonar Pro responses) is projected into the typed `NewsEvent`
 * defined in `server/adapters/contract.js`.
 *
 * The point of this module is to make the synthesis layer honest.
 * Before WS5, news reached the chat prompt as an opaque blob of
 * concatenated strings; there was no way for the prompt guard to
 * distinguish "no news found" from "news exists but we can't parse
 * it" (W6.10 Aegea case). By funneling every provider through
 * `makeNewsEvent`, we get:
 *
 *   1. A stable contract for UI rendering (headline, url, source,
 *      publishedAt — every field non-null by construction).
 *   2. Dedupe-friendly item IDs.
 *   3. Per-item confidence orthogonal to chain-level provenance.
 *   4. A single well-defined "no material news" sentinel detection
 *      for Perplexity (moved out of agentOrchestrator so both the
 *      legacy newsAgent path and the future typed news-router share
 *      one regex and one truth).
 *
 * None of these parsers throw — malformed input becomes an empty
 * event list, never an exception. The adapters above this layer
 * are responsible for wrapping the result in `Result<NewsEvent[]>`.
 */

'use strict';

const { makeNewsEvent } = require('../adapters/contract');

// ── Perplexity sentinel ──────────────────────────────────────────────
// Finalized string from the news-blind W6.10 fix; keeping it here as
// the single source of truth so agentOrchestrator and any future
// news-router that also calls Sonar use the same detection logic.
const NO_MATERIAL_NEWS_RE = /^\s*NO\s+MATERIAL\s+NEWS\s+FOUND/i;

// ── Shared helpers ───────────────────────────────────────────────────

/**
 * Extract a rough ticker list from free text. Matches `$SYMBOL` and
 * `(SYMBOL:EXCH)` patterns as well as bare uppercase symbols 2-5
 * chars preceded by a word boundary. Conservative on purpose —
 * false positives (e.g. "CEO", "USA") are filtered against a small
 * stop list.
 *
 * This helper is **not** called by the per-item parsers — Finnhub
 * and Polygon already provide explicit `related`/`tickers` arrays,
 * which are authoritative. It's exposed for the synthesis layer,
 * which may want to enrich a Perplexity-derived event with the
 * tickers mentioned in its headline text.
 *
 * @param {string} text
 * @returns {string[]} deduplicated uppercase tickers
 */
const TICKER_STOPLIST = new Set([
  'CEO', 'CFO', 'COO', 'CTO', 'USA', 'USD', 'EUR', 'GBP', 'JPY',
  'GDP', 'CPI', 'FED', 'ECB', 'BCB', 'OPEC', 'IMF', 'EIA', 'BLS',
  'IPO', 'ETF', 'REIT', 'LBO', 'MBO', 'AI', 'ML', 'ESG', 'IRR',
  'YTD', 'QTD', 'MTD', 'YOY', 'QOQ', 'MOM', 'DCF', 'EBIT', 'EBITDA',
]);

function extractTickers(text) {
  if (typeof text !== 'string' || !text) return [];
  const found = new Set();
  // $SYMBOL form (explicit)
  for (const m of text.matchAll(/\$([A-Z][A-Z0-9.-]{1,9})\b/g)) {
    found.add(m[1].toUpperCase());
  }
  // (SYMBOL:EXCH) form
  for (const m of text.matchAll(/\(([A-Z][A-Z0-9.-]{1,9})\s*:\s*[A-Z]{2,6}\)/g)) {
    found.add(m[1].toUpperCase());
  }
  // Bare uppercase word 2-5 chars — conservative
  for (const m of text.matchAll(/\b([A-Z]{2,5})\b/g)) {
    const t = m[1];
    if (!TICKER_STOPLIST.has(t)) found.add(t);
  }
  return Array.from(found);
}

/**
 * Strip HTML tags + decode common entities. Used by RSS parser and
 * Perplexity summary extraction.
 */
function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ── Finnhub ──────────────────────────────────────────────────────────
// Finnhub `/company-news` + `/news` items share the shape:
//   { id, category, datetime (unix sec), headline, image, related,
//     source, summary, url }
// When we queried with a ticker, confidence is 'high' (publisher
// vouched the item belongs to that symbol); for market-wide feed it
// is 'medium'.

/**
 * @param {Object} raw — upstream Finnhub news body
 * @param {string} [ticker] — query ticker, if any
 * @returns {import('../adapters/contract').NewsEvent | null}
 */
function parseFinnhubItem(raw, ticker) {
  if (!raw || typeof raw !== 'object') return null;
  const publishedAt = Number.isFinite(raw.datetime)
    ? new Date(raw.datetime * 1000).toISOString()
    : (typeof raw.datetime === 'string' ? raw.datetime : undefined);
  const tickers = raw.related
    ? String(raw.related).split(',').map(s => s.trim()).filter(Boolean)
    : (ticker ? [ticker] : []);
  return makeNewsEvent({
    id: raw.id != null ? `finnhub-${raw.id}` : undefined,
    headline: raw.headline,
    source: raw.source || 'Finnhub',
    url: raw.url,
    publishedAt,
    tickers,
    summary: raw.summary,
    imageUrl: raw.image,
    confidence: ticker ? 'high' : 'medium',
  });
}

/**
 * @param {Object[]} rows
 * @param {string} [ticker]
 * @returns {import('../adapters/contract').NewsEvent[]}
 */
function parseFinnhubResponse(rows, ticker) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    const ev = parseFinnhubItem(r, ticker);
    if (ev) out.push(ev);
  }
  return out;
}

// ── Polygon ──────────────────────────────────────────────────────────
// Polygon `/v2/reference/news` item shape:
//   { id, publisher: {name, homepage_url, logo_url, favicon_url},
//     title, author, published_utc, article_url, tickers: [],
//     image_url, description, keywords, insights }

/**
 * @param {Object} raw
 * @returns {import('../adapters/contract').NewsEvent | null}
 */
function parsePolygonItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const source = (raw.publisher && raw.publisher.name) || 'Polygon';
  return makeNewsEvent({
    id: raw.id ? `polygon-${raw.id}` : undefined,
    headline: raw.title,
    source,
    url: raw.article_url,
    publishedAt: raw.published_utc,
    tickers: Array.isArray(raw.tickers) ? raw.tickers : [],
    summary: raw.description,
    imageUrl: raw.image_url,
    // Polygon-supplied tickers → item-level confidence is high when
    // at least one ticker is attached (it's explicitly tagged by the
    // publisher); medium otherwise.
    confidence: Array.isArray(raw.tickers) && raw.tickers.length > 0 ? 'high' : 'medium',
  });
}

function parsePolygonResponse(body) {
  const rows = body && Array.isArray(body.results) ? body.results : [];
  const out = [];
  for (const r of rows) {
    const ev = parsePolygonItem(r);
    if (ev) out.push(ev);
  }
  return out;
}

// ── RSS (Bloomberg, FT, Reuters, …) ──────────────────────────────────
// Generic RSS 2.0 item shape; we only rely on <item>, <title>,
// <link>|<guid>, <pubDate>, <description>. CDATA wrappers are
// handled by the tolerant regexes. Input can be either a raw XML
// string or a pre-parsed `{title, link, pubDate, description}`
// object (shape matches `server/routes/market/lib/providers.js
// parseRss` rows).

/**
 * @param {Object|string} raw — pre-parsed RSS row or a raw `<item>` XML string
 * @param {string} sourceName — human-readable feed name
 * @returns {import('../adapters/contract').NewsEvent | null}
 */
function parseRssItem(raw, sourceName) {
  let title, link, pubDate, description;
  if (typeof raw === 'string') {
    title   = (raw.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
               raw.match(/<title>([^<]*)<\/title>/))?.[1]?.trim() || '';
    link    = (raw.match(/<link>([\s\S]*?)<\/link>/) ||
               raw.match(/<guid[^>]*>([\s\S]*?)<\/guid>/))?.[1]?.trim() || '';
    pubDate = raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
    description = (raw.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                   raw.match(/<description>([^<]*)<\/description>/))?.[1]?.trim() || '';
  } else if (raw && typeof raw === 'object') {
    // Accept either the providers.js-parsed shape (title/article_url/
    // published_utc/description) or an intermediate {title/link/
    // pubDate/description} shape.
    title = raw.title || '';
    link  = raw.article_url || raw.link || raw.url || '';
    pubDate = raw.published_utc || raw.pubDate || raw.publishedAt || '';
    description = raw.description || raw.summary || '';
  } else {
    return null;
  }

  if (!title || !link) return null;

  let publishedAt;
  if (pubDate) {
    const d = new Date(pubDate);
    if (Number.isFinite(d.getTime())) publishedAt = d.toISOString();
  }

  const name = typeof sourceName === 'string' && sourceName.trim()
    ? sourceName.trim()
    : 'RSS';

  return makeNewsEvent({
    id: `rss-${name.toLowerCase().replace(/\s+/g, '-')}-${Buffer.from(link).toString('base64').slice(0, 20)}`,
    headline: stripHtml(title),
    source: name,
    url: link,
    publishedAt,
    tickers: [],
    summary: stripHtml(description).slice(0, 300),
    // RSS feeds don't attach tickers → medium confidence ceiling.
    confidence: 'medium',
  });
}

/**
 * @param {string} xml — full RSS document
 * @param {string} sourceName
 * @returns {import('../adapters/contract').NewsEvent[]}
 */
function parseRssDocument(xml, sourceName) {
  if (typeof xml !== 'string' || !xml) return [];
  const out = [];
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const block of itemBlocks) {
    const ev = parseRssItem(block, sourceName);
    if (ev) out.push(ev);
  }
  return out;
}

// ── Perplexity Sonar Pro ─────────────────────────────────────────────
// Sonar responses are chat-style: one `content` string plus a list
// of `citations` (URLs, occasionally with titles). We:
//   1. Detect the "NO MATERIAL NEWS FOUND" sentinel up front —
//      consumers must short-circuit synthesis when this fires, not
//      paraphrase the stub content.
//   2. Turn each citation into a NewsEvent. Sonar doesn't provide
//      a per-citation publishedAt, so we mark confidence 'low' and
//      let publishedAt default to fetchedAt (it's what we have).
//   3. Preserve the raw content blob — callers that want full
//      context still get it via the second return tuple.

/**
 * @param {string} content — Sonar `choices[0].message.content`
 * @param {Array<{title?: string, url: string}>} [citations]
 * @returns {{events: import('../adapters/contract').NewsEvent[], noMaterialNews: boolean, raw: string}}
 */
function parsePerplexityResponse(content, citations) {
  const raw = typeof content === 'string' ? content : '';
  const noMaterialNews = NO_MATERIAL_NEWS_RE.test(raw);
  const events = [];
  if (!noMaterialNews && Array.isArray(citations)) {
    for (let i = 0; i < citations.length; i++) {
      const c = citations[i];
      if (!c) continue;
      const url = typeof c === 'string' ? c : c.url;
      const title = (typeof c === 'object' && c.title && typeof c.title === 'string')
        ? c.title
        : `Source ${i + 1}`;
      const ev = makeNewsEvent({
        headline: title,
        source: 'Perplexity',
        url,
        tickers: [],
        confidence: 'low',
      });
      if (ev) events.push(ev);
    }
  }
  return { events, noMaterialNews, raw };
}

// ── Exports ──────────────────────────────────────────────────────────

module.exports = {
  parseFinnhubItem,
  parseFinnhubResponse,
  parsePolygonItem,
  parsePolygonResponse,
  parseRssItem,
  parseRssDocument,
  parsePerplexityResponse,
  extractTickers,
  // Exposed for tests + any future direct callers.
  NO_MATERIAL_NEWS_RE,
  _stripHtml: stripHtml,
};
