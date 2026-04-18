# Particle legal pack — index

All documents in this directory are **draft baselines** and must be
reviewed by counsel before public launch. Keep this index in sync with
the files that exist on disk.

## English

| Document | File | Purpose |
|---|---|---|
| Terms of Service | `TERMS_OF_SERVICE.en.md` | Contractual terms between Arc Capital Ltd and the user. |
| Privacy Notice | `PRIVACY_NOTICE.en.md` | How we process personal data across UK GDPR / EU GDPR / LGPD / CCPA. |
| Risk Disclosure | `RISK_DISCLOSURE.en.md` | Investment risk disclosures per jurisdiction. |
| AI Disclaimer | `AI_DISCLAIMER.en.md` | What the AI features are and are not. |
| Cookie Notice | `COOKIE_NOTICE.en.md` | Cookie categories + controls. |

## Português (Brasil)

| Documento | Arquivo | Finalidade |
|---|---|---|
| Termos de Serviço | `TERMS_OF_SERVICE.pt-br.md` | Contrato entre a Arc Capital Ltd e o usuário. |
| Aviso de Privacidade | `PRIVACY_NOTICE.pt-br.md` | LGPD + referência comparada. |
| Aviso de Riscos | `RISK_DISCLOSURE.pt-br.md` | Riscos de investimento. |
| Aviso sobre IA | `AI_DISCLAIMER.pt-br.md` | Recursos de IA — uso responsável. |
| Aviso de Cookies | `COOKIE_NOTICE.pt-br.md` | Categorias de cookies e controles. |

## Not yet drafted (legal-review dependencies)

- Sub-processors list (to be embedded in the Privacy Notice once
  PostHog region and Render region selection are finalised).
- Data Processing Agreement template (for enterprise customers).
- DMCA / notice-and-takedown procedure (for vault uploads).
- EU AI Act transparency statement (depends on Particle's classification
  as GPAI provider vs deployer — legal determination needed).

## Review workflow

1. UK solicitor reviews TERMS + PRIVACY + RISK + AI_DISCLAIMER for FCA
   and UK GDPR compliance.
2. Brazilian lawyer reviews the pt-br trio for LGPD + CVM + CDC
   compliance.
3. Reviewers return redlines; we merge and re-export as .docx for
   signature alongside the production release.
4. Each subsequent amendment to any document requires a new diff review
   (these files are source-of-truth; what renders on the marketing site
   and in-product is generated from them).

## Tracking

Every legal-document change is captured in git. Reviews are logged in
`docs/legal-log.md` (create on first review).
