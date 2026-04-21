/**
 * aiToolbox.cvmFilings.test.js — unit tests for list_cvm_filings.
 *
 * Stubs cvmFilingsProvider so CVM's open-data portal isn't hit. Asserts
 * the tool is in the catalog with the correct schema, the handler
 * propagates all filter params verbatim, ticker resolution routes
 * through, and the coverage_note path is preserved for unresolvable
 * issuers.
 */

'use strict';

const assert = require('assert');
const path = require('path');

function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', '..', relativePath));
  require.cache[abs] = {
    id: abs, filename: abs, loaded: true,
    exports: exportsObj,
  };
}

// Quiet logger + ledger
stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
stubModule('services/aiCostLedger', { recordUsage: () => {} });

// Capture calls for assertion
const calls = [];

stubModule('providers/cvmFilingsProvider', {
  getCvmFilings: async (opts = {}) => {
    calls.push(opts);
    const tk = String(opts.ticker || '').toUpperCase().replace(/\.SA$/, '');

    if (tk === 'PETR4') {
      return {
        company: { cnpj: '33000167000101', name: 'PETROLEO BRASILEIRO S.A. PETROBRAS', ticker: 'PETR4' },
        year: 2026,
        from: opts.from || null,
        to: opts.to || null,
        category: opts.category || null,
        count: 2,
        filings: [
          {
            date: '2026-04-18',
            referenceDate: '2026-04-18',
            category: 'Fato Relevante',
            type: 'Apresentação de Resultados',
            subtype: '',
            subject: 'Divulgação dos resultados do 1T26',
            status: 'Ativo',
            version: '1',
            link: 'https://www.rad.cvm.gov.br/doc/1.pdf',
          },
          {
            date: '2026-03-10',
            referenceDate: '2026-03-10',
            category: 'Comunicado ao Mercado',
            type: 'Aviso aos Acionistas',
            subtype: '',
            subject: 'Dividendos',
            status: 'Ativo',
            version: '1',
            link: 'https://www.rad.cvm.gov.br/doc/2.pdf',
          },
        ],
        source: 'CVM IPE',
        asOf: '2026-04-21T20:00:00Z',
      };
    }

    if (opts.cnpj === '99999999999999') {
      return {
        company: { cnpj: '99999999999999', name: null, ticker: null },
        year: 2026,
        count: 0,
        filings: [],
        source: 'CVM IPE',
        asOf: '2026-04-21T20:00:00Z',
      };
    }

    // Unknown — fall through to coverage_note shape
    return {
      query: { ticker: opts.ticker, company: opts.company, cnpj: opts.cnpj },
      count: 0,
      filings: [],
      coverage_note:
        `Couldn't resolve that issuer to a CNPJ. The ticker table covers ~40 B3 ` +
        `blue chips; for smaller names pass the exact company name substring as it ` +
        `appears on CVM, or the CNPJ directly.`,
      source: 'CVM IPE',
    };
  },
  listKnownTickers: () => [
    { ticker: 'PETR4', cnpj: '33000167000101', name: 'PETROLEO BRASILEIRO S.A. PETROBRAS' },
  ],
});

// Load AFTER stubs
const toolboxPath = require.resolve('../aiToolbox');
delete require.cache[toolboxPath];
const toolbox = require('../aiToolbox');

(async () => {
  // 1. Tool exists in catalog with correct schema
  const tool = toolbox.TOOLS.find(t => t.name === 'list_cvm_filings');
  assert.ok(tool, 'list_cvm_filings must exist in TOOLS catalog');
  assert.ok(tool.input_schema?.properties?.ticker, 'schema must define ticker');
  assert.ok(tool.input_schema?.properties?.company, 'schema must define company');
  assert.ok(tool.input_schema?.properties?.cnpj, 'schema must define cnpj');
  assert.ok(tool.input_schema?.properties?.category, 'schema must define category');
  assert.ok(tool.input_schema?.properties?.from, 'schema must define from');
  assert.ok(tool.input_schema?.properties?.to, 'schema must define to');
  // Note: no field is "required" — the tool handles bare calls and returns
  // a coverage_note, which is the preferred UX for the AI.

  // 2. Handler registered
  assert.ok(
    typeof toolbox.HANDLERS.list_cvm_filings === 'function',
    'list_cvm_filings handler missing',
  );

  // 3. Ticker-based lookup returns canonical shape with CNPJ + filings
  const r1 = await toolbox.dispatchTool('list_cvm_filings', { ticker: 'PETR4' });
  assert.strictEqual(r1.company.cnpj, '33000167000101');
  assert.strictEqual(r1.company.ticker, 'PETR4');
  assert.strictEqual(r1.source, 'CVM IPE');
  assert.strictEqual(r1.count, 2);
  assert.strictEqual(r1.filings[0].category, 'Fato Relevante');
  assert.ok(r1.filings[0].link && r1.filings[0].link.startsWith('https://'),
    'filings must carry a downloadable link');

  // 4. Full filter set propagates through dispatcher verbatim
  await toolbox.dispatchTool('list_cvm_filings', {
    ticker: 'PETR4',
    category: 'Fato Relevante',
    type: 'Apresentação',
    from: '2026-01-01',
    to: '2026-12-31',
    limit: 5,
    year: 2026,
  });
  const last = calls[calls.length - 1];
  assert.strictEqual(last.ticker, 'PETR4', 'ticker forwarded');
  assert.strictEqual(last.category, 'Fato Relevante', 'category forwarded');
  assert.strictEqual(last.type, 'Apresentação', 'type forwarded');
  assert.strictEqual(last.from, '2026-01-01', 'from forwarded');
  assert.strictEqual(last.to, '2026-12-31', 'to forwarded');
  assert.strictEqual(last.limit, 5, 'limit forwarded');
  assert.strictEqual(last.year, 2026, 'year forwarded');

  // 5. CNPJ-direct path — zero filings but canonical company shape
  const r2 = await toolbox.dispatchTool('list_cvm_filings', { cnpj: '99999999999999' });
  assert.strictEqual(r2.company.cnpj, '99999999999999');
  assert.strictEqual(r2.count, 0);
  assert.deepStrictEqual(r2.filings, []);

  // 6. Unresolvable issuer — coverage_note, NO fabricated filings
  const r3 = await toolbox.dispatchTool('list_cvm_filings', { ticker: 'NOPE3' });
  assert.strictEqual(r3.count, 0);
  assert.deepStrictEqual(r3.filings, []);
  assert.ok(r3.coverage_note && /CNPJ|blue chips|CVM/i.test(r3.coverage_note),
    'unresolvable issuer must surface coverage_note');

  // 7. System prompt integration: search.js must reference list_cvm_filings
  //    with the "do not use EDGAR for B3" guardrail.
  const fs = require('fs');
  const searchSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'search.js'),
    'utf8',
  );
  assert.ok(
    searchSrc.includes('list_cvm_filings'),
    'search.js must reference list_cvm_filings',
  );
  assert.ok(
    /CVM|IPE|Fato Relevante/i.test(searchSrc),
    'search.js must include CVM filings guidance',
  );
  assert.ok(
    /EDGAR only covers|SEC filers|ADRs/i.test(searchSrc),
    'search.js must warn against using EDGAR for B3-listed names',
  );

  // 8. Real provider smoke — the lazy-loaded file exports getCvmFilings
  //    and listKnownTickers (catches export typos).
  delete require.cache[require.resolve(
    path.join(__dirname, '..', '..', 'providers', 'cvmFilingsProvider'),
  )];
  const realProvider = require('../../providers/cvmFilingsProvider');
  assert.ok(typeof realProvider.getCvmFilings === 'function',
    'real provider must export getCvmFilings');
  assert.ok(typeof realProvider.listKnownTickers === 'function',
    'real provider must export listKnownTickers');

  // 9. Real provider's ticker table wires PETR4 and VALE3 correctly
  const knownTickers = realProvider.listKnownTickers();
  const petr4 = knownTickers.find(r => r.ticker === 'PETR4');
  const vale3 = knownTickers.find(r => r.ticker === 'VALE3');
  const itub4 = knownTickers.find(r => r.ticker === 'ITUB4');
  assert.ok(petr4, 'ticker table must include PETR4');
  assert.ok(vale3, 'ticker table must include VALE3');
  assert.ok(itub4, 'ticker table must include ITUB4');
  assert.strictEqual(petr4.cnpj.length, 14, 'CNPJs must be 14 digits');

  // 10. Real provider helpers — smoke on the pure utilities
  assert.strictEqual(realProvider._normalizeTicker('PETR4.SA'), 'PETR4');
  assert.strictEqual(realProvider._normalizeTicker('vale3'), 'VALE3');
  assert.strictEqual(realProvider._toIsoDate('2026-04-18'), '2026-04-18');
  assert.strictEqual(realProvider._toIsoDate('18/04/2026'), '2026-04-18');
  const fields = realProvider._splitCsvLine('a;b;"c;d";e');
  assert.deepStrictEqual(fields, ['a', 'b', 'c;d', 'e'], 'CSV splitter must respect quoted commas');

  console.log('aiToolbox.cvmFilings.test.js OK');
})().catch((err) => {
  console.error('aiToolbox.cvmFilings.test.js FAILED:', err);
  process.exit(1);
});
