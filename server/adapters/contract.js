/**
 * server/adapters/contract.js
 * ─────────────────────────────────────────────────────────────────────
 * The Data Adapter Contract — WS1 foundation.
 *
 * Every data source (market data, news, fundamentals, calendar, options,
 * curves, macro) implements this typed interface. The router consults the
 * Coverage Matrix (DB) before dispatch and routes requests to the adapter
 * chain with highest declared confidence for the (region × asset × capability)
 * cell. Adapters fail closed with a typed ProviderError — never return null,
 * never silently degrade.
 *
 * This module is pure scaffolding (Result, ProviderError, Provenance,
 * AdapterRegistry). Concrete adapters live in sibling files:
 *   - polygonAdapter.js         (WS1 golden path — US equities, forex, crypto)
 *   - finnhubAdapter.js         (WS1 week 5-6 — global quotes + macro calendar)
 *   - twelvedataAdapter.js      (WS2 — global cross-source)
 *   - eulerpoolAdapter.js       (EU fundamentals)
 *   - unusualWhalesAdapter.js   (US options flow + Congress trades)
 *   - sonarAdapter.js           (Perplexity cited research)
 *   - ecbSdmxAdapter.js         (WS3 — EU sovereign curves)
 *   - fredAdapter.js            (US + international macro series)
 *
 * See docs/adapters/CONTRACT.md for the human-readable spec. Every new
 * adapter MUST read that doc first and conform to it.
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── ProviderError taxonomy ───────────────────────────────────────────
// Every adapter failure maps to exactly one of these codes. Callers
// switch on `code`, not on error message strings.

const ProviderErrorCode = Object.freeze({
  NOT_IN_COVERAGE:   'NOT_IN_COVERAGE',    // symbol/region/capability not claimed by this adapter
  RATE_LIMITED:      'RATE_LIMITED',       // upstream 429 or internal budget exceeded
  UPSTREAM_5XX:      'UPSTREAM_5XX',       // 5xx from provider
  UPSTREAM_4XX:      'UPSTREAM_4XX',       // non-429 4xx (bad request, forbidden, etc.)
  TIMEOUT:           'TIMEOUT',            // request exceeded configured deadline
  INVALID_SYMBOL:    'INVALID_SYMBOL',     // symbol rejected by upstream
  AUTH:              'AUTH',               // missing/invalid API key or expired token
  SCHEMA_MISMATCH:   'SCHEMA_MISMATCH',    // upstream response did not match expected schema
  STALE_DATA:        'STALE_DATA',         // freshness SLA violated
  DISABLED:          'DISABLED',           // adapter kill-switched (feature flag / ops)
  UNKNOWN:           'UNKNOWN',            // fallback — MUST be accompanied by cause metadata
});

/**
 * A typed error returned by every adapter method. Never throw — return.
 * @typedef {Object} ProviderError
 * @property {string} code       — one of ProviderErrorCode values
 * @property {string} adapter    — adapter name (e.g. 'polygon', 'finnhub')
 * @property {string} [upstream] — raw upstream error code/status if available
 * @property {string} [message]  — human-readable message (logs only, never to user)
 * @property {Object} [meta]     — structured cause metadata
 * @property {string} [requestId] — correlation ID
 * @property {number} [retryAfterMs] — server-suggested retry delay for RATE_LIMITED
 */
function makeProviderError(code, adapter, opts = {}) {
  if (!ProviderErrorCode[code]) {
    throw new Error(`Invalid ProviderErrorCode: ${code}`);
  }
  return Object.freeze({
    code,
    adapter,
    upstream: opts.upstream,
    message: opts.message,
    meta: opts.meta,
    requestId: opts.requestId,
    retryAfterMs: opts.retryAfterMs,
  });
}

// ── Result<T, ProviderError> ─────────────────────────────────────────
// Discriminated union. All adapter methods return one of these shapes.
// Callers MUST check .ok before reading .data.

/**
 * @template T
 * @typedef {{ok: true, data: T, provenance: Provenance} | {ok: false, error: ProviderError, provenance: Provenance}} Result
 */

function ok(data, provenance) {
  return Object.freeze({ ok: true, data, provenance });
}

function err(error, provenance) {
  return Object.freeze({ ok: false, error, provenance });
}

// ── Provenance envelope ──────────────────────────────────────────────
// Every Result carries a Provenance block. This is what makes the
// platform honest — the UI can render "last updated at HH:MM:SS from
// source X" without guessing, and the quality harness can verify
// freshness against the declared SLA.

/**
 * @typedef {Object} Provenance
 * @property {string}   source         — adapter name that served this response
 * @property {string}   fetchedAt      — ISO 8601 timestamp when response was produced
 * @property {number}   freshnessMs    — age of the underlying data in ms (0 for live streams)
 * @property {string}   confidence     — 'high' | 'medium' | 'low' | 'unverified'
 * @property {string[]} adapterChain   — ordered list of adapters attempted (e.g. ['polygon','finnhub-fallback'])
 * @property {string[]} [warnings]     — non-fatal warnings (e.g. stale cache, partial payload)
 * @property {string}   [upstreamId]   — upstream request/correlation ID if available
 * @property {number}   [latencyMs]    — total elapsed time including all fallbacks
 */
function makeProvenance({
  source,
  fetchedAt = new Date().toISOString(),
  freshnessMs = 0,
  confidence = 'medium',
  adapterChain = [],
  warnings = [],
  upstreamId,
  latencyMs,
}) {
  return Object.freeze({
    source,
    fetchedAt,
    freshnessMs,
    confidence,
    adapterChain: Object.freeze([...adapterChain]),
    warnings: Object.freeze([...warnings]),
    upstreamId,
    latencyMs,
  });
}

// ── NewsEvent ────────────────────────────────────────────────────────
// Canonical news record — every news source (Finnhub, Polygon, RSS
// feeds like Bloomberg/FT, Perplexity Sonar) normalizes into this
// typed shape via server/parsers/newsParser.js before it hits the
// synthesis layer. Rationale: W6.10/W6.11 exposed the fact that the
// chat prompt was consuming raw strings with no provenance, which
// hid the "news exists but we can't parse it" vs. "no news found"
// distinction (Aegea case). A typed event with headline/url/source/
// publishedAt/tickers/confidence gives the synthesis prompt enough
// structured information to cite honestly — and gives the UI a stable
// contract for rendering source links.
//
// Fields are deliberately narrow:
//   - `id`          stable identifier derived from upstream (url-hash
//                   for RSS, item.id for Finnhub/Polygon); used for
//                   dedupe across providers.
//   - `headline`    cleaned title string (no HTML entities, no CDATA
//                   wrappers, no trailing whitespace).
//   - `source`      human-readable publisher/feed name ("Bloomberg",
//                   "Reuters", "Finnhub", "Perplexity").
//   - `url`         canonical article URL (http/https only; parsers
//                   drop rows where url is missing because they are
//                   un-citable).
//   - `publishedAt` ISO 8601 UTC timestamp. Parsers best-effort; if
//                   upstream omits, set to fetchedAt with a warning.
//   - `tickers`     explicit tickers mentioned by the upstream record
//                   (e.g. Finnhub `related`, Polygon `tickers`). Empty
//                   array is valid — parsers don't try to guess from
//                   the headline text (that's the extractTickers
//                   helper, applied by the caller at synthesis time).
//   - `summary`     optional short abstract (<= 500 chars). Parsers
//                   truncate longer bodies.
//   - `imageUrl`    optional hero image (Polygon/Finnhub provide).
//   - `confidence`  per-item confidence ('high' for ticker-scoped
//                   Finnhub/Polygon hits, 'medium' for feed-wide news,
//                   'low' for Perplexity citations without publisher
//                   metadata). This is orthogonal to the chain-level
//                   Provenance.confidence.
//   - `raw`         optional upstream body for auditability; stripped
//                   before transport to the UI.

/**
 * @typedef {Object} NewsEvent
 * @property {string}   id
 * @property {string}   headline
 * @property {string}   source
 * @property {string}   url
 * @property {string}   publishedAt   — ISO 8601
 * @property {string[]} tickers       — upstream-asserted symbols, may be []
 * @property {string}   [summary]     — <= 500 chars
 * @property {string}   [imageUrl]
 * @property {'high'|'medium'|'low'|'unverified'} confidence
 * @property {Object}   [raw]         — audit only; never sent to UI
 */

const NEWS_SUMMARY_MAX = 500;

/**
 * Build a canonical NewsEvent. Normalizes/validates fields so the
 * synthesis layer never has to second-guess the shape. Returns null
 * if required fields (headline, url) are missing — callers filter
 * those out. Never throws.
 *
 * @param {Partial<NewsEvent>} input
 * @returns {NewsEvent|null}
 */
function makeNewsEvent(input) {
  if (!input || typeof input !== 'object') return null;
  const headline = typeof input.headline === 'string' ? input.headline.trim() : '';
  const url      = typeof input.url === 'string' ? input.url.trim() : '';
  if (!headline || !url) return null;
  if (!/^https?:\/\//i.test(url)) return null;

  const source = typeof input.source === 'string' && input.source.trim()
    ? input.source.trim()
    : 'unknown';

  let publishedAt;
  if (typeof input.publishedAt === 'string' && input.publishedAt) {
    const d = new Date(input.publishedAt);
    publishedAt = Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
  } else {
    publishedAt = new Date().toISOString();
  }

  const tickers = Array.isArray(input.tickers)
    ? input.tickers.filter(t => typeof t === 'string' && t.length > 0).map(t => t.toUpperCase())
    : [];

  let summary;
  if (typeof input.summary === 'string' && input.summary.trim()) {
    const s = input.summary.trim();
    summary = s.length > NEWS_SUMMARY_MAX ? s.slice(0, NEWS_SUMMARY_MAX - 1) + '…' : s;
  }

  const imageUrl = typeof input.imageUrl === 'string' && /^https?:\/\//i.test(input.imageUrl)
    ? input.imageUrl
    : undefined;

  const confidence = ['high', 'medium', 'low', 'unverified'].includes(input.confidence)
    ? input.confidence
    : 'medium';

  const id = typeof input.id === 'string' && input.id
    ? input.id
    : `url-${Buffer.from(url).toString('base64').slice(0, 20)}`;

  return Object.freeze({
    id,
    headline,
    source,
    url,
    publishedAt,
    tickers: Object.freeze([...tickers]),
    summary,
    imageUrl,
    confidence,
    raw: input.raw,
  });
}

// ── CalendarEvent ────────────────────────────────────────────────────
// W6.3: canonical macro / earnings / IPO calendar event. Every upstream
// (Finnhub /calendar/economic, Eulerpool, Trading Economics) normalizes
// into this shape via server/parsers/calendarParser.js before hitting
// the UI or the chat synthesis layer. Same motivation as NewsEvent —
// the existing /market/macro-calendar was returning raw vendor objects
// with heterogeneous date/time fields and no impact grading, so the
// dashboard couldn't tell "tier-1 event (NFP)" from "tier-3 (German
// retail PMI revision)".
//
// Fields:
//   - id            stable dedupe key (vendor id OR hash of kind+country+event+time)
//   - kind          'economic' | 'earnings' | 'ipo'
//   - country       ISO 3166-1 alpha-2 (US, DE, BR) for economic;
//                   ISO exchange hint for earnings/ipo ('US' when unclear).
//   - event         the headline label ('Non-Farm Payrolls', 'ECB Rate Decision').
//                   For earnings: 'AAPL Q3 2026 earnings'.
//   - timeUtc       ISO 8601 UTC. Parser combines vendor date + time-of-day
//                   + timezone into a single UTC instant. Never a bare date —
//                   the dashboard always renders in local tz so a date-only
//                   value would be ambiguous across longitude boundaries.
//                   Parser falls back to 00:00:00 UTC only when vendor
//                   explicitly gives a date-only event (e.g. BR holidays).
//   - impact        'low' | 'medium' | 'high' | 'unknown'. Normalized from
//                   vendor strings (Finnhub emits lowercase strings; some
//                   vendors use 1/2/3). Never null.
//   - actual        number|string|null — reported value if available
//   - previous      number|string|null
//   - estimate      number|string|null
//   - unit          human-readable ('%', 'K', 'B USD')
//   - symbol        earnings-only; undefined for economic/ipo
//   - confidence    per-item: 'high' for tier-1 events flagged by vendor,
//                   'medium' for unlabelled events, 'low' for schema-unsure
//                   rows (unit missing, time of day missing).

const IMPACT_LEVELS = Object.freeze(['low', 'medium', 'high', 'unknown']);
const CALENDAR_KINDS = Object.freeze(['economic', 'earnings', 'ipo']);

/**
 * @typedef {Object} CalendarEvent
 * @property {string}   id
 * @property {'economic'|'earnings'|'ipo'} kind
 * @property {string}   country
 * @property {string}   event
 * @property {string}   timeUtc   — ISO 8601 UTC
 * @property {'low'|'medium'|'high'|'unknown'} impact
 * @property {number|string|null} [actual]
 * @property {number|string|null} [previous]
 * @property {number|string|null} [estimate]
 * @property {string}   [unit]
 * @property {string}   [symbol]
 * @property {'high'|'medium'|'low'|'unverified'} confidence
 * @property {Object}   [raw]
 */

/**
 * Normalize a vendor impact string to our 4-level enum.
 * Accepts: 'low'|'medium'|'high' (Finnhub), 1|2|3 (Trading Economics),
 * '*'|'**'|'***' (FXStreet-style). Everything else → 'unknown'.
 */
function normalizeImpact(raw) {
  if (raw == null) return 'unknown';
  if (typeof raw === 'number') {
    if (raw >= 3) return 'high';
    if (raw === 2) return 'medium';
    if (raw === 1) return 'low';
    return 'unknown';
  }
  const s = String(raw).trim().toLowerCase();
  if (s === 'high' || s === 'h' || s === '***' || s === '3') return 'high';
  if (s === 'medium' || s === 'med' || s === 'm' || s === '**' || s === '2') return 'medium';
  if (s === 'low' || s === 'l' || s === '*' || s === '1') return 'low';
  return 'unknown';
}

/**
 * Build a canonical CalendarEvent from a partial input. Returns null if
 * required fields (kind, event, timeUtc) are missing or malformed.
 * Never throws.
 *
 * @param {Partial<CalendarEvent>} input
 * @returns {CalendarEvent|null}
 */
function makeCalendarEvent(input) {
  if (!input || typeof input !== 'object') return null;
  const kind = CALENDAR_KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) return null;
  const event = typeof input.event === 'string' ? input.event.trim() : '';
  if (!event) return null;

  let timeUtc;
  if (typeof input.timeUtc === 'string' && input.timeUtc) {
    const d = new Date(input.timeUtc);
    if (!Number.isFinite(d.getTime())) return null;
    timeUtc = d.toISOString();
  } else {
    return null;
  }

  const country = typeof input.country === 'string' && input.country.trim()
    ? input.country.trim().toUpperCase().slice(0, 3)
    : '';

  const impact = IMPACT_LEVELS.includes(input.impact) ? input.impact : 'unknown';

  const id = typeof input.id === 'string' && input.id
    ? input.id
    : `cal-${kind}-${country}-${event.slice(0, 32).replace(/\s+/g, '-')}-${timeUtc.slice(0, 16)}`;

  const confidence = ['high', 'medium', 'low', 'unverified'].includes(input.confidence)
    ? input.confidence
    : 'medium';

  const out = {
    id,
    kind,
    country,
    event,
    timeUtc,
    impact,
    confidence,
  };
  if (input.actual   !== undefined) out.actual   = input.actual;
  if (input.previous !== undefined) out.previous = input.previous;
  if (input.estimate !== undefined) out.estimate = input.estimate;
  if (input.unit)    out.unit = String(input.unit);
  if (input.symbol)  out.symbol = String(input.symbol).toUpperCase();
  if (input.raw)     out.raw = input.raw;

  return Object.freeze(out);
}

// ── CoverageDeclaration ──────────────────────────────────────────────
// What an adapter claims to cover. Returned by describe(). Also written
// to the coverage_matrix DB table during registration.

/**
 * @typedef {Object} CoverageDeclaration
 * @property {string}   name               — adapter identifier (unique)
 * @property {string}   version            — semver
 * @property {string[]} capabilities       — subset of ['quote','candles','curve','chain','news','calendar','fundamentals','health']
 * @property {Object[]} coverageCells      — array of { market, assetClass, capability, confidence }
 * @property {number}   latencyP95TargetMs — declared p95 SLO
 * @property {number}   freshnessSlaSec    — max allowed staleness before stale_data
 * @property {Object}   [rateLimit]        — { requestsPerSec, burst }
 * @property {string[]} [requiredEnvVars]  — env vars the adapter needs to be healthy
 */

// ── AdapterInterface (JSDoc — implementations are concrete classes) ──
// Not a class — JavaScript duck-types. Every adapter exports a factory
// that returns an object with these methods.

/**
 * @typedef {Object} Adapter
 * @property {() => CoverageDeclaration} describe
 * @property {(symbol: string, opts?: Object) => Promise<Result<Quote>>} quote
 * @property {(symbol: string, opts?: Object) => Promise<Result<Candle[]>>} [candles]
 * @property {(issuer: string, opts?: Object) => Promise<Result<Curve>>} [curve]
 * @property {(underlying: string, expiry: string, opts?: Object) => Promise<Result<OptionsChain>>} [chain]
 * @property {(query: string, opts?: Object) => Promise<Result<NewsItem[]>>} [news]
 * @property {(dateRange: Object, opts?: Object) => Promise<Result<CalendarEvent[]>>} [calendar]
 * @property {(symbol: string, period: string, statement: string) => Promise<Result<FinancialStatement>>} [fundamentals]
 * @property {() => Promise<Result<HealthSample>>} health
 */

// ── AdapterRegistry ──────────────────────────────────────────────────
// The router's home. Adapters register themselves at boot; the router
// queries the registry + the Coverage Matrix DB to select adapters per
// request. This is the ONLY place router logic lives.

class AdapterRegistry {
  constructor() {
    this._adapters = new Map();  // name -> Adapter instance
    this._declarations = new Map(); // name -> CoverageDeclaration
  }

  /**
   * Register an adapter. Called once per adapter at boot.
   * @param {Adapter} adapter
   */
  register(adapter) {
    if (typeof adapter.describe !== 'function' || typeof adapter.health !== 'function') {
      throw new Error('Adapter must implement describe() and health()');
    }
    const decl = adapter.describe();
    if (!decl || !decl.name || !decl.version) {
      throw new Error('CoverageDeclaration missing name or version');
    }
    if (this._adapters.has(decl.name)) {
      throw new Error(`Adapter already registered: ${decl.name}`);
    }
    this._adapters.set(decl.name, adapter);
    this._declarations.set(decl.name, decl);
  }

  /**
   * Look up an adapter by name.
   * @param {string} name
   * @returns {Adapter | undefined}
   */
  get(name) {
    return this._adapters.get(name);
  }

  /**
   * All registered adapters (for health dashboard and coverage-matrix sync).
   * @returns {Adapter[]}
   */
  all() {
    return Array.from(this._adapters.values());
  }

  /**
   * All coverage declarations (for writing to coverage_matrix DB).
   * @returns {CoverageDeclaration[]}
   */
  declarations() {
    return Array.from(this._declarations.values());
  }

  /**
   * Route a request to the ordered adapter chain for a (market, capability)
   * cell. Returned array respects declared priority. The dispatch helper
   * (executeChain below) walks the chain and merges provenance.
   *
   * @param {string} market       — e.g. 'US', 'KRX', 'EU'
   * @param {string} assetClass   — e.g. 'equity', 'curve', 'options', 'news'
   * @param {string} capability   — e.g. 'quote', 'candles'
   * @returns {Adapter[]}
   */
  route(market, assetClass, capability) {
    // NOTE: Wave 1 uses a naive in-memory route by declared capability.
    // Wave 1.5 replaces this with a DB query against coverage_matrix
    // (with confidence + last_verified_at filters).
    const candidates = [];
    for (const [name, decl] of this._declarations.entries()) {
      if (!decl.capabilities.includes(capability)) continue;
      const hit = (decl.coverageCells || []).find(c =>
        c.market === market && c.assetClass === assetClass && c.capability === capability
      );
      if (hit) {
        candidates.push({ adapter: this._adapters.get(name), confidence: hit.confidence, decl });
      }
    }
    const confRank = { high: 3, medium: 2, low: 1, unverified: 0 };
    candidates.sort((a, b) => (confRank[b.confidence] || 0) - (confRank[a.confidence] || 0));
    return candidates.map(c => c.adapter);
  }
}

/**
 * Walk an adapter chain, returning the first ok result or the final
 * error with the full chain recorded in provenance. Never fall through
 * silently — if every adapter errors, return the last typed error with
 * a merged adapterChain so the UI knows what was tried.
 *
 * @template T
 * @param {Adapter[]} chain
 * @param {string}    methodName
 * @param {any[]}     args
 * @returns {Promise<Result<T>>}
 */
async function executeChain(chain, methodName, args) {
  if (!chain || chain.length === 0) {
    return err(
      makeProviderError('NOT_IN_COVERAGE', 'router', {
        message: `No adapter in chain for method ${methodName}`,
      }),
      makeProvenance({ source: 'router', confidence: 'unverified', adapterChain: [] }),
    );
  }
  const attempted = [];
  let lastError = null;
  const t0 = Date.now();
  for (const adapter of chain) {
    const decl = typeof adapter.describe === 'function' ? adapter.describe() : { name: 'unknown' };
    attempted.push(decl.name);
    if (typeof adapter[methodName] !== 'function') {
      lastError = makeProviderError('NOT_IN_COVERAGE', decl.name, {
        message: `Adapter ${decl.name} does not implement ${methodName}`,
      });
      continue;
    }
    try {
      const result = await adapter[methodName](...args);
      if (result && result.ok) {
        // Merge chain into provenance so UI can show all adapters tried
        const merged = makeProvenance({
          ...result.provenance,
          adapterChain: [...attempted],
          latencyMs: Date.now() - t0,
        });
        return ok(result.data, merged);
      }
      lastError = result && result.error
        ? result.error
        : makeProviderError('UNKNOWN', decl.name, { message: 'Adapter returned non-ok without error' });
    } catch (e) {
      // Adapters should not throw — if they do, treat as UNKNOWN and continue
      lastError = makeProviderError('UNKNOWN', decl.name, {
        message: e && e.message ? e.message : String(e),
      });
    }
  }
  return err(
    lastError || makeProviderError('UNKNOWN', 'router', { message: 'Chain exhausted' }),
    makeProvenance({
      source: 'router',
      confidence: 'unverified',
      adapterChain: attempted,
      latencyMs: Date.now() - t0,
    }),
  );
}

// ── Module exports ───────────────────────────────────────────────────

module.exports = {
  ProviderErrorCode,
  makeProviderError,
  makeProvenance,
  makeNewsEvent,
  makeCalendarEvent,
  normalizeImpact,
  ok,
  err,
  AdapterRegistry,
  executeChain,
  // Constants exposed for parsers/tests.
  _NEWS_SUMMARY_MAX: NEWS_SUMMARY_MAX,
  _IMPACT_LEVELS: IMPACT_LEVELS,
  _CALENDAR_KINDS: CALENDAR_KINDS,
};
