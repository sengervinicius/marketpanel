/**
 * OverlayHost — the full-viewport layer that replaces the sector screens
 * (Phase S design review §4). Renders over the terminal (position:fixed),
 * slides/fades in ~150ms, top bar per the approved mockup:
 *
 *   ◆ TITLE (accent mono) · tab chips · ……… · [ESC ← TERMINAL]
 *
 * ESC key and the ESC chip both close; the body scrolls. Exactly one
 * overlay at a time (enforced by overlayStore). Overlay contents are
 * lazy chunks so the home bundle doesn't pay for rooms nobody opened.
 */
import { Suspense, useEffect } from 'react';
import { useOverlay } from './OverlayContext';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import PanelErrorBoundary from '../common/PanelErrorBoundary';
import './OverlayHost.css';

const BrazilOverlay = lazyWithRetry(() => import('./BrazilOverlay'));
const RatesOverlay  = lazyWithRetry(() => import('./RatesOverlay'));

// id → overlay definition. Titles/tabs live here so the host can render
// the top bar before the lazy body chunk arrives.
export const OVERLAYS = {
  brazil: { title: 'BRAZIL — DEEP VIEW', tabs: ['MARKETS', 'RATES', 'FILINGS'], Component: BrazilOverlay },
  rates:  { title: 'RATES — DEEP VIEW',  tabs: ['CURVES', 'SPREADS', 'US CREDIT'], Component: RatesOverlay },
};

export default function OverlayHost() {
  const { overlay, close, setTab } = useOverlay();
  const def = overlay.id ? OVERLAYS[overlay.id] : null;

  // ESC closes. Capture phase so App's legacy Escape handling never races us.
  useEffect(() => {
    if (!def) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [def, close]);

  if (!def) return null;

  const tab = def.tabs.includes(overlay.tab) ? overlay.tab : def.tabs[0];
  const Body = def.Component;

  return (
    <div className="ol-root" role="dialog" aria-modal="true" aria-label={def.title}>
      <div className="ol-bar">
        <span className="ol-title">◆ {def.title}</span>
        <span className="ol-tabs" role="tablist">
          {def.tabs.map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              className={`ol-chip${t === tab ? ' ol-chip--on' : ''}`}
              onClick={() => setTab(t)}
            >{t}</button>
          ))}
        </span>
        <span className="ol-spacer" />
        <button type="button" className="ol-esc" onClick={close} title="Back to terminal (Esc)">
          ESC ← TERMINAL
        </button>
      </div>
      <div className="ol-body">
        <PanelErrorBoundary name={`Overlay:${overlay.id}`}>
          <Suspense fallback={<div className="ol-loading">LOADING…</div>}>
            <Body tab={tab} params={overlay.params} setTab={setTab} />
          </Suspense>
        </PanelErrorBoundary>
      </div>
    </div>
  );
}
