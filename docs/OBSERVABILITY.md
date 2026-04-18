# Observability — what to watch, where, and how

This document is the map of every observability surface in Particle Terminal.
It was written in W6.5 as part of the global-launch readiness wave and
complements the W1.4 stack (Prometheus metrics) and W0.3 Sentry wiring.

The goal is that a single on-call engineer can, at 2am, know:

1. whether the platform is up (Grafana — RED/USE dashboard);
2. whether any specific errors are firing (Sentry);
3. what users are doing / whether a regression has broken a funnel (PostHog);
4. where the AI budget stands (Grafana — AI / Cost row);
5. whether any SLO burn rate has crossed a threshold (Alertmanager — see `ops/alerts.yml`).

---

## 1 · Prometheus + Grafana

**Stack.** Prometheus scrapes `/metrics` (IP-allowlisted). Grafana loads
`ops/grafana/particle-health-dashboard.json` against a Prometheus data source
named `Prometheus` (substituted at import via `${DS_PROMETHEUS}`).

**Install once.**

```
# In Grafana → Dashboards → Import → Upload JSON
  file:  ops/grafana/particle-health-dashboard.json
  DS:    Prometheus
```

**Panels.** The dashboard is organised into four rows (SLOs, HTTP, AI/Cost,
Database, WebSocket):

| Row | Panel | Signal |
|-----|-------|--------|
| SLOs | Availability (1h), p95 (5m), in-flight HTTP, open WS | fast RED check |
| HTTP | request rate by status, latency quantiles, top-5 slowest routes | regression hunting |
| AI / Cost | MTD spend (USD), kill-switch state, calls by outcome, tokens/min | budget control |
| Database | p95 by kind, errors by code, pool in use | DB saturation |
| WebSocket | sent vs dropped, peak buffered bytes | backpressure health |

**Adjusting.** Every expression uses the `particle_` prefix set by
`server/utils/metrics.js`. If you add a metric there, add a Grafana panel
in the same dashboard JSON rather than creating a sibling dashboard.

**Metric catalogue.** See `server/utils/metrics.js` — the definitions are the
source of truth for labels and help text.

---

## 2 · Sentry

Sentry is wired on both sides:

- Server: `server/index.js` initialises `@sentry/node` when `SENTRY_DSN` is
  set. Release tag pulls from `SENTRY_RELEASE | RENDER_GIT_COMMIT | GIT_COMMIT`
  (Render sets `RENDER_GIT_COMMIT` automatically). PII is redacted in
  `beforeSend` (authorization/cookie/set-cookie/x-api-key headers).
- Client: `client/src/main.jsx` initialises `@sentry/react`. `sendDefaultPii`
  is false, session replays are off by default (0% session, 50% error).
  Release tag comes from `VITE_SENTRY_RELEASE` injected by CI.

**Gap check (W6.5).** The following were verified present:

- Both environments call `Sentry.init` before any user code runs.
- Both environments redact auth/cookie headers in `beforeSend`.
- Server forwards `uncaughtException` and `unhandledRejection` to Sentry.
- No `console.error` → `Sentry.captureException` duplication: `server/utils/logger.js`
  is the single point that escalates to Sentry, so a single error can't
  produce two events.

**Still open.**

- Sentry Release Health (sessions) is not wired. This requires calling
  `Sentry.configureScope(scope => scope.setTag('version', release))` before
  identify — currently done implicitly via `release:` but not verified in
  Sentry's UI. Revisit after first production deploy.
- `tracesSampleRate` defaults to 0.1 via `SENTRY_TRACES_SAMPLE_RATE`. Drop
  to 0.01 once traffic is above ~100 RPS to keep the Sentry quota down.

**Alert-to-Slack routing** lives in Sentry's project settings, not in this
repo. Keep that config documented in your internal ops wiki.

---

## 3 · PostHog (product analytics)

**Why it's here.** Sentry tells us what's broken; Prometheus tells us what's
slow. Neither tells us *whether users are succeeding at anything*. PostHog
fills that third gap: funnels, feature adoption, retention.

**Consent-first.** The wrapper in `client/src/utils/analytics.js` is a
complete no-op unless:

1. `VITE_POSTHOG_KEY` is set at build time; AND
2. the user has granted the `analytics` consent bucket in
   `CookieConsentBanner.jsx` (localStorage key `lgpd_consent_v1`).

The dynamic `import('posthog-js')` means the SDK isn't downloaded at all on
builds where the key isn't set, and it's code-split in builds where it is.

**PII rules.**

- `identify(userId, { tier })` — userId only. Email NEVER passed.
- `track(name, props)` — properties are allow-listed in `ALLOWED_KEYS`.
  Adding a new property requires editing that set, which forces a PII review.
- `$ip` is blacklisted on the client. If `person_profiles: 'identified_only'`
  combined with `$ip` suppression isn't enough for your jurisdiction, also
  disable at the PostHog project level under "Person properties".

**Event catalogue (intended).**

- `login_succeeded`, `signup_succeeded`
- `portfolio_imported` — `{ rows_added, rejected_count }`
- `upgrade_clicked` — `{ from_tier, to_tier }`
- `chat_message_sent` — `{ model }`
- `vault_document_added`
- `feature_gated` — `{ flag, enabled }` (from `useFeatureFlags`)

Wire these at the call sites as work progresses. Don't backfill them all at
once — pick the ones you'll actually look at in the weekly metrics review.

**Region.** Default host is `https://eu.i.posthog.com` (EU region) so data
stays within EEA jurisdiction — matches our GDPR/LGPD posture. Override
with `VITE_POSTHOG_HOST` for the US region if needed.

---

## 4 · Alertmanager / PagerDuty

Rules live in `ops/alerts.yml` (W4.2). Two fast-burn / slow-burn windows
follow the Google SRE MWMBR pattern:

- `HighErrorRateFastBurn` — 1h window, > 14.4× budget burn ⇒ S1 page
- `HighErrorRateSlowBurn` — 6h window, > 6× budget burn ⇒ S2 ticket
- `AIMonthlySpendApproachingBudget` — 80% of monthly budget ⇒ S2
- `AIKillSwitchBlockAllEngaged` — kill switch on ⇒ S1 (should have also
  already sent a Slack ping from the product)

All alerts link to `docs/INCIDENT_RESPONSE.md`.

---

## 5 · Logs

Structured JSON via `server/utils/logger.js`. Every log line has `reqId`
(from W0.6 request-ID middleware). On Render, view logs via `render logs`
or the dashboard. For local debugging:

```
# Tail server logs with reqId filter
tail -f server.log | jq 'select(.reqId == "<id>")'
```

---

## 6 · Cross-tool correlation

A single user problem surfaces across three systems. To correlate:

1. Sentry event → copy the `event.request.headers.x-request-id` (we attach it).
2. Grep server logs for that reqId → see the full timeline.
3. If it's a paying user, search PostHog by userId for adjacent events.

The glue is `reqId` on the server side and `userId` on PostHog. Sentry
links both (release + user.id) automatically.

---

## 7 · Quick-glance index

| Question | Look here |
|----------|-----------|
| Is the site up? | Grafana — SLO row |
| Why is it slow? | Grafana — HTTP row, Top-5 slowest |
| What's erroring? | Sentry — Issues |
| How much am I spending on AI today? | Grafana — AI / Cost row |
| Did my last release break signup? | PostHog — Funnel (signup) |
| Who's on call / what's the runbook? | `docs/INCIDENT_RESPONSE.md` |
| Is a feature kill-switched? | `GET /api/flags` + `/api/admin/flags` |
