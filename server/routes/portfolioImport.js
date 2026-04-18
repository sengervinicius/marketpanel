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
const csvImporter = require('../services/csvImporter');

const router = express.Router();

function _sendErr(res, status, code, message, extra) {
  return res.status(status).json({ ok: false, error: code, message, ...(extra || {}) });
}

// 5MB cap. A 5MB broker CSV is ~50k rows — well past our 500-row position cap.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const ok =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'text/plain' ||
      file.mimetype === 'application/vnd.ms-excel' ||   // Excel sometimes tags CSV this way
      file.mimetype === 'application/octet-stream' ||   // Some browsers send this
      name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt');
    if (ok) cb(null, true);
    else cb(new Error('Only CSV/TSV files are accepted for portfolio import'));
  },
});

// Express catch-all for multer errors so the client sees 400 (not a 500 crash).
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const code   = err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'bad_upload';
    return _sendErr(res, status, code, err.message || 'Upload failed');
  });
}

// Rate limit: import isn't a hot path, and commit loops should be blocked.
const importRateLimit = rateLimitByUser({ key: 'portfolio-import', windowSec: 5 * 60, max: 10 });

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

module.exports = router;
