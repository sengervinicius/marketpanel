# OPS — Inbound email → Central Vault

**Owner:** Founder/CIO
**Code:** `server/routes/inboundEmail.js`
**Tests:** `server/__tests__/inboundEmail.test.js`
**Shipped:** P3.1

This document is the end-to-end setup for `vault@the-particle.com`. Once complete, any email forwarded to that address by an allowlisted sender has its attachments (PDF, DOCX, CSV, TSV, TXT, MD) parsed, chunked, embedded, and added to the Central Vault — the global research layer that grounds Particle AI responses for every user on the terminal.

## Architecture

```
Inbox → forwards PDF → vault@the-particle.com
                              │
                              │  MX record at Cloudflare
                              ▼
                       Postmark inbound mailbox
                              │
                              │  Inbound Webhook (JSON POST)
                              ▼
        POST /api/inbound/email/<INBOUND_EMAIL_WEBHOOK_SECRET>
                              │
                              │  token check → sender allowlist →
                              │  dedupe → per-attachment ingest
                              ▼
                       vault.ingestFile(..., isGlobal=true)
                              │
                              ▼
                       vault_documents + vault_chunks (pgvector)
                              │
                              ▼
                 Particle AI retrieval across ALL users
```

## One-time setup checklist

### 1. Postmark — provision the inbound server

1. Sign in to Postmark, create a server called `particle-inbound`.
2. Inside the server, open **Servers → particle-inbound → Settings → Inbound**.
3. Postmark shows your **Inbound Email Address** in the form `<hash>@inbound.postmarkapp.com`. Copy it — this is the hidden forwarding destination.
4. Generate a 32+ character urlsafe random token:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
   Save this as `INBOUND_EMAIL_WEBHOOK_SECRET`.
5. Configure the webhook URL in Postmark:
   ```
   https://senger-server.onrender.com/api/inbound/email/<INBOUND_EMAIL_WEBHOOK_SECRET>
   ```
   (substitute the real token; the server treats the token as part of the URL path).
6. Postmark also requires you set **Include raw email content in JSON payload** = off, and **Inbound Domain** = `the-particle.com` (set in step 2 of DNS).

### 2. Cloudflare DNS — point `vault@the-particle.com` at Postmark

In Cloudflare Dashboard → `the-particle.com` → DNS → Records, add:

| Type | Name       | Content                              | TTL  | Proxied |
|------|------------|--------------------------------------|------|---------|
| MX   | `vault`    | `inbound.postmarkapp.com`            | Auto | DNS only |

Priority: `10` (Cloudflare's MX row has a separate priority input).

If you already have MX records on the apex (`@`) for something else, leave them alone — we only add a row for the `vault` subdomain, which is what makes `vault@the-particle.com` route to Postmark.

**DKIM / SPF / Return-Path:** Postmark's inbound stream does NOT require DKIM or SPF on your side — those are outbound concerns. The `vault@` mailbox accepts whatever the sending MTA delivers.

### 3. Render — set the env vars

Open the `senger-market-server` service on Render → **Environment** and add:

| Key                              | Value                                                |
|----------------------------------|------------------------------------------------------|
| `INBOUND_EMAIL_WEBHOOK_SECRET`   | The 32+ char token you generated in step 1.4         |
| `VAULT_INBOUND_ALLOWED_SENDERS`  | `founder@the-particle.com,vinicius@arccapital.com.br` (plus any other address you send from) |

`ADMIN_EMAILS` should already contain `founder@the-particle.com` — the first entry in that list becomes the owning user_id on inbound-ingested documents, so admin UI deletion works as expected.

Save and deploy. Render restarts the service automatically.

### 4. Smoke test

From one of the allowlisted sender addresses:

1. Compose an email to `vault@the-particle.com` with a small PDF attached.
2. Subject becomes the document title when the body is ingested; with an attachment it is stored as metadata only.
3. In Postmark → Inbound activity, confirm the email was received and the webhook returned `200` with `{ok: true, accepted: [{filename: "...", ok: true}]}`.
4. In the Particle terminal admin panel (`/api/vault/admin/documents`) or a `psql`:
   ```sql
   SELECT id, filename, is_global, created_at
   FROM vault_documents
   WHERE is_global = TRUE
   ORDER BY created_at DESC
   LIMIT 5;
   ```
   The new document should be the top row.
5. Repeat with an attachment-less email whose body is the whole note — confirm the response payload now includes a `body: {ok: true, source: "textbody"|"stripped"|"html"}` block, and the new `.md` document shows in the same `vault_documents` query.
6. Test the allowlist by sending from an outside address (e.g. a personal gmail). Postmark should show `200 {ok: false, reason: "sender_not_allowed"}` and no row should land in `vault_documents`.

## What gets ingested (and what doesn't)

| Attachment type          | Ingested? | Notes |
|--------------------------|-----------|-------|
| PDF                      | yes       | Parsed via `pdf-parse`, OCR fallback via tesseract.js if text layer is empty |
| DOCX                     | yes       | Parsed via `mammoth` |
| CSV / TSV                | yes       | Parsed via `papaparse` into a tabular text dump |
| TXT / MD / MARKDOWN      | yes       | Raw text, chunked |
| PNG / JPG / TIFF         | no        | Dropped with `unsupported_extension` — open an issue if you need OCR-on-image for inbound |
| ZIP / DOC (legacy Word)  | no        | Dropped |
| Email body text          | yes*      | *Only when no parsable attachment is present and the cleaned body is ≥ 200 chars. Ingested as a synthetic `.md` named after the subject + date. Prefer `StrippedTextReply`, falling back to `TextBody`, then HTML→text of `HtmlBody`. |

Hard caps: 10 attachments per email, 25 MB per attachment, 200 000 chars per body. Exceeding any of these logs to `skipped` in the response body so on-call can replay by hand.

## Observability

Each inbound delivery logs two lines:

```
inbound-email  "Processed inbound email" { messageId, sender, subject, acceptedCount, ingestedCount, skippedCount }
inbound-email  "Ingested attachment into central vault" { messageId, sender, filename, bytes }   // per attachment
```

Failure modes (all ACKed with 200 so Postmark doesn't retry-storm):

| Reason                     | Meaning                                       | Action |
|----------------------------|-----------------------------------------------|--------|
| `bad_token`                | Webhook URL mis-configured                    | Fix URL in Postmark |
| `allowlist_unconfigured`   | `VAULT_INBOUND_ALLOWED_SENDERS` empty         | Set env var on Render |
| `owner_unconfigured`       | `ADMIN_EMAILS` empty                          | Set env var on Render |
| `owner_not_found`          | `ADMIN_EMAILS[0]` user doesn't exist in DB    | Register the account first |
| `sender_not_allowed`       | From address not in allowlist                 | Expected — log only |
| `duplicate`                | MessageID already ingested                    | Expected on retry — log only |

## Rollback

Any of these disables inbound ingestion:

- Unset `INBOUND_EMAIL_WEBHOOK_SECRET` on Render — route immediately starts 404-ing.
- Clear `VAULT_INBOUND_ALLOWED_SENDERS` — everything drops with `allowlist_unconfigured`.
- Remove the MX record at Cloudflare — mail bounces at the SMTP layer, nothing reaches Postmark.

The on-disk vault is untouched by rollback; any documents already ingested remain searchable.

## Security model

The three layers of defence, in order:

1. **Path-embedded webhook secret** — only Postmark's configured delivery URL reaches the handler. An attacker who guesses `/api/inbound/email` without the token gets 404.
2. **Sender allowlist** — even if somebody learns `vault@the-particle.com` and mails a hostile payload, `VAULT_INBOUND_ALLOWED_SENDERS` blocks it before any parsing happens. **This is the critical defence against prompt-injection research PDFs.**
3. **Attachment-type gate** — only the extensions the vault pipeline parses are allowed through. Executables, archives, and images are dropped.

Note that `From:` headers are forgeable. Mitigations:

- Postmark does SPF/DKIM verification on delivery and drops hard failures before the webhook fires — so `founder@the-particle.com` in the allowlist is effectively protected by whatever outbound auth those senders use.
- The allowlist should be kept to personal addresses the CIO controls. Do NOT add generic corporate addresses like `research@bank.com` — forge those at will.

If prompt-injection does somehow land in the central vault, W4.1's `vaultSecurity.js` scrubber and `formatForPrompt` hardening still apply at retrieval time.
