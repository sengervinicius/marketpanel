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
 *
 * Admin endpoints (Central Vault):
 *  POST   /admin/upload        — Upload to central vault (admin only)
 *  GET    /admin/documents     — List central vault documents
 *  DELETE /admin/documents/:id — Delete from central vault
 */
const express = require('express');
const multer = require('multer');
const vault = require('../services/vault');
const logger = require('../utils/logger');
const { requireAdmin } = require('../authMiddleware');
const { getTier, isUnlimited } = require('../config/tiers');

const router = express.Router();

// Multer for PDF upload (10MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'), false);
    }
  },
});

/**
 * POST /upload — Upload and ingest a PDF into the vault.
 * Enforces per-tier document limits before allowing the upload.
 */
router.post('/upload', upload.single('file'), async (req, res) => {
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

    const result = await vault.ingestPDF(req.user.id, req.file.buffer, req.file.originalname);

    logger.info('vault-route', 'PDF uploaded', {
      userId: req.user.id,
      filename: req.file.originalname,
    });

    res.json(result);
  } catch (err) {
    logger.error('vault-route', 'Upload error', { error: err.message });
    res.status(500).json({ error: 'Failed to process document' });
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

// ── Central Vault (Admin-only) ────────────────────────────────────────────

/**
 * POST /admin/upload — Upload a PDF to the central vault (all users benefit).
 * Requires admin role.
 */
router.post('/admin/upload', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const result = await vault.ingestPDF(req.user.id, req.file.buffer, req.file.originalname, { isGlobal: true });

    logger.info('vault-route', 'Central vault PDF uploaded', {
      userId: req.user.id,
      filename: req.file.originalname,
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

module.exports = router;
