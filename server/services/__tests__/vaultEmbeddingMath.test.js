/**
 * vaultEmbeddingMath.test.js — W4.3 regression guard.
 *
 * Locks in the mathematical properties of the zero-pad-to-1536 approach for
 * Voyage embeddings, and the safety rule that cross-provider cosine is
 * meaningless.
 *
 * If any of these invariants ever fail, the retrieve() similarity ranking
 * becomes garbage in silent-to-the-user ways. We want a test that screams.
 *
 * Run:
 *   node --test server/services/__tests__/vaultEmbeddingMath.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// ─── Helpers: we reimplement the math locally so this test has zero
// dependency on the runtime vault.js (which pulls in pg, mammoth, etc.). ───

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(v) {
  return Math.sqrt(dot(v, v));
}

function cosine(a, b) {
  const n = norm(a) * norm(b);
  return n === 0 ? 0 : dot(a, b) / n;
}

function zeroPadTo(v, targetDim) {
  const out = v.slice();
  while (out.length < targetDim) out.push(0);
  return out.slice(0, targetDim);
}

function randVec(dim, seed) {
  // Deterministic pseudo-random vectors so tests are reproducible.
  let s = seed;
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;   // LCG
    out[i] = ((s / 2 ** 32) - 0.5) * 2;     // range [-1, 1]
  }
  return out;
}

const VOYAGE_DIM = 1024;
const STORED_DIM = 1536;

// ── Core property: zero-padding preserves cosine similarity ──────────────

test('zero-padding both vectors preserves cosine similarity exactly', () => {
  // Property: cos(pad(a), pad(b)) === cos(a, b)
  // because the trailing zeros contribute 0 to both the dot product and
  // to each vector's L2 norm.
  for (let seed = 1; seed <= 20; seed++) {
    const a = randVec(VOYAGE_DIM, seed * 7);
    const b = randVec(VOYAGE_DIM, seed * 13 + 1);
    const aPadded = zeroPadTo(a, STORED_DIM);
    const bPadded = zeroPadTo(b, STORED_DIM);

    const cosNative = cosine(a, b);
    const cosPadded = cosine(aPadded, bPadded);

    // Floating-point safe equality
    assert.ok(
      Math.abs(cosNative - cosPadded) < 1e-12,
      `seed=${seed}: native=${cosNative} padded=${cosPadded}`
    );
  }
});

test('zero-padding preserves vector norm (|pad(v)| === |v|)', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const v = randVec(VOYAGE_DIM, seed * 3);
    const vPadded = zeroPadTo(v, STORED_DIM);
    assert.ok(Math.abs(norm(v) - norm(vPadded)) < 1e-12);
  }
});

test('zero-padding preserves ranking of nearest neighbours', () => {
  // Practical property: if Voyage says doc A is closer to query than doc B
  // in native 1024-space, the padded-to-1536 space should preserve that
  // ordering (which is what pgvector will rank on).
  const query = randVec(VOYAGE_DIM, 101);
  const docs = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(s => randVec(VOYAGE_DIM, s * 17));

  const nativeRanking = docs
    .map((d, i) => ({ i, c: cosine(query, d) }))
    .sort((a, b) => b.c - a.c)
    .map(r => r.i);

  const paddedQuery = zeroPadTo(query, STORED_DIM);
  const paddedRanking = docs
    .map((d, i) => ({ i, c: cosine(paddedQuery, zeroPadTo(d, STORED_DIM)) }))
    .sort((a, b) => b.c - a.c)
    .map(r => r.i);

  assert.deepEqual(nativeRanking, paddedRanking,
    'zero-padded ranking must match native-space ranking exactly');
});

// ── Cross-provider safety ────────────────────────────────────────────────

test('cross-provider cosine is NOT trustworthy (documentation + guard)', () => {
  // This test doesn't "assert correct similarity" — it asserts that the
  // cross-provider similarity is uncorrelated with the intra-provider
  // similarity. That's the whole reason retrieve() must filter by provider.
  //
  // Setup: pick a Voyage "query" and two Voyage "docs". Compute the
  // true intra-Voyage ranking. Then synthesise a fake OpenAI-native-1536
  // vector for the query, and check that its similarity to the
  // zero-padded Voyage docs has no reliable relationship to the true
  // ranking. We assert this by showing the similarity can flip sign
  // on random pairings.
  let disagreements = 0;
  const trials = 40;
  for (let seed = 1; seed <= trials; seed++) {
    const voyQuery = randVec(VOYAGE_DIM, seed * 5);
    const voyDocA = randVec(VOYAGE_DIM, seed * 11);
    const voyDocB = randVec(VOYAGE_DIM, seed * 23);

    const voyRank = cosine(voyQuery, voyDocA) > cosine(voyQuery, voyDocB) ? 'A' : 'B';

    // An "OpenAI-native-1536" query has real values in all 1536 slots,
    // including the 1025..1536 range that Voyage docs have zeroed out.
    const fakeOpenaiQuery = randVec(STORED_DIM, seed * 31);
    const voyDocAPadded = zeroPadTo(voyDocA, STORED_DIM);
    const voyDocBPadded = zeroPadTo(voyDocB, STORED_DIM);

    const mixedRank =
      cosine(fakeOpenaiQuery, voyDocAPadded) > cosine(fakeOpenaiQuery, voyDocBPadded)
        ? 'A' : 'B';

    if (mixedRank !== voyRank) disagreements += 1;
  }
  // With truly random inputs, cross-provider ranking agrees with
  // intra-provider ranking ~50% of the time. We assert "at least some
  // disagreements" rather than an exact rate so the test is stable.
  assert.ok(disagreements >= 5,
    `cross-provider ranking should disagree often (got ${disagreements}/${trials})`);
});
