/**
 * routes/vault.js — Private Knowledge Vault API endpoints.
 *
 * Endpoints:
 *  POST   /upload              — Upload and ingest a PDF
 *  GET    /documents           — List user's vault documents
 *  DELETE /documents/:id       — Delete a document and its chunks
 *  POST   /search              — Search vault (for testing / UI)
 */
const express = require('express');
const multer = require('multer');
const vault = require('../services/vault');
const logger = require('../utils/logger');

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
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
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

module.exports = router;
