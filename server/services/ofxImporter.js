/**
 * services/ofxImporter.js — W6.6 OFX portfolio import (seed).
 *
 * OFX (Open Financial Exchange) is the de-facto interop format shipped by
 * most US brokers (Fidelity, Schwab, E*Trade) and some European ones. The
 * spec spans OFX 1.x (SGML, no closing tags) and 2.x (XML, well-formed).
 *
 * Rather than ship a full SGML/XML parser, we exploit two properties:
 *
 *   1. Both 1.x and 2.x use the same tag names — only the closing discipline
 *      differs.
 *   2. The values we need — UNITS, UNITPRICE, MKTVAL, TICKER, CURDEF — are
 *      always scalar text, so "capture everything up to the next `<` or
 *      newline" works for both flavours.
 *
 * We therefore do NOT normalise SGML to XML (that was error-prone — closing
 * tags around already-closed XML tags corrupted valid input). We simply scan
 * for <TAG>value sequences.
 *
 * Supported: POSSTOCK (equity). Other security types (POSMF, POSOPT, POSDEBT,
 * POSOTHER) are counted as rejected with reason 'unsupported_security_type'
 * so the user is told rather than silently dropped.
 *
 * Output: { positions, rejected, warnings, currency }
 *   positions[] matches the csvImporter.normalise schema so the downstream
 *   commit path is unified.
 */

'use strict';

const crypto = require('node:crypto');
const ticker = require('./tickerResolver');

// Match <TAG>...up to next `<` or newline.
// Case-insensitive because brokers mix cases in practice.
function _extract(tag, block) {
  const re = new RegExp(`<${tag}>\\s*([^<\\n\\r]+)`, 'i');
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

function _coerceNumber(s) {
  if (s == null || s === '') return null;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Split the document into position windows. Each window starts at a <POSxxx>
 * marker and ends at the next <POSxxx> marker OR at </INVPOSLIST>.
 * Returns an array of { kind, text }.
 */
function _positionWindows(text) {
  const markerRe = /<(POSSTOCK|POSMF|POSOPT|POSDEBT|POSOTHER)>/gi;
  const indices = [];
  let m;
  while ((m = markerRe.exec(text))) indices.push({ kind: m[1].toUpperCase(), at: m.index, openLen: m[0].length });
  if (!indices.length) return [];

  // End boundary: next marker, or the next </INVPOSLIST> / end of text.
  const result = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].at + indices[i].openLen;
    let end;
    if (i + 1 < indices.length) {
      end = indices[i + 1].at;
    } else {
      const closeMatch = /<\/INVPOSLIST>/i.exec(text.slice(start));
      end = closeMatch ? start + closeMatch.index : text.length;
    }
    result.push({ kind: indices[i].kind, text: text.slice(start, end) });
  }
  return result;
}

/**
 * Parse an OFX document (string or Buffer) into { positions, rejected, warnings }.
 * portfolioId is attached to every resulting position.
 */
function parse(input, opts = {}) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const portfolioId = opts.portfolioId || 'imported';
  const positions = [];
  const rejected  = [];
  const warnings  = [];
  const now = new Date().toISOString();

  if (!/<OFX/i.test(text)) {
    throw new Error('ofx_parse_failed: not an OFX document');
  }

  const currency = (_extract('CURDEF', text) || 'USD').toUpperCase();

  const windows = _positionWindows(text);

  const hasInvPosList = /<INVPOSLIST>/i.test(text);
  if (windows.length === 0) {
    warnings.push(hasInvPosList ? 'ofx_invposlist_empty' : 'ofx_had_no_invposlist');
    return { positions, rejected, warnings, currency };
  }

  for (const w of windows) {
    if (w.kind !== 'POSSTOCK') {
      rejected.push({ kind: w.kind, reason: 'unsupported_security_type' });
      continue;
    }

    const tickerRaw = _extract('TICKER', w.text) || _extract('UNIQUEID', w.text);
    const qty       = _coerceNumber(_extract('UNITS', w.text));
    const price     = _coerceNumber(_extract('UNITPRICE', w.text));
    const mktval    = _coerceNumber(_extract('MKTVAL', w.text));

    if (!tickerRaw) { rejected.push({ kind: w.kind, reason: 'missing_ticker' }); continue; }
    const resolved = ticker.resolve(tickerRaw);
    if (!resolved) { rejected.push({ kind: w.kind, reason: 'unrecognised_symbol', raw: tickerRaw }); continue; }

    const invested = (qty != null && price != null && qty > 0 && price > 0)
      ? qty * price
      : mktval;
    if (!invested || invested <= 0) {
      rejected.push({ kind: w.kind, reason: 'invalid_amount', raw: tickerRaw });
      continue;
    }

    positions.push({
      id: crypto.randomUUID(),
      symbol: resolved.root + (resolved.suffix || ''),
      portfolioId,
      subportfolioId: null,
      investedAmount: Number(invested.toFixed(2)),
      quantity: qty ?? null,
      entryPrice: price ?? null,
      currency,
      note: null,
      createdAt: now,
      source: 'ofx_import',
    });
  }

  if (positions.length === 0 && windows.length > 0) {
    warnings.push('ofx_had_holdings_but_none_mapped');
  }
  if (positions.length > 500) {
    warnings.push('truncated_to_500_positions');
    positions.length = 500;
  }
  return { positions, rejected, warnings, currency };
}

module.exports = { parse, _extract, _coerceNumber, _positionWindows };
