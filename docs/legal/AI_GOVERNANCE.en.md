**AI Model Governance Policy**

**Particle App**  
**Version 1.0 — April 2026**  
**Classification: Public / Regulatory Disclosure**

**1. Purpose and Scope**

This policy sets out Particle's approach to the governance of AI and machine learning models used within the Particle App, in accordance with:

  - FCA Consumer Duty (PS22/9) and FCA AI Update 2025;

  - FCA Principles for Businesses (PRIN) and Senior Managers & Certification Regime (SM\&CR);

  - FCA/ICO joint guidance on AI and data protection in financial services (2025);

  - The FCA's existing principles-based framework applied to AI-enabled solutions;

  - The EU AI Act (Regulation (EU) 2024/1689) where applicable to EU users.

This policy applies to all AI models and AI-generated content deployed in user-facing features of the App.

**2. Regulatory Risk Classification**

Particle classifies its AI use cases as follows:

|                                    |                        |                                                  |
| ---------------------------------- | ---------------------- | ------------------------------------------------ |
| Feature                            | AI Risk Classification | Description                                      |
| Market data summarisation          | Low                    | Summarising publicly available market statistics |
| News and event summarisation       | Low                    | Synthesising publicly available financial news   |
| AI commentary on price action      | Medium                 | Narrative on instrument price movements          |
| Instrument search and ranking      | Medium                 | Sorting instruments by objective criteria        |
| Personalised watchlist suggestions | High (not deployed)    | Would require individual suitability assessment  |

Features in the "High" classification category are **not deployed** in the current version of the App. Before deployment, any such feature would require FCA authorisation or a valid exemption path.

**3. The Advice Boundary — Controls**

Particle has implemented the following controls to prevent AI models from crossing the financial advice line (i.e., generating "personal recommendations" within the meaning of FSMA and MiFID II):

**3.1 System Prompt Constraints**  
All AI model instances are instructed via system prompt to:

  - Provide only general market information and factual commentary;

  - Never state or imply that any instrument is "suitable," "recommended," "a buy," or "a sell" for the user;

  - Never take into account or reference the user's individual financial circumstances;

  - Decline to answer if prompted to provide personalised investment guidance; and

  - Append a standardised disclaimer to all AI-generated financial content.

**3.2 Output Filtering**  
AI outputs are screened for prohibited language patterns including (but not limited to): "you should buy," "I recommend," "suitable for your," "invest in X," "best investment for you." Outputs containing such patterns are suppressed or reformatted.

**3.3 No Individual Profiling for Recommendations**  
Particle does not feed individual user profile data (risk appetite, financial goals, net worth) into AI models for the purpose of tailoring investment commentary to a specific user.

**3.4 Disclaimer Attachment**  
All AI-generated content displayed in the App carries the following appended notice: *"This is AI-generated market information, not investment advice. Do not make investment decisions based solely on this content."*

**4. Human Oversight and Auditability**

**4.1 Audit Trail**  
Particle maintains logs of:

  - AI model version and configuration in use at time of content generation;

  - Prompt and output pairs for a rolling 90-day period (subject to privacy law retention limits);

  - Output filter trigger events.

These logs are available to the FCA and other competent regulators upon request.

**4.2 Periodic Review**  
The AI output review process is conducted no less than quarterly by \[Compliance Officer / Designated SM\&CR Function Holder\]. Reviews assess whether AI outputs are remaining within the information/education boundary and whether output filters require updating.

**4.3 Named Accountability**  
Responsibility for AI model governance sits with: \[Name, Title, SM\&CR Function Ref\], who is the Senior Manager accountable for technology and innovation risk under the Senior Managers & Certification Regime.

**5. Model Updates and Incident Response**

  - Any change to AI model, system prompt, or output filtering logic that could affect the advice/information boundary requires sign-off from the Compliance Officer prior to deployment.

  - If an AI output that constitutes a personal recommendation is detected post-deployment, the relevant feature will be suspended within 24 hours pending review.

  - Incidents will be logged in the compliance register and assessed for regulatory notification obligations.

**6. EU AI Act Compliance (Where Applicable)**

The App's AI use cases are assessed against the EU AI Act (in force from August 2024, applicable obligations phased):

  - The App does not deploy AI systems classified as "prohibited" under Article 5;

  - AI-generated market commentary is assessed as a **limited risk** system under Article 50, requiring transparency obligations (disclosure that content is AI-generated);

  - In-app labelling discloses AI-generated content to users in all EU/EEA jurisdictions.

**7. Regulatory Enquiry Contact**

Regulatory enquiries regarding AI governance: [<span class="underline">compliance@particleapp.io</span>](mailto:compliance@particleapp.io)
