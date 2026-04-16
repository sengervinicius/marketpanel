/**
 * routes/vault.js — Knowledge Vault API endpoints.
 *
 * Two tiers:
 *   Private: per-user vault (all authenticated users)
 *   Central: admin-only global vault that feeds ALL users' Particle responses
 *
 * Endpoints:
 *  POST   /upload              — Upload and ingest a PDF (private)
 *  GET    /documents           — List user's private vault documents
 *  DELETE /documents/:id       — Delete a document and its chunks
 *  POST   /search              — Search vault (for testing / UI)
 *  GET    /sector-insights     — Get vault insights for a sector (for UI cards)
 *
 * Admin endpoints (Central Vault):
 *  POST   /admin/upload        — Upload to central vault (admin only)
 *  GET    /admin/documents     — List central vault documents
 *  DELETE /admin/documents/:id — Delete from central vault
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const vault = require('../services/vault');
const logger = require('../utils/logger');
const { requireAuth, requireAdmin } = require('../authMiddleware');
const { getTier, isUnlimited } = require('../config/tiers');
const { rateLimitByUser } = require('../middleware/rateLimitByUser');
const { perMinuteLimit } = require('../middleware/rateLimitByIP');

const pg = require('../db/postgres');

const router = express.Router();

/**
 * GET /health — Vault health check (no auth required for basic status).
 * Returns database connection status and capabilities.
 */
router.get('/health', requireAuth, async (req, res) => {
  const diag = pg.getDiagnostics();

  // Check pgvector availability + embedding column type
  let pgvectorAvailable = false;
  let embeddingColumnType = 'unknown';
  let chunkCount = 0;
  let embeddingCount = 0;
  if (diag.connected) {
    try {
      const extResult = await pg.query(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
      pgvectorAvailable = extResult.rows.length > 0;
    } catch {}
    try {
      const colResult = await pg.query(`
        SELECT data_type, udt_name FROM information_schema.columns
        WHERE table_name = 'vault_chunks' AND column_name = 'embedding'
      `);
      if (colResult.rows.length > 0) {
        embeddingColumnType = colResult.rows[0].udt_name || colResult.rows[0].data_type;
      } else {
        embeddingColumnType = 'missing';
      }
    } catch {}
    try {
      const countResult = await pg.query(`SELECT COUNT(*) as total, COUNT(embedding) as with_embedding FROM vault_chunks`);
      chunkCount = parseInt(countResult.rows[0]?.total || 0);
      embeddingCount = parseInt(countResult.rows[0]?.with_embedding || 0);
    } catch {}
  }

  const status = {
    database: diag.connected ? 'connected' : diag.urlSet ? 'disconnected' : 'not_configured',
    embeddings: !!process.env.VOYAGE_API_KEY || !!process.env.OPENAI_API_KEY,
    embeddingProvider: process.env.VOYAGE_API_KEY ? 'voyage' : process.env.OPENAI_API_KEY ? 'openai' : 'none',
    schemaReady: diag.schemaReady,
    reconnecting: diag.reconnecting,
    pgvector: pgvectorAvailable,
    embeddingColumnType,
    chunkCount,
    embeddingCount,
  };
  const healthy = status.database === 'connected' && status.schemaReady;
  res.status(healthy ? 200 : 503).json({ ok: healthy, ...status });
});

// ── Multer configuration: diskStorage + 10MB limit ──────────────────
// Phase 1 Security: Replaced memoryStorage with diskStorage to prevent
// DoS via large file uploads consuming server RAM.
const UPLOAD_DIR = path.join(require('os').tmpdir(), 'particle-uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}

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
      // Unique filename to prevent collisions: timestamp-random-originalname
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const safeName = (file.originalname || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
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

// Map detected MIME types to our accepted set
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
    // Read file from disk into buffer
    const buffer = fs.readFileSync(filePath);

    // Magic-byte detection
    const detected = await FileType.fromBuffer(buffer);
    const ext = (req.file.originalname || '').toLowerCase().split('.').pop() || '';
    const isTextType = ['csv', 'tsv', 'txt', 'md', 'markdown'].includes(ext);

    if (detected) {
      // Binary file detected — check if it's in our allowed set
      if (!MAGIC_BYTE_ALLOWED.has(detected.mime)) {
        // Reject: magic bytes don't match any allowed binary type
        fs.unlink(filePath, () => {}); // clean up temp file
        return res.status(415).json({
          error: 'File type rejected',
          message: `File magic bytes indicate ${detected.mime}, which is not allowed. Accepted binary types: PDF, DOCX, PNG, JPG, TIFF.`,
        });
      }
      // Verify consistency: if user claims PDF but magic says PNG, reject
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
      // No magic bytes detected and not a text extension — suspicious
      // Allow it but log a warning (could be an empty file or unknown text format)
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
    // Clean up temp file on any error
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

/**
 * POST /upload — Upload and ingest a document into the vault.
 * Supports: PDF, DOCX, CSV, TSV, TXT, MD
 * Enforces per-tier document limits before allowing the upload.
 * Rate limited to 10 uploads per minute per user.
 */
router.post('/upload', perMinuteLimit, rateLimitByUser({ key: 'vault-upload', windowSec: 60, max: 10 }), upload.single('file'), validateAndLoadFile, cleanupTempFile, async (req, res) => {
  logger.info('vault-route', 'Upload request received', {
    userId: req.user?.id,
    hasFile: !!req.file,
    filename: req.file?.originalname,
    size: req.file?.size,
  });
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // ── Vault quota enforcement ──────────────────────────────────
    const userTier = req.user.planTier || 'trial';
    const tier = getTier(userTier);
    if (!isUnlimited(tier.vaultDocuments)) {
      const docs = await vault.getUserDocuments(req.user.id);
      if (docs.length >= tier.vaultDocuments) {
        return res.status(403).json({
          error: 'Vault limit reached',
          code: 'vault_limit',
          message: `Your ${tier.label} plan allows up to ${tier.vaultDocuments} documents. Upgrade to upload more.`,
          currentCount: docs.length,
          limit: tier.vaultDocuments,
          tier: userTier,
        });
      }
    }

    // Phase 6: Accept optional docType from request body (multipart form field)
    const docType = req.body?.docType || null;
    const metadata = docType ? { docType } : {};

    const result = await vault.ingestFile(req.user.id, req.file.buffer, req.file.originalname, metadata);

    logger.info('vault-route', 'Document uploaded', {
      userId: req.user.id,
      filename: req.file.originalname,
      fileType: result.fileType,
      detectedType: result.detectedType,
      requestedDocType: docType,
    });

    res.json(result);
  } catch (err) {
    logger.error('vault-route', 'Upload error', { error: err.message, stack: err.stack?.slice(0, 300) });
    // Return a more descriptive error so the client can show what went wrong
    const msg = err.message || 'Unknown error';
    if (msg.includes('not connected') || msg.includes('ECONNREFUSED') || msg.includes('Connection terminated') || msg.includes('timeout')) {
      return res.status(503).json({ error: 'Database unavailable', code: 'db_unavailable', message: 'Vault database is reconnecting. Please wait a moment and try again.' });
    }
    if (msg.includes('no extractable text') || msg.includes('no text')) {
      return res.status(400).json({ error: 'Unreadable file', message: 'This file contains no extractable text. Please try a different file.' });
    }
    if (msg.includes('Unsupported file type')) {
      return res.status(400).json({ error: 'File type not supported', message: msg });
    }
    if (msg.includes('too large') || msg.includes('exceeds')) {
      return res.status(400).json({ error: 'File too large', message: msg });
    }
    // Include the actual error in the response so we can diagnose — sanitize only credentials/secrets
    const safeMsg = msg.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/key[=:]\s*\S+/gi, 'key=[REDACTED]');
    res.status(500).json({ error: 'Failed to process document', message: safeMsg });
  }
});

/**
 * POST /upload-stream — SSE-based upload with progress events.
 * Phase 3: Sends progress updates during ingestion:
 *   "Extracting text..." → "Chunking (34 passages)..." → "Generating embeddings..." → "Ready to chat"
 */
router.post('/upload-stream', perMinuteLimit, rateLimitByUser({ key: 'vault-upload', windowSec: 60, max: 10 }), upload.single('file'), validateAndLoadFile, cleanupTempFile, async (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const sendEvent = (stage, message) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ stage, message })}\n\n`);
    }
  };

  try {
    if (!req.file) {
      sendEvent('error', 'No file provided');
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Quota enforcement
    const userTier = req.user.planTier || 'trial';
    const tier = getTier(userTier);
    if (!isUnlimited(tier.vaultDocuments)) {
      const docs = await vault.getUserDocuments(req.user.id);
      if (docs.length >= tier.vaultDocuments) {
        sendEvent('error', `Your ${tier.label} plan allows up to ${tier.vaultDocuments} documents. Upgrade to upload more.`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
    }

    sendEvent('extract', `Extracting text from ${req.file.originalname}...`);

    const result = await vault.ingestFile(
      req.user.id,
      req.file.buffer,
      req.file.originalname,
      {},
      false,
      (stage, message) => sendEvent(stage, message) // onProgress callback
    );

    sendEvent('complete', JSON.stringify(result));
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    logger.error('vault-route', 'Stream upload error', { error: err.message });
    const msg = err.message || 'Unknown error';
    if (msg.includes('not connected') || msg.includes('ECONNREFUSED')) {
      sendEvent('error', 'Knowledge Vault is initializing. Please try again in a moment.');
    } else if (msg.includes('no extractable text') || msg.includes('Unable to read')) {
      sendEvent('error', msg);
    } else {
      sendEvent('error', 'An error occurred while processing the file. Please try again.');
    }
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

/**
 * POST /upload-async — Phase 6: Background upload with job queue.
 * Returns immediately with a jobId. Client polls GET /jobs/:jobId for status.
 * Accepts optional 'docType' field to override auto-detection.
 * Rate limited: 10 uploads per minute per user.
 */
router.post('/upload-async', perMinuteLimit, rateLimitByUser({ key: 'vault-upload', windowSec: 60, max: 10 }), upload.single('file'), validateAndLoadFile, cleanupTempFile, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Quota enforcement
    const userTier = req.user.planTier || 'trial';
    const tier = getTier(userTier);
    if (!isUnlimited(tier.vaultDocuments)) {
      const docs = await vault.getUserDocuments(req.user.id);
      if (docs.length >= tier.vaultDocuments) {
        return res.status(403).json({
          error: 'Vault limit reached',
          code: 'vault_limit',
          message: `Your ${tier.label} plan allows up to ${tier.vaultDocuments} documents. Upgrade to upload more.`,
          currentCount: docs.length,
          limit: tier.vaultDocuments,
          tier: userTier,
        });
      }
    }

    const docType = req.body?.docType || null; // Phase 6: user-selected document type
    const metadata = docType ? { docType } : {};
    const isGlobal = false;

    // Create job and enqueue for background processing
    const job = vault.createIngestionJob(req.user.id, req.file.originalname);
    vault.enqueueIngestionJob(job, req.file.buffer, metadata, isGlobal);

    logger.info('vault-route', 'Async upload enqueued', {
      userId: req.user.id,
      jobId: job.jobId,
      filename: req.file.originalname,
      docType,
    });

    res.json({ jobId: job.jobId, status: 'queued', filename: req.file.originalname });
  } catch (err) {
    logger.error('vault-route', 'Async upload error', { error: err.message });
    res.status(500).json({ error: 'Failed to enqueue upload', message: err.message });
  }
});

/**
 * GET /jobs/:jobId — Phase 6: Poll ingestion job status.
 * Returns: { jobId, status, progress, result }
 */
router.get('/jobs/:jobId', async (req, res) => {
  const job = vault.getIngestionJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  // Security: only allow the job owner to check status
  if (job.userId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    result: job.status === 'complete' || job.status === 'error' ? job.result : null,
  });
});

/**
 * GET /jobs — Phase 6: List user's recent ingestion jobs.
 */
router.get('/jobs', async (req, res) => {
  const jobs = vault.getUserJobs(req.user.id);
  res.json(jobs.map(j => ({
    jobId: j.jobId,
    filename: j.filename,
    status: j.status,
    progress: j.progress,
    createdAt: j.createdAt,
  })));
});

/**
 * POST /ingest-url — Ingest a document from a URL.
 * Body: { url: string, title?: string }
 * Supports: HTML pages, PDF URLs, plain text URLs
 * Rate limited: 5 requests per minute per user (URL fetching is expensive)
 */
router.post('/ingest-url', rateLimitByUser({ key: 'vault-ingest-url', windowSec: 60, max: 5 }), async (req, res) => {
  try {
    const { url, title } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required and must be a string' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // ── Vault quota enforcement ──────────────────────────────────
    const userTier = req.user.planTier || 'trial';
    const tier = getTier(userTier);
    if (!isUnlimited(tier.vaultDocuments)) {
      const docs = await vault.getUserDocuments(req.user.id);
      if (docs.length >= tier.vaultDocuments) {
        return res.status(403).json({
          error: 'Vault limit reached',
          code: 'vault_limit',
          message: `Your ${tier.label} plan allows up to ${tier.vaultDocuments} documents. Upgrade to ingest more.`,
          currentCount: docs.length,
          limit: tier.vaultDocuments,
          tier: userTier,
        });
      }
    }

    const result = await vault.ingestFromUrl(url, req.user.id, title);

    logger.info('vault-route', 'URL ingested', {
      userId: req.user.id,
      url,
      title,
      documentId: result.documentId,
    });

    res.json(result);
  } catch (err) {
    logger.error('vault-route', 'URL ingest error', { error: err.message, url: req.body?.url });
    const msg = err.message || 'Unknown error';
    if (msg.includes('Invalid URL') || msg.includes('ERR_INVALID')) {
      return res.status(400).json({ error: 'Invalid URL', message: 'Please provide a valid HTTP or HTTPS URL' });
    }
    if (msg.includes('HTTP') || msg.includes('timeout')) {
      return res.status(400).json({ error: 'Could not fetch URL', message: msg });
    }
    if (msg.includes('exceeds') || msg.includes('too large')) {
      return res.status(400).json({ error: 'Content too large', message: msg });
    }
    if (msg.includes('no extractable text') || msg.includes('no text') || msg.includes('empty content')) {
      return res.status(400).json({ error: 'No content found', message: 'The URL returned empty or unreadable content' });
    }
    res.status(500).json({ error: 'Failed to ingest URL', message: 'An error occurred while processing the URL. Please try a different URL or try again later.' });
  }
});

/**
 * GET /documents — List user's vault documents with chunk counts.
 */
router.get('/documents', async (req, res) => {
  try {
    const documents = await vault.getUserDocuments(req.user.id);
    res.json({ documents });
  } catch (err) {
    logger.error('vault-route', 'Error fetching documents', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

/**
 * DELETE /documents/:id — Delete a document from the vault.
 */
router.delete('/documents/:id', async (req, res) => {
  try {
    const documentId = parseInt(req.params.id, 10);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    await vault.deleteDocument(req.user.id, documentId);

    logger.info('vault-route', 'Document deleted', {
      userId: req.user.id,
      documentId,
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('vault-route', 'Delete error', { error: err.message });
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * GET /quota — Return the user's vault usage vs tier limits.
 */
router.get('/quota', async (req, res) => {
  try {
    const userTier = req.user.planTier || 'trial';
    const tier = getTier(userTier);
    const docs = await vault.getUserDocuments(req.user.id);
    res.json({
      tier: userTier,
      tierLabel: tier.label,
      documents: {
        used: docs.length,
        limit: tier.vaultDocuments,
        unlimited: isUnlimited(tier.vaultDocuments),
      },
      aiQueriesPerDay: tier.aiQueriesPerDay,
      deepAnalysisPerDay: tier.deepAnalysisPerDay,
      morningBrief: tier.morningBrief,
    });
  } catch (err) {
    logger.error('vault-route', 'Quota error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch quota' });
  }
});

/**
 * POST /search — Search the vault (for testing / frontend search UI).
 * Body: { query: string }
 */
router.post('/search', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'query is required' });
    }

    const passages = await vault.retrieve(req.user.id, query, 5);

    logger.info('vault-route', 'Vault search executed', {
      userId: req.user.id,
      queryLength: query.length,
      resultsCount: passages.length,
    });

    res.json({ passages });
  } catch (err) {
    logger.error('vault-route', 'Search error', { error: err.message });
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /sector-insights — Get vault insights for a specific sector.
 * Query params:
 *   sector (required): energy, crypto, brazil, macro, defense, tech, healthcare, finance
 *   limit (optional): number of passages to return (default: 3)
 *
 * Searches the vault (both private and global) with a sector-specific query string.
 * Returns formatted passages with source metadata.
 */
router.get('/sector-insights', requireAuth, async (req, res) => {
  try {
    const { sector, limit = 3 } = req.query;

    if (!sector || typeof sector !== 'string') {
      return res.status(400).json({ error: 'sector query param is required' });
    }

    const sectorQueries = {
      energy: 'energy oil gas renewable solar wind coal nuclear',
      crypto: 'cryptocurrency bitcoin ethereum blockchain digital assets crypto',
      brazil: 'brazil emerging markets latin america PETR VALE',
      macro: 'macroeconomic inflation interest rates GDP currency',
      defense: 'defense aerospace military contracts security',
      tech: 'technology software artificial intelligence AI cloud computing',
      healthcare: 'healthcare pharma biotech medicine health',
      finance: 'financial services banking investment capital markets',
      commodities: 'commodities metals agriculture copper gold wheat oil',
      retail: 'retail consumer discretionary e-commerce luxury shopping',
      'fixed-income': 'bonds fixed income treasury yields credit spreads',
      asia: 'asia japan china india korea ASEAN emerging markets',
      europe: 'europe germany france UK italy spain DAX CAC FTSE',
      fx: 'currency forex FX foreign exchange rates forex trading',
    };

    const query = sectorQueries[sector.toLowerCase()];
    if (!query) {
      return res.status(400).json({
        error: 'Invalid sector',
        validSectors: Object.keys(sectorQueries),
      });
    }

    const limitNum = Math.min(parseInt(limit, 10) || 3, 10); // Cap at 10
    const passages = await vault.retrieve(req.user.id, query, limitNum);

    logger.info('vault-route', 'Sector insights retrieved', {
      userId: req.user.id,
      sector,
      resultsCount: passages.length,
    });

    // Format passages with metadata for frontend
    const formatted = passages.map(p => ({
      content: p.content,
      filename: p.filename,
      bank: p.doc_metadata?.bank || null,
      date: p.doc_metadata?.date || null,
      tickers: p.doc_metadata?.tickers || [],
      isGlobal: p.is_global,
      similarity: p.similarity || null,
    }));

    res.json({ sector, passages: formatted });
  } catch (err) {
    logger.error('vault-route', 'Sector insights error', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve sector insights' });
  }
});

// ── Central Vault (Admin-only) ────────────────────────────────────────────

/**
 * POST /admin/upload — Upload a document to the central vault (all users benefit).
 * Supports: PDF, DOCX, CSV, TSV, TXT, MD
 * Requires admin role.
 * Rate limited to 10 uploads per minute per admin user.
 */
router.post('/admin/upload', requireAdmin, perMinuteLimit, rateLimitByUser({ key: 'vault-upload-admin', windowSec: 60, max: 10 }), upload.single('file'), validateAndLoadFile, cleanupTempFile, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const result = await vault.ingestFile(req.user.id, req.file.buffer, req.file.originalname, {}, true);

    logger.info('vault-route', 'Central vault document uploaded', {
      userId: req.user.id,
      filename: req.file.originalname,
      fileType: result.fileType,
      detectedType: result.detectedType,
      global: true,
    });

    res.json({ ...result, global: true });
  } catch (err) {
    logger.error('vault-route', 'Admin upload error', { error: err.message });
    res.status(500).json({ error: 'Failed to process document' });
  }
});

/**
 * GET /admin/documents — List central vault documents.
 */
router.get('/admin/documents', requireAdmin, async (req, res) => {
  try {
    const documents = await vault.getGlobalDocuments();
    res.json({ documents });
  } catch (err) {
    logger.error('vault-route', 'Error fetching global documents', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

/**
 * DELETE /admin/documents/:id — Delete a document from the central vault.
 */
router.delete('/admin/documents/:id', requireAdmin, async (req, res) => {
  try {
    const documentId = parseInt(req.params.id, 10);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    // For admin delete, we bypass the user ownership check
    // since admin manages global docs. Use userId from the doc itself.
    const pg = require('../db/postgres');
    const doc = await pg.query(
      `SELECT user_id FROM vault_documents WHERE id = $1 AND is_global = TRUE`,
      [documentId]
    );

    if (!doc.rows || doc.rows.length === 0) {
      return res.status(404).json({ error: 'Global document not found' });
    }

    await vault.deleteDocument(doc.rows[0].user_id, documentId);

    logger.info('vault-route', 'Central vault document deleted', {
      adminId: req.user.id,
      documentId,
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('vault-route', 'Admin delete error', { error: err.message });
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// ── T3.3: Document Q&A Mode ────────────────────────────────────────────────

/**
 * POST /documents/:id/ask — Ask a question scoped to a specific document.
 * Body: { question: string }
 * Streams response back as server-sent events.
 */
router.post('/documents/:id/ask', requireAuth, async (req, res) => {
  try {
    const documentId = parseInt(req.params.id, 10);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const { question } = req.body;
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }

    // Get document metadata and verify ownership
    const docResult = await pg.query(
      `SELECT user_id, is_global, filename, metadata FROM vault_documents WHERE id = $1`,
      [documentId]
    );
    if (!docResult.rows || docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const doc = docResult.rows[0];
    if (doc.user_id !== req.user.id && !doc.is_global) {
      return res.status(403).json({ error: 'You do not have access to this document' });
    }

    // Retrieve passages from this document only
    const passages = await vault.retrieveFromDocument(documentId, req.user.id, question, 5);

    if (passages.length === 0) {
      return res.status(400).json({ error: 'No relevant passages found in this document' });
    }

    // Format passages for prompt
    const passageText = passages
      .map((p, i) => `[Passage ${i + 1}]: ${p.content}`)
      .join('\n\n');

    // Stream response using OpenAI API
    const fetch = require('node-fetch');
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'AI service not configured' });
    }

    // Set up AbortController and attach cleanup BEFORE fetch
    const controller = new AbortController();
    req.on('close', () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
      res.end();
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `You are answering questions about a specific document: "${doc.filename}". Use ONLY the provided passages to answer. If the answer is not in the passages, say so clearly. Be concise and cite which passages you're referencing.`,
        }, {
          role: 'user',
          content: `${question}\n\nRelevant passages from the document:\n\n${passageText}`,
        }],
        max_tokens: 500,
        temperature: 0.3,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error('vault-route', 'OpenAI API error', { status: response.status });
      return res.status(502).json({ error: 'AI service error' });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream chunks from OpenAI
    const { Readable } = require('stream');
    let buffer = '';

    response.body.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
          } else {
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    });

    response.body.on('end', () => {
      if (buffer.startsWith('data: ')) {
        res.write(buffer + '\n\n');
      }
      res.end();
    });

    response.body.on('error', (err) => {
      logger.error('vault-route', 'Stream error', { error: err.message });
      if (!res.headersSent) {
        res.status(502).json({ error: 'Stream error from AI service' });
      } else {
        res.write(`data: ${JSON.stringify({ error: 'Stream error: ' + err.message })}\n\n`);
        res.end();
      }
    });

    logger.info('vault-route', 'Document Q&A initiated', {
      userId: req.user.id,
      documentId,
      questionLength: question.length,
      passagesCount: passages.length,
    });
  } catch (err) {
    logger.error('vault-route', 'Document Q&A error', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process question' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Failed to process question: ' + err.message })}\n\n`);
      res.end();
    }
  }
});

/**
 * GET /documents/:id/summary — Get or generate a document summary.
 */
router.get('/documents/:id/summary', requireAuth, async (req, res) => {
  try {
    const documentId = parseInt(req.params.id, 10);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const summary = await vault.getDocumentSummary(documentId, req.user.id);

    if (!summary) {
      return res.status(503).json({ error: 'Summary generation unavailable' });
    }

    logger.info('vault-route', 'Document summary retrieved', {
      userId: req.user.id,
      documentId,
    });

    res.json({ summary });
  } catch (err) {
    if (err.message === 'Unauthorized') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (err.message === 'Document not found') {
      return res.status(404).json({ error: 'Document not found' });
    }
    logger.error('vault-route', 'Summary error', { error: err.message });
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

// ── T3.4: Central Vault Research Feed ─────────────────────────────────────

/**
 * GET /feed — Get recent global vault documents (research feed).
 */
router.get('/feed', requireAuth, async (req, res) => {
  try {
    const result = await pg.query(
      `SELECT id, filename, metadata, created_at FROM vault_documents
       WHERE is_global = TRUE
       ORDER BY created_at DESC
       LIMIT 20`
    );

    const documents = (result.rows || []).map(doc => {
      const meta = doc.metadata || {};
      return {
        id: doc.id,
        filename: doc.filename,
        bank: meta.bank || null,
        date: meta.date || null,
        tickers: Array.isArray(meta.tickers) ? meta.tickers : (meta.tickers ? [meta.tickers] : []),
        sector: meta.sector || null,
        docType: meta.docType || null,
        summary: meta.summary || null,
        createdAt: doc.created_at,
      };
    });

    logger.info('vault-route', 'Research feed retrieved', {
      userId: req.user.id,
      count: documents.length,
    });

    res.json({ documents });
  } catch (err) {
    logger.error('vault-route', 'Feed error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch research feed' });
  }
});

module.exports = router;
