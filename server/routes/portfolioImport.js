/**
 * routes/portfolioImport.js — W6.4 portfolio CSV import endpoints.
 *
 * Mounted at /api/portfolio/import (requireAuth).
 *
 * Two-step flow, designed to prevent trashing a user's portfolio on a
 * misinterpreted CSV:
 *
 *   POST /preview   — multipart CSV → { headers, rows[0..10], detectedMapping, delimiter, totalRows }
 *                     The client renders a mapping UI with detectedMapping prefilled.
 *
 *   POST /commit    — multipart CSV + JSON mapping + mode ('merge'|'replace')
 *                     → { added, rejected, warnings, doc }
 *                     Writes through portfolioStore.syncPortfolio().
 *
 * Design notes:
 *   - Uses multer memoryStorage with a 5MB cap. CSVs are small and we need
 *     the raw buffer to re-parse deterministically on both calls (the client
 *     re-uploads on commit so the server never has to hold state between requests).
 *   - Rate-limited per user to 10 imports / 5 min — broker exports aren't a
 *     hot path, and this blunts accidental commit loops.
 *   - Existing portfolio positions are NEVER silently overwritten. Default
 *     mode is 'merge' (append into the default 'Imported' portfolio, dedupe
 *     by symbol+investedAmount). 'replace' requires an explicit flag.
 *
 * Note on errors: this route uses res.status().json() directly rather than
 * the shared sendApiError helper, because that helper expects an Error object
 * and the (res, status, message) pattern common in other routes results in
 * HTTP 500 regardless of intended status. Direct JSON responses give the
 * client the correct HTTP status.
 */

'use strict';

const express = require('express');
const multer  = require('multer');
const logger  = require('../utils/logger');
const { rateLimitByUser } = require('../middleware/rateLimitByUser');
const { getPortfolio, syncPortfolio } = require('../portfolioStore');
const csvImporter       = require('../services/csvImporter');
const ofxImporter       = require('../services/ofxImporter');
const brokerPdfImporter = require('../services/brokerPdfImporter');

const router = express.Router();

function _sendErr(res, status, code, message, extra) {
  return res.status(status).json({ ok: false, error: code, message, ...(extra || {}) });
}

// 5MB cap for CSV/TSV/OFX, 10MB for PDF (broker statements can be image-heavy).
// We use memoryStorage because these files are small and the parser needs the
// full buffer. A 5MB broker CSV is ~50k rows — well past our 500-row cap.
function makeUploader({ maxBytes, allowedExts }) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (req, file, cb) => {
      const name = (file.originalname || '').toLowerCase();
      const ext  = name.split('.').pop();
      const ok = allowedExts.includes(ext) ||
        ['text/csv','text/plain','application/vnd.ms-excel','application/x-ofx','application/pdf','application/octet-stream']
          .includes(file.mimetype);
      if (ok) cb(null, true);
      else cb(new Error(`Unsupported file type. Accepted: ${allowedExts.join(', ')}`));
    },
  });
}

const csvUpload = makeUploader({ maxBytes: 5 * 1024 * 1024,  allowedExts: ['csv','tsv','txt'] });
const ofxUpload = makeUploader({ maxBytes: 5 * 1024 * 1024,  allowedExts: ['ofx','qfx','txt'] });
const pdfUpload = makeUploader({ maxBytes: 10 * 1024 * 1024, allowedExts: ['pdf'] });

// Express catch-all for multer errors so the client sees 400 (not a 500 crash).
function handleUploadFactory(uploader) {
  return function handleUpload(req, res, next) {
    uploader.single('file')(req, res, (err) => {
      if (!err) return next();
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const code   = err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'bad_upload';
      return _sendErr(res, status, code, err.message || 'Upload failed');
    });
  };
}
const handleUpload    = handleUploadFactory(csvUpload);
const handleOfxUpload = handleUploadFactory(ofxUpload);
const handlePdfUpload = handleUploadFactory(pdfUpload);

// Rate limit: import isn't a hot path, and commit loops should be blocked.
const importRateLimit = rateLimitByUser({ key: 'portfolio-import', windowSec: 5 * 60, max: 10 });

/**
 * GET /api/portfolio/import/schema
 * Public schema descriptor — users (and the Particle AI) can read this
 * to know what columns we accept, which are required, and which aliases
 * we auto-detect. No auth needed; this is metadata, not user data.
 */
router.get('/schema', (_req, res) => {
  res.json({ ok: true, schema: csvImporter.getImportSchema() });
});

/**
 * GET /api/portfolio/import/template
 * Downloadable CSV template pre-populated with the canonical column
 * headers and one example row. This is the P1.5 half-measure that sits
 * in for a direct brokerage (Plaid) integration — users export from
 * their broker, match it to our template, upload.
 */
router.get('/template', (_req, res) => {
  const body = csvImporter.buildTemplateCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    'attachment; filename="particle-portfolio-template.csv"');
  res.send(body);
});

/**
 * POST /api/portfolio/import/preview
 * multipart: file=<csv>
 * Returns the first 10 data rows + a header→field mapping guess so the
 * client can render a confirmation UI.
 */
router.post('/preview', importRateLimit, handleUpload, (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return _sendErr(res, 400, 'bad_request', 'CSV file required (multipart field: file)');
    }

    const result = csvImporter.parsePreview(req.file.buffer, {
      delimiter: req.body?.delimiter || undefined,
    });

    // Log at info without CSV content — just shape metadata.
    logger.info('csv-import', 'Preview parsed', {
      userId: req.user.id,
      headers: result.headers.length,
      rows: result.totalRows,
      mappedFields: Object.keys(result.detectedMapping).length,
    });

    res.json({ ok: true, ...result });
  } catch (e) {
    logger.warn('csv-import', 'Preview failed', { userId: req.user.id, error: e.message });
    if (String(e.message).startsWith('csv_parse_failed')) {
      return _sendErr(res, 400, 'csv_parse_failed', 'Could not parse CSV. Check delimiter and quoting.');
    }
    _sendErr(res, 500, 'server_error', 'Failed to preview CSV');
  }
});

/**
 * POST /api/portfolio/import/commit
 * multipart: file=<csv>, mapping=<JSON string>, mode=<'merge'|'replace'>, delimiter?, portfolioName?
 *
 * Commits the normalised positions to the authenticated user's portfolio.
 * - 'merge' (default): append to an 'Imported' portfolio (created if absent),
 *                      skip exact (symbol, investedAmount) duplicates.
 * - 'replace':         wipe all portfolios and install a fresh 'Imported' portfolio.
 *                      Explicit opt-in only — client must surface a confirm dialog.
 */
router.post('/commit', importRateLimit, handleUpload, async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return _sendErr(res, 400, 'bad_request', 'CSV file required (multipart field: file)');
    }

    let mapping;
    try {
      mapping = typeof req.body.mapping === 'string'
        ? JSON.parse(req.body.mapping)
        : (req.body.mapping || {});
    } catch (_e) {
      return _sendErr(res, 400, 'bad_request', 'mapping must be valid JSON');
    }

    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      return _sendErr(res, 400, 'bad_request', 'mapping must be an object');
    }
    if (!mapping.symbol) {
      return _sendErr(res, 400, 'bad_request', 'mapping.symbol is required');
    }

    const mode = req.body.mode === 'replace' ? 'replace' : 'merge';
    const portfolioName = (req.body.portfolioName || 'Imported').toString().slice(0, 64);

    // Normalise rows → positions
    const existing = getPortfolio(req.user.id);
    const targetPortfolioId = (() => {
      if (mode === 'replace' || !existing) return 'imported';
      const found = (existing.portfolios || []).find(p => p.name === portfolioName);
      return found ? found.id : 'imported';
    })();

    const { positions, rejected, warnings } = csvImporter.normalise(req.file.buffer, mapping, {
      delimiter: req.body.delimiter || undefined,
      portfolioId: targetPortfolioId,
    });

    if (positions.length === 0) {
      return _sendErr(res, 400, 'no_valid_positions',
        'No valid positions found. Review the mapping and try again.',
        { rejected, warnings });
    }

    // Build the new portfolio state
    let nextDoc;
    if (mode === 'replace' || !existing) {
      nextDoc = {
        version: 1,
        portfolios: [{ id: targetPortfolioId, name: portfolioName, subportfolios: [] }],
        positions,
      };
    } else {
      // Merge: dedupe by (symbol, investedAmount) pair against existing positions in target portfolio.
      const keyOf = p => `${p.symbol}|${Number(p.investedAmount).toFixed(2)}`;
      const existingKeys = new Set(
        (existing.positions || [])
          .filter(p => p.portfolioId === targetPortfolioId)
          .map(keyOf)
      );
      const deduped = positions.filter(p => !existingKeys.has(keyOf(p)));
      const skipped = positions.length - deduped.length;
      if (skipped > 0) warnings.push(`skipped_${skipped}_duplicate_positions`);

      const portfolios = [...(existing.portfolios || [])];
      if (!portfolios.some(p => p.id === targetPortfolioId)) {
        portfolios.push({ id: targetPortfolioId, name: portfolioName, subportfolios: [] });
      }

      nextDoc = {
        version: existing.version || 1,
        portfolios,
        positions: [...(existing.positions || []), ...deduped],
      };

      // Enforce 500-position hard cap before writing
      if (nextDoc.positions.length > 500) {
        return _sendErr(res, 400, 'too_many_positions',
          `Merge would exceed 500-position limit (current: ${existing.positions.length}, incoming: ${deduped.length}). Delete positions or use replace mode.`,
          { rejected, warnings });
      }
    }

    const doc = await syncPortfolio(req.user.id, nextDoc);

    logger.info('csv-import', 'Commit succeeded', {
      userId: req.user.id,
      mode,
      added: positions.length,
      rejected: rejected.length,
      totalPositions: doc.positions.length,
    });

    res.json({
      ok: true,
      added: positions.length,
      rejected,
      warnings,
      totalPositions: doc.positions.length,
    });
  } catch (e) {
    logger.error('csv-import', 'Commit failed', { userId: req.user.id, error: e.message });
    _sendErr(res, 500, 'server_error', 'Failed to commit CSV import');
  }
});

// ── OFX + PDF parsers (W6.6) ────────────────────────────────────────────────
// These endpoints share the commit pipeline indirectly: they produce the same
// `positions[]` shape as csvImporter.normalise(), so the client flow is:
//   1. POST /ofx/parse  or  /pdf/parse  → { positions, warnings, ... }
//   2. Client renders a confirm dialog showing the parsed positions.
//   3. Client calls POST /api/portfolio/sync  with the user-approved set.
//
// We deliberately do NOT add a /commit endpoint that auto-merges OFX/PDF
// output — parser output is less trustworthy than CSV with an explicit
// mapping, so we force the user through a separate confirm-and-sync UI.
//
// If the broker PDF template isn't recognised, the endpoint returns
// { unknownTemplate: true } so the UI can direct the user back to CSV.

function _commitIntoPortfolio(userId, positions, { mode = 'merge', portfolioName = 'Imported' } = {}) {
  const existing = getPortfolio(userId);
  const targetId = (() => {
    if (mode === 'replace' || !existing) return 'imported';
    const found = (existing.portfolios || []).find(p => p.name === portfolioName);
    return found ? found.id : 'imported';
  })();

  const stamped = positions.map(p => ({ ...p, portfolioId: targetId }));

  if (mode === 'replace' || !existing) {
    return syncPortfolio(userId, {
      version: 1,
      portfolios: [{ id: targetId, name: portfolioName, subportfolios: [] }],
      positions: stamped,
    });
  }
  const keyOf = p => `${p.symbol}|${Number(p.investedAmount).toFixed(2)}`;
  const existingKeys = new Set(
    (existing.positions || []).filter(p => p.portfolioId === targetId).map(keyOf)
  );
  const deduped = stamped.filter(p => !existingKeys.has(keyOf(p)));
  const portfolios = [...(existing.portfolios || [])];
  if (!portfolios.some(p => p.id === targetId)) {
    portfolios.push({ id: targetId, name: portfolioName, subportfolios: [] });
  }
  return syncPortfolio(userId, {
    version: existing.version || 1,
    portfolios,
    positions: [...(existing.positions || []), ...deduped],
  });
}

router.post('/ofx/parse', importRateLimit, handleOfxUpload, (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return _sendErr(res, 400, 'bad_request', 'OFX file required (multipart field: file)');
    }
    const result = ofxImporter.parse(req.file.buffer, { portfolioId: 'imported' });
    logger.info('ofx-import', 'Parsed', {
      userId: req.user.id,
      positions: result.positions.length,
      rejected: result.rejected.length,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.warn('ofx-import', 'Parse failed', { userId: req.user.id, error: e.message });
    const msg = String(e.message || '').startsWith('ofx_parse_failed') ? 'Not a valid OFX file' : 'OFX parse failed';
    _sendErr(res, 400, 'ofx_parse_failed', msg);
  }
});

router.post('/ofx/commit', importRateLimit, handleOfxUpload, async (req, res) => {
  try {
    if (!req.file?.buffer) return _sendErr(res, 400, 'bad_request', 'OFX file required');
    const mode = req.body.mode === 'replace' ? 'replace' : 'merge';
    const portfolioName = (req.body.portfolioName || 'Imported').toString().slice(0, 64);
    const parsed = ofxImporter.parse(req.file.buffer, { portfolioId: 'imported' });
    if (parsed.positions.length === 0) {
      return _sendErr(res, 400, 'no_valid_positions',
        'OFX file parsed but contained no supported positions.',
        { rejected: parsed.rejected, warnings: parsed.warnings });
    }
    const doc = await _commitIntoPortfolio(req.user.id, parsed.positions, { mode, portfolioName });
    res.json({
      ok: true,
      added: parsed.positions.length,
      rejected: parsed.rejected,
      warnings: parsed.warnings,
      totalPositions: doc.positions.length,
    });
  } catch (e) {
    logger.error('ofx-import', 'Commit failed', { userId: req.user.id, error: e.message });
    _sendErr(res, 500, 'server_error', 'Failed to commit OFX import');
  }
});

router.post('/pdf/parse', importRateLimit, handlePdfUpload, async (req, res) => {
  try {
    if (!req.file?.buffer) return _sendErr(res, 400, 'bad_request', 'PDF file required');
    const result = await brokerPdfImporter.parse(req.file.buffer, { portfolioId: 'imported' });
    logger.info('pdf-import', 'Parsed', {
      userId: req.user.id,
      template: result.template || 'unknown',
      positions: result.positions.length,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.warn('pdf-import', 'Parse failed', { userId: req.user.id, error: e.message });
    if (e.message === 'pdf_parse_not_installed') {
      return _sendErr(res, 501, 'pdf_parse_unavailable',
        'PDF parsing is not available on this deployment.');
    }
    _sendErr(res, 400, 'pdf_parse_failed', 'Could not parse PDF');
  }
});

router.post('/pdf/commit', importRateLimit, handlePdfUpload, async (req, res) => {
  try {
    if (!req.file?.buffer) return _sendErr(res, 400, 'bad_request', 'PDF file required');
    const mode = req.body.mode === 'replace' ? 'replace' : 'merge';
    const portfolioName = (req.body.portfolioName || 'Imported').toString().slice(0, 64);
    const parsed = await brokerPdfImporter.parse(req.file.buffer, { portfolioId: 'imported' });
    if (parsed.unknownTemplate) {
      return _sendErr(res, 400, 'unknown_template',
        'We don\'t recognise this broker\'s PDF format yet. Please use CSV import or contact support.',
        { supportedTemplates: parsed.supportedTemplates });
    }
    if (parsed.positions.length === 0) {
      return _sendErr(res, 400, 'no_valid_positions',
        'PDF matched a broker template but we couldn\'t extract any positions.',
        { rejected: parsed.rejected, warnings: parsed.warnings });
    }
    const doc = await _commitIntoPortfolio(req.user.id, parsed.positions, { mode, portfolioName });
    res.json({
      ok: true,
      added: parsed.positions.length,
      rejected: parsed.rejected,
      warnings: parsed.warnings,
      template: parsed.template,
      totalPositions: doc.positions.length,
    });
  } catch (e) {
    logger.error('pdf-import', 'Commit failed', { userId: req.user.id, error: e.message });
    _sendErr(res, 500, 'server_error', 'Failed to commit PDF import');
  }
});

module.exports = router;
