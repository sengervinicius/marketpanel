/**
 * vaultRerankGuard.test.js — retrieval v2b regression guard.
 *
 * The live failure this exists to prevent: fusion-stage boilerplate
 * penalty applied, yet the Cohere reranker still put the BofA
 * greeting/contact header at #1 because rerank scores are pure topical
 * relevance. Two defenses under test, via the exported shaping helpers:
 * pre-rerank exclusion input (boilerplate scores attached by
 * _applyCandidateShaping) and the post-rerank re-penalty math.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const vault = require('../vault');
const { scoreBoilerplate } = require('../vaultBoilerplate');

const HEADER = 'BofA Global Research Good morning! This is what you need to know on LatAm Oil, Gas & Petrochemicals today. Caio Ribeiro – caio.ribeiro@bofa.com– T: +55 (11) 2188-4375 Leonardo Marcondes – leonardo.marcondes@bofa.com – T: +55 (11) 3140-4801';
const CONTENT = 'We maintain our Brent forecast at 85 USD per barrel for 2026, with upside risk from OPEC+ discipline and Strait of Hormuz disruption; downside from demand softness in China. We prefer integrated producers with low breakevens.';

test('shaping attaches _boilerplate_score used by the pre-rerank exclusion', () => {
  const shaped = vault._applyCandidateShaping([
    { id: 1, document_id: 'd1', chunk_index: 0, content: HEADER, _rrf_score: 0.05 },
    { id: 2, document_id: 'd1', chunk_index: 3, content: CONTENT, _rrf_score: 0.04 },
  ]);
  const header = shaped.find(p => p.id === 1);
  const content = shaped.find(p => p.id === 2);
  assert.ok(header._boilerplate_score >= 0.7, `header must clear exclusion threshold, got ${header._boilerplate_score}`);
  assert.ok(content._boilerplate_score < 0.3, `content must stay below, got ${content._boilerplate_score}`);
});

test('post-rerank re-penalty math sinks a header that won the rerank', () => {
  // Simulate what Stage 3 does after rerankWithCohere returns
  const BOILERPLATE_PENALTY = 0.6;
  const reranked = [
    { id: 1, content: HEADER, _cohere_rank: 0.93, _boilerplate_score: scoreBoilerplate(HEADER) },
    { id: 2, content: CONTENT, _cohere_rank: 0.78, _boilerplate_score: scoreBoilerplate(CONTENT) },
  ];
  const resorted = reranked
    .map(p => ({ ...p, _final_score: p._cohere_rank * (1 - BOILERPLATE_PENALTY * (p._boilerplate_score ?? 0)) }))
    .sort((a, b) => b._final_score - a._final_score);
  assert.strictEqual(resorted[0].id, 2, 'real content must outrank the greeting header after re-penalty');
});


test('_toOrQuery drops stopwords and joins significant terms with or', () => {
  const q = vault._toOrQuery("what is BofA's outlook for oil prices");
  assert.ok(q.includes('or'), 'must be an OR expression');
  assert.ok(q.includes('bofa') && q.includes('outlook') && q.includes('oil') && q.includes('prices'), q);
  assert.ok(!/\bwhat\b|\bis\b|\bfor\b/.test(q), 'stopwords must be dropped: ' + q);
});

test('_toOrQuery strips tsquery operators from user text', () => {
  const q = vault._toOrQuery('petrobras & drop table | ! <-> injection:*');
  assert.ok(!/[&|!<>:*]/.test(q), 'operators must be stripped: ' + q);
});

test('v2d: similarity thresholds follow the embedding provider', () => {
  assert.strictEqual(vault._minSimilarityFor('openai'), 0.55);
  assert.ok(vault._minSimilarityFor('voyage') <= 0.40, 'voyage strict floor must be far below the openai one');
  assert.ok(vault._relaxedSimilarityFor('voyage') < vault._minSimilarityFor('voyage'));
  assert.strictEqual(vault._minSimilarityFor('unknown-provider'), 0.55, 'unknown providers fall back to the legacy floor');
});
