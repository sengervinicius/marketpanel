**Regulatory Compliance Overview**

**Particle App — Compliance Architecture Reference**  
**Version 1.0 — April 2026**

**1. Executive Summary**

This document maps the key regulatory obligations facing the Particle App across its target jurisdictions and summarises how each risk is addressed in the document suite. It is designed to be uploaded alongside the other compliance documents and serves as the navigation key.

**2. Jurisdiction Risk Matrix**

|                  |                                                       |                                                                                                     |                                                                                                   |                    |
| ---------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------ |
| Jurisdiction     | Primary Regime                                        | Core Risk for Particle                                                                              | Mitigation                                                                                        | Document Reference |
| UK               | FSMA 2000, FCA Rules, Consumer Duty                   | s.21 Financial Promotions; AI-generated content crossing advice line                                | Not-advice disclaimer; AI governance policy; FPO Art.19 professional exemption where applicable   | Docs 03, 04        |
| EU / EEA         | MiFID II, GDPR, EU AI Act                             | Advice vs. education line; GDPR Art. 27 EU representative; AI Act transparency                      | MiFID disclaimer; Privacy Policy with GDPR legal bases; EU representative appointed; AI labelling | Docs 02, 03        |
| Brazil           | LGPD                                                  | Data subject rights (15-day response); legal basis requirements differ from GDPR                    | LGPD-specific rights section; 15-day SLA in DSAR engine; LGPD legal bases mapped                  | Docs 02, 05        |
| USA (all states) | SEC Investment Advisers Act 1940, state blue-sky laws | Investment adviser registration required; no exemption available for retail-facing advisory content | **Geo-block all US IPs at edge**; explicit ToS exclusion of US Persons                            | Doc 01             |
| California, USA  | CCPA / CPRA                                           | Consumer data rights; automated decision-making disclosure                                          | CCPA rights section; 45-day DSAR SLA; ADMT disclosure                                             | Docs 02, 05        |

**3. Document Suite Index**

|    |                                                |                                                                                                             |
| -- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| \# | Document                                       | Addresses                                                                                                   |
| 01 | Terms of Service                               | US geo-block; not-advice statements; governing law; AI disclaimer                                           |
| 02 | Privacy Policy                                 | GDPR / UK GDPR / LGPD / CCPA legal bases; Art. 27 EU representative; data rights by jurisdiction; transfers |
| 03 | Financial Promotions & Advice Disclaimer       | s.21 FSMA; FPO exemptions; MiFID II advice boundary; AI commentary disclaimer                               |
| 04 | AI Model Governance Policy                     | FCA AI guidance; Consumer Duty; advice boundary controls; audit trail; SM\&CR accountability                |
| 05 | DSAR Procedure — Jurisdiction-Aware Engine     | One-engine DSAR system; jurisdiction flag; response timers (GDPR 30d, LGPD 15d, CCPA 45d); rights menus     |
| 06 | This Document — Regulatory Compliance Overview | Navigation; risk matrix; outstanding actions                                                                |

**4. Outstanding Actions Before Go-Live**

The following items require completion before full public launch:

|     |                                                                                                                                      |                   |                                  |                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------- | ------------------------------------------- |
| \#  | Action                                                                                                                               | Owner             | Deadline                         | Regulatory Basis                            |
| A1  | Appoint EU Art. 27 GDPR Representative (e.g. EDPO, DP-Dock, or similar service)                                                      | Legal             | Pre-EU user launch               | GDPR Art. 27                                |
| A2  | ICO registration as UK data controller                                                                                               | Legal/DPO         | Immediately                      | UK GDPR / DPA 2018                          |
| A3  | Implement IP geolocation geo-block at CDN/edge (e.g. Cloudflare WAF geo-block for US)                                                | Engineering       | Before public launch             | ToS § 2.1; SEC compliance                   |
| A4  | Execute Data Processing Agreements with all processors (cloud, analytics, support)                                                   | Legal             | Before onboarding users          | GDPR Art. 28                                |
| A5  | Conduct and document Legitimate Interest Assessments (LIAs) for analytics processing                                                 | Privacy           | Before launch                    | GDPR Art. 6(1)(f)                           |
| A6  | Obtain FCA-authorised person to review/approve any financial promotions sent to UK retail consumers (if marketing campaigns planned) | Legal             | Before campaign                  | s.21 FSMA                                   |
| A7  | Implement in-app DSAR portal with jurisdiction flag routing                                                                          | Engineering       | Before public launch             | GDPR Art. 12; LGPD Art. 18; CCPA § 1798.130 |
| A8  | Establish AI audit log infrastructure (90-day prompt/output log, filter trigger log)                                                 | Engineering       | Before AI feature launch         | FCA AI Update 2025; Consumer Duty           |
| A9  | Appoint named SM\&CR Senior Manager accountable for AI governance                                                                    | Exec/Compliance   | Before FCA engagement            | SM\&CR; FCA AI guidance                     |
| A10 | Draft and publish Cookie Policy / consent mechanism if non-essential cookies deployed                                                | Engineering/Legal | Before analytics cookies go live | GDPR; PECR (UK)                             |

**5. Key Regulatory Contacts (UK)**

|                    |                                                                                      |                                                               |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Authority          | Contact                                                                              | Purpose                                                       |
| FCA                | [<span class="underline">fca.org.uk/contact</span>](http://fca.org.uk/contact)       | Regulatory queries, authorisation applications, s.21 approval |
| ICO                | [<span class="underline">ico.org.uk</span>](http://ico.org.uk)                       | Data protection registration, breach notification             |
| FCA Innovation Hub | [<span class="underline">fca.org.uk/innovation</span>](http://fca.org.uk/innovation) | Regulatory sandbox, pre-application guidance for AI fintech   |

**6. Advice vs. Information — The Operative Test**

For the benefit of all team members, the following is the operational test Particle applies to all App content before release:

> **Does the content, when read by a reasonable retail user, identify a specific financial instrument AND present it as suitable or appropriate for that user, OR imply the user should take a specific action with respect to that instrument?**

If YES → the content is a "personal recommendation" and is prohibited absent FCA authorisation or exemption.

If NO → the content is general information/education and is permitted, subject to the FCA fair, clear and not misleading standard (COBS 4.2) and Consumer Duty outcomes.

This test is applied during content development, AI system prompt design, and compliance review of AI outputs.

*Document reviewed and approved by: \[Compliance Officer Name, Title\]*  
*Next scheduled review: April 2027*
