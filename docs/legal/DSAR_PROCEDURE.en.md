**Data Subject Rights Procedure**

**Jurisdiction-Aware DSAR Engine**

**Particle App — Internal & Regulatory Reference Document**  
**Version 1.0 — April 2026**

**1. Purpose**

This document specifies how Particle handles Data Subject Access Requests (DSARs) and exercises of data subject rights, across all applicable jurisdictions. It is designed so that a single operational workflow serves all users, with jurisdiction-specific response timelines and copy text triggered automatically by a **Jurisdiction Flag** set at account registration.

**2. Jurisdiction Flag Assignment**

Each user account carries a privacy\_jurisdiction flag set at registration based on self-declared country of residence and confirmed by IP geolocation:

|            |                                             |                                   |
| ---------- | ------------------------------------------- | --------------------------------- |
| Flag Value | Trigger Condition                           | Governing Law                     |
| GDPR\_EU   | Country of residence is EU/EEA Member State | EU GDPR (Reg. 2016/679)           |
| GDPR\_UK   | Country of residence is United Kingdom      | UK GDPR + DPA 2018                |
| LGPD\_BR   | Country of residence is Brazil              | LGPD (Lei 13.709/2018)            |
| CCPA\_CA   | Country of residence is California, USA\*   | CCPA / CPRA                       |
| GLOBAL     | All other countries                         | Privacy Policy general provisions |

\*Note: US access is geo-blocked at the network edge. CCPA\_CA flag is reserved for users who registered before the geo-block was implemented or via permitted exemption channels. No new US user registrations are accepted.

The flag value drives: (a) the response timer; (b) the statutory rights menu surfaced to the user; and (c) the copy template used in acknowledgement and response communications.

**3. DSAR Intake Channels**

Users may submit data subject rights requests via:

1.  **In-App Portal:** Settings → Privacy → Data Rights (preferred, includes identity verification)

2.  **Email:** [<span class="underline">privacy@particleapp.io</span>](mailto:privacy@particleapp.io) — subject line: "Data Request — \[Country\]"

3.  **Post:** \[Registered Address, London, UK\]

All channels feed into a central DSAR register (ticketing system). Each request is tagged with:

  - Submission date/time (for SLA calculation);

  - Jurisdiction flag from user profile;

  - Request type (access, deletion, rectification, portability, objection, restriction, opt-out);

  - Identity verification status.

**4. Response Timelines by Jurisdiction**

|                   |                                               |                                                                                    |                                 |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------- |
| Jurisdiction Flag | Statutory Deadline                            | Extension Permitted                                                                | Basis                           |
| GDPR\_EU          | **30 calendar days** from receipt             | \+60 days (complex/numerous requests, with notice to user within Day 1 deadline)   | GDPR Art. 12(3)                 |
| GDPR\_UK          | **30 calendar days** from receipt             | \+60 days (complex/numerous requests, with notice to user within Day 1 deadline)   | UK GDPR Art. 12(3)              |
| LGPD\_BR          | **15 calendar days** from receipt             | No statutory extension defined; good faith extension with notification recommended | LGPD Art. 19                    |
| CCPA\_CA          | **45 calendar days** from verified request    | \+45 days (complex requests, with written notice to consumer within Day 45)        | Cal. Civ. Code § 1798.130(a)(2) |
| GLOBAL            | **30 calendar days** (Privacy Policy default) | \+30 days with notification                                                        | Privacy Policy § 11             |

**CCPA Opt-Out Requests:** Must be honoured within **15 days** of receipt, regardless of request complexity. No extension available.

**Acknowledgement SLA (all jurisdictions):** 3 business days from receipt.

**5. Rights Menu by Jurisdiction**

The in-app DSAR portal renders the following options based on the user's privacy\_jurisdiction flag:

**GDPR\_EU and GDPR\_UK**

  - \[ \] Right to Access (Art. 15) — receive a copy of my data

  - \[ \] Right to Rectification (Art. 16) — correct inaccurate data

  - \[ \] Right to Erasure / Right to be Forgotten (Art. 17)

  - \[ \] Right to Restriction of Processing (Art. 18)

  - \[ \] Right to Data Portability (Art. 20)

  - \[ \] Right to Object to Processing (Art. 21)

  - \[ \] Rights related to automated decision-making (Art. 22)

  - \[ \] Lodge a complaint with supervisory authority (links to ICO / relevant EU DPA)

**LGPD\_BR**

  - \[ \] Confirmação do tratamento — confirmar se tratamos seus dados

  - \[ \] Acesso — obter cópia dos seus dados

  - \[ \] Correção — corrigir dados incompletos, inexatos ou desatualizados

  - \[ \] Anonimização, bloqueio ou eliminação

  - \[ \] Portabilidade

  - \[ \] Eliminação de dados tratados com consentimento

  - \[ \] Informação sobre compartilhamento

  - \[ \] Revogação do consentimento

  - \[ \] Revisão de decisões automatizadas

  - \[ \] Reclamação à ANPD

**CCPA\_CA**

  - \[ \] Right to Know — what personal information is collected

  - \[ \] Right to Delete

  - \[ \] Right to Correct inaccurate personal information

  - \[ \] Right to Opt-Out of sale or sharing (we do not sell — confirmation provided)

  - \[ \] Right to Limit use of sensitive personal information

  - \[ \] Right to Non-Discrimination

**GLOBAL**

  - \[ \] Access and copy

  - \[ \] Correction

  - \[ \] Deletion

  - \[ \] Withdraw consent

**6. Identity Verification**

Before fulfilling any DSAR, Particle verifies the requester's identity:

  - **In-app requests:** Identity confirmed by authenticated session (two-factor authentication required for DSAR access);

  - **Email requests:** Identity verified by matching email to registered account + one additional identifier (e.g., date of registration, last 4 characters of device ID);

  - **Third-party authorised agents (CCPA):** Require written authorisation from the data subject plus identity verification of the agent.

Identity verification must not be so burdensome as to effectively prevent rights exercise. Where verification cannot be completed, we will notify the requester within 5 business days of the obstacle.

**7. Response Templates**

Standardised response templates are maintained per jurisdiction flag in the DSAR system. Templates cover:

  - Acknowledgement of request (all jurisdictions, within 3 business days);

  - Extension notification (where applicable);

  - Fulfilment response including requested data extract or confirmation of action;

  - Rejection response (with reason and escalation pathway to supervisory authority).

Templates are reviewed and updated quarterly by the Privacy function.

**8. Data Extraction and Deletion Procedures**

**Access requests:** The data export pipeline generates a structured JSON export of all personal data associated with the user account, covering all categories listed in the Privacy Policy (Section 3). This export is delivered via a secure, time-limited download link.

**Deletion requests:** Upon verified deletion request, personal data is:

1.  Flagged for deletion in the primary database within 5 business days;

2.  Purged from backup systems within the next backup rotation cycle (maximum 30 days);

3.  Deletion confirmed to the user in writing.

Data subject to a legal hold (e.g., required for pending litigation or regulatory investigation) will be withheld from deletion; the user will be notified of the hold and its legal basis.

**9. Record-Keeping**

All DSAR requests are recorded in the DSAR Register, including:

  - Date received, date acknowledged, date fulfilled or rejected;

  - Jurisdiction flag;

  - Type of request;

  - Identity verification outcome;

  - Extension invoked (Y/N) and reason;

  - Any supervisory authority escalation.

The DSAR Register is retained for 5 years and is available to competent supervisory authorities on request.

**10. Supervisory Authority Contact References**

|              |                                                 |                                                                                                                          |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Jurisdiction | Authority                                       | Contact                                                                                                                  |
| UK           | Information Commissioner's Office (ICO)         | [<span class="underline">ico.org.uk</span>](http://ico.org.uk) / 0303 123 1113                                           |
| EU (default) | Relevant Member State DPA                       | [<span class="underline">edpb.europa.eu/about-edpb/board/members</span>](http://edpb.europa.eu/about-edpb/board/members) |
| Brazil       | Autoridade Nacional de Proteção de Dados (ANPD) | [<span class="underline">gov.br/anpd</span>](http://gov.br/anpd)                                                         |
| California   | California Privacy Protection Agency (CPPA)     | [<span class="underline">cppa.ca.gov</span>](http://cppa.ca.gov)                                                         |

*This document is reviewed annually and updated in response to changes in applicable law. Last reviewed: April 2026.*
