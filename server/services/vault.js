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

// ── Constants ──
const CHUNK_SIZE = 1000; // chars per chunk — larger for financial context retention
const CHUNK_OVERLAP = 150; // overlap between chunks — preserves cross-boundary context
const MAX_RETRIEVAL = 8; // top candidates before similarity filtering
const MIN_SIMILARITY = 0.65; // discard passages below this threshold — irrelevant noise is worse than nothing
const EMBEDDING_MODEL = 'text-embedding-3-small';
const VOYAGE_EMBEDDING_DIM = 1024;
const OPENAI_EMBEDDING_DIM = 1536;
const STORED_EMBEDDING_DIM = 1536; // vault_chunks.embedding column is vector(1536)

let _openaiKey = null;
let _voyageKey = null;
let _cohereKey = null;
let _embeddingDim = OPENAI_EMBEDDING_DIM;
let _activeEmbeddingProvider = 'openai';

/**
 * Initialize the vault service with API keys.
 * Priority: Voyage AI (finance-optimized) > OpenAI (fallback)
 * Cohere reranking is optional and used post-retrieval if available.
 */
function init({ openaiKey, voyageKey, cohereKey } = {}) {
  _voyageKey = voyageKey || process.env.VOYAGE_API_KEY;
  _openaiKey = openaiKey || process.env.OPENAI_API_KEY;
  _cohereKey = cohereKey || process.env.COHERE_API_KEY;

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
}

/**
 * Create vault tables if they don't exist.
 * Uses try/catch to gracefully degrade if pgvector extension is unavailable.
 */
async function ensureTable() {
  if (!pg.isConnected()) {
    // Attempt lazy reconnect before giving up
    try { await pg.query('SELECT 1'); } catch {}
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
    // BM25 full-text search column (generated, auto-maintained by Postgres)
    await alterSafe(`ALTER TABLE vault_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`);

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
  } catch (err) {
    logger.error('vault', 'Table creation error', { error: err.message });
    throw err;
  }
}

/**
 * Chunk text into overlapping segments.
 * Splits by sentences and accumulates until reaching chunkSize chars.
 */
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
 */
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
 * Ingest a PDF, parse text, chunk, embed, and store.
 */
async function ingestPDF(userId, buffer, filename, { isGlobal = false } = {}) {
  // Attempt lazy reconnect if pool is dead — the new postgres.js handles this
  if (!pg.isConnected()) {
    // Trigger a lazy reconnect via a lightweight query
    try { await pg.query('SELECT 1'); } catch {}
    if (!pg.isConnected()) {
      throw new Error('Postgres not connected — database may be starting up. Please try again in a minute.');
    }
  }

  try {
    // Sanitize filename before storing
    filename = (filename || 'untitled.pdf')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')  // Remove dangerous chars
      .replace(/\.{2,}/g, '.')                     // Remove path traversal
      .slice(0, 255);                              // Limit length

    // Compute SHA-256 hash of raw buffer for duplicate detection
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Check for existing document with same hash for this user
    const existingResult = await pg.query(
      `SELECT id, filename FROM vault_documents WHERE user_id = $1 AND content_hash = $2 LIMIT 1`,
      [userId, contentHash]
    );

    if (existingResult.rows && existingResult.rows.length > 0) {
      const existingDoc = existingResult.rows[0];
      logger.info('vault', 'Duplicate PDF detected', {
        userId,
        filename,
        existingDocId: existingDoc.id,
        existingFilename: existingDoc.filename,
      });
      return {
        duplicate: true,
        existingDocId: existingDoc.id,
        filename: existingDoc.filename,
      };
    }

    // Parse PDF — robust handling for all PDF types
    let text = '';
    let pageCount = 0;
    try {
      const pdfParse = require('pdf-parse');
      // pdf-parse options: max pages, disable rendering for speed
      const pdfData = await pdfParse(buffer, {
        max: 500, // stop after 500 pages
      });
      text = pdfData.text || '';
      pageCount = pdfData.numpages || 0;
    } catch (parseErr) {
      // pdf-parse can fail on encrypted, malformed, or complex PDFs
      // Try a more lenient extraction as fallback
      logger.warn('vault', 'Primary PDF parse failed, trying fallback', { error: parseErr.message });
      try {
        const pdfParse = require('pdf-parse');
        // Retry with render callback that's more forgiving
        const pdfData = await pdfParse(buffer, {
          max: 500,
          pagerender: function(pageData) {
            return pageData.getTextContent().then(function(textContent) {
              return textContent.items.map(item => item.str).join(' ');
            });
          },
        });
        text = pdfData.text || '';
        pageCount = pdfData.numpages || 0;
      } catch (fallbackErr) {
        logger.error('vault', 'PDF parse fallback also failed', { error: fallbackErr.message });
        throw new Error(`Unable to read this PDF: ${parseErr.message}. The file may be encrypted, image-only, or in an unsupported format.`);
      }
    }

    // Validate PDF size constraints
    if (text && text.length > 2_000_000) {
      throw new Error('PDF text content exceeds 2MB limit');
    }

    if (!text.trim()) {
      throw new Error('This PDF contains no extractable text. It may be a scanned document or image-only PDF.');
    }

    // Extract metadata
    const metadata = extractMetadata(text);
    metadata.pageCount = pageCount;

    // Create document record with content hash
    const docResult = await pg.query(
      `INSERT INTO vault_documents (user_id, filename, source, is_global, metadata, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, filename, 'upload', isGlobal, JSON.stringify(metadata), contentHash]
    );

    const documentId = docResult.rows[0].id;

    // Chunk text
    const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);

    if (chunks.length === 0) {
      throw new Error('No chunks produced from text');
    }

    // Embed chunks
    const embeddings = await embed(chunks);

    // Store chunks — batch insert for performance on large PDFs
    const DB_BATCH = 10;
    for (let i = 0; i < chunks.length; i += DB_BATCH) {
      const batch = chunks.slice(i, i + DB_BATCH);
      const promises = batch.map((chunk, j) => {
        const idx = i + j;
        const chunkMetadata = { chunkIndex: idx, totalChunks: chunks.length };
        return pg.query(
          `INSERT INTO vault_chunks (document_id, user_id, chunk_index, content, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            documentId,
            userId,
            idx,
            chunk,
            embeddings[idx] ? `[${embeddings[idx].join(',')}]` : null,
            JSON.stringify(chunkMetadata),
          ]
        );
      });
      await Promise.all(promises);
    }

    logger.info('vault', 'PDF ingested', {
      userId,
      filename,
      documentId,
      chunks: chunks.length,
    });

    return {
      documentId,
      chunks: chunks.length,
      filename,
    };
  } catch (err) {
    logger.error('vault', 'PDF ingestion error', { error: err.message });
    throw err;
  }
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
      logger.warn('vault', 'Cohere rerank timeout (3s) — using RRF results');
    } else {
      logger.warn('vault', 'Cohere rerank error', { error: err.message });
    }
    return passages; // Fall back to RRF results on any error
  }
}

async function retrieve(userId, query, limit = MAX_RETRIEVAL) {
  if (!pg.isConnected()) {
    return [];
  }

  const rankedLists = [];
  const CANDIDATE_LIMIT = 30; // pull more candidates for RRF merging

  // ── Stage 1A: Vector (semantic) search ──
  try {
    const embeddings = await embed([query]);
    if (embeddings[0]) {
      const vecResult = await pg.query(
        `SELECT vc.id, vc.document_id, vc.chunk_index, vc.content, vc.metadata,
                vd.filename, vd.source, vd.is_global, vd.metadata as doc_metadata,
                1 - (vc.embedding <=> $1::vector) AS similarity
         FROM vault_chunks vc
         JOIN vault_documents vd ON vc.document_id = vd.id
         WHERE (vc.user_id = $2 OR vd.is_global = TRUE) AND vc.embedding IS NOT NULL
         ORDER BY vc.embedding <=> $1::vector
         LIMIT $3`,
        [`[${embeddings[0].join(',')}]`, userId, CANDIDATE_LIMIT]
      );
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

  // ── Stage 2: Reciprocal Rank Fusion ──
  if (rankedLists.length === 0) {
    logger.info('vault', 'No retrieval results from any method');
    return [];
  }

  let fused;
  if (rankedLists.length === 1) {
    // Single method — use its results directly
    fused = rankedLists[0];
  } else {
    // Merge with RRF
    fused = reciprocalRankFusion(rankedLists);
    logger.info('vault', `Hybrid RRF: ${fused.length} unique passages from ${rankedLists.length} methods`);
  }

  // ── Stage 3: Optional Cohere Reranking ──
  // If we have more candidates than needed and Cohere is available, rerank for better relevance
  if (_cohereKey && fused.length > limit) {
    const reranked = await rerankWithCohere(query, fused, limit);
    logger.info('vault', `Cohere rerank: ${reranked.length} passages returned`);
    return reranked;
  }

  return fused.slice(0, limit);
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

  if (centralPassages.length > 0) {
    ctx += '\n--- CENTRAL RESEARCH VAULT (professional reports curated by Particle) ---\n';
    for (const p of centralPassages) {
      const docMeta = p.doc_metadata || {};
      const source = docMeta.bank || p.filename || 'Unknown source';
      const date = docMeta.date || '';
      const tickers = docMeta.tickers
        ? ` [${Array.isArray(docMeta.tickers) ? docMeta.tickers.join(', ') : docMeta.tickers}]`
        : '';
      ctx += `[Source: ${source}${date ? ` (${date})` : ''}${tickers}]\n`;
      ctx += `${p.content.slice(0, 500)}${p.content.length > 500 ? '...' : ''}\n\n`;
    }
    ctx += '--- END CENTRAL VAULT ---\n';
  }

  if (privatePassages.length > 0) {
    ctx += '\n--- USER VAULT (private research documents) ---\n';
    for (const p of privatePassages) {
      const docMeta = p.doc_metadata || {};
      const source = docMeta.bank || p.filename || 'Unknown source';
      const date = docMeta.date || '';
      const tickers = docMeta.tickers
        ? ` [${Array.isArray(docMeta.tickers) ? docMeta.tickers.join(', ') : docMeta.tickers}]`
        : '';
      ctx += `[Source: ${source}${date ? ` (${date})` : ''}${tickers}]\n`;
      ctx += `${p.content.slice(0, 500)}${p.content.length > 500 ? '...' : ''}\n\n`;
    }
    ctx += '--- END USER VAULT ---\n';
  }

  ctx += 'When answering, cite specific sources from the vault if relevant.\n';

  return ctx;
}

/**
 * Get user's private vault documents.
 */
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
       ORDER BY created_at DESC`,
      [userId]
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
       ORDER BY created_at DESC`
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

module.exports = {
  init,
  ensureTable,
  ingestPDF,
  chunkText,
  embed,
  retrieve,
  formatForPrompt,
  getUserDocuments,
  getGlobalDocuments,
  deleteDocument,
};
