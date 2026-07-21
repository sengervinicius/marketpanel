/**
 * OverlayContext — open/close plumbing for the full-screen overlay layer.
 *
 * Usage from anywhere under the provider:
 *   const { open, close } = useOverlay();
 *   open('brazil');                    // Brazil deep view, default tab
 *   open('rates', { tab: 'SPREADS' }); // deep-link a tab
 *
 * Code that lives OUTSIDE the provider (App's Cmd+K command handler)
 * uses the window-event bridge instead — same pattern as the existing
 * 'particle-prefill' event:
 *   window.dispatchEvent(new CustomEvent('particle-open-overlay',
 *     { detail: { id: 'brazil' } }));
 */
import { createContext, useContext, useReducer, useCallback, useEffect, useMemo } from 'react';
import { overlayReducer, initialOverlayState } from './overlayStore';

const OverlayContext = createContext(null);

const NOOP_CTX = {
  overlay: initialOverlayState,
  open: () => {},
  close: () => {},
  setTab: () => {},
};

export function OverlayProvider({ children }) {
  const [overlay, dispatch] = useReducer(overlayReducer, initialOverlayState);

  const open   = useCallback((id, params) => dispatch({ type: 'OPEN', id, params }), []);
  const close  = useCallback(() => dispatch({ type: 'CLOSE' }), []);
  const setTab = useCallback((tab) => dispatch({ type: 'SET_TAB', tab }), []);

  // Window-event bridge for callers outside the provider (Cmd+K palette,
  // HOME nav button). detail: { id, params? }.
  useEffect(() => {
    const onOpen  = (e) => { if (e?.detail?.id) open(e.detail.id, e.detail.params); };
    const onClose = () => close();
    window.addEventListener('particle-open-overlay', onOpen);
    window.addEventListener('particle-close-overlay', onClose);
    return () => {
      window.removeEventListener('particle-open-overlay', onOpen);
      window.removeEventListener('particle-close-overlay', onClose);
    };
  }, [open, close]);

  const value = useMemo(() => ({ overlay, open, close, setTab }), [overlay, open, close, setTab]);
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

/** Safe outside the provider (mobile branches, tests) — returns no-ops. */
export function useOverlay() {
  return useContext(OverlayContext) || NOOP_CTX;
}

export default OverlayContext;
