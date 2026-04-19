/**
 * vaultReembed.test.js — W4.4 regression guard.
 *
 * Verifies the re-embed worker's contracts:
 *   1. countReembedCandidates() issues the right SQL and short-circuits
 *      safely on DB outage / unknown provider.
 *   2. runReembedJob() processes chunks in batches, updates each chunk's
 *      embedding + embedding_provider, and stops when the pool drains.
 *   3. It is IDEMPOTENT — re-running on already-migrated data is a no-op.
 *   4. It is RESUMABLE — a crash mid-batch still leaves the per-row
 *      updates that succeeded committed (we UPDATE row-by-row, not in a
 *      single multi-row statement).
 *   5. It tolerates embedFn failures on a batch without aborting the job.
 *   6. It rejects invalid targetProvider and missing embedFn up front.
 *   7. maxBatches caps the run and returns status='paused' (not 'complete')
 *      when there is still work left — admin UI needs this distinction.
 *
 * Run:
 *   node --test server/services/__tests__/vaultReembed.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reembed = require('../vaultReembed');

// ── Test doubles ─────────────────────────────────────────────────────────

/**
 * Build a minimal in-memory Postgres stub that understands the four
 * SQL shapes our worker uses:
 *
 *   SELECT COUNT(*)::int AS n FROM vault_chunks WHERE COALESCE(embedding_provider, 'unknown') != $1
 *   SELECT id, content FROM vault_chunks WHERE ... ORDER BY id LIMIT $2
 *   UPDATE vault_chunks SET embedding = $1::vector, embedding_provider = $2 WHERE id = $3
 *   (and the second count call at the end of the job loop)
 */
function makeFakePg(initialChunks) {
  // Each chunk: { id, content, embedding_provider, embedding }
  const chunks = initialChunks.map(c => ({ ...c }));
  let isUp = true;
  const errors = { count: 0, select: 0, update: new Set() }; // row ids whose UPDATE should throw

  const pg = {
    isConnected: () => isUp,
    async query(sql, params) {
      if (/SELECT COUNT\(\*\)::int AS n[\s\S]*FROM vault_chunks/.test(sql)) {
        if (errors.count > 0) { errors.count -= 1; throw new Error('count simulated failure'); }
        const [provider] = params;
        const n = chunks.filter(c => (c.embedding_provider || 'unknown') !== provider).length;
        return { rows: [{ n }] };
      }
      if (/SELECT id, content[\s\S]*FROM vault_chunks[\s\S]*ORDER BY id[\s\S]*LIMIT/.test(sql)) {
        if (errors.select > 0) { errors.select -= 1; throw new Error('select simulated failure'); }
        const [provider, limit] = params;
        const rows = chunks
          .filter(c => (c.embedding_provider || 'unknown') !== provider)
          .sort((a, b) => a.id - b.id)
          .slice(0, limit)
          .map(c => ({ id: c.id, content: c.content }));
        return { rows };
      }
      if (/UPDATE vault_chunks[\s\S]*SET embedding = /.test(sql)) {
        const [vecLit, provider, id] = params;
        if (errors.update.has(id)) throw new Error(`update simulated failure for id=${id}`);
        const chunk = chunks.find(c => c.id === id);
        if (chunk) {
          chunk.embedding = vecLit;
          chunk.embedding_provider = provider;
        }
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 60)}...`);
    },
  };

  return { pg, chunks, setDown: () => { isUp = false; }, errors };
}

function silentLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

// ── Tests ────────────────────────────────────────────────────────────────

test('countReembedCandidates: returns accurate count', async () => {
  const { pg } = makeFakePg([
    { id: 1, content: 'a', embedding_provider: 'openai' },
    { id: 2, content: 'b', embedding_provider: 'voyage' },
    { id: 3, content: 'c', embedding_provider: 'openai' },
    { id: 4, content: 'd', embedding_provider: null }, // 'unknown'
  ]);
  assert.equal(await reembed.countReembedCandidates('voyage', { pg }), 3);
  assert.equal(await reembed.countReembedCandidates('openai', { pg }), 2);
});

test('countReembedCandidates: returns 0 when pg disconnected', async () => {
  const { pg, setDown } = makeFakePg([{ id: 1, content: 'a', embedding_provider: 'openai' }]);
  setDown();
  assert.equal(await reembed.countReembedCandidates('voyage', { pg }), 0);
});

test('countReembedCandidates: returns 0 for unknown provider', async () => {
  const { pg } = makeFakePg([{ id: 1, content: 'a', embedding_provider: 'openai' }]);
  assert.equal(await reembed.countReembedCandidates('acme-llm', { pg }), 0);
});

test('runReembedJob: processes all candidates in multiple batches', async () => {
  reembed._resetForTest();
  const { pg, chunks } = makeFakePg([
    { id: 1, content: 'a', embedding_provider: 'openai' },
    { id: 2, content: 'b', embedding_provider: 'openai' },
    { id: 3, content: 'c', embedding_provider: 'openai' },
    { id: 4, content: 'd', embedding_provider: 'openai' },
    { id: 5, content: 'e', embedding_provider: 'openai' },
  ]);

  const embedCalls = [];
  const embedFn = async (texts) => {
    embedCalls.push(texts.length);
    // Return distinct vectors per text so we can verify each row was updated
    return texts.map((_, i) => [0.1, 0.2, 0.3 + embedCalls.length * 0.01 + i * 0.001]);
  };

  const result = await reembed.runReembedJob(
    { targetProvider: 'voyage', embedFn, batchSize: 2 },
    { pg, log: silentLog() }
  );

  assert.equal(result.status, 'complete');
  assert.equal(result.totalCandidates, 5);
  assert.equal(result.processed, 5);
  assert.equal(result.succeeded, 5);
  assert.equal(result.failed, 0);
  assert.equal(result.batchesDone, 3); // 2 + 2 + 1
  // Every chunk is now provider='voyage'
  for (const c of chunks) {
    assert.equal(c.embedding_provider, 'voyage', `chunk ${c.id} should be migrated`);
    assert.ok(c.embedding.startsWith('['));
  }
  // embedFn was called once per batch
  assert.deepEqual(embedCalls, [2, 2, 1]);
});

test('runReembedJob: idempotent — zero work when target matches everything', async () => {
  reembed._resetForTest();
  const { pg } = makeFakePg([
    { id: 1, content: 'a', embedding_provider: 'voyage' },
    { id: 2, content: 'b', embedding_provider: 'voyage' },
  ]);
  let embedCalls = 0;
  const embedFn = async (texts) => { embedCalls += 1; return texts.map(() => [0.1]); };

  const result = await reembed.runReembedJob(
    { targetProvider: 'voyage', embedFn, batchSize: 10 },
    { pg, log: silentLog() }
  );

  assert.equal(result.status, 'complete');
  assert.equal(result.totalCandidates, 0);
  assert.equal(result.processed, 0);
  assert.equal(embedCalls, 0, 'embedFn should never be called when nothing to do');
});

test('runReembedJob: resumable — partial run leaves done rows committed', async () => {
  reembed._resetForTest();
  const { pg, chunks } = makeFakePg([
    { id: 1, content: 'a', embedding_provider: 'openai' },
    { id: 2, content: 'b', embedding_provider: 'openai' },
    { id: 3, content: 'c', embedding_provider: 'openai' },
    { id: 4, content: 'd', embedding_provider: 'openai' },
  ]);
  const embedFn = async (texts) => texts.map(() => [0.5, 0.5]);

  // First run: cap at 1 batch of 2 → 2 migrated, 2 left
  const r1 = await reembed.runReembedJob(
    { targetProvider: 'voyage', embedFn, batchSize: 2, maxBatches: 1 },
    { pg, log: silentLog() }
  );
  assert.equal(r1.status, 'paused', 'maxBatches hit, job not complete');
  assert.equal(r1.succeeded, 2);
  assert.equal(chunks.filter(c => c.embedding_provider === 'voyage').length, 2);
  assert.equal(chunks.filter(c => c.embedding_provider === 'openai').length, 2);

  // Second run: finishes the remaining 2
  const r2 = await reembed.runReembedJob(
    { targetProvider: 'voyage', embedFn, batchSize: 2 },
    { pg, log: silentLog() }
  );
  assert.equal(r2.status, 'complete');
  assert.equal(r2.succeeded, 2, 'only the remaining 2 should be processed');
  assert.equal(chunks.filter(c => c.embedding_provider === 'voyage').length, 4);
});

test('runReembedJob: tolerates embedFn throwing on one batch', async () => {
  reembed._resetForTest();
  const { pg, chunks } = makeFakePg([
    { id: 1, content: 'a', embedding_provider: 'openai' },
    { id: 2, content: 'b', embedding_provider: 'openai' },
    { id: 3, content: 'c', embedding_provider: 'openai' },
    { id: 4, content: 'd', embedding_provider: 'openai' },
  ]);
  let n = 0;
  const embedFn = async (texts) => {
    n += 1;
    if (n === 1) throw new Error('transient 429');
    return texts.map(() => [0.1, 0.1]);
  };

  const result = await reembed.runReembedJob(
    { targetProvider: 'voyage', embedFn, batchSize: 2 },
    { pg, log: silentLog() }
  );

  // Batch 1 fails (2 rows counted as failed).
  // Batches 2 and 3 succeed. But since the failed rows are still pending,
  // the loop keeps finding them → they get retried in subsequent batches.
  // Final state: all 4 rows migrated (the re-attempt in batch 2 succeeded).
  assert.equal(chunks.filter(c => c.embedding_provider === 'voyage').length, 4);
  assert.ok(result.failed >= 2, 'first-batch failure should be recorded');
  assert.ok(result.succeeded >= 4, 'remaining batches should still succeed');
});

test('runReembedJob: rejects invalid targetProvider', async () => {
  await assert.rejects(
    () => reembed.runReembedJob({ targetProvider: 'bogus', embedFn: async () => [] }, { pg: null }),
    /Invalid targetProvider/
  );
});

test('runReembedJob: rejects missing embedFn', async () => {
  await assert.rejects(
    () => reembed.runReembedJob({ targetProvider: 'voyage' }, { pg: null }),
    /embedFn is required/
  );
});

test('runReembedJob: returns error status when pg is disconnected', async () => {
  reembed._resetForTest();
  const { pg, setDown } = makeFakePg([]);
  setDown();
  const result = await reembed.runReembedJob(
    { targetProvider: 'voyage', embedFn: async () => [] },
    { pg, log: silentLog() }
  );
  assert.equal(result.status, 'error');
  assert.match(result.error, /postgres not connected/);
});

test('runReembedJob: status="paused" when maxBatches hit before pool drained', async () => {
  reembed._resetForTest();
  const { pg } = makeFakePg([
    { id: 1, content: 'a', embedding_provider: 'openai' },
    { id: 2, content: 'b', embedding_provider: 'openai' },
    { id: 3, content: 'c', embedding_provider: 'openai' },
  ]);
  const embedFn = async (texts) => texts.map(() => [0.1]);
  const result = await reembed.runReembedJob(
    { targetProvider: 'voyage', embedFn, batchSize: 1, maxBatches: 1 },
    { pg, log: silentLog() }
  );
  assert.equal(result.status, 'paused');
  assert.equal(result.succeeded, 1);
});

test('runReembedJob: calls onProgress after each batch', async () => {
  reembed._resetForTest();
  const { pg } = makeFakePg([
    { id: 1, content: 'a', embedding_provider: 'openai' },
    { id: 2, content: 'b', embedding_provider: 'openai' },
  ]);
  const embedFn = async (texts) => texts.map(() => [0.1]);
  const progressSnapshots = [];
  await reembed.runReembedJob(
    {
      targetProvider: 'voyage', embedFn, batchSize: 1,
      onProgress: s => progressSnapshots.push(s),
    },
    { pg, log: silentLog() }
  );
  assert.equal(progressSnapshots.length, 2);
  assert.equal(progressSnapshots[0].processed, 1);
  assert.equal(progressSnapshots[1].processed, 2);
});

test('getReembedJob: returns null for unknown job id', () => {
  reembed._resetForTest();
  assert.equal(reembed.getReembedJob('does-not-exist'), null);
});
