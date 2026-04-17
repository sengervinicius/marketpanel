# Service-Level Objectives — Particle Terminal

_Status: **Provisional** · Wave 0 · W0.10_
_Owner: Platform_
_Review cadence: quarterly (next review: 2026-07-17)_

These targets are **provisional**. They reflect what we believe we can already
deliver based on Wave 0 fixes, plus a small headroom. They are not yet
enforced via an error budget or paging policy; Wave 1 will wire the
measurement up (Sentry performance + Postgres query stats + a weekly report),
and Wave 2 will promote the numbers we consistently meet into hard SLOs with
alerting and an error budget.

## Why provisional?

We do not yet have sufficient historical telemetry to commit to production
SLOs. In particular:

- p95 / p99 latency at the edge is not yet reported (no RUM, no external
  probe).
- Sentry release-scoped performance data started flowing in W0.3 (this wave),
  so we have < 1 week of baseline.
- We need at least one full month of observations, ideally spanning an
  earnings week and a volatile macro event, before locking in numbers.

The numbers below are the values we will **aim for** and against which we
will measure ourselves during Wave 1. A gap against these provisional
targets is a signal to investigate, not a paging event.

## Top-level SLOs (provisional)

| # | Category | Indicator (SLI) | Provisional target (SLO) | Window |
|---|----------|-----------------|--------------------------|--------|
| 1 | Availability | `/api/health` 200 rate, from external uptime probe | **99.5%** | rolling 30 days |
| 2 | Availability | `/api/health` 200 rate, internal Sentry error rate < 1% of requests | **99.9%** | rolling 30 days |
| 3 | Latency — read APIs | p95 of `GET /api/stocks/*`, `GET /api/market/*` | **< 800 ms** | rolling 7 days |
| 4 | Latency — read APIs | p99 of same | **< 2.0 s** | rolling 7 days |
| 5 | Latency — AI | p95 time-to-first-token on `/api/search/chat` SSE | **< 3.5 s** | rolling 7 days |
| 6 | Latency — AI | p95 end-of-stream on `/api/search/chat` | **< 20 s** | rolling 7 days |
| 7 | Data freshness — market | Quote staleness on `/api/stocks` during regular hours | **< 15 s stale** for 95% of polls | rolling 7 days |
| 8 | Data freshness — BCB series | Age of most recent BCB datapoint during BR trading hours | **< 24 h** for 99% of reads | rolling 30 days |
| 9 | AI correctness — grounded answers | Share of `/api/search/chat` responses with at least one citation **or** a "no data" disclaimer | **≥ 95%** | rolling 7 days |
| 10 | Auth — success | `/api/auth/login` 2xx rate (excluding 401 which are user-intended failures) | **≥ 99.5%** | rolling 30 days |
| 11 | Webhooks — Stripe | Stripe events resulting in a persisted side effect **at least once** (idempotent) | **100%** | rolling 30 days |
| 12 | Background — alerts | Alert fan-out latency from trigger condition to push/email | **< 60 s** for 99% | rolling 30 days |

## Error-budget math (for when we promote these)

Availability SLO 99.9% over 30 days = **43 min 12 s** of allowed downtime.
Availability SLO 99.5% over 30 days = **3 h 36 min** of allowed downtime.

Once we promote an SLO out of provisional status, the corresponding budget
becomes the throttle on change velocity: if we blow through half the budget
early in the window, we freeze non-critical deploys until the window resets.

## Exclusions (what we do NOT count against SLOs)

- Client-side errors caused by ad blockers or browser extensions that break
  our SSE stream.
- Traffic from obviously automated scrapers (User-Agent blocklist).
- Latency on requests where upstream data providers (Polygon, BCB,
  Perplexity, Anthropic) returned 5xx or timed out. These count toward the
  separate **provider dependency budget** (Wave 1).

## How we will measure

Wave 1 work will make the following measurements first-class:

1. **Latency** — Sentry `startTransaction` on every Express route plus every
   AI SSE stream. Roll up to p50/p95/p99 per route per release.
2. **Availability** — internal: 500-class rate from Sentry; external: a tiny
   uptime probe hitting `/api/health` every 60 s from outside Render.
3. **Data freshness** — a synthetic poll compares `/api/stocks/AAPL.quote.ts`
   against wallclock and records lag.
4. **AI correctness** — nightly eval run on a 50-question golden set, plus
   the grounded-citation share computed from production logs.

## Review & change log

- **2026-04-17** (Wave 0, W0.10): Document created. All numbers provisional.
- Next review: 2026-07-17 — convert at least SLOs 1, 3, 10 to enforced
  status if measurement infra is live and we've hit target for 60 of the
  preceding 90 days.
