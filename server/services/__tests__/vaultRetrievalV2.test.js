/**
 * vaultRetrievalV2.test.js — retrieval v2 regression guard (audit 6.2-6.5).
 *
 * Covers the retrieve() pipeline changes with a stubbed pg (same pattern
 * as vault.duplicate-detection.test.js — no live Postgres, no network):
 *   - keyword arm uses websearch_to_tsquery and falls back to
 *     plainto_tsquery when it fails (old-Postgres degradation)
 *   - detected tickers are OR-ed in as exact unstemmed 'simple' lexemes
 *   - Portuguese-looking queries get a second, portuguese-regconfig arm
 *   - per-document diversity caps: max 6 candidates + max 4 final results
 *     per document, with backfill from remaining candidates
 *   - candidate shaping: boilerplate chunks sink, recency is a bounded
 *     tiebreak (floor 0.7), and shaping is fail-open
 *
 * No embedding keys are set, so the vector arm degrades to null embeddings
 * (existing behavior) and the keyword arm drives the pipeline — exactly
 * the degraded-mode path that must keep working.
 *
 * Run:
 *   node --test server/services/__tests__/vaultRetrievalV2.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.VAULT_QUERY_REWRITE = '0'; // rewrite step off — this file tests the SQL arms
delete process.env.ANTHROPIC_API_KEY;
delete process.env.COHERE_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.VOYAGE_API_KEY;

// ── Stub pg before vault is require()d ───────────────────────────────────
const pgPath = require.resolve('../../db/postgres');
const queries = []; // { sql, params }
let _handler = async () => ({ rows: [] });

require.cache[pgPath] = {
  id: pgPath,
  filename: pgPath,
  loaded: true,
  exports: {
    isConnected: () => true,
    query: async (sql, params) => {
      queries.push({ sql, params });
      return _handler(sql, params);
    },
    getPool: () => null,
    getDiagnostics: () => ({ connected: true, urlSet: true, schemaReady: true, reconnecting: false }),
  },
  children: [],
  paths: [],
};

const vault = require('../vault');

function chunk(id, documentId, content, extra = {}) {
  return {
    id,
    document_id: documentId,
    chunk_index: id,
    content,
    metadata: {},
    filename: `doc-${documentId}.pdf`,
    source: 'upload',
    is_global: false,
    doc_metadata: {},
    bm25_rank: 1,
    ...extra,
  };
}

function reset(handler) {
  queries.length = 0;
  _handler = handler || (async () => ({ rows: [] }));
}

const isKeywordSql = (sql) => /ts_rank_cd/.test(sql) && /search_vector/.test(sql);

// ── Keyword arm: websearch semantics + fallback ──────────────────────────

test('keyword arm uses websearch_to_tsquery', async () => {
  reset(async (sql) => {
    if (isKeywordSql(sql)) return { rows: [chunk(1, 10, 'Brent outlook remains constructive'), chunk(2, 10, 'OPEC supply discipline')] };
    return { rows: [] };
  });
  const out = await vault.retrieve(7, 'what is the outlook for oil prices');
  const kw = queries.filter(q => isKeywordSql(q.sql));
  assert.ok(kw.length >= 1, 'keyword query ran');
  assert.match(kw[0].sql, /websearch_to_tsquery/);
  assert.doesNotMatch(kw[0].sql, /\bto_tsquery\('english'/, 'no manual AND-join tsquery');
  assert.equal(out.length, 2);
});

test('keyword arm falls back to plainto_tsquery when websearch_to_tsquery fails', async () => {
  reset(async (sql) => {
    if (/websearch_to_tsquery/.test(sql)) throw new Error('function websearch_to_tsquery(regconfig, text) does not exist');
    if (isKeywordSql(sql)) return { rows: [chunk(1, 10, 'fallback row content here')] };
    return { rows: [] };
  });
  const out = await vault.retrieve(7, 'oil price outlook');
  const attempts = queries.filter(q => isKeywordSql(q.sql));
  assert.ok(attempts.some(q => /websearch_to_tsquery/.test(q.sql)), 'websearch tried first');
  assert.ok(attempts.some(q => /plainto_tsquery/.test(q.sql)), 'plainto fallback tried');
  assert.equal(out.length, 1, 'fallback rows survive to the caller');
});

test('detected tickers are OR-ed in as exact unstemmed simple-config lexemes', async () => {
  reset(async (sql) => {
    if (isKeywordSql(sql)) return { rows: [chunk(1, 10, 'PETR4 target price raised')] };
    return { rows: [] };
  });
  await vault.retrieve(7, 'outlook for PETR4 dividends');
  const kw = queries.find(q => isKeywordSql(q.sql));
  assert.ok(kw, 'keyword query ran');
  assert.match(kw.sql, /to_tsquery\('simple'/, 'exact-match ticker clause present');
  assert.ok(kw.params.includes('petr4'), `ticker lexeme passed as param (${JSON.stringify(kw.params)})`);
});

test('queries without tickers do not add the exact-match clause', async () => {
  reset();
  await vault.retrieve(7, 'what is the outlook for inflation');
  const kw = queries.find(q => isKeywordSql(q.sql));
  assert.ok(kw);
  assert.doesNotMatch(kw.sql, /to_tsquery\('simple'/);
});

// ── Portuguese arm ────────────────────────────────────────────────────────

test('Portuguese-looking query runs english AND portuguese keyword arms', async () => {
  reset();
  await vault.retrieve(7, 'qual a perspectiva para o petroleo?');
  const configs = queries.filter(q => isKeywordSql(q.sql)).map(q => q.params[0]);
  assert.ok(configs.includes('english'), 'english arm ran');
  assert.ok(configs.includes('portuguese'), 'portuguese arm ran');
});

test('English query runs only the english keyword arm', async () => {
  reset();
  await vault.retrieve(7, 'US inflation outlook next year');
  const configs = queries.filter(q => isKeywordSql(q.sql)).map(q => q.params[0]);
  assert.deepEqual(configs, ['english']);
});

test('VAULT_KEYWORD_PT=0 disables the portuguese arm', async () => {
  process.env.VAULT_KEYWORD_PT = '0';
  try {
    reset();
    await vault.retrieve(7, 'qual a perspectiva para o petroleo?');
    const configs = queries.filter(q => isKeywordSql(q.sql)).map(q => q.params[0]);
    assert.deepEqual(configs, ['english']);
  } finally {
    delete process.env.VAULT_KEYWORD_PT;
  }
});

// ── Diversity caps ────────────────────────────────────────────────────────

test('one document cannot fill every final slot (cap 4 of 8, backfilled)', async () => {
  // Doc 1 owns the top 10 ranks; doc 2 has 6 more below.
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(chunk(100 + i, 1, `doc one passage number ${i} about oil markets`));
  for (let i = 0; i < 6; i++) rows.push(chunk(200 + i, 2, `doc two passage number ${i} about oil markets`));
  reset(async (sql) => (isKeywordSql(sql) ? { rows } : { rows: [] }));

  const out = await vault.retrieve(7, 'oil market outlook', 8);
  assert.equal(out.length, 8, 'still returns a full result set');
  const perDoc = new Map();
  for (const p of out) perDoc.set(p.document_id, (perDoc.get(p.document_id) || 0) + 1);
  assert.equal(perDoc.get(1), vault.MAX_PER_DOC_FINAL, `doc 1 capped at ${vault.MAX_PER_DOC_FINAL}`);
  assert.equal(perDoc.get(2), 4, 'doc 2 backfills the freed slots');
});

test('_capPerDocument keeps order and drops overflow only', () => {
  const rows = [
    chunk(1, 1, 'a'), chunk(2, 1, 'b'), chunk(3, 2, 'c'),
    chunk(4, 1, 'd'), chunk(5, 1, 'e'), chunk(6, 2, 'f'),
  ];
  const capped = vault._capPerDocument(rows, 2);
  assert.deepEqual(capped.map(r => r.id), [1, 2, 3, 6]);
  // Degenerate inputs are passed through untouched.
  assert.equal(vault._capPerDocument(null, 2), null);
  assert.deepEqual(vault._capPerDocument(rows, 0), rows);
});

// ── Candidate shaping: boilerplate + recency ─────────────────────────────

test('boilerplate contact-block chunk sinks below real content in shaping', () => {
  const boiler = chunk(1, 1,
    'Caio Ribeiro - caio.ribeiro@bofa.com - T: +55 (11) 2188-4375 ' +
    'Leonardo Marcondes - leonardo.marcondes@bofa.com - T: +55 (11) 2188-4102',
    { _rrf_score: 0.032 }); // ranked FIRST by fusion — the live failure mode
  const real = chunk(2, 2,
    'We expect Brent to average USD 85/bbl in 2H26 as OPEC+ supply discipline offsets softer demand.',
    { _rrf_score: 0.030 });
  const shaped = vault._applyCandidateShaping([boiler, real]);
  assert.equal(shaped[0].id, 2, 'real content outranks the contact block');
  assert.ok(shaped.find(r => r.id === 1)._boilerplate_score > 0.6);
  assert.ok(shaped.find(r => r.id === 1)._adjusted_score < shaped.find(r => r.id === 2)._adjusted_score);
});

test('recency decay is a bounded tiebreak: half-life 180d, floor 0.7', () => {
  const now = Date.UTC(2026, 6, 15);
  const day = 86_400_000;
  const fresh = vault._recencyFactor({ doc_created_at: new Date(now - 1 * day) }, now);
  const half = vault._recencyFactor({ doc_created_at: new Date(now - 180 * day) }, now);
  const ancient = vault._recencyFactor({ doc_created_at: new Date(now - 3650 * day) }, now);
  assert.ok(fresh > 0.99 && fresh <= 1);
  assert.ok(Math.abs(half - Math.max(0.7, 0.5)) < 1e-9, `half-life point hits the 0.7 floor (got ${half})`);
  assert.equal(ancient, 0.7, 'floor holds — age can never dominate');
  // doc_metadata.date (report date) wins over upload date; missing dates -> 1.
  const metaDated = vault._recencyFactor({ doc_metadata: { date: '2026-07-14' }, doc_created_at: new Date(now - 3650 * day) }, now);
  assert.ok(metaDated > 0.99);
  assert.equal(vault._recencyFactor({}), 1);
  assert.equal(vault._recencyFactor({ doc_metadata: { date: 'not a date' } }), 1);
});

test('shaping is fail-open on malformed candidates', () => {
  const weird = [null, undefined, { content: 42, document_id: 1 }];
  let out;
  assert.doesNotThrow(() => { out = vault._applyCandidateShaping(weird); });
  assert.ok(Array.isArray(out), 'returns an array, never throws');
});

// ── Zero-result behavior preserved ───────────────────────────────────────

test('no arm results -> empty array (no fake fallback context)', async () => {
  reset();
  const out = await vault.retrieve(7, 'query matching nothing at all');
  assert.deepEqual(out, []);
});
