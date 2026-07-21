/**
 * chartPollGate.test.js — fix/bug-wave3 BUG 4.
 *
 * Measure tool vs. polling refresh: while measure mode is armed, the
 * intraday bars poll must be DEFERRED (not dropped), and exactly one
 * catch-up fetch must flush when the measure completes/cancels. A hidden
 * tab skips silently (visibilitychange already handles catch-up).
 */
import { describe, it, expect } from 'vitest';
import { createPollGate } from '../chartPollGate';

describe('createPollGate', () => {
  it('runs freely when not paused and visible', () => {
    const g = createPollGate();
    expect(g.shouldRun(false)).toBe(true);
    expect(g.shouldRun(false)).toBe(true);
    expect(g.pending).toBe(false);
  });

  it('hidden tab skips without creating flush debt', () => {
    const g = createPollGate();
    expect(g.shouldRun(true)).toBe(false);
    expect(g.pending).toBe(false);
    expect(g.setPaused(false)).toBe(false); // nothing to flush
  });

  it('measure armed: ticks defer, disarm flushes exactly once', () => {
    const g = createPollGate();
    g.setPaused(true);
    expect(g.shouldRun(false)).toBe(false); // 60s tick lands mid-measure
    expect(g.shouldRun(false)).toBe(false); // ... and again
    expect(g.pending).toBe(true);

    expect(g.setPaused(false)).toBe(true);  // measure done → flush once
    expect(g.pending).toBe(false);
    expect(g.setPaused(false)).toBe(false); // idempotent — no double fetch
    expect(g.shouldRun(false)).toBe(true);  // normal polling resumes
  });

  it('disarm without any deferred tick does not flush', () => {
    const g = createPollGate();
    g.setPaused(true);
    expect(g.setPaused(false)).toBe(false); // quick arm/cancel, no tick between
  });

  it('re-arming clears stale flush debt', () => {
    const g = createPollGate();
    g.setPaused(true);
    g.shouldRun(false);        // defer
    g.setPaused(true);         // user re-arms instead of finishing
    expect(g.pending).toBe(false);
    expect(g.setPaused(false)).toBe(false);
  });

  it('hidden + paused: still no run, defer only via paused path', () => {
    const g = createPollGate();
    g.setPaused(true);
    expect(g.shouldRun(true)).toBe(false);
    expect(g.pending).toBe(false); // hidden short-circuits before deferring
  });
});
