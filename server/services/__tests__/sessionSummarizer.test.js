/**
 * sessionSummarizer.test.js — P2.5 deeper-session-memory unit tests.
 *
 * Validates:
 *   - short histories pass through unchanged
 *   - long histories trigger summarisation, keep the tail verbatim,
 *     and prepend a clearly-marked synopsis turn
 *   - summariser failures (throw / timeout / empty / missing fn)
 *     fall back to deterministic tail-only truncation without blowing
 *     up the route
 *   - per-message character cap is enforced before the budget check
 *   - buildHaikuSummariser happy path + failure modes
 *   - the chat route is wired to pass an up-to-40-turn window and
 *     references the summariser
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const summarizer = require('../sessionSummarizer');

// ── Helpers ───────────────────────────────────────────────────────────
function userMsg(i, size = 200) {
  return { role: 'user', content: `u${i}:` + 'x'.repeat(size) };
}
function asstMsg(i, size = 200) {
  return { role: 'assistant', content: `a${i}:` + 'y'.repeat(size) };
}
function buildThread(turns, size = 200) {
  const out = [];
  for (let i = 0; i < turns; i++) {
    out.push(userMsg(i, size));
    out.push(asstMsg(i, size));
  }
  return out;
}

(async () => {
  // ── 1. Short history passes through unchanged ───────────────────────
  const short = buildThread(3, 100);
  const outShort = await summarizer.prepareConversationHistory(short, {
    summariseFn: async () => 'should not be called',
  });
  assert.strictEqual(outShort.summarised, false, 'short history is NOT summarised');
  assert.strictEqual(outShort.messages.length, short.length, 'length unchanged');
  assert.strictEqual(outShort.messages[0].content, short[0].content);

  // ── 2. Long history triggers summarisation ──────────────────────────
  let lastPrompt = null;
  const summariseHappy = async (prompt) => {
    lastPrompt = prompt;
    return 'User is building a Brazil thesis around PETR4 and VALE3, ' +
           'is bearish on CHY tech, and asked about DI 2027 duration.';
  };
  const long = buildThread(25, 1000); // 50 messages × ~1000 chars = 50K chars
  const outLong = await summarizer.prepareConversationHistory(long, {
    summariseFn: summariseHappy,
    keepRecent: 10,
  });
  assert.strictEqual(outLong.summarised, true, 'long history IS summarised');
  assert.strictEqual(outLong.messages.length, 11, 'synopsis + 10 verbatim tail');
  assert.strictEqual(outLong.messages[0].role, 'user',
    'synopsis is injected as a user-role turn so the model sees it pre-context');
  assert.ok(
    /\[EARLIER IN THIS THREAD/i.test(outLong.messages[0].content),
    'synopsis must be clearly marked as auto-summary, not raw quote',
  );
  assert.ok(
    /PETR4|VALE3|Brazil/.test(outLong.messages[0].content),
    'synopsis content is carried through from the summariser',
  );
  // Tail turns are the last 10 verbatim.
  const expectedTail = long.slice(-10);
  for (let i = 0; i < expectedTail.length; i++) {
    assert.strictEqual(outLong.messages[i + 1].content, expectedTail[i].content,
      `tail turn ${i} must match verbatim`);
  }
  // Summariser prompt includes role labels from the older block.
  assert.ok(/User: u0/.test(lastPrompt), 'summariser prompt preserves roles');
  assert.ok(/Assistant: a0/.test(lastPrompt), 'summariser prompt preserves assistant role');

  // ── 3. Summariser throws → fallback to tail-only ────────────────────
  const outThrow = await summarizer.prepareConversationHistory(long, {
    summariseFn: async () => { throw new Error('haiku 500'); },
    keepRecent: 10,
  });
  assert.strictEqual(outThrow.summarised, false, 'throw falls back to truncate');
  assert.strictEqual(outThrow.messages.length, 10, 'only tail kept on failure');
  assert.ok(
    !/EARLIER IN THIS THREAD/i.test(outThrow.messages[0].content),
    'no synopsis prepended on failure',
  );
  assert.ok(outThrow.reason && /haiku 500|failed/i.test(outThrow.reason),
    'failure reason is surfaced for logging');

  // ── 4. Summariser times out → fallback ──────────────────────────────
  const outTimeout = await summarizer.prepareConversationHistory(long, {
    summariseFn: () => new Promise(resolve => setTimeout(() => resolve('late'), 200)),
    keepRecent: 10,
    summaryTimeoutMs: 30,
  });
  assert.strictEqual(outTimeout.summarised, false, 'timeout falls back');
  assert.strictEqual(outTimeout.messages.length, 10);
  assert.ok(/timeout/i.test(outTimeout.reason || ''), 'timeout reason reported');

  // ── 5. Summariser returns empty string → fallback ───────────────────
  const outEmpty = await summarizer.prepareConversationHistory(long, {
    summariseFn: async () => '   ',
    keepRecent: 10,
  });
  assert.strictEqual(outEmpty.summarised, false, 'empty synopsis falls back');
  assert.strictEqual(outEmpty.messages.length, 10);

  // ── 6. No summariseFn supplied → deterministic truncation ───────────
  const outNoFn = await summarizer.prepareConversationHistory(long, {
    keepRecent: 10,
  });
  assert.strictEqual(outNoFn.summarised, false);
  assert.strictEqual(outNoFn.messages.length, 10);
  assert.ok(/no summariseFn/i.test(outNoFn.reason), 'reason identifies missing fn');

  // ── 7. Per-message cap is enforced before budgeting ─────────────────
  const bigMsg = { role: 'user', content: 'z'.repeat(10_000) };
  const tiny = [bigMsg, userMsg(1, 100), asstMsg(1, 100)];
  const outCap = await summarizer.prepareConversationHistory(tiny, {
    maxMsgChars: 500,
  });
  assert.ok(outCap.messages[0].content.length <= 520,
    'oversized message is truncated to per-msg cap');
  assert.ok(/truncated/i.test(outCap.messages[0].content), 'truncation marker appended');

  // ── 8. Empty / non-array input returns safely ───────────────────────
  const outEmpty1 = await summarizer.prepareConversationHistory([], {});
  assert.deepStrictEqual(outEmpty1.messages, []);
  assert.strictEqual(outEmpty1.summarised, false);
  const outEmpty2 = await summarizer.prepareConversationHistory(null, {});
  assert.deepStrictEqual(outEmpty2.messages, []);

  // ── 9. Rows with empty / whitespace-only content are dropped ────────
  const withNoise = [
    { role: 'user', content: 'real question' },
    { role: 'user', content: '' },
    { role: 'assistant', content: '   ' },
    { role: 'user', content: null },
  ];
  const outNoise = await summarizer.prepareConversationHistory(withNoise, {});
  assert.strictEqual(outNoise.messages.length, 1, 'only one non-empty row survives');
  assert.strictEqual(outNoise.messages[0].content, 'real question');

  // ── 10. buildHaikuSummariser returns null when key missing ──────────
  const delKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const noKey = summarizer.buildHaikuSummariser({ fetch: async () => ({}) });
  assert.strictEqual(noKey, null, 'no key → null summariser');
  if (delKey !== undefined) process.env.ANTHROPIC_API_KEY = delKey;

  // ── 11. buildHaikuSummariser happy path ─────────────────────────────
  let seenBody = null;
  const fakeFetch = async (_url, opts) => {
    seenBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ content: [{ text: 'synopsis from haiku' }] }),
    };
  };
  const haikuFn = summarizer.buildHaikuSummariser({ fetch: fakeFetch, apiKey: 'fake' });
  assert.ok(typeof haikuFn === 'function', 'builder returns a function');
  const text = await haikuFn('hello');
  assert.strictEqual(text, 'synopsis from haiku');
  assert.ok(seenBody && seenBody.model.startsWith('claude-haiku'),
    'fetch body carries a Haiku model id by default');
  assert.strictEqual(seenBody.messages[0].content, 'hello');

  // ── 12. buildHaikuSummariser non-OK response → null ─────────────────
  const badFetch = async () => ({ ok: false, json: async () => ({}) });
  const haikuBad = summarizer.buildHaikuSummariser({ fetch: badFetch, apiKey: 'fake' });
  const res = await haikuBad('hi');
  assert.strictEqual(res, null, 'non-OK response → null synopsis (caller falls back)');

  // ── 13. search.js route wires the summariser & 40-turn window ───────
  const searchSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'search.js'),
    'utf8',
  );
  assert.ok(
    /require\(['"]\.\.\/services\/sessionSummarizer['"]\)/.test(searchSrc),
    'search.js must require sessionSummarizer',
  );
  assert.ok(
    /messages\.slice\(-40\)/.test(searchSrc),
    'chat route must widen history window to the last 40 turns (P2.5)',
  );
  assert.ok(
    /prepareConversationHistory/.test(searchSrc),
    'chat route must call prepareConversationHistory before dispatching',
  );

  console.log('sessionSummarizer.test.js OK');
})().catch((err) => {
  console.error('sessionSummarizer.test.js FAILED:', err);
  process.exit(1);
});
