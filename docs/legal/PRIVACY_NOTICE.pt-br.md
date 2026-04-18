# Aviso de Privacidade

**Última atualização:** 2026-04-18
**Status:** versão base — **RASCUNHO, PENDENTE DE REVISÃO JURÍDICA**.

## 1. Quem é o controlador?

A Arc Capital Ltd (Inglaterra e País de Gales) é o **controlador** dos
dados pessoais tratados via Particle. Contato: privacy@particle.xyz.

Nos termos da LGPD, a Arc Capital Ltd atua como *controlador* e designou
Encarregado (DPO). Contato do Encarregado: privacy@particle.xyz (assunto
"Encarregado").

Para usuários no Reino Unido e UE, serão designados representantes
conforme o art. 27 do UK GDPR e do GDPR antes do lançamento comercial.

## 2. O que coletamos e por quê

| Dado | Finalidade | Base legal (LGPD) | Base legal (GDPR) | Retenção |
|---|---|---|---|---|
| E-mail + senha hash | Autenticação | Execução de contrato | Contract | Vida da conta + 30 dias |
| Perfil (nome, moeda-base, idioma) | Entrega do produto | Execução de contrato | Contract | Vida da conta + 30 dias |
| Portfólio | Produto essencial | Execução de contrato | Contract | Vida da conta + 30 dias |
| Histórico de chat | Melhoria e segurança do produto | Legítimo interesse | Legitimate interest | 12 meses móveis |
| Metadados de pagamento | Cobrança | Execução de contrato + obrigação legal | Contract + legal obligation | 7 anos (fiscal) |
| IP + logs de sessão | Segurança, fraude | Legítimo interesse | Legitimate interest | 90 dias |
| Cookies (analytics, marketing) | Análise e marketing | Consentimento | Consent | Conforme cada cookie |
| Documentos do vault | Produto essencial (RAG) | Execução de contrato | Contract | Até exclusão pelo usuário |

Não tratamos dados pessoais sensíveis (saúde, opinião política, etc.) e
você não deve enviá-los à Particle.

## 3. Operadores (sub-processors)

- **Render** (EUA + UE): hospedagem.
- **Stripe** (UK + EUA): meios de pagamento.
- **Anthropic** (EUA): inferência de LLM. Coberto por DPA empresarial da
  Anthropic; **não** treinam modelos com nossos dados.
- **OpenAI** (EUA): embeddings e inferência de fallback.
- **Polygon, TwelveData, BCB, FRED**: dados de mercado (sem dados
  pessoais).
- **Sentry** (EUA): monitoramento de erros — payloads filtrados para
  remover dados pessoais.
- **PostHog** (instância hospedada na UE): product analytics, somente
  após consentimento.

Transferências internacionais seguem Cláusulas Contratuais Padrão (UE) ou
equivalentes e, para transferências do Brasil, observam as diretrizes da
ANPD.

## 4. Seus direitos (LGPD art. 18)

- **acesso** aos dados (exportação em formato legível por máquina);
- **retificação** de dados incorretos;
- **eliminação** (período de carência de 30 dias, depois exclusão
  permanente; dados fiscais mantidos por 7 anos por obrigação legal);
- **portabilidade** dos dados;
- **oposição** a tratamento baseado em legítimo interesse;
- **informação** sobre compartilhamento;
- **revogação do consentimento** para analytics e marketing.

Janelas de resposta:

| Residência | Prazo |
|---|---|
| Brasil (LGPD) | 15 dias |
| Reino Unido (UK GDPR) | 30 dias |
| UE (GDPR) | 30 dias (prorrogáveis por 60) |
| Califórnia (CCPA) | 45 dias (prorrogáveis por 45) |

Para exercer um direito: privacy@particle.xyz ou pela página "Privacidade"
dentro do produto.

## 5. Cookies

Usamos cookies estritamente necessários (sessão, autenticação, CSRF) sem
consentimento. Cookies de analytics, marketing e ferramentas de terceiros
somente após opt-in no banner. Você pode alterar suas preferências a
qualquer momento pelo link "Preferências de cookies" no rodapé.

## 6. Transferências internacionais

Seus dados podem ser processados fora do seu país de residência,
principalmente nos EUA (Anthropic, OpenAI, Sentry, Render US). As
transferências seguem SCCs (UE → EUA) e orientação da ANPD para
transferências do Brasil.

## 7. Segurança

- Senhas com bcrypt (work factor 12).
- TLS 1.3 fim-a-fim; HSTS obrigatório.
- Chaves de assinatura JWT rotacionadas trimestralmente com sobreposição
  de chaves.
- Ações administrativas registradas em auditoria imutável.
- Documentos do vault criptografados em repouso.
- Defesa contra prompt injection na pipeline de RAG.
- Pen test externo anual (a partir do lançamento).

Em caso de incidente com dados pessoais, notificaremos usuários afetados e
autoridade competente dentro dos prazos regulatórios (72h no UK/EU GDPR;
"no menor tempo razoável" na LGPD).

## 8. Crianças e adolescentes

A Particle não é direcionada a menores de 18 anos e não coleta dados
conscientemente de crianças ou adolescentes.

## 9. Alterações neste Aviso

Notificaremos alterações relevantes com pelo menos 30 dias de antecedência
por e-mail e banner no produto.

## 10. Reclamações

Você pode reclamar junto à autoridade competente:

- Brasil: ANPD — gov.br/anpd.
- Reino Unido: ICO — ico.org.uk.
- UE: DPA nacional.
- Califórnia: CPPA.

Sugerimos nos contatar primeiro para tentarmos resolver.

## 11. Contato

- Privacidade: privacy@particle.xyz
- Encarregado (DPO, LGPD): privacy@particle.xyz (assunto "Encarregado")
- Representante UK/UE: a ser designado antes do lançamento comercial.
