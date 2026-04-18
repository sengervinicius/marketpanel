# SUPPORT_STACK.md — One-person support playbook

**Audience:** whoever is on the support rota this week (currently: founder).
**Goal:** keep response times honest while the team is one person, and make
hand-off to the first support hire a copy-paste.

This pairs with [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) (infra incidents)
and [SLOs.md](SLOs.md) (availability targets). This doc is for *user* support —
people writing in about their account, their portfolio, their bill.

---

## 1. Channels

| Channel | URL / address | Who sees it | Purpose |
|---|---|---|---|
| Email — support | `support@particle.investments` | founder | All tiers. Primary channel. |
| Email — DPO | `dpo@particle.investments` | founder | LGPD / GDPR data-subject requests only. Replied to within 15 days (LGPD Art. 19). |
| In-app chat | Crisp widget (opt-in) | founder | Paid tiers only. Behind `support_chat_enabled` flag + LGPD consent. |
| Status page | `https://status.particle.investments` | public | Uptime, known incidents, maintenance windows. |
| Roadmap | `https://roadmap.particle.investments` | public | Publicly ranked backlog. Users upvote. |

**Not supported:** phone, WhatsApp, DMs on social. Route politely to email.

Why: a one-person support stack cannot honour multi-channel SLAs without burning
out. Concentrating on two channels (email + in-app) keeps response times honest
and the audit trail clean.

---

## 2. Response SLAs

These are internal commitments, not contractual guarantees — the ToS disclaims
specific response times. They exist so the person on rota knows what "late"
means.

| Tier            | Severity 1 (can't log in, billed twice, data loss) | Severity 2 (feature broken, visible bug) | Severity 3 (question, feature request) |
|-----------------|:--:|:--:|:--:|
| Trial           | 24h | 72h | 7d  |
| Particle Pro    | 8h  | 24h | 48h |
| Particle Elite  | 4h  | 12h | 24h |
| DPO tickets     | 48h acknowledgement, 15d resolution (LGPD) | — | — |

"Response" = a human acknowledgement, not a resolution. Auto-responders don't
count. If the rota is on holiday, the auto-responder must say so and give an
ETA.

---

## 3. Triage routine (start of each day)

Work in this order:

1. Sentry issues page — any new error with >5 users affected in last 24h
   becomes a sev-2 ticket even if nobody wrote in.
2. `dpo_tickets` table (`SELECT * FROM dpo_tickets WHERE handled_at IS NULL ORDER BY created_at`).
3. Crisp inbox (if enabled).
4. Support email.

For each item: label, ack, then batch the actual replies at fixed times (10:00
and 16:00 London). Context-switching every ping is the failure mode that kills
one-person support.

---

## 4. Labels + routing

We use a flat label set so everything fits in a Gmail filter rule. Labels are
prefixed so they sort.

```
00-triage       newly arrived, not yet looked at
01-sev1         can't log in / billed twice / data loss / regulatory
02-sev2         feature broken / visible bug
03-sev3         question / feature request
10-billing      Stripe, IAP, plan changes
11-auth         login, password reset, email verification, Apple SSO
12-portfolio    positions, imports, CSV/OFX/PDF
13-data         prices, FX, BCB, provider fallback
14-ai           chat answers, vault, analysis quality
15-perf         slowness, mobile, WS drops
16-legal        LGPD, GDPR, DSAR, DPO — escalate to DPO inbox
90-spam         sales pitches, growth hackers
```

Never bury `01-sev1` or `16-legal`. Everything else can wait for the batch.

---

## 5. Escalation matrix

A single label decides whether it stays with support or gets pulled onto the
engineering queue.

| Pattern | Action |
|---|---|
| User reports wrong price / FX | Check `server/utils/metrics.js` dashboard + `docs/PERFORMANCE_PLAYBOOK.md`. If confirmed → open incident per [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md). |
| User reports "AI said something dangerous" | Freeze with template "Reply.AI-Safety" below, open sev-1 in Sentry with `ai_safety` tag, review prompt + output in `audit_log`. |
| Stripe double-charge | Do NOT refund ad hoc. Use admin dashboard's refund button so the audit row + Sentry breadcrumb are created together. |
| IAP subscription "expired" but user says they paid | Run the reconciler (`node scripts/reconcile-iap.js <userId>`), do not manually flip `subscription_active`. |
| DSAR (data export / delete) | Route to DPO inbox. Must ack in 48h. Delete pipeline is in `server/jobs/lgpdRetention.js`. |
| Legal threat / subpoena | STOP. Do not reply. Forward verbatim to founder's personal email. |

---

## 6. Canned responses

Save these as Gmail templates. They cover ~60% of volume. Customise the first
line; never customise the legal/financial disclaimers.

### Reply.Auth.Reset
```
Hi {firstName},

I've triggered a password reset. Check {email} — the link is valid for 1 hour.
If you didn't receive it within 5 minutes, check spam and then reply here; we
can verify you via a different channel.

Particle doesn't give investment advice — see https://particle.investments/terms.

— {you}
```

### Reply.Billing.DoubleCharge
```
Hi {firstName},

I'm checking the charges now. Stripe retries webhooks on transient failures so
occasionally a duplicate appears; our system dedupes (we have an idempotency
ledger), but if one slipped through I'll refund the duplicate and confirm here
within 24 hours. Your subscription remains active while I investigate.

If you need a receipt in the meantime, your billing portal is at
https://particle.investments/billing.

— {you}
```

### Reply.Import.UnsupportedBroker
```
Hi {firstName},

Thanks for trying the import. We don't yet have a template for your broker's
PDF — we only recognise formats we've explicitly modelled, because a generic
PDF parser produces wrong ingests more often than it helps.

Two options right now:
  1. Export a CSV from your broker and use Import → CSV. We auto-detect
     columns including Portuguese headers.
  2. If your broker offers an OFX export (most do), use Import → OFX.

If neither works, reply with a sample (redacted) PDF and we'll add the
template — these land in patches about every two weeks.

— {you}
```

### Reply.AI.Safety
```
Thank you for flagging this. Particle's AI is a research assistant — it does
not give investment advice, and when an answer looks like it might be read
that way we treat the report with the same urgency as a bug. I've opened
ticket {id}; I'll get back to you with what I find within 48 hours.

— {you}
```

### Reply.Feature.Request
```
Noted and logged on the public roadmap at https://roadmap.particle.investments
— you can upvote it there. I'll let you know when it's scheduled.

— {you}
```

---

## 7. Weekly rhythm

Every Friday afternoon:

- Drain `dpo_tickets` with `handled_at IS NULL`. Any older than 7 days get
  flagged red on the internal dashboard.
- Close any sev-3 tickets with no reply in 14 days, with a polite "reopening
  this if I hear back" note.
- Publish one "what shipped this week" post to the roadmap.
- Rotate the Crisp away-message to the next week's working hours.

Every quarter:

- Audit this file against actual volume. If a canned response has been edited
  the same way three times, lift the edit into the template.
- Review the SLA table against reality. If the Pro sev-2 SLA has been missed
  three times in a quarter, the SLA is the problem, not the queue.

---

## 8. Hand-off checklist (first support hire)

When we hire the first dedicated support person:

- Grant them Gmail access to `support@` (not `dpo@` — DPO stays with the
  founder + counsel).
- Grant them `role=support` in admin dashboard (read-only to audit + billing,
  can issue refunds up to $500 without approval).
- Walk them through this doc plus [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)
  and [PERFORMANCE_PLAYBOOK.md](PERFORMANCE_PLAYBOOK.md) on day one.
- Shadow them for the first week; they shadow you for the second.
- Rotate Crisp operator list — add them, keep founder as backup.

---

## 9. Crisp widget — operational notes

The in-app chat widget is gated on two things:

1. Server feature flag `support_chat_enabled` (see `server/db/init.sql` —
   default OFF so ops has to consciously turn it on per environment).
2. Client LGPD analytics consent (Crisp sets its own first-party cookies).

Consequence: we never load the Crisp SDK on page load. It code-splits via
dynamic import only after both checks pass. This keeps the LCP flat and
matches the cookie-notice promise that nothing non-essential loads pre-consent.

To turn it on for production:
```
curl -X POST https://particle.investments/api/admin/flags \
  -H 'Authorization: Bearer <admin JWT>' \
  -d '{"name":"support_chat_enabled","enabled":true,"rolloutPct":100}'
```

To turn it off (e.g. going on holiday without a backup operator):
```
curl -X POST https://particle.investments/api/admin/flags \
  -H 'Authorization: Bearer <admin JWT>' \
  -d '{"name":"support_chat_enabled","enabled":false}'
```

---

## 10. Links

- Incidents: [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)
- Observability: [OBSERVABILITY.md](OBSERVABILITY.md)
- SLOs: [SLOs.md](SLOs.md)
- Perf runbook: [PERFORMANCE_PLAYBOOK.md](PERFORMANCE_PLAYBOOK.md)
- LGPD: [LGPD_COMPLIANCE.md](LGPD_COMPLIANCE.md)
- Regulatory: [GLOBAL_REGULATORY_POSTURE.md](GLOBAL_REGULATORY_POSTURE.md)
