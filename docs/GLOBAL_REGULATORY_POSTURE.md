# Global Regulatory Posture — Particle Terminal

**Owner:** Vinicius Senger (CIO, Arc Capital)
**Last updated:** 2026-04-18
**Status:** baseline — requires UK solicitor review before public launch.

## 0. Scope

Particle Terminal is positioned as a **global** investment terminal. The
founding company operates from London; the initial user base is expected to
be Brazilian + UK + EU, with the US explicitly geo-blocked until a US
compliance posture is built.

This document enumerates the regulatory regimes that matter, maps each to
current technical controls, lists gaps, and sets a jurisdictional launch
order.

## 1. Regimes in scope

| Regime | Jurisdiction | Trigger | Authority |
|---|---|---|---|
| **FSMA s.21 / FCA CoBS** | UK | Any financial promotion to UK persons | FCA |
| **MiFID II + ESMA guidance** | EU | Investment advice / investment services to EU persons | ESMA + national regulators |
| **CVM Resolução 20/2021** | Brazil | Investment recommendation for compensation | CVM |
| **SEC Investment Advisers Act 1940** | US | Personalised investment advice to US persons | SEC + state securities boards |
| **UK GDPR** | UK | Processing UK residents' personal data | ICO |
| **EU GDPR** | EU | Processing EU residents' personal data | EDPB + national DPAs |
| **LGPD Lei 13.709/2018** | Brazil | Processing BR residents' personal data | ANPD |
| **CCPA / CPRA** | California, US | Processing California residents' personal data | CPPA |
| **PECR / ePrivacy** | UK / EU | Cookies + direct marketing | ICO / national DPAs |

## 2. Advice vs education — the line that matters

The single highest-risk product surface is the AI chat. Regulators treat
anything that a reasonable person would read as a personalised
buy/sell/hold recommendation as **investment advice**, which is reserved
activity in UK, EU, BR, and US.

Current controls (already in codebase):

- `services/aiOutputGuard.js` with red-team corpus for prompt-injection.
- `W0.4` AI output disclaimers appended to every chat response.
- `modelRouter` force-degrades to Haiku for trivia / factual queries.
- Chat response cache (`aiResponseCache`) versioned by prompt version.

Gaps:

- The guardrails do **not** currently detect recommendation-shaped output.
  "Given your portfolio, I'd rotate out of PETR4" should be blocked or
  relabelled as "for educational purposes only, not a recommendation."
- No per-jurisdiction wording on the disclaimer. A UK user should see the
  FCA-style "Capital at risk. Particle does not provide investment advice"
  wording; an EU user needs ESMA-style language.

**Action items:**

1. Add a `recommendation_detector` filter to `aiOutputGuard` that flags
   output containing imperative verbs + ticker references.
2. Expand `aiOutputGuard.disclaimer()` to accept a `jurisdiction` argument
   and return the matching locale/regime string.

## 3. Data subject rights — one engine, many regimes

Current implementation (W1.1):

- `dsar_erasure_queue` table with 30-day soft-delete grace.
- `server/routes/privacy.js` exposes access / rectify / erase / portability.
- `server/jobs/lgpdRetention.js` hard-deletes after the grace window.
- `CookieConsentBanner.jsx` stores `lgpd_consent_v1` with version bumping.

Regime-specific response windows and rights:

| Regime | Access | Erasure | Rectification | Portability | Objection |
|---|---|---|---|---|---|
| UK GDPR | 30 days | 30 days | 30 days | 30 days | 30 days |
| EU GDPR | 30 days (extendable 60) | 30 days | 30 days | 30 days | 30 days |
| LGPD | 15 days | 15 days | 15 days | 15 days | 15 days |
| CCPA | 45 days (extendable 45) | 45 days | 45 days | 45 days | opt-out right |

**Gap:** we treat every request as LGPD-speed (15 days). That's *safe* — we're
being stricter than we need to be — but the user-facing copy references
LGPD only. For a global launch we need a `jurisdiction` flag on the user
row that picks the right copy and potentially the right response timer for
operational planning. Engine itself (soft-delete → hard-delete) is already
jurisdiction-agnostic.

## 4. Geography controls

Currently there is **no** geo-block. For day-1 global launch we need:

- **Edge-level US block** (via Cloudflare Workers or Render edge rules)
  returning HTTP 451 with a legal notice page. Blocking at the edge keeps
  SEC registration off the table until we're ready.
- **Territory flag** on every user record populated from IP-geolocated
  first signup (`us`, `uk`, `eu`, `br`, `other`) — drives copy, timers,
  and the consent banner variant.
- **Clear ToS carve-out**: "Particle Terminal is not offered to persons
  in the United States." This should be in the welcome flow and the ToS.

**Action items:**

1. Add `server/middleware/geoBlock.js` using Cloudflare's `CF-IPCountry` header.
2. Add `users.jurisdiction` column (nullable, populated at signup).
3. Add `/blocked` route + static page with legal explanation.

## 5. Marketing + financial promotions

If the marketing site ranks tickers, shows back-tested returns, or claims
the product "helps you invest better", FCA s.21 is engaged. Two safe paths:

- **Section 21 exemption via article 12**: market only to self-certified
  sophisticated / high-net-worth individuals. Restricts the TAM but keeps
  the regime manageable.
- **Authorised person or AR relationship**: partner with an FCA-authorised
  firm that approves the promotion. Typical fee: £5–15k per year + per-piece
  review.

At the current stage I recommend path 1 (article 12) with a self-certification
gate at signup for UK users, until revenue justifies the AR cost.

## 6. Cookies + tracking

Current state:

- `CookieConsentBanner.jsx` is granular (analytics / marketing / functional),
  defaults both analytics and marketing to **off**.
- No analytics script is loaded until the user opts in.

Gaps:

- Banner copy is pt-br only. Needs EN + pt-br + optional EU language selector.
- No "Do Not Track" / Global Privacy Control header handling.
- No integration with any analytics tool yet (W6.5 will wire PostHog behind
  the `analytics` consent gate).

## 7. Specific AI disclosures

Per the EU AI Act (applicable from 2026-02-02 for general-purpose AI
transparency), we must:

- Clearly identify AI-generated content as AI.
- Not claim the AI provides personalised investment advice unless the
  firm is authorised to do so.
- Allow users to flag harmful / misleading AI output and record it.

Controls already in place:

- Disclaimer appended on every AI response.
- `aiOutputGuard` logs every interaction.

Gaps:

- No user-facing "flag this output" button.
- No publicly accessible transparency report (required by EU AI Act for
  GPAI providers; arguable whether Particle qualifies as a *provider* vs
  *deployer* — legal review needed).

## 8. Recommended phased launch order

| Phase | Territories | Regulatory asks | Est. lead time |
|---|---|---|---|
| **Phase 1** (closed beta) | BR + UK (invite only, self-certified sophisticated) | ToS + Privacy + AI disclaimer reviewed by UK solicitor; geo-block US | 4–6 weeks |
| **Phase 2** (public UK/BR) | BR + UK | FCA s.21 article 12 gate; UK GDPR DPA review | +4 weeks |
| **Phase 3** | + EU | MiFID II analysis + EU GDPR Art. 27 representative | +6 weeks |
| **Phase 4** | + US (or never) | SEC Investment Adviser analysis — budget US$30k legal spend minimum | +12 weeks if pursued |

## 9. Action list rolled up

Short-term (Wave 6, code):

- [ ] `users.jurisdiction` column + signup geolocation
- [ ] `server/middleware/geoBlock.js` for US 451 response
- [ ] Per-jurisdiction disclaimer in `aiOutputGuard`
- [ ] Recommendation-detector filter on AI output
- [ ] "Flag this output" button on chat UI + backing table

Legal (external dependency):

- [ ] UK solicitor review of ToS + Privacy Notice + Risk Disclosure
      (budget £2–4k, 2–3 weeks)
- [ ] UK solicitor opinion on whether article 12 gating is sufficient
- [ ] Brazilian lawyer confirms LGPD baseline is current
- [ ] Pen test of chat + vault attack surfaces (budget R$40–80k or £5–10k)

Operational (ongoing):

- [ ] Quarterly review of this document against regulatory changes
- [ ] Legal log (`docs/legal-log.md`) of every regulator communication
- [ ] DPO tickets review at the same cadence as W4 on-call handover

## 10. Appendix — current technical controls by regime

| Control | File / surface | UK GDPR | EU GDPR | LGPD | CCPA | FCA | CVM |
|---|---|---|---|---|---|---|---|
| Cookie consent banner | `CookieConsentBanner.jsx` | ✓ | partial | ✓ | — | — | — |
| DSAR endpoints | `routes/privacy.js` | ✓ | ✓ | ✓ | partial | — | — |
| Soft-delete + grace | `jobs/lgpdRetention.js` | ✓ | ✓ | ✓ | ✓ | — | — |
| AI disclaimer | `services/aiOutputGuard.js` | partial | partial | partial | — | partial | partial |
| Prompt-injection red team | `red-team/` | — | — | — | — | partial | partial |
| Rate limits + quotas | `middleware/aiQuotaGate.js` | — | — | — | — | — | — |
| Admin audit log | `middleware/adminAuditLog.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Feature kill switches | `services/featureFlags.js` | — | — | — | — | — | — |
| Geo-block | (not yet) | — | — | — | — | — | partial (US) |

Partial = the control exists but the copy, wording, or jurisdictional
variant is not tailored. Before the Phase 1 launch, convert every "partial"
in the UK GDPR + FCA column to ✓.
