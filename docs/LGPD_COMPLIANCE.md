# LGPD Compliance Baseline — Particle Terminal

**Scope:** technical and organizational controls implemented for Wave 1 (W1.1) to meet Lei Geral de Proteção de Dados (Lei nº 13.709/2018) obligations for Particle Terminal. This document is the single source of truth for engineering, operations, and the Data Protection Officer.

**Status:** baseline in place for data-subject rights (Art. 18), consent (Art. 7–8), retention, and incident response. Further work listed at the end.

**Owner:** CTO / DPO.
**Last review:** 2026-04-17.

## 1. Roles

| Role | Person | Email |
|---|---|---|
| Controller (Controlador) | Arc Capital | privacy@arccapital.com.br |
| Processor (Operador) | Particle Terminal (internal) | — |
| DPO (Encarregado) | Vinicius Senger | vinicius@arccapital.com.br |

## 2. Data inventory (Art. 37)

The platform stores the following categories of personal data, each mapped to its table and legal basis.

| Category | Storage | Legal basis (Art. 7/11) | Retention |
|---|---|---|---|
| Identity (name, email, password hash) | `users` | Execution of contract (Art. 7 V) | Until erasure request + 30 days grace |
| Session identifiers (refresh tokens) | `auth_refresh_tokens` | Legitimate interest — security | 30 days rolling |
| Subscription & payment metadata | `users.stripe_customer_id`, `iap_receipts` | Contract | 5 years (fiscal law) |
| Usage telemetry (AI calls, tokens, cost) | `ai_usage_ledger` | Legitimate interest — fraud prevention | 13 months |
| User content (chats, vault documents) | `conversations`, `vault_documents` | Contract | Until erasure request |
| Audit trail | `admin_audit_log` | Legal obligation | 5 years |
| DPO tickets | `dpo_tickets` | Consent (ticket form) | 90 days PII, 2 years message |
| Marketing preferences | `users.marketing_opt_out` etc. | Consent | Until revoked |

Cross-border transfers: OpenAI, Anthropic, and Perplexity in the United States (LGPD Art. 33 II — Standard Contractual Clauses). Listed publicly at `GET /api/privacy/data-map`.

## 3. Data-subject rights (Art. 18)

All rights are exposed at `/api/privacy/*` and surfaced in the client at `/configuracoes/privacidade`.

| Right | Endpoint | Notes |
|---|---|---|
| Confirmation of treatment | `GET /api/privacy/data-map` | Public JSON, no auth required. |
| Access | `GET /api/privacy/me` | Returns profile + last 90d audit + 30d AI usage. |
| Rectification | `PATCH /api/privacy/me` | Email/username/settings (allow-list). |
| Anonymization / Erasure | `DELETE /api/privacy/me` | Soft-delete + 30-day grace. See §5. |
| Portability | `GET /api/privacy/export` | Same payload as /me with `Content-Disposition: attachment`. |
| Information about sharing | `/data-map` controllers + processors list |
| Revocation of consent | `POST /api/privacy/object` | Toggles marketing/analytics/ai_training flags. |
| Reclamation to ANPD | Contact info in `/data-map` and DPO page. |
| DPO contact | `POST /api/privacy/dpo-contact` | Public form, rate-limited 3/hr. |

All state-changing DSAR actions are captured by `adminAuditLog` middleware (W0.8) with `lgpd_event` tags.

## 4. Consent (Art. 7–8)

The client shows a **granular** consent banner (`CookieConsentBanner.jsx`) on first load with three buckets:

- **Essential** — always on (auth/CSRF). Legal basis: execution of contract.
- **Analytics** — default OFF. Sentry performance + future aggregate analytics.
- **Marketing** — default OFF. Referral attribution and email campaigns.

Selections are stored in `localStorage` under `lgpd_consent_v1` and, for authenticated users, synced to server via `POST /api/privacy/object`. The banner version is bumped on material change so consent is re-prompted.

## 5. Retention & erasure

**Soft-delete flow.** `DELETE /api/privacy/me`:

1. Inserts `{user_id, hard_delete_after = NOW() + 30d, status='pending'}` into `dsar_erasure_queue`.
2. Sets `users.pending_deletion_at = NOW()` (runtime refuses login past this point).
3. Audit log entry `dsar_erasure_requested`.

**Grace window.** User may reverse via `POST /api/privacy/cancel-erase` within 30 days. This deletes the queue row and clears `pending_deletion_at`.

**Hard-delete.** `server/jobs/lgpdRetention.js` runs daily at 03:15 BRT:

1. Scans `dsar_erasure_queue` for rows past the grace window.
2. For each user, deletes row from `users` in a single transaction (FKs cascade).
3. Updates queue row to `status='executed'`.
4. Redacts PII columns on `dpo_tickets` older than 90 days (email, name, ip_hash nulled; message retained for stats).

**Payment records.** Retained for 5 years per Brazilian tax/fiscal obligations (Art. 16 II). DSAR does NOT cascade to `iap_receipts` or invoicing records until the retention deadline.

## 6. Security of processing (Art. 46)

- Transport: TLS 1.2+ (Render edge + HSTS).
- At-rest: Postgres encryption provided by Render; disk snapshots encrypted.
- Secrets: never committed; rotated on JWT breach per `docs/RUNBOOK_JWT_ROTATION.md` (W0.7).
- Access: MFA on admin console; `admin_audit_log` on every privileged action (W0.8).
- AI output: runtime guard scrubs credentials and exfil URLs before user sees them (`aiOutputGuard.js`, W1.3).
- Logging: request logger redacts secrets, emails, JWTs, CPF, phone numbers (W0.5).

## 7. Incident response (Art. 48)

Legal requirement: notify ANPD and affected data subjects **within a reasonable period** of confirming a personal-data incident.

Runbook (`docs/RUNBOOK_JWT_ROTATION.md` covers the auth-compromise case):

1. Detect (Sentry alert, admin audit log anomaly, external report).
2. Triage — classify severity S0–S2.
3. Contain — revoke keys, rotate JWT secrets, kill switch `block_all_ai` if AI-related.
4. Notify — DPO drafts ANPD notice (72h target), user notice (high-risk only).
5. Post-mortem — documented and filed in `docs/incidents/YYYY-MM-DD-<slug>.md`.

## 8. Open items / next-wave scope

1. Client-facing "Central de privacidade" page consolidating access / export / erase buttons.
2. Automated SCC/DPIA documentation per downstream processor (OpenAI, Anthropic, etc.).
3. Age-verification at signup (LGPD Art. 14 — minors).
4. Legal review + bilingual publication of Política de Privacidade and Termos de Uso.
5. ANPD incident-notification template kept in `docs/incidents/TEMPLATE.md`.
6. Quarterly DSAR metrics dashboard (tickets opened, median response time).

## 9. Change log

| Date | Wave | Change |
|---|---|---|
| 2026-04-17 | W1.1 | Initial baseline: DSAR endpoints, consent banner, retention job, data-map. |
