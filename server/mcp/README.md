# server/mcp — Internal MCP Tool Registry (R0.1)

## Purpose

Formalise Particle's internal tool surface into a uniform registry so that:

- every AI-callable capability (market data, macro, news, vault, earnings,
  compute, paper-trading, alt-data, …) is invoked through a single contract;
- adding a new tool no longer means editing the flat `TOOLS` array in
  `server/services/aiToolbox.js`;
- tool calls emit Prometheus metrics + an audit-log row automatically,
  without each handler having to wire its own;
- persona agents (R0.3), the node editor (R2.4) and the paper-trading engine
  (R1.3) can enumerate tools by group instead of guessing names.

## Non-goals (for R0.1)

- **Not** rewriting any existing handler.  The 22 tools currently dispatched
  by `aiToolbox.dispatchTool()` keep their implementation verbatim.  The
  registry wraps the handlers and enriches the call with group metadata,
  metrics, and audit — the underlying adapter logic is untouched.
- **Not** changing the shape of tool results seen by the Anthropic tool-use
  loop.  `registry.call()` returns the same plain object `dispatchTool()`
  would have returned, including the `{ error, truncated, ... }` envelopes
  that callers already handle.
- **Not** touching any Hard Lock file (AI chat UI, Instrument Detail,
  auth/billing/LGPD, onboarding, design tokens).  R0.1 is server-only.

## Design

### Tool shape

```
{
  name:         string,          // stable identifier; unchanged from aiToolbox
  group:        string,          // one of: market | macro | news | vault | earnings | compute
  description:  string,          // same copy the model reads today
  input_schema: object,          // JSON Schema (kept identical to aiToolbox)
  output_hint:  string,          // one-line shape description for humans/audits
  execute:      async (args, ctx) => result,
}
```

Why keep JSON Schema instead of zod?  Two reasons:

1. Claude's native tool-use API consumes `input_schema` directly — swapping
   to zod would require a translation layer.
2. The roadmap golden rule "additive, reversible" — zod would be a new
   runtime dependency.  We can add it later if the registry needs stricter
   validation.

### Registry

`registry.register(tool)` stores the tool in a Map keyed by name.  Calls
idempotent on identical re-registration; conflicting re-registrations
throw at boot (fail-fast).

`registry.list({ group })` filters.

`registry.call(name, args, ctx)` wraps `tool.execute`:

1. Stamp `t0 = Date.now()`.
2. Try/catch around `execute`.  Any throw becomes `{ error: <msg> }` —
   identical to the existing `dispatchTool()` contract.
3. Serialise the result; if `JSON.stringify(result).length >
   MAX_TOOL_PAYLOAD_BYTES` (12 KB) return
   `{ truncated: true, originalBytes, note, preview }`.  Identical envelope
   to the existing dispatcher so the model sees the same string it would
   see today.
4. `metrics.mcp_tool_calls_total.labels(tool, group, status).inc()`
   and `metrics.mcp_tool_duration_seconds.labels(tool, group).observe(dt)`.
5. `audit.write({ userId, tool, group, ok, latencyMs, truncated })` async.
6. Return the result.

### Groups

| group      | tools                                                                               |
|------------|-------------------------------------------------------------------------------------|
| market     | lookup_quote, get_yield_curve, list_sovereign_bonds, list_corporate_bonds, get_options_flow, list_market_movers, lookup_fx, lookup_commodity, forward_estimates |
| macro      | get_macro_snapshot, get_brazil_macro, get_market_regime, run_scenario               |
| news       | get_recent_wire, web_research, fetch_url, search_prediction_markets                 |
| vault      | search_vault                                                                        |
| earnings   | get_earnings_calendar, list_cvm_filings                                             |
| compute    | compute, describe_portfolio_import                                                  |

Persona agents (R0.3) and the node editor (R2.4) use `registry.list({ group })`
to enumerate tools by purpose without hard-coding names.

### Metrics

Two new prom-client instruments, exported via the existing
`server/utils/metrics.js` so they surface on the `/metrics` endpoint
already scraped from W1.4 + #251:

- `particle_mcp_tool_calls_total{tool, group, status}` — Counter.
  `status` ∈ {ok, error, truncated}.
- `particle_mcp_tool_duration_seconds{tool, group}` — Histogram with the
  standard buckets from `db_query_duration` (50 ms → 10 s).

### Audit

Append-only log via the existing `logger.info('mcp', …)` path plus, if
the DB is available, an `mcp_audit` row insert.  The insert is
best-effort — a failed audit write never fails the tool call.  The row
schema is defined in a migration shipped with R0.1-b (not this commit).

### Feature flag

`MCP_REGISTRY_V1` — registered with the `featureFlags` service, default
OFF.  When OFF, the registry is loaded and callable but the existing
`aiToolbox.dispatchTool` path remains the canonical dispatcher.  When
ON (shadow mode), `aiToolbox.dispatchTool` will delegate to
`registry.call` — this wiring is R0.1-b.  For R0.1-a (this commit) the
registry is a passive, test-only artefact.

## Cutover plan

1. **R0.1-a (this commit)** — Registry + groups + tests.  No production
   code reads from it.  Feature flag off by default.  CI green.
2. **R0.1-b** — Shadow-mode wiring: `aiToolbox.dispatchTool` checks
   `MCP_REGISTRY_V1`.  If on, delegate to registry and assert parity
   with the legacy dispatch result; warn (not fail) on divergence.
3. **R0.1-c** — Flip `MCP_REGISTRY_V1=true` in prod for 24 h, watch
   Sentry + the Prometheus histogram.
4. **R0.1-d** — Remove the legacy inline dispatch from `aiToolbox.js`;
   `dispatchTool` becomes a thin wrapper over `registry.call`.

## Files

- `registry.js`   — the Registry class.
- `contracts.js`  — tool-shape validation + result envelope helpers.
- `groups.js`     — group enum + descriptions.
- `metrics.js`    — Prometheus instrument definitions.
- `audit.js`      — audit-log writer (non-blocking).
- `index.js`      — boot entry point: creates registry, registers every
                    group's tools, returns the registry instance.
- `tools/<group>.js` — one file per group; each file registers its
                       tools with the registry instance.

## What R0.1 does NOT modify

- `server/services/aiToolbox.js` — read-only.  Handlers imported from
  here; not redefined.
- `server/routes/aiChat.js`, `server/routes/search.js` — unchanged.
- `client/**` — zero client changes.
- `.github/workflows/ci.yml` — unchanged (new files covered by existing
  `schema-smoke` + `build-and-map-leak` as usual).
- Any auth / billing / LGPD / onboarding file.
