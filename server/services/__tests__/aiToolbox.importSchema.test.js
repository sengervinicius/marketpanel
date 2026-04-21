/**
 * aiToolbox.importSchema.test.js — unit tests for describe_portfolio_import.
 *
 * Stubs csvImporter so no real file I/O is touched. Asserts the tool is in
 * the catalog with no required arguments, the handler delegates to
 * csvImporter.getImportSchema(), the returned shape carries the canonical
 * fields + endpoint URLs, and search.js carries rule #14 pointing the AI
 * at this tool for portfolio-import questions.
 *
 * P1.5 rationale: we don't have Plaid / Open Finance / Yodlee for direct
 * brokerage sync (declared gap in P1.4). The CSV path IS the supported
 * import route, and making it AI-discoverable via describe_portfolio_import
 * is what closes the UX gap without crossing the commercial blocker.
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

// Quiet logger + ledger so console is clean
stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
stubModule('services/aiCostLedger', { recordUsage: () => {} });

// Capture calls so we can assert the handler actually delegates to the importer
const calls = [];

const STUB_SCHEMA = {
  version: 1,
  fields: [
    { field: 'symbol',         required: true,  type: 'string', example: 'PETR4.SA', aliases: ['ticker', 'papel'] },
    { field: 'quantity',       required: true,  type: 'number', example: '100',       aliases: ['qty', 'quantidade'] },
    { field: 'entryPrice',     required: false, type: 'number', example: '32.50',     aliases: ['price', 'preco_medio'] },
    { field: 'investedAmount', required: false, type: 'number', example: '3250.00',   aliases: ['total', 'valor_aplicado'] },
    { field: 'currency',       required: false, type: 'string', example: 'BRL',       aliases: ['moeda'] },
    { field: 'tradeDate',      required: false, type: 'date',   example: '2026-04-21', aliases: ['date', 'data'] },
    { field: 'note',           required: false, type: 'string', example: 'Core dividend position', aliases: ['comentario'] },
  ],
  uploadUrl: '/api/portfolio/import/preview',
  commitUrl: '/api/portfolio/import/commit',
  templateUrl: '/api/portfolio/import/template',
  supportedFormats: ['csv', 'tsv', 'ofx', 'qfx', 'pdf (broker statement)'],
  modes: ['merge', 'replace'],
  notes: [
    'Two-step flow: POST CSV to /preview to get a mapping, confirm, then POST again to /commit.',
    'Default mode is merge (appends, dedupes by symbol+invested). Use replace only to wipe prior holdings.',
    'BR decimal formats (1.234,56) and US (1,234.56) both parse correctly.',
  ],
};

stubModule('services/csvImporter', {
  getImportSchema: () => {
    calls.push('getImportSchema');
    return STUB_SCHEMA;
  },
  buildTemplateCsv: () => 'symbol,quantity\nPETR4.SA,100\n',
  CANONICAL_SCHEMA: STUB_SCHEMA.fields,
  HEADER_HINTS: {},
  parsePreview: async () => ({ rows: [], mapping: {} }),
  normalise: () => ({}),
  detectMapping: () => ({}),
});

// Load toolbox fresh AFTER stubs
const toolboxPath = require.resolve('../aiToolbox');
delete require.cache[toolboxPath];
const toolbox = require('../aiToolbox');

(async () => {
  // 1. Tool exists in catalog
  const tool = toolbox.TOOLS.find(t => t.name === 'describe_portfolio_import');
  assert.ok(tool, 'describe_portfolio_import must exist in TOOLS catalog');

  // 2. No required arguments — tool must be callable with bare {} payload,
  //    because the AI is invoking it in a conversational context where the
  //    user hasn't specified anything yet.
  assert.ok(tool.input_schema, 'tool must carry an input_schema');
  assert.strictEqual(tool.input_schema.type, 'object', 'schema type must be object');
  assert.ok(
    !tool.input_schema.required || tool.input_schema.required.length === 0,
    'describe_portfolio_import must have NO required params (callable with {})',
  );

  // 3. Description must mention portfolio import + CSV guidance so the
  //    model routes the right questions here, and must explicitly forbid
  //    asking for credentials (P1.4 declared-gap guardrail).
  assert.ok(
    /portfolio|import|holdings/i.test(tool.description),
    'description must flag portfolio / import / holdings keywords',
  );
  assert.ok(
    /CSV|upload/i.test(tool.description),
    'description must redirect to CSV upload',
  );
  assert.ok(
    /credentials|account numbers?/i.test(tool.description),
    'description must explicitly warn against collecting credentials',
  );

  // 4. Handler registered
  assert.ok(
    typeof toolbox.HANDLERS.describe_portfolio_import === 'function',
    'describe_portfolio_import handler missing',
  );

  // 5. Dispatch returns the schema shape
  const r1 = await toolbox.dispatchTool('describe_portfolio_import', {});
  assert.strictEqual(r1.version, 1, 'schema version should pass through');
  assert.ok(Array.isArray(r1.fields), 'fields must be an array');
  assert.ok(r1.fields.length >= 5, 'schema must expose at least the core fields');

  // 6. Required fields are marked so the AI can communicate which columns
  //    are mandatory vs optional.
  const symbolField = r1.fields.find(f => f.field === 'symbol');
  const quantityField = r1.fields.find(f => f.field === 'quantity');
  const entryPriceField = r1.fields.find(f => f.field === 'entryPrice');
  assert.ok(symbolField, 'schema must include "symbol" field');
  assert.ok(quantityField, 'schema must include "quantity" field');
  assert.ok(entryPriceField, 'schema must include "entryPrice" field');
  assert.strictEqual(symbolField.required, true, 'symbol must be required');
  assert.strictEqual(quantityField.required, true, 'quantity must be required');
  assert.strictEqual(entryPriceField.required, false, 'entryPrice must be optional');

  // 7. Endpoint URLs come through so the AI can redirect the user.
  assert.strictEqual(r1.uploadUrl,   '/api/portfolio/import/preview');
  assert.strictEqual(r1.commitUrl,   '/api/portfolio/import/commit');
  assert.strictEqual(r1.templateUrl, '/api/portfolio/import/template');

  // 8. Supported formats + modes land in the payload so the AI can talk
  //    about "CSV / XLSX / OFX" without inventing options.
  assert.ok(Array.isArray(r1.supportedFormats) && r1.supportedFormats.includes('csv'),
    'supportedFormats must include csv');
  assert.ok(Array.isArray(r1.modes) && r1.modes.includes('merge') && r1.modes.includes('replace'),
    'modes must include merge + replace');

  // 9. Handler actually called the importer (not just a hardcoded payload
  //    in the toolbox handler).
  assert.ok(calls.includes('getImportSchema'),
    'handler must delegate to csvImporter.getImportSchema()');

  // 10. search.js wires the tool into the catalog AND carries rule #14
  //     pointing at it, with the credentials guardrail.
  const fs = require('fs');
  const searchSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'search.js'),
    'utf8',
  );
  assert.ok(
    searchSrc.includes('describe_portfolio_import'),
    'search.js must reference describe_portfolio_import in the tool catalog',
  );
  assert.ok(
    /14\.\s*PORTFOLIO\s+IMPORT/i.test(searchSrc),
    'search.js must carry a numbered rule (14) titled PORTFOLIO IMPORT',
  );
  assert.ok(
    /template|preview|commit/i.test(searchSrc),
    'rule 14 must mention the template / preview / commit flow',
  );
  assert.ok(
    /do NOT ask|never ask|without|don't ask/i.test(searchSrc) &&
      /credentials|account numbers?|password/i.test(searchSrc),
    'rule 14 must forbid asking for credentials / account numbers',
  );

  // 11. Real csvImporter — smoke on the lazy-loaded file so we catch
  //     export typos or a future rename.
  delete require.cache[require.resolve(
    path.join(__dirname, '..', '..', 'services', 'csvImporter'),
  )];
  const realImporter = require('../csvImporter');
  assert.ok(typeof realImporter.getImportSchema === 'function',
    'real csvImporter must export getImportSchema');
  assert.ok(typeof realImporter.buildTemplateCsv === 'function',
    'real csvImporter must export buildTemplateCsv');
  const realSchema = realImporter.getImportSchema();
  assert.strictEqual(realSchema.uploadUrl, '/api/portfolio/import/preview',
    'real schema must point at the wired /preview endpoint');
  assert.strictEqual(realSchema.commitUrl, '/api/portfolio/import/commit',
    'real schema must point at the wired /commit endpoint');
  assert.strictEqual(realSchema.templateUrl, '/api/portfolio/import/template',
    'real schema must point at the wired /template endpoint');
  assert.ok(realSchema.fields.find(f => f.field === 'symbol' && f.required === true),
    'real schema must mark symbol as required');
  assert.ok(realSchema.fields.find(f => f.field === 'quantity' && f.required === true),
    'real schema must mark quantity as required');

  // 12. Template CSV has a header row + an example row so the user can
  //     download it and immediately see the shape.
  const tpl = realImporter.buildTemplateCsv();
  const lines = tpl.trim().split(/\r?\n/);
  assert.ok(lines.length >= 2, 'template must carry a header row + at least one example row');
  assert.ok(/symbol/.test(lines[0]), 'template header must include "symbol"');
  assert.ok(/quantity/.test(lines[0]), 'template header must include "quantity"');

  console.log('aiToolbox.importSchema.test.js OK');
})().catch((err) => {
  console.error('aiToolbox.importSchema.test.js FAILED:', err);
  process.exit(1);
});
