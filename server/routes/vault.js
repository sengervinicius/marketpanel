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
const vault = require('../services/vault');
const logger = require('../utils/logger');
const { swallow } = require('../utils/swallow');
const { requireAuth, requireAdmin } = require('../authMiddleware');
const { getTier, isUnlimited } = require('../config/tiers');
const { rateLimitByUser } = require('../middleware/rateLimitByUser');
const { perMinuteLimit } = require('../middleware/rateLimitByIP');
const featureFlags = require('../services/featureFlags'); // W6.1 kill switch

// #253 P3.1 — multer config + MIME-magic-byte validation extracted to keep
// this router file focused on route handlers.
const {
  upload,
  validateAndLoadFile,
  cleanupTempFile,
} = require('./vault.uploadMiddleware');

const pg = require('../db/postgres');

// Audit §6.7-6.8 / M4 — doc-scoped Q&A now rides the same model-routing +
// injection-hardening rails as the main chat path instead of a hard-coded
// OpenAI call.
const modelRouter = require('../services/modelRouter');
const { sanitizeQuery } = require('./search.helpers');

// Audit §6 remainder — vault-wide answer synthesis rides the SAME AI quota
// gates as the flagship chat path (routes/search.js /ai and /chat):
// dailyAILimit (query-count) + aiQuotaGate (token budget). Whichever is
// stricter wins. Groundedness post-check results land in vault_query_log.
const { dailyAILimit } = require('../middleware/dailyAILimit');
const { aiQuotaGate } = require('../middleware/aiQuotaGate');
const vaultQueryLog = require('../services/vaultQueryLog');

const router = express.Router();

// W6.1 — vault kill switch. Admin endpoints + /health are exempt so on-call
// can always introspect while the feature is disabled for end users.
router.use(async (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/admin/')) return next();
  try {
    const ctx = req.user ? { userId: req.user.id, tier: req.user.tier, email: req.user.email } : {};
    const on = await featureFlags.isOn('vault_enabled', ctx);
    if (!on) {
      return res.status(503).json({
        error: 'vault_disabled',
        message: 'Vault is temporarily unavailable. Please check status.particle.xyz.',
      });
    }
    return next();
  } catch {
    return res.status(503).json({ error: 'vault_disabled' });
  }
});

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
    } catch (e) { swallow(e, 'vault.health.pgvector_probe'); }
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
    } catch (e) { swallow(e, 'vault.health.column_probe'); }
    try {
      const countResult = await pg.query(`SELECT COUNT(*) as total, COUNT(embedding) as with_embedding FROM vault_chunks`);
      chunkCount = parseInt(countResult.rows[0]?.total || 0);
      embeddingCount = parseInt(countResult.rows[0]?.with_embedding || 0);
    } catch (e) { swallow(e, 'vault.health.count_probe'); }
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
    const [documents, emailIngest] = await Promise.all([
      vault.getUserDocuments(req.user.id),
      // wave-nov Phase Z — INBOX status line on the Vault page.
      vault.getEmailIngestStats(req.user.id),
    ]);
    res.json({ documents, emailIngest });
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
router.post('/search', rateLimitByUser({ key: 'vault-search', windowSec: 60, max: 15 }), async (req, res) => {
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
 *
 * Wire format (backward compatible with pre-unification clients):
 *   data: {"vaultSources": [...]}   — NEW citation metadata event, same shape
 *                                     the main chat path emits. Old clients
 *                                     JSON.parse it, find no `content`, skip.
 *   data: {"content": "..."}        — completion text chunks (unchanged)
 *   data: {"partial": true, ...}    — stream-interrupted marker (from
 *                                     modelRouter; old clients ignore it)
 *   data: [DONE]                    — terminator (unchanged)
 */

// Doc-scoped Q&A output cap. Was 500 pre-unification; ~1000 leaves room for
// multi-passage answers with [Vn] citations without inviting essays.
const DOC_ASK_MAX_TOKENS = 1000;

/**
 * Wrap the real Express response so modelRouter.streamResponse's normalized
 * `data: {"chunk": "..."}` events go out on the wire as the historical
 * `data: {"content": "..."}` events this endpoint has always emitted (old
 * client bundles depend on `content` during rolling deploy). Everything
 * else — vaultSources, partial markers, [DONE], comments — passes through
 * untouched, as do headersSent/writableEnded/end/status/json used by
 * streamResponse's error paths.
 */
function makeDocAskSSEAdapter(res) {
  return {
    get headersSent() { return res.headersSent; },
    get writableEnded() { return res.writableEnded; },
    writeHead: (...args) => res.writeHead(...args),
    setHeader: (...args) => res.setHeader(...args),
    flush: (...args) => (typeof res.flush === 'function' ? res.flush(...args) : undefined),
    status: (...args) => res.status(...args),
    json: (...args) => res.json(...args),
    end: (...args) => res.end(...args),
    on: (...args) => res.on(...args),
    write: (data) => {
      const str = String(data);
      if (str.startsWith('data: ')) {
        const payload = str.slice(6).trim();
        if (payload && payload !== '[DONE]') {
          try {
            const parsed = JSON.parse(payload);
            if (parsed && typeof parsed.chunk === 'string') {
              return res.write(`data: ${JSON.stringify({ content: parsed.chunk })}\n\n`);
            }
          } catch (_) { /* non-JSON control line — pass through as-is */ }
        }
      }
      return res.write(data);
    },
  };
}

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

    // W1.3 — same prompt-injection delimiter scrub the main chat path
    // applies to every user query (routes/search.helpers.sanitizeQuery).
    const cleanQuestion = sanitizeQuery(question.trim());
    if (!cleanQuestion) {
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
    const passages = await vault.retrieveFromDocument(documentId, req.user.id, cleanQuestion, 5);

    if (passages.length === 0) {
      return res.status(400).json({ error: 'No relevant passages found in this document' });
    }

    // Unified prompt assembly: the SAME [Vn]/page-cited formatter +
    // untrusted-data envelope the main vault RAG path uses
    // (vault.formatForPrompt → vaultSecurity.wrapAsUntrustedData). Replaces
    // the old raw "[Passage N]" dump that shipped document text to the model
    // with no injection hardening and no page citations.
    const vaultContext = vault.formatForPrompt(passages);

    // Citation metadata — same shape agentOrchestrator.vaultAgent builds for
    // the main chat path's `data: {"vaultSources": [...]}` event.
    const vaultSources = passages.map(p => ({
      filename: p.filename || 'Unknown',
      source: p.doc_metadata?.bank || p.source || '',
      tickers: p.doc_metadata?.tickers || [],
      date: p.doc_metadata?.date || '',
      pageNumber: p.page_number || null,
      similarity: p.similarity != null ? parseFloat(p.similarity).toFixed(2) : null,
      isGlobal: p.is_global || false,
    }));

    // Model per router policy: doc-scoped Q&A is a quick factual lookup →
    // Haiku-class (ROUTE_MAP.quick_factual). No more hard-coded gpt-4o-mini.
    const provider = modelRouter.route('quick_factual');
    if (!process.env[provider.keyEnv]) {
      return res.status(503).json({ error: 'AI service not configured' });
    }

    const systemPrompt =
      `You are answering questions about a specific document: "${doc.filename}". ` +
      'Use ONLY the evidence passages provided to answer. If the answer is not ' +
      'in the passages, say so clearly. Be concise and cite the passages you ' +
      'reference using [V1], [V2], ... markers matching the evidence order, ' +
      'including page numbers where shown.';

    const messages = [{
      role: 'user',
      content: `${cleanQuestion}\n${vaultContext}`,
    }];

    // SSE headers + citation event BEFORE the model stream, mirroring the
    // main chat path (routes/search.js emits vaultSources ahead of chunks).
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ vaultSources })}\n\n`);

    logger.info('vault-route', 'Document Q&A initiated', {
      userId: req.user.id,
      documentId,
      model: provider.model,
      questionLength: cleanQuestion.length,
      passagesCount: passages.length,
    });

    // Stream through the shared router path: retry/backoff, cost-ledger
    // accounting, client-disconnect abort and partial-event error handling —
    // all identical to the main chat stream. The adapter rewrites
    // `{chunk}` → `{content}` on the wire for old clients.
    await modelRouter.streamResponse(provider, messages, systemPrompt, makeDocAskSSEAdapter(res), {
      onAbort: (abortFn) => { req.on('close', abortFn); },
      userId: req.user.id,
      maxTokens: DOC_ASK_MAX_TOKENS,
    });
  } catch (err) {
    logger.error('vault-route', 'Document Q&A error', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process question' });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: 'Failed to process question: ' + err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

// ── Audit §6 remainder: Vault-wide answer synthesis ───────────────────────

// Same output cap as doc-scoped Q&A: room for a multi-passage synthesized
// answer with [Vn] citations without inviting essays.
const ASK_ALL_MAX_TOKENS = 1000;
// Wider net than /search's 5 — the synthesizer benefits from more evidence.
const ASK_ALL_RETRIEVAL_LIMIT = 8;

/**
 * Extract [Vn] citation markers from a finished answer and verify each n
 * maps to a passage that was actually sent to the model. Matches both bare
 * markers ("[V2]") and page-suffixed ones ("[V1, p.12]").
 *
 * @param {string} answerText   - Full streamed answer.
 * @param {number} passageCount - Number of passages passed in the prompt.
 * @returns {{ citationsValid: number, citationsTotal: number }}
 */
function checkCitationGroundedness(answerText, passageCount) {
  const markers = [...String(answerText || '').matchAll(/\[V(\d+)[^\]]*\]/g)];
  let citationsValid = 0;
  for (const m of markers) {
    const n = parseInt(m[1], 10);
    if (Number.isInteger(n) && n >= 1 && n <= passageCount) citationsValid++;
  }
  return { citationsValid, citationsTotal: markers.length };
}

/**
 * POST /ask-all — AI-synthesized answer over the user's ENTIRE vault.
 * Body: { query: string }
 *
 * The Vault page's semantic search calls this alongside POST /search: the
 * passages render immediately, and this stream fills a synthesized answer
 * above them. Same modelRouter rails, untrusted-data envelope and [Vn]/page
 * citation formatting as /documents/:id/ask — the only differences are the
 * retrieval scope (vault-wide vault.retrieve, 8 passages) and a groundedness
 * post-check logged to vault_query_log after streaming completes.
 *
 * Wire format (superset of the doc-ask contract; unknown events are ignored
 * by old clients):
 *   data: {"type":"no_context"}      — nothing relevant in the vault; ends
 *                                      the stream immediately.
 *   data: {"vaultSources": [...]}    — citation metadata, main-chat shape,
 *                                      emitted BEFORE the completion.
 *   data: {"content": "..."}         — completion text chunks (legacy key,
 *                                      rewritten from the router's {chunk}).
 *   data: {"type":"answer_complete","citationsValid":n,"citationsTotal":m}
 *                                    — groundedness post-check, emitted after
 *                                      the last chunk.
 *   data: [DONE]                     — terminator.
 *
 * Rate limit: same family as /search (vault-search is 15/min) but stricter —
 * 10/min — because every call is an LLM completion. dailyAILimit +
 * aiQuotaGate are the same gates the flagship /api/search/chat path mounts.
 */
router.post('/ask-all',
  requireAuth,
  rateLimitByUser({ key: 'vault-ask-all', windowSec: 60, max: 10 }),
  dailyAILimit,
  aiQuotaGate,
  async (req, res) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({ error: 'query is required' });
      }

      // W1.3 — same prompt-injection delimiter scrub as doc-ask / main chat.
      const cleanQuery = sanitizeQuery(query.trim());
      if (!cleanQuery) {
        return res.status(400).json({ error: 'query is required' });
      }

      const passages = await vault.retrieve(req.user.id, cleanQuery, ASK_ALL_RETRIEVAL_LIMIT);

      const sseHeaders = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      };

      if (!passages || passages.length === 0) {
        // Nothing relevant — tell the client so it can show a quiet
        // "nothing relevant in your vault" line instead of an empty answer.
        res.writeHead(200, sseHeaders);
        res.write(`data: ${JSON.stringify({ type: 'no_context' })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      // Model per router policy — same Haiku-class lane as doc-ask.
      const provider = modelRouter.route('quick_factual');
      if (!process.env[provider.keyEnv]) {
        return res.status(503).json({ error: 'AI service not configured' });
      }

      // Unified prompt assembly: the SAME [Vn]/page-cited formatter +
      // untrusted-data envelope as doc-ask and the main vault RAG path
      // (vault.formatForPrompt → vaultSecurity.wrapAsUntrustedData).
      const vaultContext = vault.formatForPrompt(passages);

      // Citation metadata — same backward-compatible shape as doc-ask /
      // agentOrchestrator.vaultAgent (`data: {"vaultSources": [...]}`).
      const vaultSources = passages.map(p => ({
        filename: p.filename || 'Unknown',
        source: p.doc_metadata?.bank || p.source || '',
        tickers: p.doc_metadata?.tickers || [],
        date: p.doc_metadata?.date || '',
        pageNumber: p.page_number || null,
        similarity: p.similarity != null ? parseFloat(p.similarity).toFixed(2) : null,
        isGlobal: p.is_global || false,
      }));

      const systemPrompt =
        'You are synthesizing an answer from the user\'s private research vault. ' +
        'The evidence passages come from multiple documents they uploaded. ' +
        'Use ONLY the evidence passages provided to answer. If the answer is not ' +
        'in the passages, say so clearly. Be concise and cite the passages you ' +
        'reference using [V1], [V2], ... markers matching the evidence order, ' +
        'including page numbers where shown (e.g. [V2, p.14]). When naming a ' +
        'source in prose, use its document filename.';

      const messages = [{
        role: 'user',
        content: `${cleanQuery}\n${vaultContext}`,
      }];

      // SSE headers + citation event BEFORE the model stream (doc-ask order).
      res.writeHead(200, sseHeaders);
      res.write(`data: ${JSON.stringify({ vaultSources })}\n\n`);

      logger.info('vault-route', 'Vault-wide Q&A initiated', {
        userId: req.user.id,
        model: provider.model,
        queryLength: cleanQuery.length,
        passagesCount: passages.length,
      });

      // Stream through the shared router path (retry/backoff, cost ledger,
      // disconnect abort, partial-event errors). The doc-ask adapter rewrites
      // `{chunk}` → `{content}` on the wire for old clients. onComplete runs
      // synchronously inside the router's finish() BEFORE it writes [DONE],
      // so the groundedness event lands between the last chunk and [DONE].
      await modelRouter.streamResponse(provider, messages, systemPrompt, makeDocAskSSEAdapter(res), {
        onAbort: (abortFn) => { req.on('close', abortFn); },
        userId: req.user.id,
        maxTokens: ASK_ALL_MAX_TOKENS,
        onComplete: (fullAnswer) => {
          // Cheap groundedness post-check: every [Vn] in the answer must map
          // to a passage we actually sent. Emitted to the client and logged
          // to the vault_query_log row retrieve() wrote for this query.
          const grounded = checkCitationGroundedness(fullAnswer, passages.length);
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'answer_complete', ...grounded })}\n\n`);
          }
          logger.info('vault-route', 'Vault-wide answer groundedness', {
            userId: req.user.id,
            citationsValid: grounded.citationsValid,
            citationsTotal: grounded.citationsTotal,
            passagesCount: passages.length,
            answerLength: (fullAnswer || '').length,
          });
          // Fire-and-forget by contract (recordGroundedness never throws).
          Promise.resolve(
            vaultQueryLog.recordGroundedness({
              userId: req.user.id,
              query: cleanQuery,
              citationsValid: grounded.citationsValid,
              citationsTotal: grounded.citationsTotal,
            })
          ).catch(() => {});
        },
      });
    } catch (err) {
      logger.error('vault-route', 'Vault-wide Q&A error', { error: err.message });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process query' });
      } else if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: 'Failed to process query: ' + err.message })}\n\n`);
        res.write('data: [DONE]\n\n');
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
