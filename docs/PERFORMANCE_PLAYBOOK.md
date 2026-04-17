# Performance & Cost Playbook — Wave 5

**Scope:** cost-per-active-user targets, cache tiering, bundle-size budget, AI-context squeezes.

## 1. Unit economics target

| Tier | Target ARPU | AI cost ceiling / user / month | Gross margin target |
|---|---|---|---|
| Trial (new_particle) | free | R$ 0.50 | — |
| particle_pro | R$ 199 | R$ 15 (7.5%) | ≥ 80% |
| particle_elite | R$ 499 | R$ 50 (10%) | ≥ 80% |

If a user exceeds the ceiling, the AI quota gate (W1.2) force-downgrades them to Haiku for the rest of the billing cycle.

## 2. Cache tiering

| Layer | Backing | TTL | Invalidation |
|---|---|---|---|
| AI response | `aiResponseCache` — Redis if `REDIS_URL`, else LRU | 30 min factual / 60 s market-adjacent / 0 portfolio | `CACHE_VERSION` bump |
| Market quotes | In-process (polygon.js) | per-tick | Polygon WebSocket update |
| Panel SWR | React Query | revalidateOnFocus + 60 s stale | mutation invalidation |
| Static assets | Render edge CDN | 1 year (hashed filenames) | deploy-level |

## 3. Bundle-size budget (post-gzip)

| Asset type | Budget | Enforcement |
|---|---|---|
| Entry chunk | 1.5 MB uncompressed | `scripts/check-bundle-size.js` in CI |
| CSS | 300 KB | same script |
| Image | 500 KB each | same script |

Adjust via PR review; commit history is the audit trail.

## 4. AI context squeeze

A chat request at Pro tier costs roughly R$ 0.008 per 1k input tokens on Sonnet. Mitigations in priority order:

1. Route trivia / factual Qs to Haiku first (`modelRouter` already does this — verify it's wired).
2. Use the response cache before calling the model at all.
3. Trim RAG context: de-duplicate chunks, drop anything under similarity threshold 0.72.
4. For portfolio-specific Qs, cap context to the top 8 holdings by weight.
5. Compress conversation memory: summarise everything older than the 6 most recent turns.

## 5. Browser perf budget

- LCP (3G) ≤ 2.5 s
- INP ≤ 200 ms
- Total JS (main route) ≤ 900 KB gzipped

Monitored via Sentry Performance and synthetic lighthouse runs in CI.

## 6. Quarterly review checklist

- [ ] AI unit-cost per tier (last 30 days)
- [ ] Cache hit rate by TTL class
- [ ] Bundle size trend
- [ ] Render instance utilisation (CPU / memory)
- [ ] Top 10 expensive endpoints by P99 latency
- [ ] Drop unused dependencies (run `depcheck`)
