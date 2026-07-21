/**
 * chartGridSync.test.js — fix/bug-wave3 BUG 2.
 *
 * "Chart grid symbols disappear when navigating screens": a local add was
 * clobbered on remount by a stale /api/settings snapshot that raced the
 * debounced POST. The guard: user edits mark the grid dirty (persisted);
 * while dirty an incoming server snapshot NEVER overwrites local state, and
 * the flag clears only after a successful POST of a grid that still matches
 * the current local grid.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  GRID_META_KEY, gridsEqual, readGridMeta, writeGridMeta, markGridDirty,
  clearGridDirtyIfSynced, resolveIncomingServerGrid,
} from '../src/utils/chartGridSync';

const LS_KEY = 'chartGrid_v3';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

describe('gridsEqual', () => {
  it('is order-sensitive and type-safe', () => {
    expect(gridsEqual(['A', 'B'], ['A', 'B'])).toBe(true);
    expect(gridsEqual(['A', 'B'], ['B', 'A'])).toBe(false);
    expect(gridsEqual(['A'], ['A', 'B'])).toBe(false);
    expect(gridsEqual(null, [])).toBe(false);
    expect(gridsEqual([], [])).toBe(true);
  });
});

describe('grid meta round-trip', () => {
  let storage;
  beforeEach(() => { storage = fakeStorage(); });

  it('defaults clean when missing or corrupt', () => {
    expect(readGridMeta(storage)).toEqual({ dirty: false, updatedAt: null });
    storage.setItem(GRID_META_KEY, '{not json');
    expect(readGridMeta(storage)).toEqual({ dirty: false, updatedAt: null });
  });

  it('markGridDirty persists and survives a "remount" (new reader)', () => {
    markGridDirty(storage, 1000);
    expect(readGridMeta(storage)).toEqual({ dirty: true, updatedAt: 1000 });
  });

  it('writeGridMeta normalizes junk', () => {
    writeGridMeta(storage, { dirty: 'yes', updatedAt: 5 });
    expect(readGridMeta(storage).dirty).toBe(false); // only strict true counts
  });
});

describe('resolveIncomingServerGrid — the clobber guard', () => {
  const local = ['SPY', 'QQQ', 'NEWLY_ADDED'];
  const staleServer = ['SPY', 'QQQ'];

  it('keeps local when server grid is empty/missing', () => {
    expect(resolveIncomingServerGrid({ localGrid: local, serverGrid: null, dirty: false }))
      .toEqual({ grid: local, appliedServer: false });
    expect(resolveIncomingServerGrid({ localGrid: local, serverGrid: [], dirty: false }))
      .toEqual({ grid: local, appliedServer: false });
  });

  it('NEVER lets a server snapshot clobber dirty local edits', () => {
    const r = resolveIncomingServerGrid({ localGrid: local, serverGrid: staleServer, dirty: true });
    expect(r.grid).toEqual(local);
    expect(r.appliedServer).toBe(false);
  });

  it('applies the server grid when clean, capped at max', () => {
    const big = Array.from({ length: 20 }, (_, i) => `T${i}`);
    const r = resolveIncomingServerGrid({ localGrid: ['SPY'], serverGrid: big, dirty: false, max: 12 });
    expect(r.appliedServer).toBe(true);
    expect(r.grid).toHaveLength(12);
    expect(r.grid[0]).toBe('T0');
  });
});

describe('clearGridDirtyIfSynced — ack only clears when nothing changed since', () => {
  let storage;
  beforeEach(() => { storage = fakeStorage(); });

  it('clears when the saved grid matches disk', () => {
    storage.setItem(LS_KEY, JSON.stringify(['SPY', 'QQQ']));
    markGridDirty(storage);
    expect(clearGridDirtyIfSynced(storage, ['SPY', 'QQQ'], LS_KEY)).toBe(true);
    expect(readGridMeta(storage).dirty).toBe(false);
  });

  it('stays dirty when the user edited again mid-flight', () => {
    storage.setItem(LS_KEY, JSON.stringify(['SPY', 'QQQ', 'TSLA'])); // newer edit
    markGridDirty(storage);
    expect(clearGridDirtyIfSynced(storage, ['SPY', 'QQQ'], LS_KEY)).toBe(false);
    expect(readGridMeta(storage).dirty).toBe(true);
  });
});

describe('end-to-end race replay (the reported bug)', () => {
  it('add → navigate away → remount with stale GET → local add survives', () => {
    const storage = fakeStorage();
    const serverSnapshot = ['SPY', 'QQQ'];              // what the server still has

    // 1. user adds VALE3.SA: local state + LS update, edit marks dirty
    const local = ['SPY', 'QQQ', 'VALE3.SA'];
    storage.setItem(LS_KEY, JSON.stringify(local));
    markGridDirty(storage);

    // 2. unmount/remount (Vault and back) — meta persisted in storage
    const meta = readGridMeta(storage);
    expect(meta.dirty).toBe(true);

    // 3. remount GET resolves with the STALE server grid
    const { grid, appliedServer } = resolveIncomingServerGrid({
      localGrid: JSON.parse(storage.getItem(LS_KEY)),
      serverGrid: serverSnapshot,
      dirty: meta.dirty,
    });
    expect(appliedServer).toBe(false);
    expect(grid).toContain('VALE3.SA');                 // the add survived

    // 4. flushed/retried POST lands → dirty clears → future GETs may apply
    expect(clearGridDirtyIfSynced(storage, grid, LS_KEY)).toBe(true);
    const after = resolveIncomingServerGrid({
      localGrid: grid, serverGrid: grid, dirty: readGridMeta(storage).dirty,
    });
    expect(after.appliedServer).toBe(true);
  });
});
