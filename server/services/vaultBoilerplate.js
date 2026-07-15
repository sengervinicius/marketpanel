/**
 * vaultBoilerplate.js — heuristic boilerplate detector for vault chunks.
 *
 * Sell-side PDFs are full of chunks that embed "well" but carry zero
 * informational value for retrieval: greeting headers ("Good morning, this
 * is what you need to know today"), analyst contact blocks (name – email –
 * T: +55 (11) ...), legal disclaimers / analyst certifications, and tables
 * of contents. Because these blocks mention the bank, the tickers, and the
 * report topic, they frequently WIN on cosine similarity against a
 * conversational query and crowd out the actual content — the live failure
 * where "what is BofA's outlook for oil prices" returned the analyst
 * contact header instead of the outlook.
 *
 * scoreBoilerplate(text) is a PURE function returning 0..1:
 *   0   = looks like real content
 *   1   = almost certainly boilerplate
 *
 * The retrieval path multiplies each fused candidate's score by
 * (1 - BOILERPLATE_PENALTY * score), so this only down-weights — it never
 * hard-filters. A wrong high score costs rank, not recall.
 *
 * No I/O, no LLM, no dependencies — safe to call on every candidate chunk
 * (typically <= ~90 per query) and trivially unit-testable.
 */
'use strict';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Phone numbers as they appear in research contact blocks:
// "+55 (11) 2188-4375", "T: +1 646 855 1234", "(11) 3232-1234"
const PHONE_RE = /\+?\d{1,3}[\s.]?\(?\d{2,4}\)?[\s.-]\d{3,5}[\s.-]\d{3,5}/g;
const URL_RE = /(?:https?:\/\/|www\.)[^\s]+/gi;

// Greeting / daily-note openers (EN + PT-BR).
const GREETING_RES = [
  /\bgood\s+(morning|afternoon|evening)\b/i,
  /\bthis is what you need to know\b/i,
  /\bwhat you need to know today\b/i,
  /\bbom\s+dia\b/i,
  /\bboa\s+tarde\b/i,
  /\bboa\s+noite\b/i,
];

// Disclaimer / certification language (EN + PT-BR).
const DISCLAIMER_RES = [
  /\bimportant\s+disclosures?\b/i,
  /\banalyst\s+certification\b/i,
  /\bnot\s+(?:an?\s+)?(?:offer|solicitation|investment\s+advice)\b/i,
  /\bfor\s+informational?\s+purposes\s+only\b/i,
  /\bpast\s+performance\s+is\s+(?:no|not)\b/i,
  /\bhereby\s+certif(?:y|ies)\b/i,
  /\bregistered\s+broker[- ]dealer\b/i,
  /\bconflicts?\s+of\s+interest\b/i,
  /\bthis\s+(?:report|document|material)\s+(?:is|has been)\s+(?:prepared|issued|distributed)\b/i,
  /\bn[aã]o\s+constitui\s+(?:uma\s+)?(?:oferta|recomenda[cç][aã]o)\b/i,
  /\bmaterial\s+publicit[aá]rio\b/i,
];

// "T: +55" style phone labels — near-unique to analyst contact blocks.
const PHONE_LABEL_RE = /\bT\s*:\s*\+/;

// Table-of-contents markers: dotted leaders ("Introduction ....... 3") or
// an explicit heading.
const TOC_LEADER_RE = /\.{4,}\s*\d{1,3}(?:\s|$)/g;
const TOC_HEADING_RE = /\b(?:table\s+of\s+contents|[ií]ndice|sum[aá]rio)\b/i;

function _countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

function _matchedChars(text, re) {
  let total = 0;
  const matches = text.match(re);
  if (matches) for (const m of matches) total += m.length;
  return total;
}

/**
 * Score how boilerplate-like a chunk of text is.
 *
 * @param {string} text - chunk content
 * @returns {number} 0..1 (0 = real content, 1 = pure boilerplate)
 */
function scoreBoilerplate(text) {
  if (typeof text !== 'string') return 0;
  const t = text.trim();
  if (t.length < 20) return 0; // too short to judge — don't penalise

  let score = 0;

  // ── 1. Contact-block signals ──────────────────────────────────────────
  const emailCount = _countMatches(t, EMAIL_RE);
  const phoneCount = _countMatches(t, PHONE_RE);
  if (emailCount >= 3) score += 0.55;
  else if (emailCount === 2) score += 0.4;
  else if (emailCount === 1) score += 0.2;
  if (phoneCount >= 2) score += 0.3;
  else if (phoneCount === 1) score += 0.15;
  if (PHONE_LABEL_RE.test(t)) score += 0.2;

  // ── 2. Greeting / daily-note openers ──────────────────────────────────
  let greetingHits = 0;
  for (const re of GREETING_RES) if (re.test(t)) greetingHits++;
  if (greetingHits > 0) score += 0.35 + 0.15 * Math.min(greetingHits - 1, 1);

  // ── 3. Disclaimer / certification language ────────────────────────────
  let disclaimerHits = 0;
  for (const re of DISCLAIMER_RES) if (re.test(t)) disclaimerHits++;
  if (disclaimerHits >= 3) score += 0.7;
  else if (disclaimerHits === 2) score += 0.5;
  else if (disclaimerHits === 1) score += 0.25;

  // ── 4. Table-of-contents patterns ──────────────────────────────────────
  const tocLeaders = _countMatches(t, TOC_LEADER_RE);
  if (tocLeaders >= 3) score += 0.6;
  else if (TOC_HEADING_RE.test(t) && tocLeaders >= 1) score += 0.5;

  // ── 5. Character-mass ratio: emails + URLs + phones ────────────────────
  // A contact/footer block is mostly made of addresses; real prose is not.
  const machineChars =
    _matchedChars(t, EMAIL_RE) +
    _matchedChars(t, URL_RE) +
    _matchedChars(t, PHONE_RE);
  const ratio = machineChars / t.length;
  if (ratio > 0.3) score += 0.5;
  else if (ratio > 0.15) score += 0.25;

  return Math.min(1, score);
}

module.exports = { scoreBoilerplate };
