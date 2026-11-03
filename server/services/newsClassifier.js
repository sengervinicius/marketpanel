/**
 * newsClassifier.js — a verdict on every headline, not just the ones a vendor tags.
 *
 * WHY
 * ---
 * The wire already paints a story red/green on its left edge and shows ticker
 * chips — but only when the PROVIDER supplied sentiment. That is Polygon
 * `insights`, which covers US equities. For Bloomberg, the FT and anything
 * Brazilian, it is never present, so the colouring and the chips are invisible
 * on exactly the content a macro desk reads. The reference the owner pointed at
 * (Kento) classifies every line and shows the tally up top — a read on the tape
 * before you read a word. This module makes that possible.
 *
 * HOW
 * ---
 * One Haiku call per batch of up to 30 uncached headlines returns, per line:
 *   sentiment    positive | negative | neutral   (market impact, not mood)
 *   instruments  up to 4 short codes the story moves (CDS5Y, SELIC, PETR4, USDBRL…)
 *
 * Verdicts are cached by a hash of the title for 24h — a headline does not
 * change its meaning — so after the first pass each poll classifies only what
 * is genuinely new. The feed caches for 60s, so steady state is a handful of
 * lines a minute.
 *
 * FAIL-SAFE
 * ---------
 * This must never block or degrade the wire. Any failure (no key, timeout,
 * non-JSON reply, rate limit) returns the items untouched with
 * `sentiment: null`. The client treats null as "unclassified" and leaves the
 * edge uncoloured rather than guessing. Nothing here is ever a fabricated verdict.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const lexicon = require('./newsLexicon');

const MODEL = 'claude-haiku-4-5-20251001';
const BATCH = 30;
const TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;

const _cache = new Map(); // titleHash -> { sentiment, instruments, at }
let _modelDeadUntil = 0;   // billing/auth backoff for the model path

function keyFor(title) {
  return crypto.createHash('sha1').update(String(title || '').trim().toLowerCase()).digest('hex');
}

function cacheGet(k) {
  const v = _cache.get(k);
  if (!v) return null;
  if (Date.now() - v.at > CACHE_TTL_MS) { _cache.delete(k); return null; }
  return v;
}

function cacheSet(k, v) {
  if (_cache.size >= CACHE_MAX) {
    // drop the oldest ~10%
    const n = Math.ceil(CACHE_MAX / 10);
    let i = 0;
    for (const key of _cache.keys()) { _cache.delete(key); if (++i >= n) break; }
  }
  _cache.set(k, { ...v, at: Date.now() });
}

const SYSTEM = `You classify financial news headlines for a professional markets terminal.
For each headline return its likely MARKET impact and the instruments it moves.

sentiment: "positive" if the news is supportive for the main asset(s) it concerns (risk-on, easing, beats, upgrades, resolution),
"negative" if adverse (risk-off, tightening, misses, downgrades, escalation, institutional pressure on a central bank),
"neutral" if informational, scheduled, mixed, or genuinely unclear. Do not infer mood from tone; judge price impact.

instruments: up to 4 SHORT uppercase codes a desk would use, most relevant first. Prefer tradable symbols and benchmark names:
tickers (PETR4, AAPL, VALE3), FX pairs (USDBRL, EURUSD), rates (SELIC, DI, FED, UST10Y), sovereign risk (CDS5Y), indices (IBOV, SPX), commodities (BRENT, GOLD).
Use [] if nothing specific.

Reply with ONLY a JSON array, one object per input line in the same order, shape:
[{"i":0,"sentiment":"negative","instruments":["CDS5Y","SELIC","USDBRL"]}, ...]`;

async function callHaiku(lines) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('no_anthropic_key');

  const user = lines.map((t, i) => `${i}\t${t}`).join('\n');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1800,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!r.ok) throw new Error(`anthropic_http_${r.status}`);
    const data = await r.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('no_json_array');
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) throw new Error('not_array');
    return arr;
  } finally {
    clearTimeout(timer);
  }
}

function normSent(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'positive' || v === 'bullish') return 'positive';
  if (v === 'negative' || v === 'bearish') return 'negative';
  if (v === 'neutral') return 'neutral';
  return null;
}

function normInstruments(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(x => String(x || '').toUpperCase().replace(/[^A-Z0-9.=:^/-]/g, '').slice(0, 12))
    .filter(Boolean)
    .slice(0, 4);
}

/**
 * Attach `sentiment`, `instruments` and `classified` to each item in place and
 * return the same array. Never throws.
 */
async function enrich(items) {
  if (!Array.isArray(items) || items.length === 0) return items;

  const pending = [];
  for (const it of items) {
    if (!it || !it.title) continue;
    const k = keyFor(it.title);
    const hit = cacheGet(k);
    if (hit) {
      it.sentiment = hit.sentiment;
      it.instruments = hit.instruments;
      it.classified = true;
      it.classifier = 'model';
    } else {
      // Floor: deterministic lexicon verdict so the wire is never blank.
      // Haiku (below) overwrites it when it answers.
      const lx = lexicon.tag(it.title);
      it.sentiment = lx.sentiment;
      it.instruments = lx.instruments;
      it.classified = true;
      it.classifier = 'lexicon';
      pending.push({ it, k });
    }
  }
  // No key → nothing to upgrade; lexicon verdicts stand.
  if (!process.env.ANTHROPIC_API_KEY || _modelDeadUntil > Date.now()) return items;

  for (let s = 0; s < pending.length; s += BATCH) {
    const slice = pending.slice(s, s + BATCH);
    try {
      const out = await callHaiku(slice.map(p => p.it.title));
      const byIndex = new Map(out.map(o => [Number(o.i), o]));
      slice.forEach((p, idx) => {
        const o = byIndex.get(idx);
        const sentiment = normSent(o?.sentiment);
        if (!sentiment) return; // keep the lexicon verdict
        const instruments = normInstruments(o?.instruments);
        // Model wins on sentiment; union the codes so lexicon tickers survive.
        p.it.sentiment = sentiment;
        p.it.instruments = [...new Set([...instruments, ...(p.it.instruments || [])])].slice(0, 4);
        p.it.classifier = 'model';
        cacheSet(p.k, { sentiment, instruments: p.it.instruments });
      });
    } catch (e) {
      // Lexicon verdicts stand. Billing/auth failures won't fix themselves
      // in the next 60s poll, so stop paying the round-trip for 10 min.
      logger.warn('newsClassifier', `batch of ${slice.length} kept on lexicon: ${e.message}`);
      if (/anthropic_http_(400|401|403|429)/.test(e.message)) _modelDeadUntil = Date.now() + 10 * 60 * 1000;
      break;
    }
  }
  return items;
}

/** Counts for the header bar. Unclassified items are not counted. */
function tally(items) {
  const t = { negative: 0, neutral: 0, positive: 0, unclassified: 0, model: 0 };
  for (const it of items || []) {
    if (it?.sentiment === 'negative') t.negative++;
    else if (it?.sentiment === 'positive') t.positive++;
    else if (it?.sentiment === 'neutral') t.neutral++;
    else t.unclassified++;
    if (it?.classifier === 'model') t.model++;
  }
  return t;
}

module.exports = { enrich, tally, _cacheSize: () => _cache.size };
