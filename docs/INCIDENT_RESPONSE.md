# Incident Response Runbook — Particle Terminal

**Audience:** engineers on call for Particle Terminal. Review before first shift.

**Scope:** any unplanned degradation of a user-visible path: login, panels, chat, vault, billing, real-time feeds.

**North star:** restore user access first, investigate root cause second, file the post-mortem third.

## 1. Severity table

| Severity | Definition | Response target | Paging |
|---|---|---|---|
| S0 | Full outage, data loss, or security incident | Ack in 10 min, mitigation in 60 min | PagerDuty high-urgency + phone |
| S1 | Single critical path broken for ≥10% of users | Ack in 20 min, mitigation in 2h | PagerDuty high-urgency |
| S2 | Degraded performance (latency, partial feature) | Ack in 1h, mitigation in 8h | PagerDuty low-urgency |
| S3 | Cosmetic / internal-only issue | Next business day | Backlog ticket |

## 2. First 10 minutes

1. Acknowledge PagerDuty alert.
2. Open `https://<prod>/api/admin/debug/health` and scan the JSON.
   - `alarmCount` high? note which feeds are `stale` or `critical`.
   - `providers.*.breakerOpen` true? external API degraded.
   - `db.connected` false? go to step 3a.
3. Check Sentry for the top issue in the last hour. Correlate error fingerprint with the affected path.
4. If Stripe is implicated, open Stripe dashboard > Events; look for recent 4xx/5xx on webhook endpoint.

### 2a. DB offline
- Render Postgres status page.
- If Render incident active: post status update, flip `block_all_ai=true` via `/api/admin/debug/kill-switch`.
- If not: check connection pool saturation (`db_pool_in_use` metric).

### 2b. AI cost runaway
- `GET /api/admin/debug/kill-switch` — confirm state.
- If a user is generating oversized prompts: `POST /api/admin/debug/kill-switch {"force_haiku": true, "reason": "runaway spend"}`.
- Review `ai_usage_ledger` for the offending user; consider manual quota override.

### 2c. Provider outage (Polygon / TwelveData)
- `GET /api/admin/debug/providers` — verify breaker is open for the failing provider.
- The fallback ladder should route around it automatically. If not, deploy an env-flag disable: `POLYGON_ENABLED=0`.

### 2d. JWT compromise
- Follow `docs/RUNBOOK_JWT_ROTATION.md` — rotate keys, invalidate refresh tokens, notify DPO if user data was exfiltrated.

## 3. Communication

- **Internal:** `#incident` Slack thread. One-line updates every 15 minutes.
- **Public:** statuspage update within 30 minutes of confirming S0/S1.
- **Users:** in-app banner if > 10 minutes of disruption.
- **DPO:** within 1 hour of confirming a personal-data incident (LGPD Art. 48).

## 4. Mitigation patterns

| Symptom | Mitigation |
|---|---|
| API latency spike | Enable rate limiter fallback tier, scale Render instances +1 |
| AI cost spike | Flip `force_haiku` kill switch, reduce AI_MAX_CONTEXT_TOKENS |
| WS disconnect storm | Cap `ws_buffered_amount_peak`, force-reload clients via banner |
| Stale market data | Flip provider env flag, confirm fallback ladder routing |
| Billing webhook pileup | Claim table INSERT-only; rerun reconciler manually |

## 5. Post-mortem

For every S0 and S1, file a post-mortem within 72 hours using `docs/incidents/TEMPLATE.md`.

## 6. Contacts

| Role | Name | Channel |
|---|---|---|
| IC (incident commander) | Rotating | PagerDuty |
| CTO / Tier-2 escalation | Vinicius Senger | phone |
| DPO | Vinicius Senger | vinicius@arccapital.com.br |
| Render support | — | support@render.com |
| Stripe support | — | https://support.stripe.com |
| ANPD | — | https://www.gov.br/anpd |
