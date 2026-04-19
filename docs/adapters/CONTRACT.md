# Data Adapter Contract

**Status:** Wave 1 — WS1 foundation. Living document.

Every data source that Particle consumes — market data, news, fundamentals, options, curves, macro calendars, research — implements this contract. There are no exceptions. The router reads the Coverage Matrix and dispatches requests to the adapter chain with the highest declared confidence for the relevant `(market × asset_class × capability)` cell. If no adapter claims coverage, the router fails closed with a typed `NOT_IN_COVERAGE` error. The UI renders that state honestly. We never silently degrade to a wrong source, we never return `null`, and we never hide a failed adapter behind a second adapter's success without recording the attempt in provenance.

## Why this contract exists

Before Wave 1, the server had three parallel systems with overlapping responsibility: `server/providers/*.js` (per-vendor shim files), `server/config/providerMatrix.js` (hardcoded string arrays of provider names per exchange group), and `server/lib/providerFallback.js` (silent fallback-to-null). Each of those was reasonable in isolation and catastrophic in combination. Coverage gaps were invisible, silent failures were routine, and there was no way for CI to verify what the product claimed to support. The Adapter Contract collapses all three into one typed interface plus one database-driven routing table, so adding a market, retiring a vendor, or catching a regression is a single-file change with a CI guard.

## The core types

Every adapter method returns `Result<T, ProviderError>` — a discriminated union where `ok: true` carries `data` and `provenance`, and `ok: false` carries a typed `error` and `provenance`. Callers check `.ok` before reading `.data`. Adapters never throw; they return. If a library call throws, the adapter catches it and maps to `UNKNOWN` with the cause in metadata.

The `ProviderError.code` is one of: `NOT_IN_COVERAGE`, `RATE_LIMITED`, `UPSTREAM_5XX`, `UPSTREAM_4XX`, `TIMEOUT`, `INVALID_SYMBOL`, `AUTH`, `SCHEMA_MISMATCH`, `STALE_DATA`, `DISABLED`, `UNKNOWN`. These are the only codes the rest of the system switches on. String matching on `.message` is forbidden.

The `Provenance` envelope carries `source`, `fetchedAt`, `freshnessMs`, `confidence` (`high` | `medium` | `low` | `unverified`), `adapterChain` (every adapter attempted, in order), `warnings`, `upstreamId`, and `latencyMs`. The UI reads `provenance` to render "last updated at HH:MM:SS from Polygon" without guessing. The quality harness reads `provenance` to verify freshness against declared SLA.

## The adapter shape

Every adapter exports a factory that returns an object with at least `describe()` and `health()`. It additionally implements whichever of `quote`, `candles`, `curve`, `chain`, `news`, `calendar`, `fundamentals` it supports — and only those. `describe()` returns a `CoverageDeclaration` listing capabilities, covered `(market, assetClass, capability)` cells with declared confidence, latency p95 target in milliseconds, freshness SLA in seconds, optional rate limits, and required environment variables. That declaration is the source of truth for both the runtime registry and the seed data written to the `coverage_matrix` table during migrations.

`health()` returns `Result<HealthSample>` where `HealthSample` includes the last upstream status, observed p95 latency from a rolling window, and rate-limit headroom. Health is polled by the adapter-health dashboard and by the nightly quality harness. A failing `health()` counts against the adapter's confidence score in the Coverage Matrix and can demote it below its peers in the router chain.

## The Coverage Matrix

Adapter capability declarations are synced to the `coverage_matrix` Postgres table at boot. The router queries that table for every request and builds the adapter chain for the target cell, sorted by confidence and last-verified-at. Stale cells (verified > 72h ago) are demoted. Cells with no adapter trigger `NOT_IN_COVERAGE` at the router level; the UI receives a typed error and renders an honest "not supported" state rather than an empty chart.

Every nightly CI run replays a canonical set of probes against each cell and updates `last_verified_at` and `last_result`. A probe that fails writes a row to `coverage_probes` with the error code, the latency, and a payload-hash for change detection. If a cell's failure rate exceeds the declared SLO over a trailing window, CI demotes the cell's confidence and opens an incident ticket.

## The router

`AdapterRegistry.route(market, assetClass, capability)` returns an ordered array of adapter instances — the "chain". `executeChain(chain, method, args)` walks the chain, returns the first `ok` result, and merges every attempted adapter into `provenance.adapterChain`. On total failure, it returns the last typed error with the full chain recorded. No silent fall-through. No null returns. No exceptions leak out.

In Wave 1, `route()` uses in-memory declarations seeded from `describe()`. In Wave 1.5, `route()` reads from the `coverage_matrix` table directly, which is how confidence demotions from the quality harness take effect without restarts.

## Forbidden patterns

Hardcoded ticker lists in adapter code. Silent null returns. String matching on error messages to control flow. Bypassing the registry with a direct import of an adapter-internal helper. Adding a new vendor by copying an existing provider file. Feature flags older than 30 days. "Beta" labels on capabilities that are actually broken. CI guards are added for each of these as they're detected in review.

## Migration order

Polygon is the golden path because it is our most mature integration; migrating it first validates the contract against known-good behavior. Finnhub follows in weeks 5–6 because it unlocks the existing Asian and European coverage we already pay for. Twelvedata follows as a cross-source in Q2. Eulerpool, Unusual Whales, Perplexity Sonar, ECB SDMX, and FRED each follow the same template once their capability declaration is written. The legacy `server/providers/*.js` and `server/lib/providerFallback.js` are quarantined behind the adapter layer and retired once every caller has migrated. No legacy provider survives past Q1 closing.

## How to add a new adapter

Read this doc. Write the `describe()` returning an accurate CoverageDeclaration. Implement the capability methods returning `Result<T>` with provenance on both success and failure paths. Register the adapter in `server/adapters/index.js`. Add a probe to `scripts/eval/golden/` for every coverage cell the adapter claims. Open the PR; CI will seed the Coverage Matrix, run the probes, and block merge if any cell fails to turn green within the declared SLO. No other steps. No other files touched.
