# Runbook — JWT signing-key rotation

_Status: Wave 0 · W0.7_
_Owner: Platform/Security_
_Applies to: `server/authStore.js`_

## Why

Our short-lived access tokens (15 min) are signed with HS256. Historically we
used a single `JWT_SECRET`. Rotating that secret immediately invalidated every
live session, which is bad for both users and support volume. This runbook
describes a seamless, zero-downtime rotation using two keys (CURRENT and
PREVIOUS) identified by a **kid** in the JWT header.

## How the two-key model works

- `JWT_SIGNING_KID_CURRENT` + `JWT_SIGNING_KEY_CURRENT` — signs all **new**
  tokens.
- `JWT_SIGNING_KID_PREVIOUS` + `JWT_SIGNING_KEY_PREVIOUS` — accepted only
  during **verification**, never used to sign.
- Every token carries its `kid` in the header. The server uses that kid to
  pick the right key. Tokens signed under PREVIOUS keep working until the
  access-token TTL (15 min) expires; after that, the client's refresh flow
  mints a new token signed under CURRENT.
- Legacy fallback: if only `JWT_SECRET` is set, it is mounted as kid `legacy`
  so existing tokens keep validating during the one-time cut-over.

## Rotation cadence

Rotate **every 90 days** or **immediately** on any suspected compromise. Put
this on the platform calendar; pager the on-call if it slips past 100 days.

## Rotation procedure

### 0. Preconditions

- You can edit env vars in Render without a full deploy.
- You have write access to the password manager entry **JWT signing keys**.
- The app is healthy (check Sentry dashboard for active incidents).

### 1. Generate a new key

```bash
# 64 random bytes, base64-url — paste the output into the password manager
node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))"
```

Pick a kid that encodes the date, e.g. `k-2026-04`. Kids are non-secret but
must be unique across active keys.

### 2. Promote CURRENT → PREVIOUS

In the **server** environment (Render → senger-market-server → Environment):

| Key | New value |
|-----|-----------|
| `JWT_SIGNING_KID_PREVIOUS` | the **old** CURRENT kid |
| `JWT_SIGNING_KEY_PREVIOUS` | the **old** CURRENT key |

### 3. Install new CURRENT

| Key | New value |
|-----|-----------|
| `JWT_SIGNING_KID_CURRENT` | the new kid (e.g. `k-2026-04`) |
| `JWT_SIGNING_KEY_CURRENT` | the new key from step 1 |

### 4. Deploy

Trigger a manual redeploy of the server. Client does not need redeploy.

### 5. Verify

- Hit `GET /api/health` → 200.
- Log in in an incognito window. Decode the JWT (`jwt.io`) and confirm the
  header's `kid` matches the new CURRENT value.
- Open an existing session in another browser (one signed under the previous
  key). It should still work until the access token naturally expires and
  the refresh flow rotates it.
- Check Sentry for `JsonWebTokenError` or `TokenExpiredError` spike — a small
  bump is expected around the refresh horizon; a sustained spike is not.

### 6. Retire PREVIOUS

After **15 minutes + one refresh-window buffer** (call it 30 min total), any
token still signed under the old key is expired. You may now unset
`JWT_SIGNING_KID_PREVIOUS` + `JWT_SIGNING_KEY_PREVIOUS`. Leaving them in
place is also acceptable; they will be ignored once no tokens carry that kid.

Do **not** immediately delete the old key value from the password manager —
keep it for 90 days in case you need to decrypt a forensic log.

## Emergency rotation (compromise suspected)

If you suspect a key is leaked (e.g. GitHub-secret-scan hit, infra breach):

1. Run steps 1–4 above immediately.
2. Within the same change window, **revoke all refresh tokens**: run
   `DELETE FROM refresh_tokens;` in the server Postgres console. Every user
   will be forced back to the login screen; acceptable tradeoff vs. a live
   compromise.
3. Post a status update to `#security` and the Arc Capital ops channel.
4. File an incident ticket; see `docs/INCIDENT_RESPONSE.md` once it exists
   (tracked in the Wave 1 backlog).

## Rollback

If the new key causes widespread verification failures:

1. Swap the env-var values so that CURRENT becomes the old (working) key.
2. Redeploy.
3. Leave a `JWT_SIGNING_KID_PREVIOUS` set to the attempted new kid so any
   tokens that made it out into the wild continue validating for the TTL.

## Observability

After each rotation, paste the kid and the timestamp into the platform log
pinned thread. This is intentionally a manual record — we want a human to
eyeball that rotations are actually happening, not just pass a CI check.
