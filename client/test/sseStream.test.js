/**
 * sseStream.test.js — line-buffering, UTF-8 safety, [DONE], parse-error and
 * abort semantics of the shared SSE reader (src/utils/sseStream.js).
 *
 * Uses a hand-rolled reader mock (queue of Uint8Array chunks) so we can
 * split events at hostile byte boundaries — no network, no jsdom streams.
 */
import { describe, it, expect, vi } from 'vitest';
import { readSSEStream, createChatAbort } from '../src/utils/sseStream';

const enc = new TextEncoder();

/** Build a fetch-Response-like object from an array of string|Uint8Array chunks. */
function mockResponse(chunks) {
  const queue = chunks.map(c => (typeof c === 'string' ? enc.encode(c) : c));
  let cancelled = false;
  let released = false;
  let pendingResolve = null;
  const reader = {
    read: () =>
      new Promise((resolve) => {
        if (cancelled || queue.length === 0) return resolve({ done: true, value: undefined });
        // Simulate async network arrival; lets cancel() win races.
        pendingResolve = resolve;
        queueMicrotask(() => {
          if (!pendingResolve) return;
          const r = pendingResolve; pendingResolve = null;
          if (cancelled) return r({ done: true, value: undefined });
          r({ done: false, value: queue.shift() });
        });
      }),
    cancel: () => {
      cancelled = true;
      if (pendingResolve) { pendingResolve({ done: true, value: undefined }); pendingResolve = null; }
      return Promise.resolve();
    },
    releaseLock: () => { released = true; },
  };
  return {
    response: { body: { getReader: () => reader } },
    state: { get cancelled() { return cancelled; }, get released() { return released; } },
  };
}

describe('readSSEStream', () => {
  it('decodes multibyte UTF-8 split across reads (stream: true)', async () => {
    // 'ç' = 0xC3 0xA7 — split the two bytes across separate reads.
    const full = enc.encode('data: {"chunk":"aç"}\n\n');
    const splitAt = full.indexOf(0xa7); // second byte of ç
    const { response } = mockResponse([full.slice(0, splitAt), full.slice(splitAt)]);

    const got = [];
    await readSSEStream(response, { onData: d => got.push(d) });
    expect(got).toEqual([{ chunk: 'aç' }]);
  });

  it('buffers data: lines that straddle chunk boundaries', async () => {
    const { response } = mockResponse([
      'data: {"chunk":"hel',            // first half of the event
      'lo"}\n\ndata: {"chunk":" wor',   // completes it + starts the next
      'ld"}\n\n',
    ]);
    const got = [];
    await readSSEStream(response, { onData: d => got.push(d) });
    expect(got.map(g => g.chunk).join('')).toBe('hello world');
  });

  it('stops at [DONE], calls onDone once, cancels the reader', async () => {
    const { response, state } = mockResponse([
      'data: {"chunk":"a"}\n\ndata: [DONE]\n\ndata: {"chunk":"NEVER"}\n\n',
    ]);
    const got = [];
    const onDone = vi.fn();
    await readSSEStream(response, { onData: d => got.push(d), onDone });
    expect(got).toEqual([{ chunk: 'a' }]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(state.cancelled).toBe(true);
    expect(state.released).toBe(true);
  });

  it('calls onDone on EOF without [DONE] and flushes the trailing line', async () => {
    // Final event has no trailing newline — must still be delivered at EOF.
    const { response } = mockResponse(['data: {"chunk":"a"}\ndata: {"chunk":"b"}']);
    const got = [];
    const onDone = vi.fn();
    await readSSEStream(response, { onData: d => got.push(d), onDone });
    expect(got).toEqual([{ chunk: 'a' }, { chunk: 'b' }]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('logs a malformed complete line once and keeps going', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { response } = mockResponse([
        'data: {broken\n\ndata: [ERROR]\n\ndata: {"chunk":"ok"}\n\n',
      ]);
      const got = [];
      await readSSEStream(response, { onData: d => got.push(d) });
      expect(got).toEqual([{ chunk: 'ok' }]);
      expect(warn).toHaveBeenCalledTimes(1); // logged once, not per bad line
    } finally {
      warn.mockRestore();
    }
  });

  it('propagates onData exceptions to the caller (not swallowed as parse errors)', async () => {
    const { response } = mockResponse(['data: {"error":"boom"}\n\n']);
    await expect(
      readSSEStream(response, { onData: () => { throw new Error('boom'); } }),
    ).rejects.toThrow('boom');
  });

  it('abort mid-stream rejects with AbortError and cancels the reader', async () => {
    const { response, state } = mockResponse([
      'data: {"chunk":"first"}\n\n',
      'data: {"chunk":"second"}\n\n',
      'data: {"chunk":"third"}\n\n',
    ]);
    const { controller, signal, abort } = createChatAbort();
    expect(controller.signal).toBe(signal);

    const got = [];
    const onDone = vi.fn();
    const p = readSSEStream(response, {
      signal,
      onDone,
      onData: (d) => { got.push(d); if (got.length === 1) abort(); },
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(got).toEqual([{ chunk: 'first' }]);
    expect(onDone).not.toHaveBeenCalled(); // abort is not a normal finish
    expect(state.cancelled).toBe(true);
    expect(state.released).toBe(true);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { response, state } = mockResponse(['data: {"chunk":"x"}\n\n']);
    const { signal, abort } = createChatAbort();
    abort();
    await expect(readSSEStream(response, { signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.cancelled).toBe(true);
  });

  it('throws a TypeError for a response without a readable body', async () => {
    await expect(readSSEStream({}, {})).rejects.toThrow(TypeError);
  });
});
