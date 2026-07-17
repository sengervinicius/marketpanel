/**
 * utils/extractJson.js — tolerant JSON extraction for LLM output.
 *
 * The news-briefing (and sibling AI routes) ask providers to "respond ONLY
 * with valid JSON", but real-world completions come back wrapped in
 * ```json fences, prefixed with prose ("Here is the briefing:"), suffixed
 * with commentary, or occasionally truncated mid-object. A bare
 * JSON.parse(raw) on those renders the whole feature as
 * "Failed to parse AI response".
 *
 * extractJson(raw):
 *   1. strips Markdown code fences (``` / ```json);
 *   2. balanced-scans for the FIRST complete {...} or [...] block,
 *      string- and escape-aware, so prose before/after is ignored;
 *   3. removes trailing commas before } or ] (outside strings);
 *   4. JSON.parse — returns the parsed value, or null when no complete
 *      JSON value exists (e.g. truncated output). Callers decide whether
 *      to retry the LLM or fall back.
 */

'use strict';

/** Strip Markdown code fences anywhere in the text. */
function stripFences(text) {
  // Remove opening fences like ``` or ```json (with optional language tag)
  // and closing fences. Keep inner content.
  return text.replace(/```[a-zA-Z0-9_-]*\s*/g, '');
}

/**
 * Balanced scan: starting from the first '{' or '[', find the matching
 * closer while honoring JSON string literals and backslash escapes.
 * Returns the candidate substring, or null if no opener / never closes
 * (truncated output).
 */
function firstBalancedBlock(text) {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // truncated — never balanced
}

/** Remove trailing commas before } or ], skipping string literals. */
function stripTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === ',') {
      // Lookahead past whitespace: drop the comma if the next token closes.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue; // skip trailing comma
    }
    out += ch;
  }
  return out;
}

/**
 * extractJson(raw) → parsed value | null
 */
function extractJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const unfenced = stripFences(raw);
  const block = firstBalancedBlock(unfenced);
  if (block == null) return null;

  const cleaned = stripTrailingCommas(block);
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

module.exports = { extractJson, _internal: { stripFences, firstBalancedBlock, stripTrailingCommas } };
