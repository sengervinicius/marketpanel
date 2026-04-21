/**
 * services/qaHarness.js — P2.4 Multilingual QA harness.
 *
 * Why this exists
 * ---------------
 * Particle AI's tool-calling policy is spread across ~18 numbered rules
 * in search.js. Every time someone edits that prompt (or adds a new
 * tool), a PT-BR / ES phrasing that used to route to the right tool can
 * quietly stop working — and we won't notice until a Brazilian user
 * asks about Selic and the model hand-waves. This harness is the
 * offline gate that catches those regressions.
 *
 * The harness has two layers:
 *
 * 1. STRUCTURAL CHECK (default, used in CI) — parses the TOOLS catalog
 *    and the system prompt source, asserts that every canonical
 *    scenario's trigger phrase appears in the prompt and that the
 *    expected tool is registered in TOOLS. Runs in ~50 ms, no model
 *    call, no network. This is what ships as a unit test.
 *
 * 2. LIVE CHECK (opt-in, `--live` flag on the CLI runner) — actually
 *    feeds each scenario through the real Anthropic endpoint and
 *    scrapes the tool_use blocks from the response. Slow and costs
 *    money, only invoked manually before a release. Results are printed
 *    to stdout with a pass/fail summary.
 *
 * Keeping them in one file means the scenario set is a single source
 * of truth — the CI gate and the live eval agree on what "right" looks
 * like.
 */

'use strict';

// ── Scenario catalogue ────────────────────────────────────────────────
//
// Each scenario is a `{ lang, prompt, expectedTool, trigger, category }`.
//
//   - lang          'en' | 'pt-BR' | 'es'
//   - prompt        the user message as they'd type it
//   - expectedTool  name in TOOLS that MUST be called
//   - trigger       substring the harness looks for in the system prompt
//                   to prove the rule table teaches the model this phrase
//   - category      grouping for the summary report
//
// Only add a scenario when the trigger phrase is actually in search.js
// — otherwise the structural check will fail (which is the point).
const SCENARIOS = [
  // ── Equities: lookup_quote across languages ─────────────────────────
  {
    lang: 'en',
    prompt: 'What is the current price of NVDA?',
    expectedTool: 'lookup_quote',
    trigger: 'lookup_quote',
    category: 'equities',
  },
  {
    lang: 'pt-BR',
    prompt: 'Qual o preço atual da PETR4.SA?',
    expectedTool: 'lookup_quote',
    trigger: 'PETR4.SA',
    category: 'equities',
  },
  {
    lang: 'es',
    prompt: '¿Cuál es la cotización de AAPL?',
    expectedTool: 'lookup_quote',
    trigger: 'AAPL',
    category: 'equities',
  },

  // ── Commodities: EN + PT-BR vocab ───────────────────────────────────
  {
    lang: 'en',
    prompt: 'Price of iron ore today',
    expectedTool: 'lookup_commodity',
    trigger: 'iron ore',
    category: 'commodities',
  },
  {
    lang: 'pt-BR',
    prompt: 'Qual o preço do minério de ferro hoje?',
    expectedTool: 'lookup_commodity',
    trigger: 'minério de ferro',
    category: 'commodities',
  },
  {
    lang: 'pt-BR',
    prompt: 'Cotação do boi gordo',
    expectedTool: 'lookup_commodity',
    trigger: 'boi gordo',
    category: 'commodities',
  },

  // ── Brazilian macro: SELIC / IPCA in PT-BR ──────────────────────────
  {
    lang: 'pt-BR',
    prompt: 'Qual é a Selic hoje?',
    expectedTool: 'get_brazil_macro',
    trigger: 'get_brazil_macro',
    category: 'br-macro',
  },
  {
    lang: 'pt-BR',
    prompt: 'Mostra o histórico do IPCA nos últimos 12 meses',
    expectedTool: 'get_brazil_macro',
    trigger: 'histórico',
    category: 'br-macro',
  },

  // ── Alerts bulk: PT-BR must resolve to delete_all_alerts ────────────
  {
    lang: 'pt-BR',
    prompt: 'Apaga todos os meus alertas',
    expectedTool: null,       // action-tag path, not a TOOL call
    trigger: 'apaga todos os meus alertas',
    category: 'alerts-action',
    expectedActionTag: 'delete_all_alerts',
  },

  // ── Forward estimates: EN only (US-only coverage) ───────────────────
  {
    lang: 'en',
    prompt: "What's the street modelling for NVDA FY+2 EPS?",
    expectedTool: 'forward_estimates',
    trigger: 'street',
    category: 'estimates',
  },

  // ── Coverage gaps: model must decline, not fabricate ────────────────
  {
    lang: 'en',
    prompt: 'Show me Kweichow Moutai A-shares intraday',
    expectedTool: null,
    trigger: 'A-shares',
    category: 'declared-gap',
    expectsDecline: true,
  },
  {
    lang: 'pt-BR',
    prompt: 'Conecta minha conta da XP com Plaid',
    expectedTool: null,
    trigger: 'Plaid',
    category: 'declared-gap',
    expectsDecline: true,
  },
];

// ── Language detection ────────────────────────────────────────────────
//
// Good-enough stopword-based detector. Not a full i18n library — we
// only need to tell EN / PT-BR / ES apart on short financial prompts,
// and a 30-word whitelist each nails every scenario in the catalogue.
//
// Tokens are lowercased and stripped of accents so "é" and "e" match
// the same entry. Diacritic-bearing forms are kept in the list too so
// a tokenizer that DOESN'T strip accents still matches.
const STOPWORDS = {
  'pt-BR': [
    'qual', 'quanto', 'quando', 'onde', 'como', 'porque', 'por que',
    'é', 'e', 'do', 'da', 'dos', 'das', 'de', 'em', 'no', 'na',
    'com', 'para', 'por', 'sem', 'sobre', 'meu', 'minha', 'meus',
    'minhas', 'nosso', 'nossa', 'preço', 'cotação', 'selic', 'ipca',
    'taxa', 'hoje', 'apaga', 'apagar', 'mostra', 'histórico', 'últimos',
    'mês', 'meses', 'está', 'estão', 'são', 'têm', 'vou', 'vamos',
    'seus', 'suas', 'seu', 'sua', 'todos', 'todas', 'o', 'a', 'os', 'as',
    'ao', 'aos', 'às', 'boi', 'gordo', 'arroba', 'cotado',
    'cotada', 'conecta', 'conta',
  ],
  es: [
    'cuál', 'cuánto', 'cuándo', 'dónde', 'cómo', 'porqué',
    'es', 'el', 'la', 'los', 'las', 'del', 'con',
    'para', 'por', 'sin', 'sobre', 'mi', 'mis', 'nuestro',
    'cotización', 'cotizacion', 'cotiza', 'precio', 'tasa',
    'hoy', 'ayer', 'borra', 'muestra', 'históricamente',
    'últimos', 'ultimos', 'mes', 'meses', 'está', 'están', 'son',
    'dólares', 'dolares', 'actualmente', 'ahora',
  ],
  en: [
    // Deliberately omit 'a' and 'an' — they collide with the PT/ES
    // preposition / article 'a', which tilts short financial prompts
    // toward EN incorrectly. Lean on distinctly English function words
    // (the, is, are, with, for, ...) and domain verbs instead.
    'what', 'when', 'where', 'why', 'how', 'which', 'who',
    'is', 'are', 'the', 'of', 'in', 'on', 'at',
    'with', 'for', 'by', 'without', 'about', 'my', 'our',
    'price', 'quote', 'rate', 'today', 'yesterday', 'delete',
    'show', 'history', 'last', 'months', 'street', 'modelling',
    'consensus', 'forward', 'current', 'trading',
  ],
};

// Strip accents for a resilient match. Normalise to NFD and drop
// combining diacritics.
function deaccent(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Returns 'en' | 'pt-BR' | 'es' | 'unknown'.
function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'unknown';
  const tokens = deaccent(text).toLowerCase().split(/\s+|[,.;:!?¿¡]/).filter(Boolean);
  if (tokens.length === 0) return 'unknown';
  const scores = { en: 0, 'pt-BR': 0, es: 0 };
  for (const lang of Object.keys(STOPWORDS)) {
    const bag = new Set(STOPWORDS[lang].map(w => deaccent(w).toLowerCase()));
    for (const t of tokens) {
      if (bag.has(t)) scores[lang] += 1;
    }
  }
  // Specific accented characters are a strong PT-BR / ES signal that
  // survives even when the stopword hits are tied.
  if (/[ãõç]/.test(text)) scores['pt-BR'] += 2;
  if (/[ñ¿¡]/.test(text)) scores.es += 2;

  let best = 'unknown', bestScore = 0;
  for (const [lang, s] of Object.entries(scores)) {
    if (s > bestScore) { best = lang; bestScore = s; }
  }
  // Require at least one stopword hit to commit to a language — a pure
  // ticker string like "PETR4" shouldn't be called PT-BR.
  return bestScore === 0 ? 'unknown' : best;
}

// Assert that a reply is in the expected language. Returns
// { ok, detected, reason }. Used in the live evaluator.
function assertLanguageReply(expected, replyText) {
  const detected = detectLanguage(replyText);
  if (detected === expected) return { ok: true, detected };
  // Allow 'unknown' on very short replies — a one-word "Sim." can't be
  // reliably detected and shouldn't fail the gate.
  const wordCount = String(replyText || '').split(/\s+/).filter(Boolean).length;
  if (detected === 'unknown' && wordCount < 3) return { ok: true, detected };
  return {
    ok: false,
    detected,
    reason: `expected ${expected}, got ${detected}`,
  };
}

// ── Structural (offline) harness ──────────────────────────────────────
//
// Loads TOOLS + search.js source, asserts that every scenario is wired.
// Returns { passed, failed, results[] } so the test can fail on any row.
function runStructuralCheck({ toolsCatalog, searchSource, scenarios = SCENARIOS } = {}) {
  const results = [];
  const toolNames = new Set((toolsCatalog || []).map(t => t.name));

  for (const s of scenarios) {
    const reasons = [];

    // Trigger must appear somewhere in the system prompt.
    if (!searchSource || !searchSource.includes(s.trigger)) {
      reasons.push(`trigger "${s.trigger}" missing from system prompt`);
    }

    // If an expected tool is specified, it must be in the catalog.
    if (s.expectedTool && !toolNames.has(s.expectedTool)) {
      reasons.push(`expected tool "${s.expectedTool}" not in TOOLS catalog`);
    }

    // Scenarios flagged as expecting a decline must reference their
    // gap somewhere in the prompt AND NOT resolve to a real tool.
    if (s.expectsDecline) {
      // The coverage-gap test already covers this — we just double-check
      // the rule is still numbered in the prompt.
      if (!/13\.\s*DECLARED COVERAGE GAPS/i.test(searchSource || '')) {
        reasons.push('rule 13 DECLARED COVERAGE GAPS missing');
      }
    }

    // Action-tag scenarios must have their tag mentioned in the prompt.
    if (s.expectedActionTag) {
      const tag = `action:${s.expectedActionTag}`;
      if (!searchSource || !searchSource.includes(tag)) {
        reasons.push(`action tag "${tag}" not referenced in system prompt`);
      }
    }

    results.push({
      lang: s.lang,
      prompt: s.prompt,
      category: s.category,
      ok: reasons.length === 0,
      reasons,
    });
  }

  const passed = results.filter(r => r.ok).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

// ── Live harness (opt-in) ─────────────────────────────────────────────
//
// Runs each scenario through the real tool-use loop. Requires an
// ANTHROPIC_API_KEY in env and is intentionally not wired into the
// default test runner — costs a few cents per invocation.
//
// The caller supplies a `dispatch(prompt, { systemPrompt }) => Promise<{
//   toolsUsed, finalText }>` so this module doesn't have to import the
// full agentOrchestrator in a test context.
async function runLiveCheck({ dispatch, systemPrompt, scenarios = SCENARIOS }) {
  if (typeof dispatch !== 'function') {
    throw new Error('runLiveCheck requires dispatch(prompt, ctx) function');
  }
  const results = [];
  for (const s of scenarios) {
    let ok = true;
    const reasons = [];
    try {
      const { toolsUsed = [], finalText = '' } = await dispatch(s.prompt, { systemPrompt });

      if (s.expectedTool) {
        const used = toolsUsed.map(t => t.name);
        if (!used.includes(s.expectedTool)) {
          ok = false;
          reasons.push(`expected tool "${s.expectedTool}" not called (used: ${used.join(',') || 'none'})`);
        }
      }

      if (s.expectsDecline) {
        // Decline scenarios must NOT call a tool and must mention the
        // gap keyword (e.g. "A-shares" / "Plaid").
        if (toolsUsed.length > 0) {
          ok = false;
          reasons.push(`decline scenario should not call tools (called: ${toolsUsed.map(t => t.name).join(',')})`);
        }
        if (!new RegExp(s.trigger, 'i').test(finalText)) {
          ok = false;
          reasons.push(`reply must reference "${s.trigger}" to name the gap`);
        }
      }

      // Language mirror
      const lang = assertLanguageReply(s.lang, finalText);
      if (!lang.ok) {
        ok = false;
        reasons.push(`language mismatch: ${lang.reason}`);
      }
    } catch (e) {
      ok = false;
      reasons.push(`dispatch threw: ${e.message}`);
    }
    results.push({ lang: s.lang, prompt: s.prompt, category: s.category, ok, reasons });
  }
  const passed = results.filter(r => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}

module.exports = {
  SCENARIOS,
  detectLanguage,
  assertLanguageReply,
  runStructuralCheck,
  runLiveCheck,
};
