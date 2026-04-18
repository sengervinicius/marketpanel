# Particle legal pack — index

The files in this directory form Particle's legal + regulatory pack. Each
document exists in two forms:

1. **Source (.docx)** under `source/` — the counsel-produced, signable
   version. These are the authoritative artifacts for filings, counterparty
   disclosures, and signature workflows.
2. **Markdown rendering (.en.md / .pt-br.md)** in this directory — a
   `pandoc`-converted, grep-friendly copy used by the app's renderer and by
   CI for diff review. If a rendering drifts from the source, the .docx
   wins.

The five counsel-produced documents (2026-04 set) are versioned in
`source/` with the prefixes `01_`, `03_`, `04_`, `05_`, `06_`. Gaps in
numbering are intentional — reserved for future docs in the same series.

## English — consumer-facing

| Document | Source | Markdown | Purpose |
|---|---|---|---|
| Terms of Service (v2026-04) | `source/01_terms_of_service.docx` | `TERMS_OF_SERVICE.en.md` | Contractual terms. Particle Technologies Ltd, England & Wales. Covers geographic restrictions (US not available), advice boundary, IP, liability, termination, dispute resolution. |
| Privacy Notice | — (baseline) | `PRIVACY_NOTICE.en.md` | UK GDPR / EU GDPR / LGPD / CCPA processing notice. Awaiting counsel redlines. |
| Risk Disclosure | — (baseline) | `RISK_DISCLOSURE.en.md` | Investment risk disclosures per jurisdiction. Awaiting counsel redlines. |
| AI Disclaimer | — (baseline) | `AI_DISCLAIMER.en.md` | Consumer-facing explanation of what the AI does + does not do. |
| Financial Promotions Disclaimer (v1.0) | `source/03_financial_promotions_disclaimer.docx` | `FINANCIAL_PROMOTIONS_DISCLAIMER.en.md` | FCA / FSMA §21 disclaimer shown on any marketing surface. Required for UK distribution. |
| Cookie Notice | — (baseline) | `COOKIE_NOTICE.en.md` | Cookie categories + controls (LGPD/GDPR gating). |

## English — regulatory / internal reference

| Document | Source | Markdown | Audience |
|---|---|---|---|
| AI Model Governance Policy (v1.0) | `source/04_ai_model_governance_policy.docx` | `AI_GOVERNANCE.en.md` | FCA Consumer Duty (PS22/9), FCA AI Update 2025, FCA/ICO 2025 guidance, EU AI Act (2024/1689). Classification: Public / Regulatory Disclosure. |
| Data Subject Rights Procedure (v1.0) | `source/05_dsar_procedure.docx` | `DSAR_PROCEDURE.en.md` | Jurisdiction-aware DSAR engine — internal + regulatory reference. |
| Regulatory Compliance Overview (v1.0) | `source/06_regulatory_compliance_overview.docx` | `REGULATORY_COMPLIANCE_OVERVIEW.en.md` | Compliance architecture reference. Supersedes the high-level posture in `../GLOBAL_REGULATORY_POSTURE.md` for external reviewers. |

## Português (Brasil) — consumer-facing

| Documento | Arquivo | Finalidade |
|---|---|---|
| Termos de Serviço | `TERMS_OF_SERVICE.pt-br.md` | Contrato baseline. **Aguardando retradução da v2026-04 (em inglês sob revisão da counsel).** |
| Aviso de Privacidade | `PRIVACY_NOTICE.pt-br.md` | LGPD + referência comparada. |
| Aviso de Riscos | `RISK_DISCLOSURE.pt-br.md` | Riscos de investimento. |
| Aviso sobre IA | `AI_DISCLAIMER.pt-br.md` | Recursos de IA — uso responsável. |
| Aviso de Cookies | `COOKIE_NOTICE.pt-br.md` | Categorias de cookies e controles. |

Translations of the three new counsel documents (Financial Promotions
Disclaimer, AI Governance Policy, DSAR Procedure, Regulatory Compliance
Overview) are **pending** — the Brazilian lawyer will retranslate from the
.docx sources.

## Authoritative source rule

When a consumer-facing claim is evaluated for legal purposes (a regulator
inquiry, a contractual dispute, a DSAR response), the **.docx files in
`source/`** are authoritative. The markdown renderings are for
developer-time grep and in-app display only. If the in-app UI or a
markdown file contradicts the source .docx, the .docx wins and the
contradiction is a bug to fix.

## Review workflow

1. UK solicitor reviews TERMS + PRIVACY + RISK + AI_DISCLAIMER +
   FINANCIAL_PROMOTIONS + AI_GOVERNANCE + REGULATORY_COMPLIANCE_OVERVIEW
   for FCA, FSMA §21, UK GDPR, and EU AI Act compliance.
2. Brazilian lawyer reviews the pt-br set for LGPD + CVM + CDC compliance
   and translates the four new documents into pt-br.
3. Reviewers return redlines on the .docx sources; we replace the files
   in `source/` and regenerate the matching markdown with
   `pandoc source/<file>.docx -t gfm --wrap=none -o <file>.en.md`.
4. Each subsequent amendment to any document requires a new diff review.

## Not yet drafted (legal-review dependencies)

- Sub-processors list (to be embedded in the Privacy Notice once
  PostHog region and Render region selection are finalised).
- Data Processing Agreement template (for enterprise customers).
- DMCA / notice-and-takedown procedure (for vault uploads).
- pt-br translations of the four new counsel documents.

## Tracking

Every legal-document change is captured in git. Reviews are logged in
`docs/legal-log.md` (create on first review).
