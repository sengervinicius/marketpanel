# Particle Terminal — Capacity Plan (W1.7)

This document translates the k6 baseline in `load-tests/particle-baseline.js`
into concrete scaling decisions: how many users the current deploy can hold,
what breaks first, and what to upgrade before each milestone.

## 1. Current posture (as of W1 completion)

| Resource                    | Plan / size                    | Hard limit          | Headroom at baseline |
|-----------------------------|--------------------------------|---------------------|----------------------|
| Render web service          | 1 instance, 512 MB / 0.5 vCPU  | 1 process           | ~60% CPU @ 200 VUs   |
| Render Postgres             | 97 max_connections             | 97                  | pool.max = 10 / inst |
| Redis (cache + rate limits) | Render Key-Value               | ~100 MB             | ~10 MB used          |
| WebSocket fanout            | In-process, wss @ port 10000   | OS FD limit (~4096) | fine to 2k clients   |
| AI provider quota           | Anthropic + Perplexity paid    | $1k / month default | depends on traffic   |

The baseline scenario (`200 VUs, 20 min, 20 WS subs/VU, 1 AI call/VU/loop`)
maps to roughly **~1.1k synthetic chat requests / 15 min**, **~4k live
WS subscriptions**, **~0 errors** in the current deploy. That is the
shippable floor.

## 2. What breaks first at each load tier

Projection (from resource utilization slopes, not linear extrapolation):

| Concurrent active users | First bottleneck                                                 | Mitigation |
|-------------------------|------------------------------------------------------------------|------------|
| ≤ 200                   | None                                                             | Ship as-is. |
| 500                     | Node event loop under AI streaming                               | Enable multiple Render instances + sticky LB for WS. |
| 1 000                   | Postgres pool saturation (`pool.max = 10` × N instances)         | Move to pgBouncer (transaction-pool mode), raise pool.max to 20. |
| 2 500                   | WebSocket FD pressure + outbound bandwidth                        | Add a dedicated WS fanout layer (NATS / Redis pub-sub + 2nd instance). |
| 5 000                   | Postgres CPU / disk IO                                            | Move to Render Pro tier, add a read replica for analytics queries. |
| 10 000                  | Single-region limits                                              | Multi-region deploy + regional Postgres replicas, CDN for static assets. |

## 3. AI cost sensitivity

Each baseline AI call bills roughly:
- 1k input tokens @ Sonnet = 0.3¢
- 500 output tokens @ Sonnet = 0.75¢
- ≈ **1.05¢ / call** median, rising to ~5¢ on long threads

At 200 concurrent active users running the baseline loop once every 15 min,
that's 13k calls / day ≈ **$137 / day ≈ $4 100 / month** at full Sonnet.
The kill-switch at 80% of a $1 000 budget trips after about 5 days of full
Sonnet traffic on the baseline loop; the force-haiku mode brings the per-call
cost down to ~0.02¢ and extends the runway ~50×.

Provisioning guidance: for 1k DAU on the paid plan, budget for **$800–1500 /
month** on AI with `force_haiku` fallback configured. The nightly anomaly
report (`/api/admin/ai-usage/anomalies`) is the first place to look when
spend skews.

## 4. Running the baseline

Local smoke (~1 minute, 5 VUs — used by CI):

```bash
k6 run -e BASE=http://localhost:10000 -e SMOKE=1 load-tests/particle-baseline.js
```

Full staged run against staging (~28 minutes, 5 → 200 VUs):

```bash
export BASE=https://particle-staging.onrender.com
export TEST_USERS='loadtest1@example.com:pwA,loadtest2@example.com:pwB'
k6 run --summary-export=k6-summary.json load-tests/particle-baseline.js
```

Nightly baseline is expected to run against staging (never production) at
02:00 BRT. Results are uploaded to `s3://particle-observability/k6/` for
delta-over-time dashboards.

## 5. CI gate

`.github/workflows/loadtest.yml` runs the `SMOKE=1` scenario on every PR
that touches `server/**`. The gate fails the build if any of these
thresholds regress beyond 10% of the last successful baseline:

- `http_req_duration.p(95)`
- `http_req_failed.rate`
- `checks.rate`

For the full staged run, the nightly job publishes a comment to the release
issue on GitHub with the previous-night-vs-tonight delta.

## 6. Pre-deploy checklist

Before any release that could change the request path or touch the pool:

1. Run the SMOKE variant locally against a copy of the staging database.
2. Watch `/metrics` in Grafana for new anomalies (spike in `http_in_flight`,
   drift on `db_pool_in_use`, new cardinality on `particle_http_requests_total`).
3. Re-run the full staged k6 against staging; compare to last baseline.
4. If any threshold regresses, either fix the regression or file a
   capacity-planning ticket before rollout.

Every release note for the Terminal should include the staged-run summary
as an attached file so we have a trend log.
