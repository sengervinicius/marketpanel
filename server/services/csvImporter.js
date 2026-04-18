/**
 * services/csvImporter.js — W6.4 portfolio CSV import MVP.
 *
 * Users upload a CSV exported from any broker. We auto-detect the
 * columns, hand back a preview for the user to confirm, and then
 * commit the positions to the portfolio store on a second call.
 *
 * The design principle: NEVER commit without an explicit user confirm
 * step. Messy broker exports can trash a portfolio if we guess wrong.
 *
 * Flow:
 *   1. parsePreview(csvBuffer, {delimiter?}) →
 *        {headers, rows[0..10], detectedMapping}
 *   2. client renders a mapping UI with detectedMapping prefilled
 *   3. commit(csvBuffer, mapping, userId, existingPortfolio) →
 *        {positionsAdded, positionsRejected, doc}
 *
 * The commit never mutates anything. It returns a new portfolio doc
 * which the route hands to portfolioStore.syncPortfolio().
 */

'use strict';

const { parse } = require('csv-parse/sync');
const crypto = require('node:crypto');
const logger = require('../utils/logger');
const ticker = require('./tickerResolver');

// Heuristic header → canonical field. All compared case-insensitively,
// stripped of non-alphanumerics. Broker exports vary wildly.
const HEADER_HINTS = {
  symbol:         ['symbol', 'ticker', 'instrument', 'stock', 'code', 'ativo', 'papel'],
  quantity:       ['quantity', 'qty', 'shares', 'units', 'quantidade'],
  entryPrice:     ['price', 'entryprice', 'averageprice', 'costbasis', 'unitcost',
                   'precomedio', 'precoentrada', 'precomediocompra', 'precomedioponderado'],
  investedAmount: ['amount', 'totalcost', 'costtotal', 'invested', 'totalinvested',
                   'totalinvestido', 'custototal', 'valorinvestido', 'valortotal'],
  currency:       ['currency', 'ccy', 'moeda'],
  note:           ['note', 'notes', 'memo', 'comment', 'observacao', 'observacoes'],
  tradeDate:      ['date', 'tradedate', 'purchasedate', 'datacompra', 'dataoperacao'],
};

// Canonicalise a header for heuristic matching.
// - Lowercase
// - Strip diacritics (so "Preço Médio" matches "precomedio", "Observação" matches "observacao")
// - Strip every char outside [a-z0-9]
function _canon(h) {
  return String(h || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function detectMapping(headers) {
  const out = {};
  for (const [field, hints] of Object.entries(HEADER_HINTS)) {
    const canonHints = hints.map(_canon);
    for (let i = 0; i < headers.length; i++) {
      const c = _canon(headers[i]);
      if (canonHints.includes(c)) { out[field] = headers[i]; break; }
    }
  }
  return out;
}

function _coerceNumber(v) {
  if (v == null || v === '') return null;
  const s = String(v).replace(/[^0-9.\-,]/g, '');
  // After stripping non-numerics, empty string means no digits in the source.
  // Return null so Number('') doesn't silently coerce 'abc' to 0.
  if (s === '' || s === '-') return null;
  // Heuristic: if the string has both '.' and ',' treat the last separator
  // as the decimal. Otherwise a single ',' on Brazilian CSVs is decimal.
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let num;
  if (hasDot && hasComma) {
    if (s.lastIndexOf('.') > s.lastIndexOf(',')) num = Number(s.replace(/,/g, ''));
    else num = Number(s.replace(/\./g, '').replace(',', '.'));
  } else if (hasComma) {
    num = Number(s.replace(/\./g, '').replace(',', '.'));
  } else {
    num = Number(s);
  }
  return Number.isFinite(num) ? num : null;
}

function _detectDelimiter(text) {
  // Pick the char that produces the most balanced row widths on the first 10 lines.
  const sample = text.split(/\r?\n/).slice(0, 10).filter(Boolean);
  if (sample.length === 0) return ',';
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = -Infinity;
  for (const d of candidates) {
    const widths = sample.map(line => line.split(d).length);
    const min = Math.min(...widths);
    const max = Math.max(...widths);
    if (min < 2) continue;                                        // no field split, skip
    const score = min - (max - min);                               // prefer many fields with low variance
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/**
 * Parse the CSV, detect a mapping, and return the first 10 data rows for preview.
 */
function parsePreview(buffer, opts = {}) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
  const delimiter = opts.delimiter || _detectDelimiter(text);

  let rows;
  try {
    rows = parse(text, {
      columns: true,
      delimiter,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    });
  } catch (e) {
    throw new Error(`csv_parse_failed: ${e.message}`);
  }

  if (!rows.length) return { headers: [], rows: [], detectedMapping: {}, delimiter, totalRows: 0 };

  const headers = Object.keys(rows[0]);
  const detectedMapping = detectMapping(headers);
  return {
    headers,
    rows: rows.slice(0, 10),
    detectedMapping,
    delimiter,
    totalRows: rows.length,
  };
}

/**
 * Turn a CSV + mapping into a list of normalised position objects.
 * Returns { positions, rejected, warnings }.
 */
function normalise(buffer, mapping, opts = {}) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
  const delimiter = opts.delimiter || _detectDelimiter(text);
  const rows = parse(text, {
    columns: true, delimiter, skip_empty_lines: true, trim: true,
    relax_quotes: true, relax_column_count: true,
  });

  const positions = [];
  const rejected  = [];
  const warnings  = [];
  const now = new Date().toISOString();
  const portfolioId = opts.portfolioId || 'imported';

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rawSymbol = mapping.symbol ? r[mapping.symbol] : null;
    const rawQty    = mapping.quantity ? r[mapping.quantity] : null;
    const rawPrice  = mapping.entryPrice ? r[mapping.entryPrice] : null;
    const rawAmount = mapping.investedAmount ? r[mapping.investedAmount] : null;
    const rawCcy    = mapping.currency ? r[mapping.currency] : null;
    const rawNote   = mapping.note ? r[mapping.note] : null;

    if (!rawSymbol || !String(rawSymbol).trim()) {
      rejected.push({ row: i + 2, reason: 'missing_symbol', raw: r });
      continue;
    }

    const resolved = ticker.resolve(rawSymbol);
    if (!resolved) {
      rejected.push({ row: i + 2, reason: 'unrecognised_symbol', raw: r });
      continue;
    }

    const qty    = _coerceNumber(rawQty);
    const price  = _coerceNumber(rawPrice);
    const amount = _coerceNumber(rawAmount);

    // Need either (qty & price) or amount to form a position.
    if ((!qty || !price) && !amount) {
      rejected.push({ row: i + 2, reason: 'missing_qty_or_amount', raw: r });
      continue;
    }

    const investedAmount = (qty && price) ? qty * price : amount;
    if (!Number.isFinite(investedAmount) || investedAmount <= 0) {
      rejected.push({ row: i + 2, reason: 'invalid_amount', raw: r });
      continue;
    }

    const currency = (rawCcy && String(rawCcy).trim()) ||
      (resolved.market === 'BR' ? 'BRL' : resolved.market === 'CRYPTO' ? 'USD' : 'USD');

    positions.push({
      id: crypto.randomUUID(),
      symbol: resolved.root + (resolved.suffix || ''),
      portfolioId,
      subportfolioId: null,
      investedAmount: Number(investedAmount.toFixed(2)),
      quantity: qty ?? null,
      entryPrice: price ?? null,
      currency: String(currency).toUpperCase(),
      note: rawNote ? String(rawNote).slice(0, 200) : null,
      createdAt: now,
      source: 'csv_import',
    });
  }

  if (positions.length > 500) {
    warnings.push('truncated_to_500_positions');
    positions.length = 500;
  }

  return { positions, rejected, warnings };
}

module.exports = {
  parsePreview,
  normalise,
  detectMapping,
  // exposed for tests
  _coerceNumber,
  _detectDelimiter,
};
