/**
 * citationEval.test.js — W4.5 regression guard.
 *
 * Proves the IR metrics are computed correctly against a mock retriever,
 * so when we later wire this harness to vault.retrieve() in CI the
 * numbers we see are trustworthy.
 *
 * Covered cases:
 *   - Perfect retrieval → hit=1, recall=1, precision=1, MRR=1
 *   - Zero overlap → all metrics = 0, but the harness does not throw
 *   - First expected at rank 3 → RR = 1/3
 *   - Partial recall (2 of 3 expected in top-5) → recall = 2/3
 *   - Retriever throw → counted as error, not crash
 *   - Empty retrieval handled safely
 *   - Duplicate docs in retriever output collapsed by extractDocIds
 *   - Concurrency > 1 still produces deterministic per-query results
 *
 * Run:
 *   node --test server/eval/__tests__/citationEval.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreRun, scoreOne, extractDocIds, formatReport } = require('../citationEval');

// ── extractDocIds ────────────────────────────────────────────────────────

test('extractDocIds: handles the real vault.retrieve shape', () => {
  const passages = [
    { id: 101, document_id: 42, filename: 'a.pdf', similarity: 0.9 },
    { id: 102, document_id: 42, filename: 'a.pdf', similarity: 0.85 },
    { id: 201, document_id: 77, filename: 'b.pdf', similarity: 0.7 },
  ];
  // Same document appearing in multiple chunks should count once.
  assert.deepEqual(extractDocIds(passages), [42, 77]);
});

test('extractDocIds: falls back to doc_id / id fields', () => {
  assert.deepEqual(extractDocIds([{ doc_id: 5 }]), [5]);
  assert.deepEqual(extractDocIds([{ id: 9 }]), [9]);
});

test('extractDocIds: tolerates junk', () => {
  assert.deepEqual(extractDocIds(null), []);
  assert.deepEqual(extractDocIds([]), []);
  assert.deepEqual(extractDocIds([null, {}, undefined, { filename: 'no-id' }]), []);
});

// ── scoreOne — per-query metric math ──────────────────────────────────────

test('scoreOne: perfect retrieval', () => {
  const r = scoreOne(
    { id: 'q1', query: 'x', expectedDocumentIds: [1, 2] },
    [1, 2, 3, 4, 5],
    5
  );
  assert.equal(r.hit, true);
  assert.equal(r.recall, 1);
  assert.equal(r.precision, 2 / 5);  // 2 of top-5 are expected
  assert.equal(r.reciprocalRank, 1); // first hit at rank 1
});

test('scoreOne: first expected at rank 3 → RR = 1/3', () => {
  const r = scoreOne(
    { id: 'q1', query: 'x', expectedDocumentIds: [42] },
    [5, 6, 42, 7, 8],
    5
  );
  assert.equal(r.hit, true);
  assert.equal(r.recall, 1);
  assert.equal(r.precision, 1 / 5);
  assert.ok(Math.abs(r.reciprocalRank - 1 / 3) < 1e-12);
});

test('scoreOne: zero overlap → all zeros, no throw', () => {
  const r = scoreOne(
    { id: 'q1', query: 'x', expectedDocumentIds: [100, 200] },
    [1, 2, 3, 4, 5],
    5
  );
  assert.equal(r.hit, false);
  assert.equal(r.recall, 0);
  assert.equal(r.precision, 0);
  assert.equal(r.reciprocalRank, 0);
});

test('scoreOne: partial recall (2 of 3 expected)', () => {
  const r = scoreOne(
    { id: 'q1', query: 'x', expectedDocumentIds: [1, 2, 3] },
    [1, 2, 4, 5, 6],
    5
  );
  assert.equal(r.hit, true);
  assert.ok(Math.abs(r.recall - 2 / 3) < 1e-12);
  assert.equal(r.precision, 2 / 5);
  assert.equal(r.reciprocalRank, 1);
});

test('scoreOne: top-k truncation bites — expected is at rank 6, k=5', () => {
  const r = scoreOne(
    { id: 'q1', query: 'x', expectedDocumentIds: [42] },
    [1, 2, 3, 4, 5, 42], // expected at rank 6
    5
  );
  assert.equal(r.hit, false, 'rank 6 should not count when k=5');
  assert.equal(r.reciprocalRank, 0);
});

test('scoreOne: empty retrieval', () => {
  const r = scoreOne(
    { id: 'q1', query: 'x', expectedDocumentIds: [1] },
    [],
    5
  );
  assert.equal(r.hit, false);
  assert.equal(r.recall, 0);
  assert.equal(r.precision, 0);
  assert.equal(r.reciprocalRank, 0);
});

test('scoreOne: empty expected set', () => {
  const r = scoreOne(
    { id: 'q1', query: 'x', expectedDocumentIds: [] },
    [1, 2, 3],
    5
  );
  // Undefined ground truth → recall should be 0 by convention, no crash.
  assert.equal(r.hit, false);
  assert.equal(r.recall, 0);
});

// ── scoreRun — aggregation + retriever handling ──────────────────────────

test('scoreRun: macro-averaged aggregates are correct', async () => {
  const queries = [
    { id: 'a', query: 'a', expectedDocumentIds: [1] }, // perfect hit
    { id: 'b', query: 'b', expectedDocumentIds: [2] }, // miss
    { id: 'c', query: 'c', expectedDocumentIds: [3] }, // hit at rank 3
  ];
  const retriever = async (q) => {
    if (q === 'a') return [{ document_id: 1 }];
    if (q === 'b') return [{ document_id: 99 }];
    if (q === 'c') return [{ document_id: 5 }, { document_id: 6 }, { document_id: 3 }];
    return [];
  };

  const { perQuery, aggregate } = await scoreRun({ queries, retriever, k: 5 });
  assert.equal(perQuery.length, 3);
  assert.equal(aggregate.queries, 3);
  assert.equal(aggregate.errors, 0);
  assert.ok(Math.abs(aggregate.hitRateAtK - 2 / 3) < 1e-12);    // a + c hit
  assert.ok(Math.abs(aggregate.recallAtK - 2 / 3) < 1e-12);     // 1 + 0 + 1 / 3
  // MRR = (1 + 0 + 1/3) / 3 = 4/9
  assert.ok(Math.abs(aggregate.mrr - 4 / 9) < 1e-12);
});

test('scoreRun: retriever throw is counted as error, not crash', async () => {
  const queries = [
    { id: 'a', query: 'ok', expectedDocumentIds: [1] },
    { id: 'b', query: 'boom', expectedDocumentIds: [2] },
  ];
  const retriever = async (q) => {
    if (q === 'boom') throw new Error('retriever exploded');
    return [{ document_id: 1 }];
  };
  const { perQuery, aggregate } = await scoreRun({ queries, retriever, k: 5 });
  assert.equal(aggregate.errors, 1);
  const bad = perQuery.find(r => r.id === 'b');
  assert.equal(bad.error, 'retriever exploded');
  assert.equal(bad.hit, false);
  // The good query still contributed to the aggregate.
  assert.equal(perQuery.find(r => r.id === 'a').hit, true);
});

test('scoreRun: requires retriever', async () => {
  await assert.rejects(
    () => scoreRun({ queries: [], retriever: null }),
    /retriever function is required/
  );
});

test('scoreRun: concurrency > 1 preserves per-query order', async () => {
  const queries = Array.from({ length: 10 }, (_, i) => ({
    id: `q${i}`, query: `q${i}`, expectedDocumentIds: [i],
  }));
  const retriever = async (q) => {
    // Random microdelay to force interleaving
    await new Promise(r => setTimeout(r, Math.random() * 3));
    const i = Number(q.replace('q', ''));
    return [{ document_id: i }];
  };
  const { perQuery } = await scoreRun({ queries, retriever, k: 5, concurrency: 4 });
  for (let i = 0; i < 10; i++) {
    assert.equal(perQuery[i].id, `q${i}`);
    assert.equal(perQuery[i].hit, true);
  }
});

// ── formatReport — CI log output ─────────────────────────────────────────

test('formatReport: renders aggregate line with stable formatting', () => {
  const result = {
    perQuery: [],
    aggregate: {
      queries: 5, errors: 0,
      hitRateAtK: 0.8, recallAtK: 0.7, precisionAtK: 0.3, mrr: 0.65,
    },
  };
  const out = formatReport(result, { k: 5 });
  assert.match(out, /queries=5/);
  assert.match(out, /Hit@5\s*:\s*0\.800/);
  assert.match(out, /Recall@5\s*:\s*0\.700/);
  assert.match(out, /Precision@5\s*:\s*0\.300/);
  assert.match(out, /MRR\s*:\s*0\.650/);
});

test('formatReport: verbose mode shows per-query lines', () => {
  const result = {
    perQuery: [
      { id: 'a', query: 'x', expected: [1], retrieved: [1], hit: true, recall: 1, precision: 0.2, reciprocalRank: 1 },
      { id: 'b', query: 'y', expected: [2], retrieved: [9], hit: false, recall: 0, precision: 0, reciprocalRank: 0 },
    ],
    aggregate: { queries: 2, errors: 0, hitRateAtK: 0.5, recallAtK: 0.5, precisionAtK: 0.1, mrr: 0.5 },
  };
  const out = formatReport(result, { k: 5, verbose: true });
  assert.match(out, /\[a\].*HIT/);
  assert.match(out, /\[b\].*MISS/);
});
