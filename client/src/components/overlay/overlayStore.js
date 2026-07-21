/**
 * overlayStore.js — pure state machine for the full-screen overlay layer
 * (Phase S §4: overlays replace the sector screens).
 *
 * Kept as a plain reducer (no React) so open/close/tab logic is unit-
 * testable without a DOM. Invariants:
 *   - only ONE overlay at a time — OPEN replaces whatever was up;
 *   - CLOSE always returns to the terminal (never to another overlay);
 *   - tab is per-overlay UI state and resets on every OPEN (a fresh
 *     open lands on the overlay's default tab unless params.tab says
 *     otherwise).
 */

export const initialOverlayState = { id: null, params: null, tab: null };

export function overlayReducer(state, action) {
  switch (action && action.type) {
    case 'OPEN': {
      if (!action.id || typeof action.id !== 'string') return state;
      const params = action.params || null;
      return {
        id: action.id,
        params,
        // params.tab lets entry points deep-link (e.g. "FILINGS");
        // null means "overlay default" — OverlayHost resolves it.
        tab: (params && typeof params.tab === 'string' && params.tab) || null,
      };
    }
    case 'CLOSE':
      return state.id === null ? state : initialOverlayState;
    case 'SET_TAB': {
      if (state.id === null) return state; // no overlay — nothing to tab
      if (!action.tab || typeof action.tab !== 'string') return state;
      if (state.tab === action.tab) return state;
      return { ...state, tab: action.tab };
    }
    default:
      return state;
  }
}
