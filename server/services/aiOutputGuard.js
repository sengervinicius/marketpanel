/**
 * services/aiOutputGuard.js — W1.3 output validator.
 *
 * After the model returns, run the text through a set of cheap validators
 * before we hand it to the user. The goal is not to block every prompt
 * injection (the model should already refuse), but to catch three failure
 * modes that we care about most:
 *
 *   1. External URL exfiltration — a document or user prompt coerced the
 *      model into emitting http(s) URLs to attacker-controlled hosts.
 *   2. Credential/config disclosure — the model echoed values that look
 *      like API keys, JWTs, or credit-card numbers. These are ALSO caught
 *      by the existing logger redactor, but an end-user never sees the
 *      log; this guard scrubs the visible answer too.
 *   3. Missing financial-advice disclaimer on any response that names a
 *      specific ticker + a direction. Enforced per LGPD + CVM guidance.
 *
 * Failures are logged with `ai_safety_violation` so they surface on the
 * Sentry dashboard and the admin audit trail. The text is scrubbed in
 * place; we never reject the whole response.
 */

'use strict';

const logger = require('../utils/logger');

// W0.4 disclaimers already appended elsewhere; we only add this one as a
// last-resort safety net if the answer recommends a specific trade.
const DISCLAIMER_PT = 'Este conteúdo é informativo e não constitui recomendação de investimento.';
const DISCLAIMER_EN = 'This content is informational only and is not investment advice.';

// Allow-list: our own domains + known vendor docs.  Everything else in
// the model's output is stripped.
const URL_ALLOWLIST = [
  /(^|\/\/)particle-terminal\.com\b/i,
  /(^|\/\/)the-particle\.com\b/i,
  /(^|\/\/)sengervinicius\.com\b/i,
  /(^|\/\/)anthropic\.com\b/i,
  /(^|\/\/)perplexity\.ai\b/i,
  /(^|\/\/)polygon\.io\b/i,
  /(^|\/\/)bcb\.gov\.br\b/i,
  /(^|\/\/)tradingeconomics\.com\b/i,
  /(^|\/\/)sec\.gov\b/i,
  /(^|\/\/)fred\.stlouisfed\.org\b/i,
];

const URL_RE          = /https?:\/\/[^\s)\]>"']+/gi;
const MD_IMG_RE       = /!\[[^\]]*]\(\s*(https?:\/\/[^)\s]+)\s*\)/gi;
const MD_LINK_RE      = /\[([^\]]+)]\(\s*(https?:\/\/[^)\s]+)\s*\)/gi;
const JS_URL_RE       = /javascript:\s*[^\s)]+/gi;

// Conservative credential / secret sniffers. These match the same vocabulary
// used by utils/logger.js redactor, but we apply them to OUTBOUND answer
// text, not inbound request logs.
const JWT_RE          = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER_RE       = /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi;
const AWS_KEY_RE      = /\bAKIA[0-9A-Z]{16}\b/g;
const SK_RE           = /\b(sk-[A-Za-z0-9-]{20,}|sk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,})\b/g;
const CC_RE           = /\b(?:\d[ -]?){13,19}\b/g;

// If the model names a specific ticker AND suggests directional action,
// the response must carry a disclaimer.
const TICKER_RE       = /\b([A-Z]{1,5}(?:[.\-][A-Z]{1,3})?)\b/g;      // AAPL, PETR4.SA, BRK.B
const DIRECTIONAL_RE  = /\b(buy|sell|short|long|call|put|go\s+short|go\s+long|bullish|bearish|overweight|underweight|strong\s+buy|strong\s+sell|comprar|vender|vendido|comprado)\b/i;

/**
 * Inspect model output text and return { text, violations: [...] }.
 * `text` is the cleaned/scrubbed version; the original is never returned
 * to callers.  Caller is responsible for logging + auditing violations.
 */
function sanitizeAIOutput(input, { locale = 'pt' } = {}) {
  if (!input || typeof input !== 'string') return { text: input || '', violations: [] };

  let text = input;
  const violations = [];

  // 1. Strip javascript: URLs unconditionally.
  text = text.replace(JS_URL_RE, '[URL removido]');

  // 2. Strip credential-shaped strings.
  const secretHits = [];
  text = text
    .replace(JWT_RE,     () => { secretHits.push('jwt');    return '[token removido]'; })
    .replace(BEARER_RE,  () => { secretHits.push('bearer'); return 'Bearer [token removido]'; })
    .replace(AWS_KEY_RE, () => { secretHits.push('aws');    return '[chave removida]'; })
    .replace(SK_RE,      () => { secretHits.push('sk');     return '[chave removida]'; })
    .replace(CC_RE,      () => { secretHits.push('cc');     return '[número removido]'; });
  if (secretHits.length) violations.push({ kind: 'credential-leak', hits: secretHits });

  // 3. Remove markdown image exfil; keep the alt text.
  text = text.replace(MD_IMG_RE, (_m, url) => {
    if (URL_ALLOWLIST.some(re => re.test(url))) return _m;
    violations.push({ kind: 'markdown-image-exfil', url });
    return '[imagem removida]';
  });

  // 4. Rewrite markdown links pointing outside the allow-list to plain text.
  text = text.replace(MD_LINK_RE, (_m, label, url) => {
    if (URL_ALLOWLIST.some(re => re.test(url))) return _m;
    violations.push({ kind: 'external-url', url });
    return label;
  });

  // 5. Drop bare external URLs not in the allow-list.
  text = text.replace(URL_RE, (url) => {
    if (URL_ALLOWLIST.some(re => re.test(url))) return url;
    violations.push({ kind: 'external-url', url });
    return '[link removido]';
  });

  // 6. Require disclaimer when ticker + direction appear together.
  const mentionsTicker    = (text.match(TICKER_RE) || []).some(t => t.length >= 3);
  const mentionsDirection = DIRECTIONAL_RE.test(text);
  if (mentionsTicker && mentionsDirection) {
    const d = locale === 'en' ? DISCLAIMER_EN : DISCLAIMER_PT;
    if (!text.toLowerCase().includes('recomendaç') && !text.toLowerCase().includes('not investment advice')) {
      text = text.trimEnd() + `\n\n${d}`;
      violations.push({ kind: 'auto-disclaimer-inserted' });
    }
  }

  return { text, violations };
}

/**
 * Helper: sanitize and log.  Use this from /chat and /vault/ask right
 * before responding to the user.
 */
function guardAndLog(answer, meta = {}) {
  const { text, violations } = sanitizeAIOutput(answer, meta);
  if (violations.length) {
    logger.warn('aiOutputGuard', 'Model output scrubbed', {
      violations: violations.slice(0, 5),
      moreViolations: Math.max(0, violations.length - 5),
      userId: meta.userId,
      model: meta.model,
      ai_safety_violation: true,
    });
  }
  return text;
}

module.exports = { sanitizeAIOutput, guardAndLog };
