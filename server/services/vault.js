/**
 * vault.js — Knowledge Vault for Particle.
 *
 * Two vault tiers:
 *   1. Private vault: per-user document store (reports, notes, PDFs)
 *   2. Central vault: admin-only global store fed by Vinicius with professional
 *      research that enriches ALL users' Particle responses.
 *
 * PDFs are parsed, chunked, embedded, and stored in Postgres with pgvector
 * for semantic search. When a user asks a question, relevant passages from
 * both their private vault AND the central vault are retrieved and injected
 * into the AI prompt as grounded context.
 */
const crypto = require('crypto');
const pg = require('../db/postgres');
const logger = require('../utils/logger');
const { swallow } = require('../utils/swallow');
const mammoth = require('mammoth');
const Papa = require('papaparse');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const vaultSecurity = require('./vaultSecurity');
const vaultQueryLog = require('./vaultQueryLog');
const vaultQueryCache = require('./vaultQueryCache');

// OCR support — lazy load tesseract.js to gracefully degrade if unavailable
let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch (e) {
  logger.warn('vault', 'tesseract.js not installed — OCR support will be disabled', { error: e.message });
}

// ── Constants ──
const CHUNK_SIZE = 1000; // chars per chunk — larger for financial context retention
const CHUNK_OVERLAP = 150; // overlap between chunks — preserves cross-boundary context
const MAX_RETRIEVAL = 8; // top candidates before similarity filtering
const MIN_SIMILARITY = 0.55; // Phase 2 AI: raised from 0.3 — only genuinely relevant passages should surface
const MIN_PASSAGES_THRESHOLD = 2; // Phase 6: if fewer than this meet threshold, return 0 (avoid confusing context)
const EMBEDDING_MODEL = 'text-embedding-3-small';
const VOYAGE_EMBEDDING_DIM = 1024;
const OPENAI_EMBEDDING_DIM = 1536;
const STORED_EMBEDDING_DIM = 1536; // vault_chunks.embedding column is vector(1536)

let _openaiKey = null;
let _voyageKey = null;
let _cohereKey = null;
let _anthropicKey = null;
let _embeddingDim = OPENAI_EMBEDDING_DIM;
let _activeEmbeddingProvider = 'openai';

// ── Phase 6: In-memory ingestion job queue ──────────────────────────────────
// Jobs are keyed by a unique jobId. Status flows: queued → processing → complete | error
const _ingestionJobs = new Map();
const MAX_CONCURRENT_JOBS = 2;
let _activeJobCount = 0;

function createIngestionJob(userId, filename) {
  const jobId = `job_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    jobId,
    userId,
    filename,
    status: 'queued',    // queued | processing | complete | error
    progress: null,      // { stage, message }
    result: null,        // final result or error message
    createdAt: Date.now(),
  };
  _ingestionJobs.set(jobId, job);
  // Cleanup old jobs (>1 hour) on every creation
  const cutoff = Date.now() - 3600_000;
  for (const [id, j] of _ingestionJobs) {
    if (j.createdAt < cutoff) _ingestionJobs.delete(id);
  }
  return job;
}

function getIngestionJob(jobId) {
  return _ingestionJobs.get(jobId) || null;
}

function getUserJobs(userId) {
  return [..._ingestionJobs.values()]
    .filter(j => j.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
}

/**
 * Process an ingestion job in the background using setImmediate.
 * The HTTP handler returns immediately with the jobId; the client polls for status.
 */
function enqueueIngestionJob(job, buffer, metadata, isGlobal) {
  // Phase 3: Store buffer/metadata on job so drainJobQueue can process deferred jobs
  job._buffer = buffer;
  job._metadata = metadata;
  job._isGlobal = isGlobal;

  if (_activeJobCount < MAX_CONCURRENT_JOBS) {
    _startJob(job);
  }
  // else: drainJobQueue() will pick it up when a slot opens
}

function _startJob(job) {
  _activeJobCount++;
  job.status = 'processing';
  job.progress = { stage: 'extract', message: `Extracting text from ${job.filename}...` };

  setImmediate(async () => {
    try {
      const result = await ingestFile(
        job.userId, job._buffer, job.filename, job._metadata, job._isGlobal,
        (stage, message) => { job.progress = { stage, message }; }
      );
      job.status = 'complete';
      job.result = result;
    } catch (err) {
      job.status = 'error';
      job.result = { error: err.message };
      logger.error('vault', 'Background ingestion failed', { jobId: job.jobId, error: err.message });
    } finally {
      // Free buffer memory after processing
      job._buffer = null;
      _activeJobCount--;
      // Process next queued job if any
      drainJobQueue();
    }
  });
}

function drainJobQueue() {
  // Phase 3: Actually process queued jobs now that buffers are stored on the job
  while (_activeJobCount < MAX_CONCURRENT_JOBS) {
    let nextJob = null;
    for (const j of _ingestionJobs.values()) {
      if (j.status === 'queued' && j._buffer) {
        nextJob = j;
        break;
      }
    }
    if (!nextJob) break;
    _startJob(nextJob);
  }
}

/**
 * Initialize the vault service with API keys.
 * Priority: Voyage AI (finance-optimized) > OpenAI (fallback)
 * Cohere reranking is optional and used post-retrieval if available.
 */
function init({ openaiKey, voyageKey, cohereKey, anthropicKey } = {}) {
  _voyageKey = voyageKey || process.env.VOYAGE_API_KEY;
  _openaiKey = openaiKey || process.env.OPENAI_API_KEY;
  _cohereKey = cohereKey || process.env.COHERE_API_KEY;
  _anthropicKey = anthropicKey || process.env.ANTHROPIC_API_KEY;

  if (_voyageKey) {
    _activeEmbeddingProvider = 'voyage';
    _embeddingDim = VOYAGE_EMBEDDING_DIM;
    logger.info('vault', 'Initialized with Voyage AI embeddings (finance-optimized, 1024d)');
  } else if (_openaiKey) {
    _activeEmbeddingProvider = 'openai';
    _embeddingDim = OPENAI_EMBEDDING_DIM;
    logger.info('vault', 'Initialized with OpenAI embeddings (1536d)');
  } else {
    logger.warn('vault', 'No embedding API keys set — embeddings will be disabled');
  }

  if (_cohereKey) {
    logger.info('vault', 'Cohere reranking enabled');
  } else {
    logger.info('vault', 'Cohere API key not set — reranking will be skipped');
  }

  if (_anthropicKey) {
    logger.info('vault', 'Anthropic key set — Haiku reranking fallback enabled');
  }
}

/**
 * Create vault tables if they don't exist.
 * Uses try/catch to gracefully degrade if pgvector extension is unavailable.
 */
async function ensureTable() {
  if (!pg.isConnected()) {
    // Attempt lazy reconnect before giving up
    try { await pg.query('SELECT 1'); } catch (e) { swallow(e, 'vault.lazy_reconnect.ensureSchema'); }
    if (!pg.isConnected()) {
      logger.warn('vault', 'Postgres not connected — skipping table creation (will retry on reconnect)');
      return;
    }
  }

  try {
    // Create vector extension if available
    try {
      await pg.query('CREATE EXTENSION IF NOT EXISTS vector');
      logger.info('vault', 'pgvector extension enabled');
    } catch (e) {
      logger.warn('vault', 'pgvector extension not available — semantic search will be disabled', {
        error: e.message,
      });
    }

    // Create vault_documents table
    await pg.query(`
      CREATE TABLE IF NOT EXISTS vault_documents (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        source TEXT DEFAULT 'upload',
        is_global BOOLEAN NOT NULL DEFAULT FALSE,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Idempotent migrations — add any missing columns from older schema versions
    const alterSafe = async (sql) => {
      try { await pg.query(sql); } catch (e) { /* column exists or not supported */ }
    };
    // vault_documents columns that may be missing from old init.sql
    await alterSafe(`ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS filename TEXT NOT NULL DEFAULT 'untitled.pdf'`);
    await alterSafe(`ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'upload'`);
    await alterSafe(`ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE`);
    await alterSafe(`ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`);
    await alterSafe(`ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64) DEFAULT NULL`);
    // vault_chunks columns that may be missing
    await alterSafe(`ALTER TABLE vault_chunks ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL DEFAULT 0`);
    await alterSafe(`ALTER TABLE vault_chunks ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`);

    // Embedding column — init.sql creates the table without it (no pgvector dep).
    // Try vector(1536) first (pgvector); fall back to TEXT (store JSON array).
    const hasEmbedding = await pg.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vault_chunks' AND column_name = 'embedding'
    `);
    if (hasEmbedding.rows.length === 0) {
      // Column doesn't exist — add it
      try {
        await pg.query(`ALTER TABLE vault_chunks ADD COLUMN embedding vector(1536)`);
        logger.info('vault', 'Added embedding column as vector(1536)');
      } catch (vecErr) {
        // pgvector not available — use TEXT to store JSON array
        await pg.query(`ALTER TABLE vault_chunks ADD COLUMN embedding TEXT`);
        logger.warn('vault', 'Added embedding column as TEXT (pgvector not available)', { error: vecErr.message });
      }
    }

    // BM25 full-text search column (generated, auto-maintained by Postgres)
    await alterSafe(`ALTER TABLE vault_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`);
    // Embedding provider tracking — which model generated each chunk's embedding
    await alterSafe(`ALTER TABLE vault_chunks ADD COLUMN IF NOT EXISTS embedding_provider VARCHAR(20) DEFAULT 'unknown'`);
    // Phase 3: Page number for PDF page-level citations
    await alterSafe(`ALTER TABLE vault_chunks ADD COLUMN IF NOT EXISTS page_number INTEGER`);

    // Phase 3: Index for page-level citation queries
    await pg.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_chunks_page ON vault_chunks(document_id, page_number)
    `);

    // Create index on user_id for faster queries
    await pg.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_documents_user ON vault_documents(user_id)
    `);
    // Index for global vault queries
    await pg.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_documents_global ON vault_documents(is_global) WHERE is_global = TRUE
    `);
    // Unique index on (user_id, content_hash) to prevent duplicate ingestion
    try {
      await pg.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_documents_user_hash ON vault_documents(user_id, content_hash)
        WHERE content_hash IS NOT NULL
      `);
      logger.info('vault', 'Unique (user_id, content_hash) index created for duplicate detection');
    } catch (e) {
      logger.warn('vault', 'Could not create unique hash index', { error: e.message });
    }

    // Create vault_chunks table (with optional vector column)
    await pg.query(`
      CREATE TABLE IF NOT EXISTS vault_chunks (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES vault_documents(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding vector(1536),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Create indices
    await pg.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_chunks_user ON vault_chunks(user_id)
    `);
    await pg.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_chunks_document ON vault_chunks(document_id)
    `);

    // Try to create HNSW vector index (better scale than IVFFLAT: no training needed,
    // better recall, handles growing datasets without re-indexing)
    try {
      // Drop old IVFFLAT index if it exists, replace with HNSW
      await pg.query(`DROP INDEX IF EXISTS idx_vault_chunks_embedding`);
      await pg.query(`
        CREATE INDEX IF NOT EXISTS idx_vault_chunks_embedding_hnsw
        ON vault_chunks USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);
      logger.info('vault', 'HNSW vector index created for semantic search');
    } catch (e) {
      logger.warn('vault', 'Could not create HNSW index — trying IVFFLAT fallback', {
        error: e.message,
      });
      // Fallback to IVFFLAT for older pgvector versions
      try {
        await pg.query(`
          CREATE INDEX IF NOT EXISTS idx_vault_chunks_embedding
          ON vault_chunks USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = 100)
        `);
        logger.info('vault', 'IVFFLAT vector index created (HNSW not available)');
      } catch (e2) {
        logger.warn('vault', 'Could not create any vector index — semantic search degraded', {
          error: e2.message,
        });
      }
    }

    // GIN index for BM25 full-text search
    try {
      await pg.query(`CREATE INDEX IF NOT EXISTS idx_vault_chunks_fts ON vault_chunks USING gin(search_vector)`);
      logger.info('vault', 'GIN full-text search index created');
    } catch (e) {
      logger.warn('vault', 'Could not create GIN FTS index', { error: e.message });
    }

    logger.info('vault', 'Tables ensured successfully');

    // Diagnostic: check for mixed-provider documents after migration
    try {
      const mixed = await getMixedProviderDocuments();
      if (mixed.length > 0) {
        logger.warn('vault', `Found ${mixed.length} documents with mixed embedding providers`, {
          documents: mixed.map(d => ({ id: d.document_id, filename: d.filename, providers: d.providers })),
        });
      } else {
        logger.info('vault', 'No mixed-provider documents found');
      }
    } catch (diagErr) {
      logger.debug('vault', 'Mixed provider diagnostic skipped', { error: diagErr.message });
    }
  } catch (err) {
    logger.error('vault', 'Table creation error', { error: err.message });
    throw err;
  }
}

/**
 * Detect document type based on content and filename.
 * Returns one of: 'earnings_transcript', 'research_report', 'financial_table', or 'default'
 */
function detectDocumentType(text, filename = '') {
  const lower = text.toLowerCase();
  const filenameExt = (filename || '').toLowerCase();

  // Earnings transcript: typical phrases and speaker patterns
  if (
    lower.includes('operator') ||
    lower.includes('q&a') ||
    lower.includes('question and answer') ||
    /^[A-Z\s]+-[A-Z]:/m.test(text) ||
    /\b(Q:|A:|Unidentified:|Analyst:|Operator:)/m.test(text)
  ) {
    return 'earnings_transcript';
  }

  // Research report: analyst insights, price targets, ratings
  if (
    lower.includes('price target') ||
    lower.includes('rating') ||
    lower.includes('analyst') ||
    lower.includes('recommendation') ||
    lower.includes('valuation') ||
    lower.includes('initiated coverage') ||
    filenameExt.includes('report') ||
    filenameExt.includes('research')
  ) {
    return 'research_report';
  }

  // Macro commentary: central bank minutes, economic outlook, policy briefs
  if (
    lower.includes('fomc') ||
    lower.includes('copom') ||
    lower.includes('monetary policy') ||
    lower.includes('interest rate decision') ||
    lower.includes('central bank') ||
    lower.includes('inflation outlook') ||
    lower.includes('gdp growth') ||
    lower.includes('economic outlook') ||
    filenameExt.includes('macro') ||
    filenameExt.includes('minutes') ||
    filenameExt.includes('outlook')
  ) {
    return 'macro_commentary';
  }

  // SEC / CVM filing: 10-K, 10-Q, 8-K, prospectuses, ITR forms
  if (
    lower.includes('10-k') ||
    lower.includes('10-q') ||
    lower.includes('8-k') ||
    lower.includes('form 20-f') ||
    lower.includes('securities and exchange commission') ||
    lower.includes('comissão de valores mobiliários') ||
    lower.includes('item 1.') ||
    filenameExt.includes('filing') ||
    filenameExt.includes('10k') ||
    filenameExt.includes('10q') ||
    filenameExt.includes('prospectus')
  ) {
    return 'filing';
  }

  // Financial table: high density of numbers and tabular structure
  const numberDensity = (text.match(/\d+[.,]\d+|[\d,]+(?:\.\d{1,2})?/g) || []).length / (text.split('\n').length + 1);
  if (numberDensity > 2 || filenameExt.includes('table') || filenameExt.includes('data')) {
    // Additional heuristic: check for aligned columns (multiple spaces or tabs)
    const hasColumns = /\t|\s{4,}/.test(text);
    if (hasColumns || numberDensity > 3) {
      return 'financial_table';
    }
  }

  return 'default';
}

/**
 * Chunk earnings transcript by speaker turns.
 * Preserves speaker labels and conversation structure.
 */
function chunkEarningsTranscript(text, chunkSize = CHUNK_SIZE) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const chunks = [];
  let currentChunk = '';
  let currentSpeaker = '';

  for (const line of lines) {
    // Detect speaker changes: "Name - Title:" or "Q:" / "A:"
    const speakerMatch = line.match(/^(.+?)\s*[-:]\s*(.*)$/);
    const isSpeakerLine = speakerMatch && (speakerMatch[1].match(/^[A-Z][a-z]+ [A-Z]/));

    if (isSpeakerLine && currentChunk.length > 200) {
      // Flush current chunk when speaker changes and we have enough content
      chunks.push(currentChunk.trim());
      currentChunk = speakerMatch[1] + ' ' + line;
      currentSpeaker = speakerMatch[1];
    } else {
      if ((currentChunk + '\n' + line).length > chunkSize && currentChunk.length > 100) {
        chunks.push(currentChunk.trim());
        // Add speaker context to next chunk
        currentChunk = (currentSpeaker ? `[${currentSpeaker}] ` : '') + line;
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
    }
  }

  if (currentChunk.trim().length > 50) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Chunk research report using parent-child hierarchy.
 * Large sections (context) paired with smaller chunks (retrieval).
 * Stores parent_chunk_id in metadata for reference.
 */
function chunkResearchReport(text, contextSize = 2000, chunkSize = 800) {
  // Split by section headers (# or ##)
  const sections = text.split(/^#{1,2}\s+/m).filter(s => s.trim().length > 0);
  const chunks = [];
  let globalChunkId = 0;

  for (const section of sections) {
    const parentChunk = section.slice(0, contextSize).trim();
    globalChunkId++;
    const parentId = globalChunkId;

    // Split section into smaller chunks
    const sectionLines = section.split('\n').filter(l => l.trim().length > 0);
    let subChunk = '';

    for (const line of sectionLines) {
      if ((subChunk + '\n' + line).length > chunkSize && subChunk.length > 200) {
        chunks.push({
          content: subChunk.trim(),
          parentChunkId: parentId,
          parentContext: parentChunk,
        });
        globalChunkId++;
        subChunk = line;
      } else {
        subChunk += (subChunk ? '\n' : '') + line;
      }
    }

    if (subChunk.trim().length > 50) {
      chunks.push({
        content: subChunk.trim(),
        parentChunkId: parentId,
        parentContext: parentChunk,
      });
      globalChunkId++;
    }
  }

  return chunks.length > 0 ? chunks : [{ content: text, parentChunkId: null }];
}

/**
 * Chunk financial table: convert to row-per-chunk format with headers.
 * Preserves tabular structure by prepending headers to each row.
 */
function chunkFinancialTable(text) {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    return [text];
  }

  const chunks = [];
  const headerLine = lines[0];
  const dataStart = 1;

  // Group rows into chunks (e.g., 5-10 rows per chunk)
  const rowsPerChunk = Math.max(5, Math.floor(1000 / Math.max(1, headerLine.length)));

  for (let i = dataStart; i < lines.length; i += rowsPerChunk) {
    const rowsSlice = lines.slice(i, Math.min(i + rowsPerChunk, lines.length));
    const chunk = [headerLine, ...rowsSlice].join('\n');
    if (chunk.trim().length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Chunk macro commentary (FOMC/COPOM minutes, economic outlooks).
 * Splits by section headings (typically numbered or titled), preserves full paragraphs.
 * Each chunk gets a parentContext summary from the document header.
 */
function chunkMacroCommentary(text, chunkSize = CHUNK_SIZE) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [];

  // Extract header context (first ~300 chars typically contain date/institution)
  const headerContext = text.slice(0, 300).replace(/\n+/g, ' ').trim();

  // Split on section-like headings: "1.", "I.", "Section:", all-caps lines, etc.
  const sectionPattern = /^(?:\d+\.\s|[IVXLC]+\.\s|#{1,3}\s|[A-Z][A-Z\s]{8,}$)/;
  const sections = [];
  let currentSection = '';
  let currentHeading = '';

  for (const line of lines) {
    if (sectionPattern.test(line) && currentSection.length > 50) {
      sections.push({ heading: currentHeading, content: currentSection.trim() });
      currentHeading = line;
      currentSection = line + '\n';
    } else {
      if (!currentHeading && sectionPattern.test(line)) currentHeading = line;
      currentSection += line + '\n';
    }
  }
  if (currentSection.trim().length > 0) {
    sections.push({ heading: currentHeading, content: currentSection.trim() });
  }

  // Now chunk each section if needed
  const chunks = [];
  for (const section of sections) {
    if (section.content.length <= chunkSize * 1.5) {
      chunks.push({
        content: section.content,
        parentContext: headerContext,
        sectionHeading: section.heading,
      });
    } else {
      // Split oversized section by paragraphs
      const paras = section.content.split(/\n{2,}/).filter(p => p.trim().length > 0);
      let currentChunk = '';
      for (const para of paras) {
        if ((currentChunk + '\n\n' + para).length > chunkSize && currentChunk.length > 0) {
          chunks.push({
            content: currentChunk.trim(),
            parentContext: headerContext,
            sectionHeading: section.heading,
          });
          currentChunk = para;
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + para;
        }
      }
      if (currentChunk.trim().length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          parentContext: headerContext,
          sectionHeading: section.heading,
        });
      }
    }
  }

  return chunks.length > 0 ? chunks : [{ content: text, parentContext: headerContext, sectionHeading: '' }];
}

/**
 * Chunk SEC/CVM filings (10-K, 10-Q, prospectuses).
 * Splits on "Item X." headings that structure these documents.
 * Preserves item headings as parent context for child chunks.
 */
function chunkFiling(text, chunkSize = CHUNK_SIZE) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [];

  // Extract cover page context
  const coverContext = text.slice(0, 400).replace(/\n+/g, ' ').trim();

  // Split on "Item X." headings (SEC standard) or "PART I/II/III/IV" headings
  const itemPattern = /^(?:Item\s+\d+[A-Za-z]?[\.\:]|PART\s+[IVXLC]+)/i;
  const items = [];
  let currentItem = '';
  let currentItemHeading = '';

  for (const line of lines) {
    if (itemPattern.test(line) && currentItem.length > 50) {
      items.push({ heading: currentItemHeading, content: currentItem.trim() });
      currentItemHeading = line;
      currentItem = line + '\n';
    } else {
      if (!currentItemHeading && itemPattern.test(line)) currentItemHeading = line;
      currentItem += line + '\n';
    }
  }
  if (currentItem.trim().length > 0) {
    items.push({ heading: currentItemHeading, content: currentItem.trim() });
  }

  // Chunk each item, keeping heading as parent context
  const chunks = [];
  for (const item of items) {
    const parentCtx = item.heading
      ? `${coverContext.slice(0, 150)} | ${item.heading}`
      : coverContext.slice(0, 200);

    if (item.content.length <= chunkSize * 1.5) {
      chunks.push({
        content: item.content,
        parentContext: parentCtx,
        sectionHeading: item.heading,
      });
    } else {
      // Split by paragraphs within item
      const paras = item.content.split(/\n{2,}/).filter(p => p.trim().length > 0);
      let currentChunk = '';
      for (const para of paras) {
        if ((currentChunk + '\n\n' + para).length > chunkSize && currentChunk.length > 0) {
          chunks.push({
            content: currentChunk.trim(),
            parentContext: parentCtx,
            sectionHeading: item.heading,
          });
          currentChunk = para;
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + para;
        }
      }
      if (currentChunk.trim().length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          parentContext: parentCtx,
          sectionHeading: item.heading,
        });
      }
    }
  }

  return chunks.length > 0 ? chunks : [{ content: text, parentContext: coverContext, sectionHeading: '' }];
}

/**
 * Chunk text into overlapping segments (default chunking strategy).
 * Splits by sentences and accumulates until reaching chunkSize chars.
 */
/**
 * Detect if text looks like a table (repeated tab/pipe characters or aligned columns).
 * Returns true if > 40% of lines contain 2+ tabs or pipes.
 */
function looksLikeTable(text) {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return false;
  // Detect tab-delimited, pipe-delimited, or number-column-heavy lines (financial statements)
  const tableLines = lines.filter(l =>
    (l.match(/\t/g) || []).length >= 2 ||
    (l.match(/\|/g) || []).length >= 2 ||
    // Financial table: 3+ columns of numbers/currency separated by spaces
    (l.match(/[\d$%,.()\-]{2,}/g) || []).length >= 3
  );
  return tableLines.length / lines.length > 0.4;
}

/**
 * Find the end of a table block starting from a position in the text.
 * A table ends when we hit 2+ consecutive non-table lines.
 */
function findTableEnd(text, startPos) {
  let pos = startPos;
  let nonTableStreak = 0;
  const lines = text.slice(startPos).split('\n');
  for (const line of lines) {
    pos += line.length + 1;
    const isTableLine = (line.match(/\t/g) || []).length >= 2 || (line.match(/\|/g) || []).length >= 2;
    if (!isTableLine && line.trim().length > 0) {
      nonTableStreak++;
      if (nonTableStreak >= 2) return pos - line.length - 1;
    } else {
      nonTableStreak = 0;
    }
  }
  return text.length;
}

function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Step 1: Split by paragraph boundaries first (double newlines, section headers)
  const paragraphs = text
    .split(/\n{2,}|\r\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const chunks = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    // Phase 3: Table-aware boundary detection — don't split mid-table
    if (looksLikeTable(para)) {
      // Flush current chunk
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      // Keep table as a single chunk (up to 3x normal size) to preserve structure
      if (para.length <= chunkSize * 3) {
        chunks.push(para.trim());
      } else {
        // Very large table — split by row groups, preserving header
        const rows = para.split('\n');
        const header = rows[0];
        let tableChunk = header;
        for (let r = 1; r < rows.length; r++) {
          if ((tableChunk + '\n' + rows[r]).length > chunkSize * 2 && tableChunk.length > header.length + 50) {
            chunks.push(tableChunk.trim());
            tableChunk = header + '\n' + rows[r]; // re-prepend header
          } else {
            tableChunk += '\n' + rows[r];
          }
        }
        if (tableChunk.trim().length > 0) chunks.push(tableChunk.trim());
      }
      continue;
    }

    // If a single paragraph exceeds chunkSize, split it by sentences
    if (para.length > chunkSize) {
      // Flush current chunk first
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      // Split oversized paragraph by sentences
      const sentences = para
        .split(/(?<=[.!?])\s+/)
        .filter(s => s.trim().length > 0);
      for (const sentence of sentences) {
        if ((currentChunk + ' ' + sentence).length > chunkSize && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          const overlapText = currentChunk.slice(-Math.min(overlap, currentChunk.length));
          currentChunk = overlapText + ' ' + sentence;
        } else {
          currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
      }
    } else if ((currentChunk + '\n\n' + para).length > chunkSize && currentChunk.length > 0) {
      // Paragraph would push chunk over limit — start a new chunk
      chunks.push(currentChunk.trim());
      const overlapText = currentChunk.slice(-Math.min(overlap, currentChunk.length));
      currentChunk = overlapText + ' ' + para;
    } else {
      // Add paragraph to current chunk
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Route chunking based on detected document type.
 * Returns array of chunks, where each chunk is either a string or { content, metadata } object.
 * For research reports, extracts metadata objects; for others, returns plain strings.
 */
function chunkTextWithType(text, filename, docType = null) {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const type = docType || detectDocumentType(text, filename);
  let chunks = [];

  switch (type) {
    case 'earnings_transcript':
      chunks = chunkEarningsTranscript(text).map(c => ({
        content: typeof c === 'string' ? c : c.content,
        metadata: { documentType: 'earnings_transcript' },
      }));
      break;
    case 'research_report':
      chunks = chunkResearchReport(text);
      chunks = chunks.map(c => {
        if (typeof c === 'string') {
          return { content: c, metadata: { documentType: 'research_report' } };
        }
        return {
          content: c.content,
          metadata: {
            documentType: 'research_report',
            parentChunkId: c.parentChunkId,
            parentContext: c.parentContext,
          },
        };
      });
      break;
    case 'macro_commentary':
      chunks = chunkMacroCommentary(text).map(c => ({
        content: c.content,
        metadata: {
          documentType: 'macro_commentary',
          parentContext: c.parentContext,
          sectionHeading: c.sectionHeading,
        },
      }));
      break;
    case 'filing':
      chunks = chunkFiling(text).map(c => ({
        content: c.content,
        metadata: {
          documentType: 'filing',
          parentContext: c.parentContext,
          sectionHeading: c.sectionHeading,
        },
      }));
      break;
    case 'financial_table':
      chunks = chunkFinancialTable(text).map(c => ({
        content: c,
        metadata: { documentType: 'financial_table' },
      }));
      break;
    default:
      chunks = chunkText(text).map(c => ({
        content: c,
        metadata: { documentType: 'default' },
      }));
  }

  return chunks;
}

/**
 * Call Voyage AI embeddings API (finance-optimized).
 * Returns array of embeddings padded to STORED_EMBEDDING_DIM (1536).
 */
async function embedVoyage(texts) {
  if (!_voyageKey) {
    logger.warn('vault', 'Voyage API key not set — falling back to OpenAI');
    return embedOpenAI(texts);
  }

  if (!Array.isArray(texts)) {
    texts = [texts];
  }

  // Batch in groups of 10 for Voyage (conservative limit)
  const BATCH_SIZE = 10;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    try {
      const response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${_voyageKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'voyage-finance-2',
          input: batch,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        logger.error('vault', 'Voyage API error', { status: response.status, error: err.slice(0, 200), batch: `${i}-${i + batch.length}` });
        allEmbeddings.push(...batch.map(() => null));
        continue;
      }

      const data = await response.json();
      // Voyage returns 1024d vectors; pad to 1536 to fit the column
      const paddedEmbeddings = data.data.map(d => {
        const vec = d.embedding;
        // Zero-pad to 1536 dimensions
        while (vec.length < STORED_EMBEDDING_DIM) {
          vec.push(0);
        }
        return vec.slice(0, STORED_EMBEDDING_DIM);
      });
      allEmbeddings.push(...paddedEmbeddings);
    } catch (err) {
      logger.error('vault', 'Voyage embedding batch error', { error: err.message, batch: `${i}-${i + batch.length}` });
      allEmbeddings.push(...batch.map(() => null));
    }
  }

  return allEmbeddings;
}

/**
 * Call OpenAI embeddings API.
 * Returns array of embeddings (or nulls if API unavailable).
 */
async function embedOpenAI(texts) {
  if (!_openaiKey) {
    logger.warn('vault', 'OpenAI key not set — returning null embeddings');
    return texts.map(() => null);
  }

  if (!Array.isArray(texts)) {
    texts = [texts];
  }

  // Batch in groups of 20 to avoid OpenAI token limits
  const BATCH_SIZE = 20;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${_openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: batch,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        logger.error('vault', 'OpenAI API error', { status: response.status, error: err.slice(0, 200), batch: `${i}-${i + batch.length}` });
        allEmbeddings.push(...batch.map(() => null));
        continue;
      }

      const data = await response.json();
      allEmbeddings.push(...data.data.map(d => d.embedding));
    } catch (err) {
      logger.error('vault', 'Embedding batch error', { error: err.message, batch: `${i}-${i + batch.length}` });
      allEmbeddings.push(...batch.map(() => null));
    }
  }

  return allEmbeddings;
}

/**
 * Route embedding calls to the active provider.
 * Priority: Voyage AI (if key available) > OpenAI (fallback)
 *
 * Phase 3: Track active provider for consistency checks.
 * Documents embedded with one provider shouldn't be searched with another
 * (different dimensionality / semantic space).
 */
function getEmbeddingProvider() {
  return _voyageKey ? 'voyage' : (_openaiKey ? 'openai' : 'none');
}

async function embed(texts) {
  if (_voyageKey) {
    return embedVoyage(texts);
  } else {
    return embedOpenAI(texts);
  }
}

/**
 * Extract metadata from text (analyst, bank, tickers, date).
 */
function extractMetadata(text) {
  const metadata = {};

  // Try to find analyst name (rough pattern)
  const analystMatch = text.match(/(?:analyst|author|by)\s+([A-Z][a-z]+ [A-Z][a-z]+)/i);
  if (analystMatch) {
    metadata.analyst = analystMatch[1];
  }

  // Try to find bank/institution
  const bankMatch = text.match(/(Goldman Sachs|JP Morgan|Morgan Stanley|Citi|Bank of America|Wells Fargo|Barclays|Deutsche Bank)/i);
  if (bankMatch) {
    metadata.bank = bankMatch[1];
  }

  // Try to find date patterns (YYYY-MM-DD or Month Day, Year)
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/);
  if (dateMatch) {
    metadata.date = dateMatch[1];
  }

  // Try to find tickers (simple: consecutive uppercase letters, 1-5 chars, prefixed with $)
  const tickerMatches = text.match(/\$([A-Z]{1,5})\b/g);
  if (tickerMatches) {
    metadata.tickers = [...new Set(tickerMatches.map(t => t.slice(1)))];
  }

  return metadata;
}

/**
 * Extract metadata using an LLM (Claude Haiku or Perplexity Sonar).
 * Non-blocking — if the LLM call fails, we return empty metadata and proceed.
 *
 * @param {string} text - The document text (first 2000 chars will be used)
 * @param {string} filename - The document filename
 * @returns {Promise<object>} Metadata object with bank, date, tickers, sector, docType, summary
 */
async function extractMetadataWithLLM(text, filename) {
  const metadata = {};

  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const perplexityKey = process.env.PERPLEXITY_API_KEY;

    // Choose API based on availability (Anthropic preferred)
    let provider;
    let apiKey;
    let url;
    let headers;
    let body;

    const truncatedText = text.substring(0, 2000);
    const prompt = `You are a financial document analyzer. Extract metadata from the given document.

Document filename: "${filename}"
Document text (first 2000 chars):
${truncatedText}

Return a JSON object (ONLY, no markdown or explanation) with these fields:
{
  "bank": "Institution name or null if not identifiable",
  "date": "YYYY-MM-DD format or null",
  "tickers": ["AAPL", "MSFT"] or empty array,
  "sector": "Technology/Healthcare/Finance/etc or null",
  "docType": "research_report|earnings_transcript|macro_commentary|filing|other",
  "summary": "One-sentence summary of what this document is about"
}

Be conservative — only extract what you're confident about. Use null for uncertain fields.`;

    if (anthropicKey) {
      // Use Claude Haiku
      provider = 'anthropic';
      apiKey = anthropicKey;
      url = 'https://api.anthropic.com/v1/messages';
      headers = {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      };
      body = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [
          { role: 'user', content: prompt }
        ],
      };
    } else if (perplexityKey) {
      // Use Perplexity Sonar
      provider = 'perplexity';
      apiKey = perplexityKey;
      url = 'https://api.perplexity.ai/chat/completions';
      headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      body = {
        model: 'sonar',
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: 500,
      };
    } else {
      // No API key available — skip metadata extraction
      logger.debug('vault', 'No API key for metadata extraction (ANTHROPIC_API_KEY or PERPLEXITY_API_KEY)');
      return metadata;
    }

    // Make the API call with a 10-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        logger.warn('vault', 'LLM metadata extraction API error', {
          status: response.status,
          error: errText.substring(0, 200),
        });
        return metadata;
      }

      const data = await response.json();

      // Extract the response content based on provider
      let responseText = '';
      if (provider === 'anthropic') {
        responseText = data.content?.[0]?.text || '';
      } else if (provider === 'perplexity') {
        responseText = data.choices?.[0]?.message?.content || '';
      }

      if (!responseText) {
        logger.warn('vault', 'Empty LLM metadata response');
        return metadata;
      }

      // Parse the JSON response
      // Handle potential markdown code blocks
      const jsonStr = responseText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      const parsed = JSON.parse(jsonStr);

      // Merge extracted metadata with parsed results
      if (parsed.bank) metadata.bank = parsed.bank;
      if (parsed.date) metadata.date = parsed.date;
      if (Array.isArray(parsed.tickers) && parsed.tickers.length > 0) {
        metadata.tickers = parsed.tickers;
      }
      if (parsed.sector) metadata.sector = parsed.sector;
      if (parsed.docType) metadata.docType = parsed.docType;
      if (parsed.summary) metadata.summary = parsed.summary;

      logger.info('vault', 'LLM metadata extracted', { bank: parsed.bank, docType: parsed.docType });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    // Non-blocking error — log and continue
    if (err.name === 'AbortError') {
      logger.warn('vault', 'LLM metadata extraction timed out');
    } else {
      logger.warn('vault', 'LLM metadata extraction error', { error: err.message });
    }
  }

  return metadata;
}

/**
 * Parse DOCX file and extract text.
 * Returns extracted text or throws on error.
 */
async function parseDOCX(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (err) {
    logger.warn('vault', 'DOCX parse error', { error: err.message });
    throw new Error(`Unable to read DOCX: ${err.message}`);
  }
}

/**
 * Parse CSV/TSV file and convert to readable text.
 * Preserves headers and converts rows to readable format.
 */
function parseCSV(buffer, filename = '') {
  try {
    const csvText = buffer.toString('utf-8');
    const delimiter = filename.toLowerCase().includes('.tsv') ? '\t' : ',';

    const result = Papa.parse(csvText, {
      delimiter,
      header: false,
      skipEmptyLines: true,
      dynamicTyping: false,
    });

    if (!result.data || result.data.length === 0) {
      throw new Error('CSV is empty or malformed');
    }

    // Convert rows to readable text with headers preserved
    const headers = result.data[0];
    const rows = result.data.slice(1);

    let text = 'Data Table:\n\n';
    text += headers.join(' | ') + '\n';
    text += '─'.repeat(Math.min(100, headers.join(' | ').length)) + '\n';

    for (const row of rows) {
      if (row.some(cell => cell && cell.toString().trim().length > 0)) {
        text += row.join(' | ') + '\n';
      }
    }

    return text;
  } catch (err) {
    logger.warn('vault', 'CSV parse error', { error: err.message });
    throw new Error(`Unable to read CSV/TSV: ${err.message}`);
  }
}

/**
 * Parse plain text or Markdown file.
 * Returns text as-is after basic cleanup.
 */
function parsePlainText(buffer) {
  const text = buffer.toString('utf-8');

  if (!text || text.trim().length === 0) {
    throw new Error('File is empty or unreadable');
  }

  // Basic cleanup: normalize line endings, trim excess whitespace
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Generic file ingest function that routes by file extension.
 * Handles: PDF, DOCX, CSV, TSV, TXT, MD
 */
/**
 * Phase 3: Robust page-by-page PDF extraction.
 * Uses pdf-parse with page-level processing, memory-safe for large reports.
 * Falls back to pagerender textContent extraction if primary parse fails.
 */
async function extractPDFText(buffer, metadata, onProgress) {
  const pdfParse = require('pdf-parse');

  // Phase 3: Track per-page text for page-level citations
  const pageTexts = []; // { pageNumber, text }
  let currentPageNum = 0;

  // Strategy 1: Page-by-page extraction with page boundary tracking
  try {
    const pdfData = await pdfParse(buffer, {
      max: 500,
      pagerender: function(pageData) {
        currentPageNum++;
        const myPageNum = currentPageNum;
        return pageData.getTextContent().then(function(textContent) {
          // Preserve table structure: join items with spaces, lines with newlines
          let lastY = null;
          const lines = [];
          let currentLine = [];
          for (const item of textContent.items) {
            if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
              lines.push(currentLine.join('\t'));
              currentLine = [];
            }
            currentLine.push(item.str);
            lastY = item.transform[5];
          }
          if (currentLine.length) lines.push(currentLine.join('\t'));
          const pageText = lines.join('\n');
          pageTexts.push({ pageNumber: myPageNum, text: pageText });
          return pageText;
        });
      },
    });
    const text = pdfData.text || '';
    metadata.pageCount = pdfData.numpages || 0;
    // Store page boundaries for chunk-level page assignment
    metadata._pageTexts = pageTexts.length > 0 ? pageTexts : null;

    if (text.trim().length > 50) {
      if (onProgress) onProgress('extract', `Extracted text from ${metadata.pageCount} pages`);
      return text;
    }
    // Text too short — likely scanned PDF, try standard fallback
    logger.warn('vault', 'PDF text extraction yielded minimal text, trying standard fallback');
  } catch (parseErr) {
    logger.warn('vault', 'Enhanced PDF parse failed, trying standard', { error: parseErr.message });
  }

  // Strategy 2: Standard extraction (no page tracking, fallback)
  try {
    const pdfData = await pdfParse(buffer, { max: 500 });
    const text = pdfData.text || '';
    metadata.pageCount = pdfData.numpages || 0;
    metadata._pageTexts = null; // No page tracking in fallback

    if (text.trim().length > 50) {
      if (onProgress) onProgress('extract', `Extracted text from ${metadata.pageCount} pages (standard)`);
      return text;
    }
  } catch (fallbackErr) {
    logger.warn('vault', 'Standard PDF parse failed', { error: fallbackErr.message });
  }

  // Strategy 3: OCR fallback for scanned PDFs (if tesseract available)
  if (Tesseract) {
    try {
      logger.info('vault', 'Attempting OCR extraction for scanned PDF');
      if (onProgress) onProgress('extract', 'Scanned PDF detected — running OCR...');
      // For OCR, we'd need to convert PDF pages to images first
      // This is a graceful degradation — tesseract handles image buffers
      const pdfParse = require('pdf-parse');
      const pdfData = await pdfParse(buffer, { max: 50 }); // Limit for OCR
      metadata.pageCount = pdfData.numpages || 0;
      if (pdfData.text && pdfData.text.trim().length > 20) {
        return pdfData.text;
      }
    } catch (ocrErr) {
      logger.warn('vault', 'OCR fallback failed', { error: ocrErr.message });
    }
  }

  throw new Error('Unable to read this PDF. It may be image-only or password-protected. Try converting to DOCX first.');
}

async function ingestFile(userId, buffer, filename, metadata = {}, isGlobal = false, onProgress = null) {
  if (!pg.isConnected()) {
    try { await pg.query('SELECT 1'); } catch (e) { swallow(e, 'vault.lazy_reconnect.ingestFile'); }
    if (!pg.isConnected()) {
      throw new Error('Postgres not connected — database may be starting up. Please try again in a minute.');
    }
  }

  try {
    // Determine file type from extension
    const ext = (filename || '').toLowerCase().split('.').pop() || '';
    let text = '';
    let fileType = 'unknown';

    logger.info('vault', 'Ingesting file', { userId, filename, ext });

    // Parse file based on extension
    if (ext === 'pdf') {
      fileType = 'pdf';
      text = await extractPDFText(buffer, metadata, onProgress);
    } else if (ext === 'docx') {
      fileType = 'docx';
      text = await parseDOCX(buffer);
    } else if (ext === 'csv' || ext === 'tsv') {
      fileType = 'table';
      text = parseCSV(buffer, filename);
    } else if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
      fileType = 'text';
      text = parsePlainText(buffer);
    } else if (['png', 'jpg', 'jpeg', 'tiff', 'tif'].includes(ext)) {
      // OCR for image files
      fileType = 'image';
      const mimetypeMap = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'tiff': 'image/tiff',
        'tif': 'image/tiff',
      };
      const mimetype = mimetypeMap[ext] || 'image/png';
      text = await extractTextFromImage(buffer, mimetype);
    } else {
      throw new Error(`Unsupported file type: .${ext}. Supported: PDF, DOCX, CSV, TSV, TXT, MD, PNG, JPG, JPEG, TIFF`);
    }

    // Validate extracted text
    if (!text.trim()) {
      throw new Error('This file contains no extractable text.');
    }

    if (text.length > 2_000_000) {
      throw new Error('File text content exceeds 2MB limit');
    }

    // W4.1 — Scrub adversarial LLM directives from ingested text BEFORE
    // chunking + embedding. Without this, a malicious PDF with a
    // "disregard previous instructions" footnote or a chat-template marker
    // can ride all the way through retrieval and into the live prompt.
    // The scrubber is conservative (logs everything it touched); zero hits
    // is the expected case on normal research documents.
    const scrub = vaultSecurity.scrubIngestedText(text);
    if (scrub.hits > 0) {
      logger.warn('vault', 'Ingestion scrubber neutralised adversarial patterns', {
        userId,
        filename,
        hits: scrub.hits,
        removed: scrub.removed.slice(0, 10),
      });
    }
    text = scrub.text;

    // Re-validate after scrubbing — a document that was ONLY injection payload
    // (rare but possible) could now be empty.
    if (!text.trim()) {
      throw new Error('File contents were entirely adversarial payload; nothing left to ingest.');
    }

    // Sanitize filename
    filename = (filename || `untitled.${ext}`)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\.{2,}/g, '.')
      .slice(0, 255);

    // Extract metadata
    const docMetadata = extractMetadata(text);
    docMetadata.fileType = fileType;
    docMetadata.detectedType = detectDocumentType(text, filename);
    Object.assign(docMetadata, metadata);

    // Compute content hash for duplicate detection
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');

    // W3.5 fix: duplicate scope depends on target shelf.
    //
    //  - Private upload (isGlobal=false): match only the user's own private
    //    docs (is_global = FALSE). Previously matched across both shelves,
    //    which surfaced someone else's global doc as a "duplicate" when a
    //    user re-uploaded the same file privately.
    //
    //  - Central upload (isGlobal=true): match only existing GLOBAL docs.
    //    Previously the check was `user_id = $1 AND content_hash = $2`,
    //    which blocked the founder from promoting a file they had first
    //    ingested into their own private vault — the dedupe matched the
    //    private row and returned `{duplicate:true}` without ever
    //    creating the global copy. That manifests as the reported
    //    "UI does the shiny thing but nothing uploads".
    const existingResult = isGlobal
      ? await pg.query(
          `SELECT id, filename FROM vault_documents
            WHERE is_global = TRUE AND content_hash = $1
            LIMIT 1`,
          [contentHash]
        )
      : await pg.query(
          `SELECT id, filename FROM vault_documents
            WHERE user_id = $1 AND is_global = FALSE AND content_hash = $2
            LIMIT 1`,
          [userId, contentHash]
        );

    if (existingResult.rows && existingResult.rows.length > 0) {
      const existingDoc = existingResult.rows[0];
      logger.info('vault', 'Duplicate file detected', {
        userId,
        filename,
        isGlobal,
        existingDocId: existingDoc.id,
      });
      return {
        duplicate: true,
        existingDocId: existingDoc.id,
        filename: existingDoc.filename,
        isGlobal,
      };
    }

    // Chunk text with type-specific chunking (before transaction — no DB work)
    // Phase 6: User-selected docType overrides auto-detection
    const userDocType = metadata?.docType || null;
    const effectiveDocType = userDocType || docMetadata.detectedType || null;
    if (onProgress) onProgress('chunk', `Chunking ${text.length} characters (type: ${effectiveDocType || 'auto'})...`);
    const chunkedData = chunkTextWithType(text, filename, effectiveDocType);

    // Extract chunk content and metadata
    const chunks = chunkedData.map(c => {
      if (typeof c === 'string') {
        return { content: c, metadata: {} };
      }
      return { content: c.content, metadata: c.metadata || {} };
    });

    if (chunks.length === 0) {
      throw new Error('No chunks produced from content');
    }

    // Phase 3: Assign page numbers to chunks using page boundary data from PDF extraction
    const pageTexts = metadata?._pageTexts;
    if (pageTexts && pageTexts.length > 0) {
      // Build a cumulative char offset map: page start positions in the full text
      let offset = 0;
      const pageStarts = pageTexts.map(pt => {
        const start = offset;
        offset += pt.text.length + 1; // +1 for page separator
        return { pageNumber: pt.pageNumber, start, end: offset };
      });

      // For each chunk, find its approximate position in the full text and assign a page
      let searchFrom = 0;
      for (const chunk of chunks) {
        const chunkSnippet = chunk.content.slice(0, 100);
        const pos = text.indexOf(chunkSnippet, searchFrom);
        if (pos >= 0) {
          searchFrom = pos;
          const page = pageStarts.find(p => pos >= p.start && pos < p.end);
          chunk.metadata.pageNumber = page ? page.pageNumber : null;
        } else {
          chunk.metadata.pageNumber = null;
        }
      }
    }
    // Clean up internal page data
    delete metadata._pageTexts;

    // Embed chunks (before transaction — external API call)
    if (onProgress) onProgress('embed', `Generating embeddings for ${chunks.length} passages...`);
    const chunkTexts = chunks.map(c => c.content);
    const embeddings = await embed(chunkTexts);
    const embeddingProvider = getEmbeddingProvider();

    // Store document + chunks in a single transaction
    if (onProgress) onProgress('store', `Storing ${chunks.length} passages...`);
    const client = await pg.getPool().connect();
    let documentId;
    try {
      await client.query('BEGIN');

      // Create document record
      const docResult = await client.query(
        `INSERT INTO vault_documents (user_id, filename, source, is_global, metadata, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [userId, filename, 'upload', isGlobal, JSON.stringify(docMetadata), contentHash]
      );
      documentId = docResult.rows[0].id;

      // Insert chunks in batches
      const DB_BATCH = 10;
      for (let i = 0; i < chunks.length; i += DB_BATCH) {
        const batch = chunks.slice(i, i + DB_BATCH);
        const promises = batch.map((chunk, j) => {
          const idx = i + j;
          const chunkMetadata = {
            ...chunk.metadata,
            chunkIndex: idx,
            totalChunks: chunks.length,
            embeddingProvider,
          };
          // Phase 3: Validate embedding dimension before INSERT
          let embeddingStr = null;
          if (embeddings[idx]) {
            if (embeddings[idx].length !== STORED_EMBEDDING_DIM) {
              logger.error('vault', 'Embedding dimension mismatch', {
                expected: STORED_EMBEDDING_DIM,
                got: embeddings[idx].length,
                provider: embeddingProvider,
                chunkIndex: idx,
              });
              // Skip this chunk's embedding rather than crash the INSERT
            } else {
              embeddingStr = `[${embeddings[idx].join(',')}]`;
            }
          }
          return client.query(
            `INSERT INTO vault_chunks (document_id, user_id, chunk_index, content, embedding, metadata, embedding_provider, page_number)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              documentId,
              userId,
              idx,
              chunk.content,
              embeddingStr,
              JSON.stringify(chunkMetadata),
              embeddingProvider || 'unknown',
              chunk.metadata?.pageNumber || null,
            ]
          );
        });
        await Promise.all(promises);
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      logger.error('vault', `Ingestion rolled back: chunk insert failed`, {
        userId, filename, documentId, error: txErr.message,
      });
      throw new Error(`Ingestion rolled back: chunk insert failed — ${txErr.message}`);
    } finally {
      client.release();
    }

    logger.info('vault', 'File ingested', {
      userId,
      filename,
      fileType,
      detectedType: docMetadata.detectedType,
      documentId,
      chunks: chunks.length,
    });

    if (onProgress) onProgress('done', `Ready to chat about ${filename}`);

    return {
      documentId,
      chunks: chunks.length,
      filename,
      fileType,
      detectedType: docMetadata.detectedType,
      metadata: docMetadata,
    };
  } catch (err) {
    logger.error('vault', 'File ingestion error', { error: err.message });
    throw err;
  }
}

/**
 * Ingest a PDF, parse text, chunk, embed, and store.
 * (Backward compatible wrapper around ingestFile)
 */
async function ingestPDF(userId, buffer, filename, { isGlobal = false } = {}) {
  return ingestFile(userId, buffer, filename, {}, isGlobal);
}

/**
 * Retrieve relevant passages from user's private vault AND the central vault.
 * Merges results by similarity score so the best passages surface regardless of source.
 * Falls back to keyword search if embeddings unavailable.
 */
/**
 * Reciprocal Rank Fusion — merges ranked lists from different retrieval methods.
 * RRF score = sum(1 / (k + rank_i)) across methods. k=60 is standard.
 */
function reciprocalRankFusion(rankedLists, k = 60) {
  const scores = new Map(); // chunk_id → { score, row }
  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const row = list[rank];
      const id = row.id || `${row.document_id}-${row.chunk_index}`;
      const existing = scores.get(id) || { score: 0, row };
      existing.score += 1 / (k + rank + 1);
      scores.set(id, existing);
    }
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map(x => ({ ...x.row, _rrf_score: x.score }));
}

/**
 * Rerank passages using Cohere Rerank API.
 * Takes top candidates after RRF and reranks them for better relevance.
 * Gracefully skips if Cohere key is unavailable or API times out.
 *
 * @param {string} query - The user's original query
 * @param {Array} passages - Array of passage objects from vault_chunks
 * @param {number} topN - How many top results to return after reranking
 * @returns {Array} Reranked passages with Cohere scores, or original passages on error/timeout
 */
async function rerankWithCohere(query, passages, topN) {
  if (!_cohereKey || passages.length === 0) {
    return passages;
  }

  if (passages.length <= topN) {
    // No need to rerank if we have few candidates
    return passages;
  }

  try {
    // Cohere API expects documents as array of { text, ... } objects
    const documents = passages.map((p, idx) => ({
      text: p.content,
      index: idx,
    }));

    // Set a 3-second timeout for the rerank request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch('https://api.cohere.com/v2/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${_cohereKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'rerank-v3.5',
        query: query,
        documents: documents,
        top_n: topN,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.text();
      logger.warn('vault', 'Cohere rerank API error', { status: response.status, error: err.slice(0, 200) });
      return passages; // Fall back to RRF results
    }

    const data = await response.json();
    if (!data.results || data.results.length === 0) {
      logger.warn('vault', 'Cohere rerank returned no results');
      return passages;
    }

    // Map Cohere results back to original passage objects, preserving all metadata
    const reranked = data.results.map(result => {
      const originalPassage = passages[result.index];
      return {
        ...originalPassage,
        _cohere_rank: result.relevance_score,
      };
    });

    logger.info('vault', `Cohere reranking: ${passages.length} candidates -> ${reranked.length} top results`);
    return reranked;
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('vault', 'Cohere rerank timeout (3s) — trying Haiku fallback');
    } else {
      logger.warn('vault', 'Cohere rerank error — trying Haiku fallback', { error: err.message });
    }
    // Phase 6: Cascade to Haiku reranking if Cohere fails
    return rerankWithHaiku(query, passages, topN);
  }
}

/**
 * Phase 6: Claude Haiku reranking fallback.
 * When Cohere is unavailable or times out, use Haiku to score passage relevance.
 * Cheaper and faster than Sonnet, good enough for reranking.
 * Falls back to original passages (RRF order) if Haiku also fails.
 */
async function rerankWithHaiku(query, passages, topN) {
  if (!_anthropicKey || passages.length === 0) {
    return passages;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // Build a compact prompt asking Haiku to rank passages by relevance
    const passageList = passages.map((p, i) =>
      `[${i}] ${p.content.slice(0, 300)}`
    ).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': _anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Given the query: "${query}"\n\nRank these passages by relevance (most relevant first). Return ONLY a JSON array of passage indices, e.g. [2,0,5,1].\n\n${passageList}`,
        }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn('vault', 'Haiku rerank API error', { status: response.status });
      return passages;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Extract JSON array from response
    const match = text.match(/\[[\d,\s]+\]/);
    if (!match) {
      logger.warn('vault', 'Haiku rerank returned unparseable response');
      return passages;
    }

    const indices = JSON.parse(match[0]);
    const reranked = indices
      .filter(i => i >= 0 && i < passages.length)
      .slice(0, topN)
      .map((idx, rank) => ({
        ...passages[idx],
        _haiku_rank: rank,
      }));

    if (reranked.length === 0) return passages;

    logger.info('vault', `Haiku reranking fallback: ${passages.length} candidates -> ${reranked.length} top results`);
    return reranked;
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('vault', 'Haiku rerank timeout (5s) — using RRF results');
    } else {
      logger.warn('vault', 'Haiku rerank error', { error: err.message });
    }
    return passages; // Final fallback: RRF order
  }
}

async function retrieve(userId, query, limit = MAX_RETRIEVAL) {
  // W4.2: capture end-to-end retrieval latency so we can write it to
  // vault_query_log and spot regressions over time.
  const _startedAt = Date.now();
  // Track which reranker actually ran so the audit row is accurate.
  let _rerankerUsed = 'none';

  if (!pg.isConnected()) {
    logger.warn('vault', 'retrieve() skipped — Postgres not connected');
    return [];
  }

  // Diagnostic: check if user has any documents at all
  try {
    const docCount = await pg.query(
      'SELECT COUNT(*) as count FROM vault_documents WHERE user_id = $1 OR is_global = TRUE',
      [userId]
    );
    const chunkCount = await pg.query(
      'SELECT COUNT(*) as count FROM vault_chunks WHERE user_id = $1 OR document_id IN (SELECT id FROM vault_documents WHERE is_global = TRUE)',
      [userId]
    );
    const embeddedCount = await pg.query(
      'SELECT COUNT(*) as count FROM vault_chunks WHERE (user_id = $1 OR document_id IN (SELECT id FROM vault_documents WHERE is_global = TRUE)) AND embedding IS NOT NULL',
      [userId]
    );
    logger.info('vault', `retrieve() for user=${userId}: ${docCount.rows[0]?.count || 0} docs, ${chunkCount.rows[0]?.count || 0} chunks, ${embeddedCount.rows[0]?.count || 0} embedded, query="${query.substring(0, 80)}"`);
  } catch (diagErr) {
    logger.warn('vault', 'Diagnostic count query failed', { error: diagErr.message });
  }

  const rankedLists = [];
  const CANDIDATE_LIMIT = 30; // pull more candidates for RRF merging

  // ── Stage 1A: Vector (semantic) search ──
  //
  // W4.3 — Embedding provider safety rules.
  //
  // Voyage returns 1024d vectors; we zero-pad to 1536 so they fit the shared
  // column. Zero-padding is cosine-preserving IFF both the query vector and
  // the document vector were padded the same way (the trailing zeros
  // contribute 0 to both the dot product and to each vector's L2 norm, so
  // the cosine comes out identical to the native-1024 cosine).
  //
  // That is SAFE within a provider. It is NOT safe across providers:
  // an OpenAI-native-1536 vector's first 1024 dims have no meaningful
  // relationship to a Voyage vector, so comparing openai-query (full-1536)
  // against voyage-doc (padded-1024) is mathematical garbage that was
  // previously dressed up with a bogus similarity score.
  //
  // The old code had a "retry without provider filter" fallback when the
  // filtered query returned zero rows. That fallback is what produced the
  // cross-provider garbage scores. We REMOVE it entirely: if no rows in the
  // active provider match, the correct answer is zero rows — not a bag of
  // unrelated documents with fabricated similarity. Legacy rows that were
  // embedded before the provider column existed carry embedding_provider =
  // 'unknown'; those are all OpenAI-era, so we accept them when active
  // provider is openai and reject them otherwise.
  try {
    // W4.6: cache the query embedding so repeat questions don't re-pay
    // 50-200ms of latency + per-token cost. Ingestion still calls embed()
    // directly; only the retrieval hot path is cached.
    const activeProviderForCache = getEmbeddingProvider();
    const cachedOrFresh = await vaultQueryCache.embedQuery({
      query,
      provider: activeProviderForCache,
      // We don't currently thread model name into embed() separately;
      // the provider label uniquely identifies the model today.
      model: activeProviderForCache,
      embedFn: async () => {
        const r = await embed([query]);
        return r?.[0] || null;
      },
    });
    const embeddings = [cachedOrFresh];
    if (embeddings[0]) {
      const activeProvider = getEmbeddingProvider();
      logger.info('vault', `Vector search using provider=${activeProvider}, embedding dim=${embeddings[0].length}`);

      // Acceptable embedding_provider values, keyed by active provider.
      const acceptedProviders = activeProvider === 'openai'
        ? ['openai', 'unknown']  // 'unknown' = legacy pre-provider-column data, all OpenAI
        : ['voyage'];            // Voyage is strict — no legacy aliasing

      let vecResult;
      try {
        vecResult = await pg.query(
          `SELECT vc.id, vc.document_id, vc.chunk_index, vc.content, vc.metadata, vc.page_number,
                  vd.filename, vd.source, vd.is_global, vd.metadata as doc_metadata,
                  1 - (vc.embedding <=> $1::vector) AS similarity
           FROM vault_chunks vc
           JOIN vault_documents vd ON vc.document_id = vd.id
           WHERE (vc.user_id = $2 OR vd.is_global = TRUE) AND vc.embedding IS NOT NULL
             AND vc.embedding_provider = ANY($4::text[])
           ORDER BY vc.embedding <=> $1::vector
           LIMIT $3`,
          [`[${embeddings[0].join(',')}]`, userId, CANDIDATE_LIMIT, acceptedProviders]
        );

        if (!vecResult.rows || vecResult.rows.length === 0) {
          // W4.3: this is now a legitimate "no coverage under active
          // provider" signal. We do NOT fall back across providers.
          logger.info('vault',
            `Vector search returned 0 rows for provider=${activeProvider} ` +
            `(accepted=${JSON.stringify(acceptedProviders)}) — no cross-provider fallback`);
        }
      } catch (filterErr) {
        // If the ANY($4::text[]) form is rejected (e.g. very old Postgres
        // or the column is literally missing), fall back to a single-provider
        // match. Still NO cross-provider bleed: worst case we return zero.
        logger.warn('vault', 'Provider-filtered vector search failed, retrying narrow', { error: filterErr.message });
        vecResult = await pg.query(
          `SELECT vc.id, vc.document_id, vc.chunk_index, vc.content, vc.metadata, vc.page_number,
                  vd.filename, vd.source, vd.is_global, vd.metadata as doc_metadata,
                  1 - (vc.embedding <=> $1::vector) AS similarity
           FROM vault_chunks vc
           JOIN vault_documents vd ON vc.document_id = vd.id
           WHERE (vc.user_id = $2 OR vd.is_global = TRUE) AND vc.embedding IS NOT NULL
             AND vc.embedding_provider = $4
           ORDER BY vc.embedding <=> $1::vector
           LIMIT $3`,
          [`[${embeddings[0].join(',')}]`, userId, CANDIDATE_LIMIT, activeProvider]
        );
      }
      // Pre-filter by similarity threshold
      const vecRows = (vecResult.rows || []).filter(r =>
        r.similarity != null && parseFloat(r.similarity) >= MIN_SIMILARITY
      );
      if (vecRows.length > 0) rankedLists.push(vecRows);
      logger.info('vault', `Vector search: ${vecResult.rows?.length || 0} candidates, ${vecRows.length} above threshold`);
    }
  } catch (err) {
    logger.warn('vault', 'Vector search failed', { error: err.message });
  }

  // ── Stage 1B: BM25 (keyword) search via tsvector ──
  try {
    // Build tsquery from user query — handle tickers ($AAPL → AAPL) and multi-word
    const cleanQuery = query
      .replace(/\$/g, '')       // strip $ prefix from tickers
      .replace(/[^\w\s]/g, ' ') // strip special chars
      .trim()
      .split(/\s+/)
      .filter(w => w.length >= 2)
      .join(' & ');             // AND all terms

    if (cleanQuery) {
      const bm25Result = await pg.query(
        `SELECT vc.id, vc.document_id, vc.chunk_index, vc.content, vc.metadata,
                vd.filename, vd.source, vd.is_global, vd.metadata as doc_metadata,
                ts_rank_cd(vc.search_vector, to_tsquery('english', $1)) AS bm25_rank
         FROM vault_chunks vc
         JOIN vault_documents vd ON vc.document_id = vd.id
         WHERE (vc.user_id = $2 OR vd.is_global = TRUE)
           AND vc.search_vector @@ to_tsquery('english', $1)
         ORDER BY bm25_rank DESC
         LIMIT $3`,
        [cleanQuery, userId, CANDIDATE_LIMIT]
      );
      const bm25Rows = bm25Result.rows || [];
      if (bm25Rows.length > 0) rankedLists.push(bm25Rows);
      logger.info('vault', `BM25 search: ${bm25Rows.length} matches for "${cleanQuery}"`);
    }
  } catch (err) {
    // BM25 may fail if search_vector column doesn't exist yet — graceful degradation
    logger.warn('vault', 'BM25 search failed (column may not exist yet)', { error: err.message });
  }

  // ── Stage 1C: No results from vector or BM25 — return empty ──
  // Phase 2 AI: Removed broad fallback that returned recent docs with fake similarity 0.5.
  // Returning random unrelated docs caused the AI to hallucinate vault citations.
  // Better to let the AI work without vault context than to confuse it with irrelevant passages.
  if (rankedLists.length === 0) {
    logger.info('vault', 'Both vector and BM25 search returned empty — returning no vault context');
    // W4.2: still audit the query — a zero-hit query is a useful signal
    // (coverage gap, typo, wrong provider, etc.).
    vaultQueryLog.logVaultQuery({
      userId, query, passages: [],
      embeddingProvider: _activeEmbeddingProvider,
      rerankerUsed: _rerankerUsed,
      latencyMs: Date.now() - _startedAt,
    }).catch(() => {}); // fire-and-forget
    return [];
  }

  // ── Stage 2: Reciprocal Rank Fusion ──

  let fused;
  if (rankedLists.length === 1) {
    // Single method — use its results directly
    fused = rankedLists[0];
  } else {
    // Merge with RRF
    fused = reciprocalRankFusion(rankedLists);
    logger.info('vault', `Hybrid RRF: ${fused.length} unique passages from ${rankedLists.length} methods`);
  }

  // ── Stage 3: Optional Reranking (Cohere → Haiku fallback) ──
  // If we have more candidates than needed, rerank for better relevance
  let finalPassages;
  if ((_cohereKey || _anthropicKey) && fused.length > limit) {
    finalPassages = await rerankWithCohere(query, fused, limit);
    // W4.2: we don't currently thread the "which reranker won" flag out
    // of rerankWithCohere; "cohere" here means "the Cohere→Haiku chain
    // was invoked" — W4.5 can refine to per-provider if needed.
    _rerankerUsed = _cohereKey ? 'cohere' : 'haiku';
    logger.info('vault', `Reranking: ${finalPassages.length} passages returned`);
  } else {
    finalPassages = fused.slice(0, limit);
  }

  // ── Stage 4: Min-passages threshold (Phase 6, Task 9) ──
  // If we have very few quality passages, it's better to return nothing than inject
  // confusing/irrelevant context. Only applies when vector similarity is the primary signal.
  const passagesAboveThreshold = finalPassages.filter(p =>
    p.similarity != null && parseFloat(p.similarity) >= MIN_SIMILARITY
  );
  if (passagesAboveThreshold.length > 0 && passagesAboveThreshold.length < MIN_PASSAGES_THRESHOLD) {
    // Check if these are strong enough to be useful
    const avgSimilarity = passagesAboveThreshold.reduce((sum, p) => sum + parseFloat(p.similarity), 0) / passagesAboveThreshold.length;
    if (avgSimilarity < 0.5) {
      logger.info('vault', `Min-passages rule: only ${passagesAboveThreshold.length} passages above threshold with avg similarity ${avgSimilarity.toFixed(3)} — returning empty to avoid noise`);
      // W4.2: audit even the suppressed case — we want to see when the
      // min-passages rule is filtering users' real queries.
      vaultQueryLog.logVaultQuery({
        userId, query, passages: [],
        embeddingProvider: _activeEmbeddingProvider,
        rerankerUsed: _rerankerUsed,
        latencyMs: Date.now() - _startedAt,
      }).catch(() => {});
      return [];
    }
  }

  // W4.2: happy-path audit — log what was actually returned to the caller.
  vaultQueryLog.logVaultQuery({
    userId, query, passages: finalPassages,
    embeddingProvider: _activeEmbeddingProvider,
    rerankerUsed: _rerankerUsed,
    latencyMs: Date.now() - _startedAt,
  }).catch(() => {});

  return finalPassages;
}

/**
 * Format retrieved passages for AI prompt injection.
 */
function formatForPrompt(passages) {
  if (!passages || passages.length === 0) {
    return '';
  }

  // Separate central (global) vs private passages for clear labeling
  const centralPassages = passages.filter(p => p.is_global);
  const privatePassages = passages.filter(p => !p.is_global);

  let ctx = '';

  // Phase 6: Helper to format a single passage with parent context awareness
  const formatPassage = (p, index) => {
    const docMeta = p.doc_metadata || {};
    const chunkMeta = typeof p.metadata === 'string' ? JSON.parse(p.metadata || '{}') : (p.metadata || {});
    const source = docMeta.bank || p.filename || 'Unknown source';
    const date = docMeta.date || '';
    const tickers = docMeta.tickers
      ? ` [${Array.isArray(docMeta.tickers) ? docMeta.tickers.join(', ') : docMeta.tickers}]`
      : '';
    const docType = chunkMeta.documentType ? ` (${chunkMeta.documentType})` : '';
    // Phase 3: Include page number in citation source
    const pageRef = p.page_number ? `, p.${p.page_number}` : '';

    let passageCtx = `[V${index + 1}] [Source: ${source}${pageRef}${date ? ` (${date})` : ''}${tickers}${docType}]\n`;

    // Phase 6: Inject parent context (section heading, document header) for better grounding
    if (chunkMeta.parentContext) {
      passageCtx += `[Context: ${chunkMeta.parentContext.slice(0, 200)}]\n`;
    }
    if (chunkMeta.sectionHeading) {
      passageCtx += `[Section: ${chunkMeta.sectionHeading}]\n`;
    }

    // Phase 6: Increased from 500 to 800 chars — chunks are already sized, no need to double-truncate
    const maxLen = 800;
    passageCtx += `${p.content.slice(0, maxLen)}${p.content.length > maxLen ? '...' : ''}\n\n`;
    return passageCtx;
  };

  if (centralPassages.length > 0) {
    ctx += '\n--- CENTRAL RESEARCH VAULT (professional reports curated by Particle) ---\n';
    centralPassages.forEach((p, i) => { ctx += formatPassage(p, i); });
    ctx += '--- END CENTRAL VAULT ---\n';
  }

  if (privatePassages.length > 0) {
    ctx += '\n--- USER VAULT (private research documents) ---\n';
    const offset = centralPassages.length;
    privatePassages.forEach((p, i) => { ctx += formatPassage(p, offset + i); });
    ctx += '--- END USER VAULT ---\n';
  }

  ctx += 'When answering, cite specific vault sources using [V1], [V2], [V3] etc. markers matching the order they appear above.\n';

  // W4.1 — Wrap the entire vault-context block in an unambiguous "untrusted
  // data, not instructions" envelope. The downstream LLM sees a header that
  // tells it to treat everything inside the delimiters as evidence to be
  // cited, and never as commands to follow. Combined with the ingestion
  // scrubber this materially closes the W1.3-on-ingestion gap.
  return vaultSecurity.wrapAsUntrustedData(ctx);
}

/**
 * Get user's private vault documents.
 */
// Safety cap on document list responses. Tier limits cap normal users below this,
// but the cap protects against runaway queries + oversized JSON responses.
const DOC_LIST_MAX = 500;

async function getUserDocuments(userId) {
  if (!pg.isConnected()) {
    return [];
  }

  try {
    const result = await pg.query(
      `SELECT id, filename, source, is_global, metadata, created_at,
              (SELECT COUNT(*) FROM vault_chunks WHERE document_id = vault_documents.id) as chunk_count
       FROM vault_documents
       WHERE user_id = $1 AND is_global = FALSE
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, DOC_LIST_MAX]
    );

    return result.rows || [];
  } catch (err) {
    logger.error('vault', 'Error fetching documents', { error: err.message });
    return [];
  }
}

/**
 * Get central vault documents (global, available to all users).
 */
async function getGlobalDocuments() {
  if (!pg.isConnected()) {
    return [];
  }

  try {
    const result = await pg.query(
      `SELECT id, filename, source, is_global, metadata, created_at,
              (SELECT COUNT(*) FROM vault_chunks WHERE document_id = vault_documents.id) as chunk_count
       FROM vault_documents
       WHERE is_global = TRUE
       ORDER BY created_at DESC
       LIMIT $1`,
      [DOC_LIST_MAX]
    );

    return result.rows || [];
  } catch (err) {
    logger.error('vault', 'Error fetching global documents', { error: err.message });
    return [];
  }
}

/**
 * Delete a document and its chunks.
 */
async function deleteDocument(userId, documentId) {
  if (!pg.isConnected()) {
    throw new Error('Postgres not connected');
  }

  try {
    // Verify ownership
    const doc = await pg.query(
      `SELECT id FROM vault_documents WHERE id = $1 AND user_id = $2`,
      [documentId, userId]
    );

    if (!doc.rows || doc.rows.length === 0) {
      throw new Error('Document not found or unauthorized');
    }

    // Delete chunks (cascade handled by FK)
    await pg.query(`DELETE FROM vault_chunks WHERE document_id = $1`, [documentId]);

    // Delete document
    await pg.query(`DELETE FROM vault_documents WHERE id = $1`, [documentId]);

    logger.info('vault', 'Document deleted', { userId, documentId });

    return { ok: true };
  } catch (err) {
    logger.error('vault', 'Error deleting document', { error: err.message });
    throw err;
  }
}

/**
 * Retrieve passages from a specific document only (for document-scoped Q&A).
 * Similar to retrieve() but filters by document_id.
 */
async function retrieveFromDocument(documentId, userId, query, limit = MAX_RETRIEVAL) {
  if (!pg.isConnected()) {
    return [];
  }

  // Verify user owns the document or it's global
  const docCheck = await pg.query(
    `SELECT user_id, is_global FROM vault_documents WHERE id = $1`,
    [documentId]
  );
  if (!docCheck.rows || docCheck.rows.length === 0) {
    throw new Error('Document not found');
  }
  const doc = docCheck.rows[0];
  if (doc.user_id !== userId && !doc.is_global) {
    throw new Error('Unauthorized');
  }

  const CANDIDATE_LIMIT = 30;
  const rankedLists = [];

  // ── Stage 1A: Vector (semantic) search on document ──
  try {
    const embeddings = await embed([query]);
    if (embeddings[0]) {
      const vecResult = await pg.query(
        `SELECT vc.id, vc.document_id, vc.chunk_index, vc.content, vc.metadata,
                vd.filename, vd.source, vd.is_global, vd.metadata as doc_metadata,
                1 - (vc.embedding <=> $1::vector) AS similarity
         FROM vault_chunks vc
         JOIN vault_documents vd ON vc.document_id = vd.id
         WHERE vc.document_id = $2 AND vc.embedding IS NOT NULL
         ORDER BY vc.embedding <=> $1::vector
         LIMIT $3`,
        [`[${embeddings[0].join(',')}]`, documentId, CANDIDATE_LIMIT]
      );
      const vecRows = (vecResult.rows || []).filter(r =>
        r.similarity != null && parseFloat(r.similarity) >= MIN_SIMILARITY
      );
      if (vecRows.length > 0) rankedLists.push(vecRows);
      logger.info('vault', `Document vector search: ${vecResult.rows?.length || 0} candidates, ${vecRows.length} above threshold`);
    }
  } catch (err) {
    logger.warn('vault', 'Document vector search failed', { error: err.message });
  }

  // ── Stage 1B: BM25 (keyword) search on document ──
  try {
    const cleanQuery = query
      .replace(/\$/g, '')
      .replace(/[^\w\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(w => w.length >= 2)
      .join(' & ');

    if (cleanQuery) {
      const bm25Result = await pg.query(
        `SELECT vc.id, vc.document_id, vc.chunk_index, vc.content, vc.metadata,
                vd.filename, vd.source, vd.is_global, vd.metadata as doc_metadata,
                ts_rank_cd(vc.search_vector, to_tsquery('english', $1)) AS bm25_rank
         FROM vault_chunks vc
         JOIN vault_documents vd ON vc.document_id = vd.id
         WHERE vc.document_id = $2 AND vc.search_vector @@ to_tsquery('english', $1)
         ORDER BY bm25_rank DESC
         LIMIT $3`,
        [cleanQuery, documentId, CANDIDATE_LIMIT]
      );
      const bm25Rows = bm25Result.rows || [];
      if (bm25Rows.length > 0) rankedLists.push(bm25Rows);
      logger.info('vault', `Document BM25 search: ${bm25Rows.length} matches`);
    }
  } catch (err) {
    logger.warn('vault', 'Document BM25 search failed', { error: err.message });
  }

  // ── Stage 2: Merge results ──
  if (rankedLists.length === 0) {
    return [];
  }

  let fused;
  if (rankedLists.length === 1) {
    fused = rankedLists[0];
  } else {
    fused = reciprocalRankFusion(rankedLists);
    logger.info('vault', `Document hybrid RRF: ${fused.length} unique passages`);
  }

  // ── Stage 3: Optional Cohere Reranking ──
  if (_cohereKey && fused.length > limit) {
    const reranked = await rerankWithCohere(query, fused, limit);
    logger.info('vault', `Document Cohere rerank: ${reranked.length} passages`);
    return reranked;
  }

  return fused.slice(0, limit);
}

/**
 * Get or generate a summary for a document.
 * If metadata.summary exists, return it. Otherwise, retrieve and summarize.
 */
async function getDocumentSummary(documentId, userId) {
  if (!pg.isConnected()) {
    return null;
  }

  // Check document exists and user has access
  const docResult = await pg.query(
    `SELECT id, filename, metadata, is_global, user_id FROM vault_documents WHERE id = $1`,
    [documentId]
  );
  if (!docResult.rows || docResult.rows.length === 0) {
    throw new Error('Document not found');
  }
  const doc = docResult.rows[0];
  if (doc.user_id !== userId && !doc.is_global) {
    throw new Error('Unauthorized');
  }

  // Return existing summary if available
  const metadata = doc.metadata || {};
  if (metadata.summary) {
    return metadata.summary;
  }

  // Generate summary from first 5 chunks
  try {
    const chunks = await pg.query(
      `SELECT content FROM vault_chunks WHERE document_id = $1 ORDER BY chunk_index ASC LIMIT 5`,
      [documentId]
    );
    const content = (chunks.rows || []).map(r => r.content).join('\n\n');
    if (!content || content.trim().length === 0) {
      return 'No content available for summary.';
    }

    // Use Haiku to generate summary
    if (!process.env.OPENAI_API_KEY) {
      return 'Summary generation not available.';
    }

    const fetch = require('node-fetch');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Summarize this document in 2-3 sentences:\n\n${content.slice(0, 2000)}`,
        }],
        max_tokens: 150,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      logger.warn('vault', 'Summary generation failed', { status: response.status });
      return null;
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content;

    if (summary) {
      // Cache the summary in metadata
      await pg.query(
        `UPDATE vault_documents SET metadata = jsonb_set(metadata, '{summary}', $1) WHERE id = $2`,
        [JSON.stringify(summary), documentId]
      );
    }

    return summary || null;
  } catch (err) {
    logger.error('vault', 'Error generating summary', { error: err.message });
    return null;
  }
}

/**
 * Extract text from image using OCR (tesseract.js).
 * Supports: PNG, JPG, JPEG, TIFF
 *
 * @param {Buffer} buffer - Image buffer
 * @param {string} mimetype - Image MIME type
 * @returns {Promise<string>} Extracted text
 * @throws {Error} If tesseract.js is not available or OCR fails
 */
async function extractTextFromImage(buffer, mimetype) {
  if (!Tesseract) {
    throw new Error(
      'OCR support is not available. Please contact support if you need to upload images. ' +
      'For now, please convert your image to PDF or another supported format (DOCX, TXT, CSV).'
    );
  }

  // Validate mimetype
  const supportedTypes = ['image/png', 'image/jpeg', 'image/tiff'];
  if (!supportedTypes.includes(mimetype)) {
    throw new Error(`Unsupported image type: ${mimetype}. Supported: PNG, JPEG, TIFF`);
  }

  try {
    logger.info('vault', 'Starting OCR on image', { mimetype });

    // Convert buffer to base64 data URL for Tesseract
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimetype};base64,${base64}`;

    // Run OCR with Tesseract.js
    const result = await Tesseract.recognize(dataUrl, 'eng');

    if (!result || !result.data || !result.data.text) {
      throw new Error('OCR produced no text output');
    }

    const extractedText = result.data.text.trim();

    if (!extractedText) {
      throw new Error('Image contains no recognizable text');
    }

    logger.info('vault', 'OCR complete', { textLength: extractedText.length });

    return extractedText;
  } catch (err) {
    logger.error('vault', 'OCR extraction failed', { error: err.message });
    throw new Error(`Failed to extract text from image: ${err.message}`);
  }
}

/**
 * Fetch content from a URL.
 * Supports: HTML, PDF, plain text
 *
 * @param {string} url - The URL to fetch
 * @param {number} maxSize - Maximum content size in bytes (default: 500KB)
 * @returns {Promise<{content: string, contentType: string}>} Fetched content and MIME type
 */
function fetchURL(url, maxSize = 500 * 1024) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate',
        },
        timeout: 10000,
      };

      const req = client.request(url, options, (res) => {
        // Follow redirects (max 5)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchURL(res.headers.location, maxSize)
            .then(resolve)
            .catch(reject);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }

        const contentType = res.headers['content-type'] || 'text/plain';
        let chunks = [];
        let totalSize = 0;

        res.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > maxSize) {
            req.destroy();
            return reject(new Error(`Content exceeds ${maxSize / 1024 / 1024}MB limit`));
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          const content = Buffer.concat(chunks).toString('utf-8');
          resolve({ content, contentType });
        });

        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('URL fetch timeout (10s)'));
      });

      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Extract main content from HTML (strip nav, footer, ads, scripts, styles).
 * Uses simple regex-based parsing for lightweight extraction.
 *
 * @param {string} html - Raw HTML content
 * @returns {string} Extracted main text content
 */
function extractMainContentFromHTML(html) {
  // Remove script and style tags
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove nav, footer, header, aside (common structural elements)
  text = text
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '')
    .replace(/<div\s+class="[^"]*(?:nav|menu|sidebar|ad|advertisement|cookie)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

  // Collapse whitespace
  text = text
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

/**
 * Ingest a document from a URL.
 * Fetches content, determines type (HTML/PDF/text), extracts text, and ingests normally.
 *
 * @param {string} url - The URL to ingest
 * @param {number} userId - User ID
 * @param {string} title - Optional document title (defaults to URL)
 * @returns {Promise<object>} Result object with documentId, chunks, filename
 */
async function ingestFromUrl(url, userId, title = null) {
  if (!pg.isConnected()) {
    try { await pg.query('SELECT 1'); } catch (e) { swallow(e, 'vault.lazy_reconnect.ingestFromUrl'); }
    if (!pg.isConnected()) {
      throw new Error('Postgres not connected — database may be starting up. Please try again in a minute.');
    }
  }

  try {
    // Validate and normalize URL
    const parsedUrl = new URL(url);
    const urlString = parsedUrl.toString();

    logger.info('vault', 'Fetching URL', { userId, url: urlString });

    // Fetch content from URL
    const { content, contentType } = await fetchURL(urlString);

    if (!content || !content.trim()) {
      throw new Error('URL returned empty content');
    }

    let text = '';
    let fileType = 'web';
    const filename = title || parsedUrl.hostname;

    // Process based on content type
    if (contentType.includes('application/pdf')) {
      // Handle PDF URLs
      logger.info('vault', 'Processing PDF from URL', { url: urlString });
      const pdfParse = require('pdf-parse');
      const buffer = Buffer.from(content, 'binary');
      try {
        const pdfData = await pdfParse(buffer, { max: 500 });
        text = pdfData.text || '';
        fileType = 'pdf';
      } catch (err) {
        logger.warn('vault', 'PDF parsing failed for URL', { error: err.message });
        throw new Error(`Unable to parse PDF from URL: ${err.message}`);
      }
    } else if (contentType.includes('text/html')) {
      // Extract main content from HTML
      logger.info('vault', 'Processing HTML from URL', { url: urlString });
      text = extractMainContentFromHTML(content);
      fileType = 'html';
    } else {
      // Treat as plain text
      text = content;
      fileType = 'text';
    }

    // Validate extracted text
    if (!text.trim()) {
      throw new Error('URL contains no extractable text');
    }

    if (text.length > 2_000_000) {
      throw new Error('URL content exceeds 2MB limit');
    }

    // Create metadata with source URL
    const metadata = {
      fileType,
      source_url: urlString,
      url_hostname: parsedUrl.hostname,
      ingest_type: 'url',
    };

    // Ingest normally via ingestFile
    const result = await ingestFile(userId, Buffer.from(text), `${filename}.txt`, metadata, false);

    logger.info('vault', 'URL ingested successfully', {
      userId,
      url: urlString,
      documentId: result.documentId,
      chunks: result.chunks,
    });

    return {
      ...result,
      source_url: urlString,
      ingest_type: 'url',
    };
  } catch (err) {
    logger.error('vault', 'URL ingestion error', { error: err.message, url });
    throw err;
  }
}

/**
 * Diagnostic: find documents with chunks from multiple embedding providers.
 * These documents will have degraded retrieval because cosine similarity
 * is meaningless across different embedding spaces.
 */
async function getMixedProviderDocuments() {
  if (!pg.isConnected()) return [];
  try {
    const result = await pg.query(`
      SELECT vc.document_id, vd.filename, vd.user_id,
             array_agg(DISTINCT vc.embedding_provider) AS providers,
             COUNT(*) AS chunk_count
      FROM vault_chunks vc
      JOIN vault_documents vd ON vc.document_id = vd.id
      WHERE vc.embedding IS NOT NULL
      GROUP BY vc.document_id, vd.filename, vd.user_id
      HAVING COUNT(DISTINCT vc.embedding_provider) > 1
    `);
    return result.rows || [];
  } catch (err) {
    logger.warn('vault', 'Mixed provider diagnostic failed', { error: err.message });
    return [];
  }
}

module.exports = {
  init,
  ensureTable,
  ingestPDF,
  ingestFile,
  ingestFromUrl,
  extractTextFromImage,
  chunkText,
  chunkTextWithType,
  detectDocumentType,
  chunkEarningsTranscript,
  chunkResearchReport,
  chunkFinancialTable,
  chunkMacroCommentary,
  chunkFiling,
  embed,
  getEmbeddingProvider,
  retrieve,
  retrieveFromDocument,
  getDocumentSummary,
  formatForPrompt,
  getUserDocuments,
  getGlobalDocuments,
  deleteDocument,
  getMixedProviderDocuments,
  // Phase 6: Job queue exports
  createIngestionJob,
  getIngestionJob,
  getUserJobs,
  enqueueIngestionJob,
};
