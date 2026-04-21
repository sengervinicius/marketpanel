/**
 * aiToolbox.toolEvents.test.js — P2.6 error-transparency unit tests.
 *
 * Validates the per-tool status emission path:
 *   - runToolLoop invokes onToolEvent once per dispatched tool
 *   - successful tools emit ok:true with a non-negative durationMs
 *   - tools that return { error } emit ok:false with the message surfaced
 *   - handlers that throw are classified as failures (dispatchTool wraps
 *     the throw in { error } so the loop keeps going)
 *   - absent onToolEvent callback is a no-op (back-compat)
 *   - a throwing onToolEvent callback does not break the loop
 *   - runToolLoopStream forwards events as `data: {"toolEvent":{...}}\n\n`
 *     SSE frames on the response object
 *
 * All test cases stub global.fetch so we script exactly what the Claude
 * tool-use endpoint "returns" round-by-round, without any real network.
 */

'use strict';

const assert = require('assert');
const path = require('path');

function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', '..', relativePath));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

stubModule('utils/logger',       { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
stubModule('services/aiCostLedger', { recordUsage: () => {} });

// aiToolbox.js uses `require('node-fetch')` — stub that module BEFORE
// requiring aiToolbox so callClaudeJson picks up our scripted fetch
// instead of hitting the live Anthropic endpoint.
const scripted = [];
function pushResp(body) { scripted.push(body); }
const nodeFetchPath = require.resolve('node-fetch');
require.cache[nodeFetchPath] = {
  id: nodeFetchPath,
  filename: nodeFetchPath,
  loaded: true,
  exports: async () => {
    if (scripted.length === 0) throw new Error('no more scripted responses');
    const body = scripted.shift();
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  },
};

const aiToolbox = require('../aiToolbox');

(async () => {
  // ── Test harness: scripted fetch ────────────────────────────────────
  // Each pushResp enqueues one Claude round response. callClaudeJson
  // dequeues and returns it. Test cases push TWO responses — round 1 asks
  // for tool uses, round 2 returns final text — so the loop exits cleanly.
  process.env.ANTHROPIC_API_KEY = 'fake-test-key';

  // Register synthetic tool handlers.
  aiToolbox.HANDLERS.fake_ok    = async () => ({ ok: 1, value: 42 });
  aiToolbox.HANDLERS.fake_err   = async () => ({ error: 'upstream 500' });
  aiToolbox.HANDLERS.fake_throw = async () => { throw new Error('kaboom'); };

  const provider = {
    url: 'https://api.anthropic.com/v1/messages',
    keyEnv: 'ANTHROPIC_API_KEY',
    model: 'claude-sonnet-4-6',
  };

  // ── 1. One round, two parallel tools (ok + err) ─────────────────────
  pushResp({
    content: [
      { type: 'tool_use', id: 'tu_1', name: 'fake_ok',  input: {} },
      { type: 'tool_use', id: 'tu_2', name: 'fake_err', input: {} },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 40 },
  });
  pushResp({
    content: [{ type: 'text', text: 'synthesised answer' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 60, output_tokens: 20 },
  });

  const events = [];
  const out1 = await aiToolbox.runToolLoop(
    provider,
    [{ role: 'user', content: 'hi' }],
    'SYSTEM',
    { onToolEvent: (e) => events.push(e) },
  );
  assert.strictEqual(out1.finalText, 'synthesised answer', 'final text returned');
  assert.strictEqual(events.length, 2, 'one event per dispatched tool');

  const okEvt  = events.find(e => e.name === 'fake_ok');
  const errEvt = events.find(e => e.name === 'fake_err');
  assert.ok(okEvt,  'ok-event present');
  assert.ok(errEvt, 'err-event present');

  // Successful tool
  assert.strictEqual(okEvt.ok, true,           'successful tool → ok:true');
  assert.strictEqual(okEvt.error, null,        'successful tool → error:null');
  assert.strictEqual(typeof okEvt.durationMs, 'number', 'durationMs is numeric');
  assert.ok(okEvt.durationMs >= 0,             'durationMs non-negative');
  assert.strictEqual(okEvt.truncated, false,   'successful tool → truncated:false');

  // Error-returning tool
  assert.strictEqual(errEvt.ok, false,         'error tool → ok:false');
  assert.strictEqual(errEvt.error, 'upstream 500', 'error string passed through');

  // ── 2. Thrown handler is classified as failure ──────────────────────
  pushResp({
    content: [{ type: 'tool_use', id: 'tu_3', name: 'fake_throw', input: {} }],
    stop_reason: 'tool_use',
  });
  pushResp({
    content: [{ type: 'text', text: 'recovered' }],
    stop_reason: 'end_turn',
  });
  const events2 = [];
  const out2 = await aiToolbox.runToolLoop(
    provider,
    [{ role: 'user', content: 'try' }],
    'SYSTEM',
    { onToolEvent: (e) => events2.push(e) },
  );
  assert.strictEqual(out2.finalText, 'recovered', 'loop recovers from throw');
  assert.strictEqual(events2.length, 1);
  assert.strictEqual(events2[0].ok, false,     'thrown handler → ok:false');
  assert.ok(/kaboom/.test(events2[0].error),   'thrown message surfaced in event.error');
  assert.strictEqual(events2[0].name, 'fake_throw');

  // ── 3. Absent onToolEvent is harmless ───────────────────────────────
  pushResp({
    content: [{ type: 'tool_use', id: 'tu_4', name: 'fake_ok', input: {} }],
    stop_reason: 'tool_use',
  });
  pushResp({
    content: [{ type: 'text', text: 'silent' }],
    stop_reason: 'end_turn',
  });
  const out3 = await aiToolbox.runToolLoop(
    provider,
    [{ role: 'user', content: 'x' }],
    'SYSTEM',
    {}, // no onToolEvent
  );
  assert.strictEqual(out3.finalText, 'silent', 'loop works with no callback');

  // ── 4. Throwing callback must not break the loop ────────────────────
  pushResp({
    content: [{ type: 'tool_use', id: 'tu_5', name: 'fake_ok', input: {} }],
    stop_reason: 'tool_use',
  });
  pushResp({
    content: [{ type: 'text', text: 'survived' }],
    stop_reason: 'end_turn',
  });
  const out4 = await aiToolbox.runToolLoop(
    provider,
    [{ role: 'user', content: 'x' }],
    'SYSTEM',
    { onToolEvent: () => { throw new Error('ui blew up'); } },
  );
  assert.strictEqual(out4.finalText, 'survived',
    'loop survives a throwing onToolEvent callback');

  // ── 5. runToolLoopStream emits toolEvent SSE frames ─────────────────
  pushResp({
    content: [{ type: 'tool_use', id: 'tu_6', name: 'fake_err', input: {} }],
    stop_reason: 'tool_use',
  });
  pushResp({
    content: [{ type: 'text', text: 'streamed' }],
    stop_reason: 'end_turn',
  });
  const frames = [];
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead: () => {},
    write:     (chunk) => { frames.push(String(chunk)); return true; },
    end:       () => { res.writableEnded = true; },
  };
  await aiToolbox.runToolLoopStream(
    provider,
    [{ role: 'user', content: 'stream me' }],
    'SYSTEM',
    res,
    { userId: 'u1' },
  );
  const toolFrames = frames.filter(f => f.includes('"toolEvent"'));
  assert.strictEqual(toolFrames.length, 1,
    'exactly one toolEvent frame emitted for one tool dispatch');

  const parsed = JSON.parse(toolFrames[0].replace(/^data: /, '').trim());
  assert.ok(parsed.toolEvent, 'frame parses with toolEvent key');
  assert.strictEqual(parsed.toolEvent.name, 'fake_err');
  assert.strictEqual(parsed.toolEvent.ok, false);
  assert.strictEqual(parsed.toolEvent.error, 'upstream 500');
  assert.strictEqual(typeof parsed.toolEvent.durationMs, 'number');

  // The stream should also have written the text chunks and a [DONE].
  assert.ok(frames.some(f => f.includes('"chunk"')), 'chunk frame(s) present');
  assert.ok(frames.some(f => f.includes('[DONE]')), '[DONE] frame present');

  // ── 6. Cleanup ──────────────────────────────────────────────────────
  delete aiToolbox.HANDLERS.fake_ok;
  delete aiToolbox.HANDLERS.fake_err;
  delete aiToolbox.HANDLERS.fake_throw;

  console.log('aiToolbox.toolEvents.test.js OK');
})().catch((err) => {
  console.error('aiToolbox.toolEvents.test.js FAILED:', err);
  process.exit(1);
});
