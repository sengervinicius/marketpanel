/**
 * tapHandlers.js — shared touch-slop guard for mobile list rows.
 *
 * Why this exists (#224):
 *   Across the app, mobile list rows were wired with both
 *     onClick={openDetail}
 *   AND
 *     onTouchEnd={(e) => { e.preventDefault(); openDetail(...); }}
 *
 *   The onTouchEnd branch fired openDetail UNCONDITIONALLY even when the
 *   user was scrolling the list. Any vertical flick through a watchlist
 *   opened a random ticker. Users couldn't reliably scroll through their
 *   own watchlist without tripping detail overlays. Multiple CIO reports.
 *
 *   The fix is a standard touch-slop gate: record the touchstart
 *   position, compute the movement delta on touchmove, and only fire the
 *   tap if total movement stayed under ~10px. Scrolls get correctly
 *   classified and ignored. Long-press is wired in the same place so a
 *   slow drag can't trigger a long-press either.
 *
 * Usage:
 *   import { useTapGuard } from '../../utils/tapHandlers';
 *
 *   const rowHandlers = useTapGuard({
 *     onTap:       () => openDetail(sym),
 *     onLongPress: () => handleWhyPress(sym),
 *   });
 *   <div className="row" {...rowHandlers}>...</div>
 *
 * Notes:
 *   - useTapGuard returns a STABLE handlers object per instance, so each
 *     row should have its own call site. For lists where a single hook
 *     would be reused across many rows, pass the symbol into a closure
 *     around `useTapGuard` or use `createTapHandlers` (non-hook variant)
 *     inside the map callback.
 *   - preventDefault() on touchend suppresses the synthetic click that
 *     iOS dispatches after a tap, so the same tap won't fire twice.
 *   - onClick remains wired for desktop (mouse users); a small cooldown
 *     ref dedupes it against a recent touch-driven tap.
 */

import { useRef } from 'react';

const DEFAULT_SLOP_PX        = 10;   // ~3mm on most phones; matches iOS native feel
const DEFAULT_LONGPRESS_MS   = 600;
const CLICK_DEDUPE_WINDOW_MS = 500;  // guards against double-fire tap+click

/**
 * Non-hook factory for use inside .map() render callbacks where calling
 * hooks per-row would violate the Rules of Hooks. Internally holds its
 * state on a mutable object that the caller can keep in a ref.
 *
 * For most panels the hook form (useTapGuard) is fine because we create
 * a handler per row lazily via render-level closures — see below.
 */
export function createTapHandlers({
  onTap,
  onLongPress,
  slop = DEFAULT_SLOP_PX,
  longPressMs = DEFAULT_LONGPRESS_MS,
} = {}) {
  const s = {
    startX: 0,
    startY: 0,
    moved: false,
    longPressFired: false,
    longPressTimer: null,
    lastTapAt: 0,
  };

  const clearLongPress = () => {
    if (s.longPressTimer) {
      clearTimeout(s.longPressTimer);
      s.longPressTimer = null;
    }
  };

  return {
    onTouchStart: (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      s.startX = t.clientX;
      s.startY = t.clientY;
      s.moved = false;
      s.longPressFired = false;
      clearLongPress();
      if (onLongPress) {
        s.longPressTimer = setTimeout(() => {
          s.longPressFired = true;
          onLongPress();
        }, longPressMs);
      }
    },
    onTouchMove: (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;
      if (dx * dx + dy * dy > slop * slop) {
        s.moved = true;
        clearLongPress();
      }
    },
    onTouchEnd: (e) => {
      clearLongPress();
      if (s.moved || s.longPressFired) return;
      // Suppress the synthetic click so it doesn't double-fire onTap.
      if (e && e.preventDefault) e.preventDefault();
      s.lastTapAt = Date.now();
      if (onTap) onTap();
    },
    onTouchCancel: () => {
      clearLongPress();
      // Conservative: treat a cancelled touch as "moved" so no tap fires.
      s.moved = true;
    },
    // Desktop / mouse path. Dedupes against a recent touch-driven tap.
    onClick: () => {
      if (Date.now() - s.lastTapAt < CLICK_DEDUPE_WINDOW_MS) return;
      if (onTap) onTap();
    },
  };
}

/**
 * Hook form for single-row components (sheets, headers, individual
 * buttons). For list rows inside a .map(), use createTapHandlers() stored
 * on a ref-held Map keyed by row identifier, or simply rebuild the
 * handlers per render with a closure — creation is cheap.
 */
export function useTapGuard(opts) {
  const handlersRef = useRef(null);
  if (!handlersRef.current) {
    handlersRef.current = createTapHandlers(opts);
  }
  return handlersRef.current;
}

// ────────────────────────────────────────────────────────────────
// Module-level tracker — minimal three-function API for use in .map()
// render callbacks across sector/panel screens where a per-row ref is
// overkill. Only one touch gesture happens at a time in practice
// (single-finger scroll on mobile), so sharing state module-wide is
// fine and keeps call-site diffs tiny.
//
// Usage:
//   import { tapStart, tapMove, tapEnd } from '../../utils/tapHandlers';
//
//   <div
//     onClick={() => openDetail(sym)}
//     onTouchStart={tapStart}
//     onTouchMove={tapMove}
//     onTouchEnd={(e) => tapEnd(e, () => openDetail(sym))}
//   />
//
// The onClick stays wired for desktop. onTouchEnd only fires openDetail
// if the gesture was a real tap (no significant movement); scrolls are
// correctly classified and suppressed.
// ────────────────────────────────────────────────────────────────

let _tX = 0;
let _tY = 0;
let _tMoved = false;
const MODULE_SLOP_PX = 10;

export function tapStart(e) {
  const t = e.touches && e.touches[0];
  if (!t) return;
  _tX = t.clientX;
  _tY = t.clientY;
  _tMoved = false;
}

export function tapMove(e) {
  const t = e.touches && e.touches[0];
  if (!t) return;
  const dx = t.clientX - _tX;
  const dy = t.clientY - _tY;
  if (dx * dx + dy * dy > MODULE_SLOP_PX * MODULE_SLOP_PX) {
    _tMoved = true;
  }
}

/**
 * tapEnd(e, onTap) — call inside onTouchEnd. Fires onTap only if the
 * gesture didn't exceed the slop threshold; otherwise it's classified
 * as a scroll and nothing fires. preventDefault is called on a real
 * tap to suppress the synthetic click so onTap doesn't double-fire.
 */
export function tapEnd(e, onTap) {
  if (_tMoved) return;
  if (e && e.preventDefault) e.preventDefault();
  if (onTap) onTap();
}

export default createTapHandlers;
