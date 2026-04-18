# Privacy Notice

**Last updated:** 2026-04-18
**Status:** baseline — **DRAFT, NOT YET LEGALLY REVIEWED**.

This notice covers personal data processing by Particle Terminal, operated
by Algotex Ltd (England and Wales).

## 1. Who is the controller?

Algotex Ltd is the **data controller** for personal data processed via
Particle. Contact: privacy@particle.xyz.

Under UK GDPR Article 27 and EU GDPR Article 27 respectively, we have
(or will have, before EU launch) appointed representatives for the UK and
EU. Their contact details will appear here when instructed.

Under the Brazilian LGPD, Algotex Ltd acts as `controlador` and has
designated an Encarregado (DPO). Contact the DPO at privacy@particle.xyz.

## 2. What we collect and why

| Data | Purpose | Legal basis (GDPR) | Legal basis (LGPD) | Retention |
|---|---|---|---|---|
| Email + hashed password | Authentication | Contract | Execução de contrato | Account lifetime + 30 days after closure |
| Profile (name, base currency, locale) | Product delivery | Contract | Execução de contrato | Account lifetime + 30 days |
| Portfolio entries | Core product | Contract | Execução de contrato | Account lifetime + 30 days |
| Chat history | Feature improvement + safety | Legitimate interest | Legítimo interesse | 12 months rolling |
| Payment metadata (card last-4, subscription state) | Billing | Contract + legal obligation | Execução de contrato + cumprimento de obrigação legal | 7 years (tax records) |
| IP address + session logs | Security, fraud prevention | Legitimate interest | Legítimo interesse | 90 days |
| Cookies (analytics, marketing) | Analytics + marketing | Consent | Consentimento | Per cookie lifetime |
| Vault document contents | Core product (RAG) | Contract | Execução de contrato | Until user deletes |

We do not process special categories of personal data (health, political
opinion, etc.) and you should not upload such data to Particle.

## 3. Sub-processors

Particle uses the following sub-processors to deliver the service. A list
is kept up to date at /legal/sub-processors and changes are notified in
advance where required by law.

- **Render** (US + EU): application hosting.
- **Stripe** (UK + US): payment processing.
- **Anthropic** (US): LLM inference for AI features. Data covered under
  Anthropic's Enterprise DPA; Anthropic does **not** train on our data.
- **OpenAI** (US): embeddings and fallback LLM inference.
- **Polygon, TwelveData, BCB, FRED**: market data providers (no personal
  data is shared with these providers).
- **Sentry** (US): error tracking. Personal data in error payloads is
  filtered before upload.
- **PostHog** (EU-hosted instance): product analytics. Triggered only
  after explicit consent.

All non-EU sub-processors are covered by either Standard Contractual Clauses
(EU) / International Data Transfer Agreement (UK) or an adequacy decision
where applicable.

## 4. Your rights

You have the right to:

- **access** your personal data (we provide a machine-readable export);
- **rectify** inaccurate data;
- **erase** your data (30-day grace, then permanent deletion; billing and
  tax records are retained for 7 years for legal compliance);
- **port** your data to another service;
- **object** to processing based on legitimate interest;
- **restrict** processing in defined circumstances;
- **withdraw consent** for cookie-based analytics and marketing at any
  time without affecting the service.

Response windows:

| Residence | Window |
|---|---|
| Brazil (LGPD) | 15 days |
| UK (UK GDPR) | 30 days |
| EU (EU GDPR) | 30 days (extendable by 60) |
| California (CCPA) | 45 days (extendable by 45) |

To exercise a right: privacy@particle.xyz or use the Privacy page inside
the product.

## 5. Cookies

We use strictly necessary cookies (session, authentication, CSRF) without
consent. Analytics, marketing, and embedded-tool cookies are loaded only
after you opt in through the consent banner. You can change your
preferences at any time via the footer link.

## 6. International transfers

Your data may be processed outside your country of residence, primarily
in the United States (Anthropic, OpenAI, Sentry, Render US regions). These
transfers rely on Standard Contractual Clauses (EU → US) and the UK
Addendum to the SCCs (UK → US), and on Brazilian ANPD approval for
transfers from Brazil.

## 7. Security

We follow industry-standard practices:

- Passwords hashed with bcrypt (work factor 12).
- TLS 1.3 end-to-end; HSTS enforced.
- JWT signing keys rotated quarterly with dual-key overlap.
- Admin actions logged to an immutable audit table.
- Vault documents stored encrypted at rest.
- Prompt-injection defences in the AI RAG pipeline.
- Annual external penetration testing (from launch onward).

We maintain an incident response plan (`docs/INCIDENT_RESPONSE.md`). In a
confirmed personal data breach we will notify affected users and the
relevant authority within the regulatory window (72h under UK / EU GDPR,
"as soon as possible" under LGPD).

## 8. Children

Particle is not directed at children. We do not knowingly collect personal
data from anyone under 18.

## 9. Changes to this notice

We will notify you of material changes at least 30 days in advance via
email and in-product banner.

## 10. Complaints

You may complain to your national supervisory authority:

- UK: Information Commissioner's Office (ICO) — ico.org.uk.
- Brazil: Autoridade Nacional de Proteção de Dados (ANPD) — gov.br/anpd.
- EU: your national data protection authority.
- California: California Privacy Protection Agency (CPPA).

We encourage you to reach out to us first so we can try to resolve any
concern.

## 11. Contact

- Data protection queries: privacy@particle.xyz
- Brazilian DPO (Encarregado): privacy@particle.xyz (ref: "Encarregado")
- UK / EU representative: (to be appointed before public launch)
