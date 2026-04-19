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
  ok,
  err,
  AdapterRegistry,
  executeChain,
};
