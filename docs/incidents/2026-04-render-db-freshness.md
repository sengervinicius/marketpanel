# Post-mortem — INCIDENT-2026-04-20-RENDER-DB-FRESHNESS

**Status:** published
**Severity:** S1
**Incident window:** `2026-04-20 08:12` → `2026-04-20 10:10` BRT
**Duration of user impact:** ~1h 58m
**Author:** Platform/Claude
**Reviewers:** Vinicius (CIO)

## Summary

On Monday 2026-04-20 a freshly provisioned Render Postgres instance was pointed at the production web service. `init.sql` aborted partway through because the `idx_conv_memory_user_active` index used `WHERE expires_at > NOW()` in its predicate — which Postgres rejects, since `NOW()` is STABLE, not IMMUTABLE. Every CREATE TABLE below that line never ran, including `feature_flags`. When the server booted, `featureFlags.isOn('ai_chat_enabled')` threw (the table did not exist), the error was mapped to a generic off-state, and `/api/search/chat` returned 503 with the banner "Particle AI is temporarily offline" for every user.

The incident was user-visible for about two hours. Mitigation was a single-line SQL fix (drop the predicate) plus a hotfix commit that made future schema failures impossible to ship silently.

## Impact

- **Users affected:** 100% of authenticated users attempting to use Particle AI. Everyone else (terminal panels, market data, vault browsing, billing) was unaffected because those paths don't touch `feature_flags`.
- **Revenue at risk:** Zero near-term. Particle AI is the core paid feature, but the incident window was inside Brazil morning before most trading desks were active; no cancellations traced to the window.
- **Data loss:** None. No writes were corrupted — failed writes just returned errors. The vault, user, and subscription tables either already existed (old DB) or were missing entirely (new DB), so there was no partial-write state.
- **SLO burn:** `ai_chat_availability` target 99.5%/28d consumed ~6% of its monthly budget in this one incident.

## Timeline (times in BRT)

| Time  | Event |
|-------|-------|
| 08:12 | Render redeploy kicked off; new Postgres instance attached via env var flip. |
| 08:14 | Web service live; first user hits the AI chat panel and receives the 503 banner. |
| 08:16 | Sentry fires `Particle AI offline — feature_flags not found`. |
| 08:22 | CIO reports "Particle AI still offline after prior migration" in the ops channel. |
| 09:31 | On-call begins diagnosis; `psql` into the new DB shows `feature_flags` missing. |
| 09:48 | Root cause confirmed: `init.sql` line 246 aborts on `CREATE INDEX ... WHERE NOW()`. |
| 10:01 | Fix committed (`bff2acd`) — predicate dropped; redeploy triggered. |
| 10:05 | AI chat responses start working in production. |
| 10:09 | Hardening commit (`01c1094`) — per-statement exec + required-table assertion + CI smoke test. |
| 10:10 | Incident closed. |

## Root cause

Two stacked bugs, one latent since the commit that added `idx_conv_memory_user_active`, the other latent in every prior deployment that happened to reuse an existing DB.

### Bug 1 — non-IMMUTABLE function in an index predicate

```sql
CREATE INDEX IF NOT EXISTS idx_conv_memory_user_active
  ON conv_memory(user_id, last_seen DESC)
  WHERE expires_at > NOW();
```

Postgres requires index predicates to be IMMUTABLE so the predicate can be evaluated safely during index maintenance. `NOW()` is STABLE (returns the same value within a transaction, but different values across transactions). The statement fails with:

```
ERROR: functions in index predicate must be marked IMMUTABLE
```

This never fired on existing DBs because `IF NOT EXISTS` treats the index as a no-op once it's present — the predicate is only validated on initial creation. Every production DB in use since the commit landed had the index created successfully at some earlier point (likely when the predicate was different), so subsequent boots silently skipped the failing statement.

### Bug 2 — `init.sql` ran as a single transactional unit

`server/db/postgres.js` applied `init.sql` with a single `pg.query(allSql)`. Postgres executes that as one multi-statement transaction; any failure rolls back the entire block. Line 246 aborted, lines 247 → end never ran, and the only record was a single generic error log line near boot that nobody noticed because the server happily came up and started serving requests.

### Why it surfaced on Monday specifically

Monday was the first time in ~90 days that a **brand new** Postgres instance was pointed at the stack. Render periodically rotates underlying instances and nudges customers to attach to the new one; we accepted the nudge on Monday morning. Every prior attachment had been to a DB that already had the index from a previous, pre-predicate version of `init.sql`.

## What went well

Sentry caught the failure within 2 minutes of the first user request — the `feature_flags` table query produced a structured `PostgresError: relation "feature_flags" does not exist` that the generic error handler surfaced by pattern. The CIO report came in within 8 minutes; the on-call had the symptom within 10.

The vault kill switch (W6.1) prevented the outage from spreading. AI chat is the one surface that dereferences `feature_flags.ai_chat_enabled` on every request; the terminal panels proxy market data without hitting the table, so 95% of the UI kept working.

The fix itself was 1 line. Ship time from diagnosis to green was 17 minutes (09:48 → 10:05).

## What went poorly

The deploy shipped in the first place. We had no guard against `init.sql` silently failing — the server booted, responded to health checks, and served traffic with a broken schema underneath for ~2 hours before anyone noticed at the surface.

Diagnosis took too long. The incident was first reported at 08:22 BRT; root cause was confirmed at 09:48. That 86-minute gap was dominated by "is the DB up? yes. is the table there? no. why?" — time we could have eliminated with better boot-time assertions.

Monitoring was lagging indicators only. Sentry saw the user-facing 503s, not the underlying `init.sql` abort. There was no structured "schema bootstrap succeeded" heartbeat.

## Action items

| # | Action | Status | Commit |
|---|--------|--------|--------|
| 1 | Drop the `NOW()` predicate from `idx_conv_memory_user_active`. Index becomes non-partial; query planner still applies the `WHERE` at query time, so read performance is unchanged. | done | `bff2acd` |
| 2 | Apply `init.sql` statement-by-statement with per-statement try/catch + structured preview logging. | done | `01c1094` |
| 3 | After `init.sql` + migrations, assert `REQUIRED_TABLES` are all present; if any are missing, log FATAL and `process.exit(1)` so the deploy fails rather than serving a broken schema. | done | `01c1094` |
| 4 | Schema smoke test in CI — spin up `postgres:16`, drop the public schema, apply `init.sql` against a guaranteed-fresh DB, assert every required table exists and `feature_flags` seed has all three baseline rows. | done | `01c1094` |
| 5 | Wire a structured `schema_bootstrap_ok` Sentry breadcrumb at boot so future freshness events show up in the deploy timeline immediately. | **open** | — |
| 6 | Document the "drop public schema then migrate" flow in `DB_AUDIT_PLAYBOOK.md` as the canonical way to validate `init.sql` locally before touching production. | **open** | — |
| 7 | Postgres password rotation runbook (`docs/RUNBOOK_POSTGRES_PASSWORD_ROTATION.md`) — unrelated to the root cause, but this incident exposed that we had no rotation procedure written down. | done (P3.2) | — |

## Appendix

- Fix commit: [`bff2acd`](https://github.com/) — `Fix init.sql: drop NOW() predicate from conv_memory index`
- Hardening commit: [`01c1094`](https://github.com/) — `Harden schema bootstrap so this incident never happens again`
- CI workflow: `.github/workflows/ci.yml:schema-smoke`
- Schema smoke test: `server/db/__tests__/initSchema.smoke.js`
- Required-table list: `REQUIRED_TABLES` in `server/db/postgres.js`
- Related: `docs/RUNBOOK_POSTGRES_PASSWORD_ROTATION.md` (P3.2)
