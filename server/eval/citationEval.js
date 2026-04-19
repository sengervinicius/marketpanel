/**
 * citationEval.js — W4.5 citation-accuracy eval harness.
 *
 * Given a fixture set of (query → expected_document_ids) tuples and a
 * retrieval function, compute the standard IR metrics we care about:
 *
 *   Hit@k           — did ANY expected doc land in top-k? (binary per query)
 *   Recall@k        — fraction of expected docs present in top-k
 *   Precision@k     — fraction of top-k results that are expected
 *   MRR             — Mean Reciprocal Rank of first correct hit (0 if none)
 *
 * Aggregates are macro-averaged across queries (every query weights the
 * same), which is the right choice for a citation-accuracy CI gate
 * because it doesn't let a few high-passage queries dominate.
 *
 * This module deliberately takes the retriever as a parameter rather
 * than importing vault.js directly. That keeps it unit-testable without
 * spinning up pg / embedding providers, and lets future slices wire up
 * alternative retrievers (BM25-only, semantic-only, etc.) for A/B work.
 *
 * Usage (CI or manual):
 *   const { scoreRun } = require('./citationEval');
 *   const fixtures = require('./fixtures/citationEval.fixtures.json');
 *   const { vault } = require('../services/vault');
 *   const result = await scoreRun({
 *     queries: fixtures,
 *     retriever: (q) => vault.retrieve(USER_ID, q, 8),
 *     k: 5,
 *   });
 *   if (result.aggregate.recallAtK < 0.70) throw new Error('regressed');
 */
'use strict';

/**
 * @typedef {Object} EvalQuery
 * @property {string} id                    - Stable identifier (e.g. "br-selic-01")
 * @property {string} query                 - The user's question
 * @property {number[]} expectedDocumentIds - At least one must appear in top-k
 * @property {string} [note]                - Human comment for review
 */

/**
 * @typedef {Object} PerQueryResult
 * @property {string} id
 * @property {string} query
 * @property {number[]} expected
 * @property {number[]} retrieved
 * @property {boolean} hit            - At least one expected doc in top-k
 * @property {number} recall          - Recall@k
 * @property {number} precision       - Precision@k
 * @property {number} reciprocalRank  - 1/rank_of_first_hit, 0 if none
 * @property {string} [error]         - If the retriever threw
 */

/**
 * @typedef {Object} AggregateResult
 * @property {number} queries          - Total query count
 * @property {number} hitRateAtK
 * @property {number} recallAtK
 * @property {number} precisionAtK
 * @property {number} mrr
 * @property {number} errors           - Queries where retriever threw
 */

/** Unique-preserving projection of the retriever output to document ids. */
function extractDocIds(passages) {
  if (!Array.isArray(passages)) return [];
  const seen = new Set();
  const out = [];
  for (const p of passages) {
    if (!p) continue;
    const id = p.document_id != null ? Number(p.document_id)
             : p.doc_id != null ? Number(p.doc_id)
             : p.id != null ? Number(p.id)
             : null;
    if (id != null && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Per-query scoring. Pure function, no side effects.
 *
 * @param {EvalQuery} q
 * @param {number[]} retrievedDocIds
 * @param {number} k
 * @returns {PerQueryResult}
 */
function scoreOne(q, retrievedDocIds, k) {
  const expected = Array.isArray(q.expectedDocumentIds) ? q.expectedDocumentIds.map(Number) : [];
  const topK = retrievedDocIds.slice(0, k);
  const expectedSet = new Set(expected);
  const topKHits = topK.filter(id => expectedSet.has(id));

  const hit = topKHits.length > 0;
  const recall = expected.length === 0 ? 0 : topKHits.length / expected.length;
  const precision = topK.length === 0 ? 0 : topKHits.length / topK.length;

  let reciprocalRank = 0;
  for (let i = 0; i < topK.length; i++) {
    if (expectedSet.has(topK[i])) {
      reciprocalRank = 1 / (i + 1);
      break;
    }
  }

  return {
    id: q.id,
    query: q.query,
    expected,
    retrieved: topK,
    hit,
    recall,
    precision,
    reciprocalRank,
  };
}

/**
 * Run the full eval set and aggregate.
 *
 * @param {Object} args
 * @param {EvalQuery[]} args.queries
 * @param {Function} args.retriever       - async (query) => passages[]
 * @param {number} [args.k=5]             - Truncate retriever output to top-k
 * @param {number} [args.concurrency=1]   - Parallel retrievers (most retrievers hit a shared DB, so keep this low)
 * @returns {Promise<{perQuery: PerQueryResult[], aggregate: AggregateResult}>}
 */
async function scoreRun(args) {
  const queries = Array.isArray(args?.queries) ? args.queries : [];
  const retriever = args?.retriever;
  const k = Number.isInteger(args?.k) && args.k > 0 ? args.k : 5;
  const concurrency = Number.isInteger(args?.concurrency) && args.concurrency > 0
    ? Math.min(args.concurrency, 8)
    : 1;

  if (typeof retriever !== 'function') {
    throw new Error('scoreRun: retriever function is required');
  }

  const perQuery = new Array(queries.length);
  let errors = 0;

  // Simple bounded-concurrency fan-out.
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= queries.length) return;
      const q = queries[i];
      try {
        const passages = await retriever(q.query);
        const retrievedDocIds = extractDocIds(passages);
        perQuery[i] = scoreOne(q, retrievedDocIds, k);
      } catch (err) {
        errors += 1;
        perQuery[i] = {
          id: q.id, query: q.query,
          expected: q.expectedDocumentIds || [],
          retrieved: [],
          hit: false, recall: 0, precision: 0, reciprocalRank: 0,
          error: err.message,
        };
      }
    }
  });
  await Promise.all(workers);

  const n = perQuery.length || 1;
  const sum = (key) => perQuery.reduce((acc, r) => acc + (r[key] || 0), 0);
  const hitRateAtK = perQuery.filter(r => r.hit).length / n;

  const aggregate = {
    queries: perQuery.length,
    hitRateAtK,
    recallAtK: sum('recall') / n,
    precisionAtK: sum('precision') / n,
    mrr: sum('reciprocalRank') / n,
    errors,
  };

  return { perQuery, aggregate };
}

/**
 * Pretty-print a scoreRun result for CLI / CI log output. No emojis,
 * stable formatting so diffs render cleanly. Returns a string.
 */
function formatReport({ perQuery, aggregate }, opts = {}) {
  const k = opts.k || 5;
  const lines = [];
  lines.push(`Citation-accuracy eval — k=${k}, queries=${aggregate.queries}, errors=${aggregate.errors}`);
  lines.push(`  Hit@${k}       : ${aggregate.hitRateAtK.toFixed(3)}`);
  lines.push(`  Recall@${k}    : ${aggregate.recallAtK.toFixed(3)}`);
  lines.push(`  Precision@${k} : ${aggregate.precisionAtK.toFixed(3)}`);
  lines.push(`  MRR         : ${aggregate.mrr.toFixed(3)}`);
  if (opts.verbose) {
    lines.push('');
    lines.push('Per-query:');
    for (const r of perQuery) {
      const status = r.error ? `ERR ${r.error}`
                  : r.hit ? `HIT  RR=${r.reciprocalRank.toFixed(2)} P=${r.precision.toFixed(2)} R=${r.recall.toFixed(2)}`
                  : 'MISS';
      lines.push(`  [${r.id}] ${status}  expected=${JSON.stringify(r.expected)} retrieved=${JSON.stringify(r.retrieved)}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  scoreRun,
  scoreOne,
  extractDocIds,
  formatReport,
};
