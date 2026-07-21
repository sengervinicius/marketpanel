/**
 * chartGridSync.js — merge/guard logic for the home chart grid (fix/bug-wave3
 * BUG 2: "grid symbols disappear when navigating screens").
 *
 * The failure mode: user adds a ticker → local state + localStorage update
 * immediately, the server POST is debounced 1.5s. Switching views unmounts
 * ChartPanel; on return the remounted panel GETs /api/settings and blindly
 * applied the server grid — which is STALE if the debounced POST hadn't
 * fired/landed yet. The stale grid then re-POSTed itself, permanently
 * deleting the user's add.
 *
 * Guard: every user edit marks the grid DIRTY (persisted in localStorage so
 * it survives the unmount/remount); while dirty, an incoming server snapshot
 * NEVER overwrites local state. The flag clears only after a successful POST
 * of a grid that still matches the current local grid.
 *
 * Pure functions take a `storage` (localStorage-compatible) so they are unit
 * testable without a DOM.
 */

export const GRID_META_KEY = 'chartGrid_v3_meta';

/** Order-sensitive grid equality (order is user-meaningful — it's the layout). */
export function gridsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Read the sync meta ({ dirty, updatedAt }); corrupt/missing → clean defaults. */
export function readGridMeta(storage) {
  try {
    const raw = storage.getItem(GRID_META_KEY);
    if (!raw) return { dirty: false, updatedAt: null };
    const j = JSON.parse(raw);
    return {
      dirty: j?.dirty === true,
      updatedAt: Number.isFinite(j?.updatedAt) ? j.updatedAt : null,
    };
  } catch {
    return { dirty: false, updatedAt: null };
  }
}

export function writeGridMeta(storage, meta) {
  try {
    storage.setItem(GRID_META_KEY, JSON.stringify({
      dirty: meta.dirty === true,
      updatedAt: meta.updatedAt ?? Date.now(),
    }));
  } catch { /* private mode / quota — degrade to in-session behavior */ }
}

/** Mark local edits pending (called on every user add/remove/replace/swap). */
export function markGridDirty(storage, now = Date.now()) {
  writeGridMeta(storage, { dirty: true, updatedAt: now });
}

/**
 * After a successful POST of `savedGrid`: clear the dirty flag ONLY if the
 * grid on disk still matches what was saved (the user may have edited again
 * while the request was in flight — those edits are still unsynced).
 */
export function clearGridDirtyIfSynced(storage, savedGrid, gridKey, now = Date.now()) {
  try {
    const cur = JSON.parse(storage.getItem(gridKey));
    if (gridsEqual(cur, savedGrid)) {
      writeGridMeta(storage, { dirty: false, updatedAt: now });
      return true;
    }
  } catch { /* fall through — keep dirty */ }
  return false;
}

/**
 * Decide what the grid should be when a server snapshot arrives.
 *
 * Rules:
 *  - no/empty server grid            → keep local (nothing to merge);
 *  - local edits pending (dirty)     → keep local: an older server snapshot
 *                                      must NEVER clobber newer local edits;
 *  - clean                           → server wins (capped at `max`).
 *
 * Returns { grid, appliedServer } — appliedServer=false means the caller
 * should (re)schedule a save so the server catches up with local state.
 */
export function resolveIncomingServerGrid({ localGrid, serverGrid, dirty, max = 12 }) {
  const local = Array.isArray(localGrid) ? localGrid : [];
  if (!Array.isArray(serverGrid) || serverGrid.length === 0) {
    return { grid: local, appliedServer: false };
  }
  if (dirty) {
    return { grid: local, appliedServer: false };
  }
  return { grid: serverGrid.slice(0, max), appliedServer: true };
}
