/**
 * sseStream.js — Shared SSE reader for streaming chat responses.
 *
 * Every chat surface in the app (ChatPanel, VaultDocChat, useParticleAI,
 * ParticleChatContext) streams `data: {...}` events off a fetch Response.
 * Before this module each call site hand-rolled the read loop, and most of
 * them shared the same three bugs:
 *
 *   1. `decoder.decode(value)` without `{ stream: true }` corrupts multibyte
 *      UTF-8 sequences that straddle two network reads (e.g. "ã" in a
 *      PT-BR answer split across chunks renders as U+FFFD garbage).
 *   2. Splitting each chunk on '\n' with no cross-read buffer silently drops
 *      `data:` lines that straddle a chunk boundary — the tail half fails
 *      JSON.parse and is skipped, losing streamed tokens.
 *   3. No AbortController wiring, so unmounting a component mid-stream kept
 *      the fetch alive and fired setState on an unmounted component.
 *
 * Contract
 * --------
 * `readSSEStream(response, { onData, onDone, signal })`
 *
 *   - `response`  : a fetch Response whose body is an SSE stream of
 *                   `data: <payload>\n\n` events.
 *   - `onData(obj)`: called once per successfully JSON-parsed `data:` payload,
 *                   in stream order. Exceptions thrown by onData propagate to
 *                   the caller (they are NOT swallowed as parse errors).
 *   - `onDone()`  : called exactly once when the stream terminates normally —
 *                   either a `data: [DONE]` sentinel or the reader draining.
 *                   NOT called on abort or error.
 *   - `signal`    : optional AbortSignal. On abort the reader is cancelled and
 *                   the promise rejects with a DOMException named 'AbortError'
 *                   (same shape fetch itself produces), so existing
 *                   `err.name === 'AbortError'` handling keeps working whether
 *                   or not the same signal was also passed to fetch().
 *
 * Guarantees:
 *   - UTF-8 is decoded with `{ stream: true }` (multibyte-safe across reads).
 *   - Lines are only processed once complete; the trailing partial line is
 *     buffered across reads and flushed (with a final decoder flush) at EOF.
 *   - A payload that is a complete line but malformed JSON is logged once per
 *     stream and skipped — it never throws.
 *   - `data: [DONE]` stops reading immediately (reader is cancelled) rather
 *     than merely breaking one loop iteration.
 *   - The reader lock is always released.
 *
 * @param {Response} response - fetch Response with a readable SSE body.
 * @param {object}   handlers
 * @param {(data: object) => void} [handlers.onData]
 * @param {() => void}             [handlers.onDone]
 * @param {AbortSignal}            [handlers.signal]
 * @returns {Promise<void>} resolves when the stream ends ([DONE] or EOF);
 *                          rejects with AbortError on abort, or with whatever
 *                          onData throws.
 */
export async function readSSEStream(response, { onData, onDone, signal } = {}) {
  if (!response || !response.body || typeof response.body.getReader !== 'function') {
    throw new TypeError('readSSEStream: response has no readable body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let parseErrorLogged = false;
  let doneCalled = false;

  const throwAbort = () => {
    // Mirror fetch's own abort rejection so callers can share one handler.
    throw new DOMException('The SSE stream was aborted.', 'AbortError');
  };

  const cancelReader = () => {
    try {
      const p = reader.cancel();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* reader already closed */ }
  };

  const onAbort = () => { cancelReader(); };
  if (signal) {
    if (signal.aborted) { cancelReader(); throwAbort(); }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  const finishOnce = () => {
    if (doneCalled) return;
    doneCalled = true;
    if (typeof onDone === 'function') onDone();
  };

  /**
   * Process one complete line. Returns true when the [DONE] sentinel was
   * seen and reading should stop.
   */
  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const payload = trimmed.slice(5).trim();
    if (!payload) return false;
    if (payload === '[DONE]') return true;

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // Only complete lines reach this point, so a parse failure means the
      // server sent a genuinely malformed/non-JSON payload (e.g. a legacy
      // '[ERROR]' sentinel). Log once per stream, never crash the read loop.
      if (!parseErrorLogged) {
        parseErrorLogged = true;
        console.warn('[sseStream] skipping malformed SSE payload:', payload.slice(0, 120));
      }
      return false;
    }
    // Deliberately outside the try/catch: onData errors belong to the caller.
    if (typeof onData === 'function') onData(parsed);
    return false;
  };

  try {
    for (;;) {
      if (signal && signal.aborted) throwAbort();
      const { done, value } = await reader.read();
      if (signal && signal.aborted) throwAbort();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep the trailing partial line for the next read
      for (const line of lines) {
        if (handleLine(line)) {
          cancelReader();
          finishOnce();
          return;
        }
      }
    }

    // EOF: flush any bytes the decoder is still holding plus the last
    // (now necessarily complete) buffered line.
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
    finishOnce();
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/**
 * Convenience factory for the per-request abort pattern used by the chat
 * surfaces: create one per send(), stash it in a ref, and call `.abort()`
 * from the unmount cleanup (or a user-facing Stop button).
 *
 * @returns {{ controller: AbortController, signal: AbortSignal, abort: () => void }}
 */
export function createChatAbort() {
  const controller = new AbortController();
  return {
    controller,
    signal: controller.signal,
    abort: () => controller.abort(),
  };
}
