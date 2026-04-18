/**
 * services/brokerPdfImporter.js — W6.6 broker-statement PDF parser (seed).
 *
 * Philosophy: PDF parsing is brittle. We refuse to be clever. We define a
 * small set of broker templates, each with a simple fingerprint regex that
 * identifies the source, and a per-template line extractor that pulls
 * (symbol, quantity, price | amount) triples out of the text layer.
 *
 * If no template matches we return { positions: [], unknownTemplate: true }
 * so the UI can tell the user "we don't support this broker yet — please
 * use the CSV path or raise a ticket". Crucially we do NOT fall back to a
 * generic heuristic — that path has historically produced wildly wrong
 * portfolio ingests.
 *
 * Seeded templates:
 *   1. XP Investimentos (BR) — "Posição Consolidada" daily statement.
 *      Fingerprint: contains "XP INVESTIMENTOS" AND "Posição Consolidada".
 *      Rows look like:  "PETR4         100  R$ 30,50  R$ 3.050,00"
 *
 *   2. Hargreaves Lansdown (UK) — "Investment Report" summary.
 *      Fingerprint: contains "Hargreaves Lansdown" AND "Investment Report".
 *      Rows look like:  "Lloyds Banking Group plc   LLOY   1,000   £0.48    £480.00"
 *
 * These are seeds — the regexes will need tuning against real statements
 * once we have them. Keep them honest by writing a fixture-based test
 * before editing the parser for a new broker.
 */

'use strict';

const crypto = require('node:crypto');
const tickerResolver = require('./tickerResolver');
let pdfParse = null;
try { pdfParse = require('pdf-parse'); } catch (_) { /* fail soft at parse-time */ }

function _coerceBR(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[^0-9.,-]/g, '');
  // Brazilian format: thousand dots, comma decimal. "1.234,56" → 1234.56
  // If only comma: treat as decimal.
  const n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function _coerceEN(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ── Templates ──────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    name: 'XP Investimentos BR',
    fingerprint: /XP\s+INVESTIMENTOS.*Posi[çc][ãa]o\s+Consolidada/is,
    currency: 'BRL',
    market: 'BR',
    /**
     * Expected line shape after normalising whitespace:
     *   PETR4  100  R$ 30,50  R$ 3.050,00
     * Ticker ~4 letters + 1–2 digits, qty integer, two R$ figures.
     */
    extract(text) {
      const lineRe = /^([A-Z]{4}\d{1,2})\s+([\d.,]+)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)/gm;
      const positions = [];
      let m;
      while ((m = lineRe.exec(text))) {
        positions.push({
          symbol: m[1],
          quantity: _coerceBR(m[2]),
          entryPrice: _coerceBR(m[3]),
          investedAmount: _coerceBR(m[4]),
        });
      }
      return positions;
    },
  },
  {
    name: 'Hargreaves Lansdown UK',
    fingerprint: /Hargreaves\s+Lansdown.*Investment\s+Report/is,
    currency: 'GBP',
    market: 'UK',
    /**
     * Expected line shape:
     *   Lloyds Banking Group plc   LLOY   1,000   £0.48    £480.00
     * Ticker is 3–5 uppercase letters (LSE tickers). Quantity can carry
     * commas. Prices are prefixed with £.
     */
    extract(text) {
      // LSE tickers are 2–5 uppercase letters (e.g. BP, HSBA, LLOY, RIO).
      const lineRe = /^.+?\s+([A-Z]{2,5})\s+([\d.,]+)\s+£\s*([\d.,]+)\s+£\s*([\d.,]+)/gm;
      const positions = [];
      let m;
      while ((m = lineRe.exec(text))) {
        positions.push({
          symbol: m[1],
          quantity: _coerceEN(m[2]),
          entryPrice: _coerceEN(m[3]),
          investedAmount: _coerceEN(m[4]),
        });
      }
      return positions;
    },
  },
];

function _findTemplate(text) {
  for (const t of TEMPLATES) {
    if (t.fingerprint.test(text)) return t;
  }
  return null;
}

/**
 * Parse a broker PDF buffer.
 * Returns { positions, rejected, warnings, template }
 * or     { positions: [], unknownTemplate: true, warnings: [...] }
 */
async function parse(buffer, opts = {}) {
  if (!pdfParse) throw new Error('pdf_parse_not_installed');
  if (!Buffer.isBuffer(buffer)) throw new Error('bad_input: buffer required');

  const parsed = await pdfParse(buffer);
  const text = parsed.text || '';
  const portfolioId = opts.portfolioId || 'imported';
  const now = new Date().toISOString();

  const template = _findTemplate(text);
  if (!template) {
    return {
      positions: [],
      rejected: [],
      warnings: ['unknown_broker_template'],
      unknownTemplate: true,
      supportedTemplates: TEMPLATES.map(t => t.name),
    };
  }

  const raw = template.extract(text);
  const positions = [];
  const rejected  = [];

  for (const r of raw) {
    if (!r.symbol) { rejected.push({ reason: 'missing_symbol', raw: r }); continue; }
    const resolved = tickerResolver.resolve(r.symbol);
    if (!resolved) { rejected.push({ reason: 'unrecognised_symbol', raw: r }); continue; }

    const invested = (r.quantity && r.entryPrice && r.quantity > 0 && r.entryPrice > 0)
      ? r.quantity * r.entryPrice
      : r.investedAmount;
    if (!invested || invested <= 0) {
      rejected.push({ reason: 'invalid_amount', raw: r });
      continue;
    }

    positions.push({
      id: crypto.randomUUID(),
      symbol: resolved.root + (resolved.suffix || ''),
      portfolioId,
      subportfolioId: null,
      investedAmount: Number(invested.toFixed(2)),
      quantity: r.quantity ?? null,
      entryPrice: r.entryPrice ?? null,
      currency: template.currency,
      note: null,
      createdAt: now,
      source: 'pdf_import',
    });
  }

  const warnings = [];
  if (positions.length === 0) warnings.push('template_matched_but_no_rows_extracted');
  if (positions.length > 500) {
    warnings.push('truncated_to_500_positions');
    positions.length = 500;
  }

  return { positions, rejected, warnings, template: template.name };
}

// Exposed for tests so we can hit `extract` on a known-good text blob
// without having to ship a fixture PDF.
module.exports = {
  parse,
  _findTemplate,
  TEMPLATES,
};
