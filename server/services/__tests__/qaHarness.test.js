/**
 * qaHarness.test.js — P2.4 Multilingual QA harness unit tests.
 *
 * Validates the harness catalogue is internally consistent and that
 * the language detector correctly classifies EN / PT-BR / ES inputs.
 * The STRUCTURAL check is then run against the real TOOLS catalog and
 * the real search.js source — if anyone edits the prompt in a way that
 * drops a documented PT-BR / ES trigger, or adds a scenario with an
 * unregistered tool, this test fails.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', '..', relativePath));
  require.cache[abs] = {
    id: abs, filename: abs, loaded: true,
    exports: exportsObj,
  };
}

stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
stubModule('services/aiCostLedger', { recordUsage: () => {} });

const qa = require('../qaHarness');
const toolboxPath = require.resolve('../aiToolbox');
delete require.cache[toolboxPath];
const toolbox = require('../aiToolbox');

(async () => {
  // ── 1. Catalogue shape ──────────────────────────────────────────────
  assert.ok(Array.isArray(qa.SCENARIOS) && qa.SCENARIOS.length >= 10,
    'SCENARIOS must be a non-trivial array');
  // At least one scenario per primary language.
  const langs = new Set(qa.SCENARIOS.map(s => s.lang));
  assert.ok(langs.has('en'),    'must cover en');
  assert.ok(langs.has('pt-BR'), 'must cover pt-BR');
  assert.ok(langs.has('es'),    'must cover es');
  // At least one declined (coverage-gap) scenario.
  assert.ok(qa.SCENARIOS.some(s => s.expectsDecline),
    'must include at least one decline/coverage-gap scenario');
  // At least one action-tag scenario (alerts bulk).
  assert.ok(qa.SCENARIOS.some(s => s.expectedActionTag),
    'must include at least one action-tag scenario');

  // Every scenario row has the required keys + sane types.
  for (const s of qa.SCENARIOS) {
    assert.ok(['en', 'pt-BR', 'es'].includes(s.lang), `bad lang: ${s.lang}`);
    assert.ok(typeof s.prompt === 'string' && s.prompt.length > 0, 'prompt must be a string');
    assert.ok(typeof s.trigger === 'string' && s.trigger.length > 0, 'trigger required');
    assert.ok(typeof s.category === 'string' && s.category.length > 0, 'category required');
    if (s.expectedTool !== null && s.expectedTool !== undefined) {
      assert.ok(typeof s.expectedTool === 'string', 'expectedTool must be a string or null');
    }
  }

  // ── 2. Language detection ───────────────────────────────────────────
  assert.strictEqual(qa.detectLanguage('What is the current price of NVDA?'), 'en');
  assert.strictEqual(qa.detectLanguage('Qual o preço atual da PETR4.SA?'), 'pt-BR');
  assert.strictEqual(qa.detectLanguage('¿Cuál es la cotización del dólar?'), 'es');
  assert.strictEqual(qa.detectLanguage('Mostra o histórico do IPCA'), 'pt-BR');
  assert.strictEqual(qa.detectLanguage(''), 'unknown');
  assert.strictEqual(qa.detectLanguage('PETR4'), 'unknown');
  // Accented characters steer classification even with thin stopwords.
  assert.strictEqual(qa.detectLanguage('Avaliação do câmbio'), 'pt-BR');

  // ── 3. assertLanguageReply ──────────────────────────────────────────
  let chk;
  chk = qa.assertLanguageReply('en', 'The current price of NVDA is $900.');
  assert.strictEqual(chk.ok, true, 'EN reply passes EN gate');
  chk = qa.assertLanguageReply('pt-BR', 'O preço atual da PETR4 é R$ 34,50.');
  assert.strictEqual(chk.ok, true, 'PT-BR reply passes PT-BR gate');
  chk = qa.assertLanguageReply('es', 'El precio actual del dólar es de 5,20 reales.');
  assert.strictEqual(chk.ok, true, 'ES reply passes ES gate');
  chk = qa.assertLanguageReply('pt-BR', 'The current price is 5.20 reais.');
  assert.strictEqual(chk.ok, false, 'EN reply must fail PT-BR gate');
  assert.ok(/expected pt-BR/.test(chk.reason), 'reason string should cite expected');
  // Very short replies are tolerated — one-word "Sim." can't be detected.
  chk = qa.assertLanguageReply('pt-BR', 'Sim.');
  assert.strictEqual(chk.ok, true, 'short ambiguous reply is tolerated');

  // ── 4. Structural check against the REAL prompt + catalog ──────────
  const searchSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'search.js'),
    'utf8',
  );
  const report = qa.runStructuralCheck({
    toolsCatalog: toolbox.TOOLS,
    searchSource,
  });
  assert.strictEqual(report.failed, 0,
    `structural check failed:\n${JSON.stringify(report.results.filter(r => !r.ok), null, 2)}`);
  assert.strictEqual(report.passed, report.total, 'all scenarios must pass offline');

  // ── 5. The LANGUAGE MIRROR rule must exist in the prompt ────────────
  assert.ok(
    /18\.\s*LANGUAGE MIRROR/i.test(searchSource),
    'rule 18 LANGUAGE MIRROR must be present so the AI mirrors user language',
  );
  assert.ok(
    /SAME language/i.test(searchSource),
    'LANGUAGE MIRROR rule must explicitly require same-language replies',
  );

  // ── 6. Tool calls are language-invariant (docs say so) ──────────────
  // The LANGUAGE MIRROR rule must make clear that the TOOL arguments stay
  // canonical (e.g. PETR4.SA, iron ore, selic) while the narrative mirrors
  // the user. This prevents a subtle regression where someone decides to
  // "localise" tool arg parsing.
  assert.ok(
    /language-invariant/i.test(searchSource),
    'LANGUAGE MIRROR must state tool calls are language-invariant',
  );

  // ── 7. runLiveCheck happy path with a mocked dispatch ───────────────
  // Smoke test the live-eval plumbing using a synthetic dispatcher.
  const mockDispatch = async (prompt, _ctx) => {
    // Order matters: more-specific patterns first so e.g. the forward-
    // estimates prompt ("street modelling for NVDA FY+2") doesn't match
    // the generic lookup_quote NVDA branch.
    if (/street|FY\+2/i.test(prompt)) {
      return { toolsUsed: [{ name: 'forward_estimates' }], finalText: 'Street consensus for NVDA FY+2 EPS is $6.10, bull $7.00, bear $5.20, off 38 analysts.' };
    }
    if (/NVDA/i.test(prompt)) {
      return { toolsUsed: [{ name: 'lookup_quote' }], finalText: 'NVDA is at $900 today.' };
    }
    if (/PETR4/i.test(prompt)) {
      return { toolsUsed: [{ name: 'lookup_quote' }], finalText: 'A PETR4.SA está cotada a R$ 34,50.' };
    }
    if (/AAPL/i.test(prompt)) {
      return { toolsUsed: [{ name: 'lookup_quote' }], finalText: 'AAPL cotiza a $180 actualmente en dólares.' };
    }
    if (/iron ore/i.test(prompt)) {
      return { toolsUsed: [{ name: 'lookup_commodity' }], finalText: 'Iron ore is trading at $110/t today.' };
    }
    if (/minério de ferro/i.test(prompt)) {
      return { toolsUsed: [{ name: 'lookup_commodity' }], finalText: 'O minério de ferro está em US$ 110/t hoje.' };
    }
    if (/boi gordo/i.test(prompt)) {
      return { toolsUsed: [{ name: 'lookup_commodity' }], finalText: 'O boi gordo está cotado a R$ 320 a arroba.' };
    }
    if (/Selic/i.test(prompt)) {
      return { toolsUsed: [{ name: 'get_brazil_macro' }], finalText: 'A Selic está em 10,25% a.a. hoje.' };
    }
    if (/IPCA/i.test(prompt)) {
      return { toolsUsed: [{ name: 'get_brazil_macro' }], finalText: 'O histórico do IPCA mostra 4,12% nos últimos 12 meses.' };
    }
    if (/alertas/i.test(prompt)) {
      return { toolsUsed: [], finalText: 'Vou apagar todos os seus alertas. [action:delete_all_alerts]' };
    }
    if (/A-shares/i.test(prompt)) {
      return { toolsUsed: [], finalText: "Mainland A-shares aren't in our live feeds — we're not licensed to Tushare." };
    }
    if (/Plaid/i.test(prompt)) {
      return { toolsUsed: [], finalText: 'Não conectamos contas via Plaid — use o import de CSV na página de portfólio.' };
    }
    return { toolsUsed: [], finalText: '' };
  };
  const live = await qa.runLiveCheck({ dispatch: mockDispatch, systemPrompt: 'pretend' });
  assert.strictEqual(live.failed, 0,
    `live mock failed:\n${JSON.stringify(live.results.filter(r => !r.ok), null, 2)}`);

  // ── 8. Live check catches tool-selection regression ─────────────────
  const wrongTool = async (prompt) => {
    if (/NVDA|PETR4|AAPL/i.test(prompt)) {
      return { toolsUsed: [{ name: 'lookup_commodity' }], finalText: 'NVDA answer here.' };
    }
    return { toolsUsed: [], finalText: 'no idea' };
  };
  const bad = await qa.runLiveCheck({
    dispatch: wrongTool,
    scenarios: qa.SCENARIOS.filter(s => s.expectedTool === 'lookup_quote'),
  });
  assert.ok(bad.failed > 0, 'must flag rows where the wrong tool was picked');
  assert.ok(
    bad.results.some(r => r.reasons.some(x => /expected tool/i.test(x))),
    'failure reason must cite the missing tool',
  );

  // ── 9. Live check catches language mismatch ─────────────────────────
  const wrongLang = async (prompt) => {
    // Always reply in English regardless of prompt language.
    if (/PETR4|IPCA|Selic|alertas|minério|boi gordo/i.test(prompt)) {
      return { toolsUsed: [{ name: 'lookup_quote' }], finalText: 'The current price of this asset is 34.50 dollars per share, quoted on the exchange today.' };
    }
    return { toolsUsed: [], finalText: '' };
  };
  const badLang = await qa.runLiveCheck({
    dispatch: wrongLang,
    scenarios: qa.SCENARIOS.filter(s => s.lang === 'pt-BR'),
  });
  assert.ok(badLang.failed > 0, 'must flag EN reply to PT-BR prompt');
  assert.ok(
    badLang.results.some(r => r.reasons.some(x => /language mismatch/i.test(x))),
    'failure reason must cite language mismatch',
  );

  // ── 10. Declined scenarios must NOT call tools ──────────────────────
  const toolHappy = async (prompt) => {
    if (/A-shares/i.test(prompt)) {
      // Wrongly calls a tool on a gap scenario.
      return { toolsUsed: [{ name: 'lookup_quote' }], finalText: 'Here are your A-shares quotes.' };
    }
    return { toolsUsed: [], finalText: '' };
  };
  const decline = await qa.runLiveCheck({
    dispatch: toolHappy,
    scenarios: qa.SCENARIOS.filter(s => s.expectsDecline && /A-shares/i.test(s.prompt)),
  });
  assert.ok(decline.failed > 0, 'decline scenario must fail when a tool is called');

  // ── 11. Missing dispatch function throws ─────────────────────────────
  await assert.rejects(
    () => qa.runLiveCheck({ dispatch: null }),
    /dispatch/,
    'runLiveCheck must reject when dispatch is missing',
  );

  console.log('qaHarness.test.js OK');
})().catch((err) => {
  console.error('qaHarness.test.js FAILED:', err);
  process.exit(1);
});
