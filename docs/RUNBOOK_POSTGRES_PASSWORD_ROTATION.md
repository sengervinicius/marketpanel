# Runbook — Postgres password rotation

_Status: P3.2_
_Owner: Platform/Security_
_Applies to: Render Managed Postgres (`senger-postgres`) + the env var `DATABASE_URL` on `senger-market-server`_

## Why

The Postgres password is the single credential that protects every user row, every vault chunk, every subscription record, and every admin audit log entry in this system. Rotate it:

- **Every 90 days** as hygiene.
- **Immediately** on any suspected compromise (commit that leaked the URL, ex-contractor laptop, password-manager breach).
- **After any third party** was ever read-only granted the URL for debugging — that grant is irrevocable until we rotate.

## Blast radius

Changing the password causes **one momentary reconnect** across the Node process's pg pool. In practice:

- The application keeps running; the pool reconnects on the next query.
- In-flight WebSocket subscriptions survive (they don't touch pg directly).
- Background jobs (`jobs/markToMarket`, vault re-embed) retry on connection error — confirmed because this is how the process already handles Render's weekly reboots.
- Expect a ~10-second window where some requests may return a 503 from the vault kill switch if `pgConnected()` returns false. This is the same behaviour we see on any Render deploy.

**No data is lost. No sessions are invalidated.** JWTs are signed with the key set in `JWT_SIGNING_KEY_CURRENT`, not the DB password, so users stay logged in.

## Preconditions

- Admin access to the Render dashboard (both the Postgres instance and the web service).
- Write access to the password-manager entry **Render Postgres — senger**.
- You're watching Sentry and Render logs for 10 minutes around the cut.
- No active incident. If vault ingestion jobs are running (see `vault._ingestionJobs` in logs), wait for them to drain — an in-flight ingestion that reconnects mid-embedding will retry, but the user-facing job status will flap.

## Procedure

### 1. Schedule

Pick a low-traffic window (Brazil early morning or Sunday). You don't need a maintenance banner for a 10-second reconnect; just note the window in the incident channel.

### 2. Snapshot first

Before touching anything, trigger a Render Postgres backup:

1. Render dashboard → `senger-postgres` → **Backups** tab → **Create Backup**.
2. Wait until the new row shows _Complete_ (~1–3 min on the current DB size).
3. Confirm the backup ID in the password-manager entry.

This is cheap insurance; if the rotation goes wrong, you restore from this backup rather than trying to guess the previous password.

### 3. Rotate on Render

1. Render dashboard → `senger-postgres` → **Info** tab.
2. Scroll to **Connections**. The **Internal Database URL** and **External Database URL** both end in `?password=<current>`. These are what `DATABASE_URL` points at.
3. Click the **Reset Password** button (or the equivalent — Render's UI calls it "Rotate Password" on some plans).
4. Render generates a new password and updates both Internal and External URLs in place. **Copy the new Internal URL immediately** — Render shows the full URL once, then masks it.
5. Paste the new URL into the password-manager entry **Render Postgres — senger** under a new versioned field (don't overwrite the old one yet; leave the old URL in an _expiring_ field with a 24h note so you can rollback if needed).

### 4. Update the web service env var

1. Render dashboard → `senger-market-server` → **Environment**.
2. Find the `DATABASE_URL` row. Paste the new Internal URL into the value cell.
3. Click **Save Changes**.
4. Render auto-triggers a redeploy.

### 5. Watch the redeploy

Tail the deploy logs in the Render dashboard. You should see, in order:

```
[INFO] Postgres pool created — <pool size> connections
[INFO] Postgres schema bootstrap: OK
[INFO] initDB — users table ready
[INFO] Vault initialized
[INFO] Server listening on port <N>
```

If you instead see `ECONNREFUSED`, `password authentication failed`, or a crash loop, **go to Rollback immediately** (section 7). Don't wait to debug.

### 6. Verify

From anywhere with the Render CLI (or Render shell), run a handful of smoke queries:

```sql
-- Auth layer is alive
SELECT COUNT(*) FROM users;

-- Vault is alive
SELECT COUNT(*) FROM vault_documents;

-- Admin audit log is being written (should be non-empty)
SELECT MAX(created_at) FROM admin_audit_log;

-- Background jobs' last heartbeat (if we have one)
SELECT pg_postmaster_start_time(), now();
```

Then open the live terminal as an admin user and do a real flow:

1. Log in at https://the-particle.com
2. Open the AI chat panel, ask "what's new with AAPL?" — confirms vault query path
3. Upload a small PDF to the private vault — confirms ingestion path
4. Check Sentry for any new errors in the last 15 minutes

### 7. Rollback

If anything in step 5 or 6 fails:

1. Render dashboard → `senger-market-server` → **Environment**.
2. Paste the OLD `DATABASE_URL` (the one you saved in step 3.5) back into the value cell. **This only works if you rotated via "Reset Password"** — Render may have fully invalidated the old credential. If so, you cannot rollback the password; you rollback by restoring from the backup taken in step 2 and re-pointing the URL at the restored instance.
3. Save Changes → wait for redeploy → verify health.
4. File an incident and open a task to figure out why step 5 failed before the next rotation window.

### 8. Cleanup

After the rotation has been stable for **24 hours**:

1. Delete the OLD URL field from the password-manager entry.
2. Note the rotation date and backup ID in the audit spreadsheet.
3. Set a calendar reminder for +90 days.

## What to check before rotating

- [ ] No deploys in flight (Render **Events** tab is quiet for the last 15 min).
- [ ] Sentry shows no active P1/P2 incidents.
- [ ] You have the Render admin session active in a second tab for rollback.
- [ ] The backup completed and is listed as _Complete_.
- [ ] The old `DATABASE_URL` is captured in the password manager with an expiry note.

## Known pitfalls

- **Connection pooler:** If we ever introduce PgBouncer in front of the DB, rotation needs to update the pooler's credentials too. As of today (2026-04-20) we don't use one.
- **Read replicas:** Same — as of today we have none. If we add one, rotation will need to happen on both primary and replica, and `REPLICA_DATABASE_URL` (a hypothetical env var) must be updated in lock-step.
- **Long-running vault ingestion:** If a large PDF is mid-embed when the pool reconnects, the job will retry from the last checkpoint. No corruption, but the user sees "Ingesting…" for an extra minute.
- **Encoded password characters:** Render's generator may include `+` or `/` in the base64. `DATABASE_URL` requires percent-encoding (`+` → `%2B`, `/` → `%2F`). Render usually handles this for you — verify by eyeballing the new URL before saving.
- **CI/dev machines:** Any developer with a copy of `DATABASE_URL` in their local `.env` needs an updated copy. Notify on internal Slack.

## Related

- Incident **DB-freshness** (April 2026) — resolved by `01c1094` (schema bootstrap hardening) + `bff2acd` (conv_memory index fix). See `docs/incidents/2026-04-render-db-freshness.md`.
- `docs/DB_AUDIT_PLAYBOOK.md` — broader DB health procedures.
- `docs/RUNBOOK_JWT_ROTATION.md` — sister runbook for JWT keys.
