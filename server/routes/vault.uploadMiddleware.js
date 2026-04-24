/**
 * vault.uploadMiddleware.js — #253 P3.1 extract from routes/vault.js.
 *
 * Provides the multer instance and the two middleware functions used by every
 * /vault/upload* route:
 *   - validateAndLoadFile: magic-byte MIME validation (Phase 1 security)
 *   - cleanupTempFile: delete diskStorage temp file on response finish
 *
 * The upload dir + accepted types are created once at require-time.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const logger = require('../utils/logger');
const { swallow } = require('../utils/swallow');

// ── Multer configuration: diskStorage + 10MB limit ──────────────────
// Phase 1 Security: diskStorage avoids DoS via large file uploads
// consuming server RAM.
const UPLOAD_DIR = path.join(require('os').tmpdir(), 'particle-uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { swallow(e, 'vault.upload_dir.mkdir'); }

const ACCEPTED_MIMETYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/csv',
  'text/tab-separated-values',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/tiff',
];
const ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'csv', 'tsv', 'txt', 'md', 'markdown', 'png', 'jpg', 'jpeg', 'tiff', 'tif'];

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      // Cryptographic uniqueness so concurrent uploads at high RPS can't collide.
      const unique = `${Date.now()}-${require('crypto').randomBytes(8).toString('hex')}`;
      const safeName = (file.originalname || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
      cb(null, `${unique}-${safeName}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB hard cap
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname || '').toLowerCase().split('.').pop() || '';
    const isAcceptedExt = ACCEPTED_EXTENSIONS.includes(ext);
    const isAcceptedMime = ACCEPTED_MIMETYPES.includes(file.mimetype);

    if (isAcceptedExt || isAcceptedMime) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Accepted: PDF, DOCX, CSV, TSV, TXT, MD, PNG, JPG, JPEG, TIFF'), false);
    }
  },
});

// ── MIME magic-byte validation ──────────────────────────────────────
// Phase 1 Security: After multer writes to disk, validate magic bytes
// match the claimed file type. Rejects disguised executables.
const FileType = require('file-type');

const MAGIC_BYTE_ALLOWED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/tiff',
  // Note: text files (csv, txt, md, tsv) have no magic bytes — they pass through
]);

/**
 * Middleware: validate uploaded file's magic bytes match its claimed type.
 * Reads from disk (diskStorage), validates, then loads buffer onto req.file.buffer
 * for downstream compatibility. Deletes temp file on rejection.
 */
async function validateAndLoadFile(req, res, next) {
  if (!req.file || !req.file.path) return next();

  const filePath = req.file.path;
  try {
    const buffer = fs.readFileSync(filePath);

    const detected = await FileType.fromBuffer(buffer);
    const ext = (req.file.originalname || '').toLowerCase().split('.').pop() || '';
    const isTextType = ['csv', 'tsv', 'txt', 'md', 'markdown'].includes(ext);

    if (detected) {
      if (!MAGIC_BYTE_ALLOWED.has(detected.mime)) {
        fs.unlink(filePath, () => {});
        return res.status(415).json({
          error: 'File type rejected',
          message: `File magic bytes indicate ${detected.mime}, which is not allowed. Accepted binary types: PDF, DOCX, PNG, JPG, TIFF.`,
        });
      }
      const claimedMime = req.file.mimetype;
      if (claimedMime && MAGIC_BYTE_ALLOWED.has(claimedMime) && claimedMime !== detected.mime) {
        // Special case: application/octet-stream is generic — allow it
        if (claimedMime !== 'application/octet-stream') {
          fs.unlink(filePath, () => {});
          return res.status(415).json({
            error: 'File type mismatch',
            message: `Claimed type ${claimedMime} but file content is ${detected.mime}.`,
          });
        }
      }
    } else if (!isTextType) {
      logger.warn('vault-route', 'No magic bytes detected for non-text upload', {
        filename: req.file.originalname,
        ext,
        size: buffer.length,
      });
    }

    // Attach buffer for downstream compatibility (vault.ingestFile expects buffer)
    req.file.buffer = buffer;
    next();
  } catch (err) {
    fs.unlink(filePath, () => {});
    logger.error('vault-route', 'File validation error', { error: err.message });
    return res.status(500).json({ error: 'File validation failed', message: err.message });
  }
}

/**
 * Cleanup middleware: delete temp file after request completes.
 * Runs as a response finish hook so the file is cleaned up
 * regardless of success or error.
 */
function cleanupTempFile(req, res, next) {
  if (req.file && req.file.path) {
    const filePath = req.file.path;
    res.on('finish', () => {
      fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') {
          logger.warn('vault-route', 'Failed to clean up temp file', { path: filePath, error: err.message });
        }
      });
    });
  }
  next();
}

module.exports = {
  UPLOAD_DIR,
  ACCEPTED_MIMETYPES,
  ACCEPTED_EXTENSIONS,
  MAGIC_BYTE_ALLOWED,
  upload,
  validateAndLoadFile,
  cleanupTempFile,
};
