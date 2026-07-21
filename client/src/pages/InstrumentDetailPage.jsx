/**
 * InstrumentDetailPage.jsx
 * Standalone page for popped-out instrument detail.
 * Route: /detail/:symbolKey
 *
 * Opens in a separate browser window via:
 *   window.open(window.location.origin + '/#/detail/AAPL', '_blank', 'width=1100,height=700')
 *
 * #288 / FIX-popout — InstrumentDetail consumes a stack of context
 * providers (Watchlist, Alerts, OpenDetail, Screen, Portfolio) that
 * App.jsx mounts at the root of the SPA. The popout route bypasses
 * App.jsx entirely, so any hook InstrumentDetail uses against those
 * contexts threw "useWatchlist must be used inside WatchlistProvider"
 * the moment the popout window mounted. Every time a feature added a
 * new context to InstrumentDetail without also wrapping the popout,
 * this regression came back. The fix is to mirror the provider stack
 * here so the popout is a drop-in window for the same component.
 */

import { Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { lazyWithRetry } from '../utils/lazyWithRetry';

const InstrumentDetail = lazyWithRetry(() => import('../components/common/InstrumentDetail'));
import { useAuth } from '../context/AuthContext';
import { OpenDetailProvider } from '../context/OpenDetailContext';
import { ScreenProvider } from '../context/ScreenContext';
import { WatchlistProvider } from '../context/WatchlistContext';
import { AlertsProvider } from '../context/AlertsContext';
import { PortfolioProvider } from '../context/PortfolioContext';
import PanelErrorBoundary from '../components/common/PanelErrorBoundary';

export default function InstrumentDetailPage() {
  const { symbolKey } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const decodedSymbol = symbolKey ? decodeURIComponent(symbolKey) : null;

  if (!decodedSymbol) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0a0a0a', color: '#444',
        fontSize: 11,
      }}>
        No symbol specified.
      </div>
    );
  }

  return (
    <div style={{
      // #288 / FIX-popout-scroll (CIO repro) — the popout renders inside
      // #root, which App.css pins to `height:100%; overflow:hidden` for
      // every viewport wider than 768px (the popout is always >768px, so
      // it is treated as desktop). A previous attempt switched this
      // container to `min-height:100vh` hoping the *document* would
      // scroll, but the document CAN'T scroll — #root clips it. Result:
      // tall instruments were cut off with no scrollbar on either axis.
      //
      // Correct model: this container is a fixed-height (100vh) flex
      // column and the body BELOW the header is the real scroll
      // container. That works regardless of #root's overflow:hidden
      // because the scroll happens inside our own element.
      height: '100vh', background: '#0a0a0a',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      fontFamily: 'var(--font-ui)',
    }}>
      {/* Minimal header for the pop-out window */}
      <div style={{
        height: 34, flexShrink: 0, display: 'flex', alignItems: 'center',
        background: '#000', borderBottom: '1px solid #1e1e1e',
        padding: '0 12px', gap: 10,
      }}>
        <span style={{ color: 'var(--color-particle)', fontWeight: 700, fontSize: 11, letterSpacing: '2px' }}>PARTICLE</span>
        <span style={{ color: '#2a2a2a', fontSize: 9, letterSpacing: '1px' }}>INSTRUMENT DETAIL</span>
        <span style={{
          color: 'var(--text-primary, #ddd)', fontFamily: 'var(--font-family-mono)',
          fontWeight: 700, fontSize: 11, letterSpacing: '1px',
        }}>{decodedSymbol}</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: '#2a2a2a', fontSize: 8.5, letterSpacing: '0.5px' }}>SEPARATE WINDOW — CLOSE TO RETURN</span>
        {user && <span style={{ color: '#2a2a2a', fontSize: 8.5 }}>{user.username?.toUpperCase()}</span>}
        <button className="btn"
          onClick={() => window.close()}
          title="Close this window"
          style={{
            background: 'none', border: '1px solid #1e1e1e', color: '#333',
            fontSize: 9, padding: '2px 8px', }}
        >CLOSE</button>
      </div>

      {/* Full InstrumentDetail in page mode (no overlay backdrop).
          #288 / FIX-popout — wrap in the same provider stack App.jsx
          uses, so the hooks inside InstrumentDetail (useWatchlist,
          useAlerts, useOpenDetail, useScreenContext) and any modal it
          opens (PositionEditor → usePortfolio) all resolve. Order
          matches App.jsx: ScreenProvider outermost, then
          OpenDetailProvider, PortfolioProvider, WatchlistProvider,
          AlertsProvider. We don't include MarketProvider / PriceProvider
          / FeedStatusProvider — the popout doesn't run the WebSocket;
          it gets data through TanStack Query REST hits, which is fine. */}
      {/* FIX-popup-fill-window — the popout now FILLS its window like the
          in-app `.id-overlay` instead of scrolling the document. This
          wrapper is a flex-column that takes all the space under the 34px
          header (flex:1 + minHeight:0) and clips its own overflow so the
          child `.id-page` fills it exactly; the chart flex-fills and the
          right rail (`.id-sidebar-content`) scrolls INTERNALLY. No
          document scroll in the wide two-pane mode. Below 900px the
          `@media (max-width:900px)` block in InstrumentDetail.css flips
          `.id-page-body-wrap` to an internal scroll container and lets the
          stacked `.id-page` grow, so narrow windows still stack + scroll.
          The layout (overflow/scroll) lives in CSS — not inline — so the
          media query can override it. */}
      <div className="id-page-body-wrap">
        <ScreenProvider>
          <OpenDetailProvider>
            <PortfolioProvider>
              <WatchlistProvider>
                <AlertsProvider>
                  <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 11 }}>Loading...</div>}>
                    {/* #291 W2.16 HOTFIX — wrap in PanelErrorBoundary so a
                        render crash inside InstrumentDetail (recharts
                        bad-data, etc.) gets contained to a panel-level
                        fallback instead of escaping all the way to the
                        global AppErrorBoundary's "App crashed — render
                        error" screen. App.jsx already wraps InstrumentDetail
                        this way; this mirrors it for the popout route. */}
                    <PanelErrorBoundary name="InstrumentDetail (popout)">
                      <InstrumentDetail
                        ticker={decodedSymbol}
                        onClose={() => window.close()}
                        asPage
                      />
                    </PanelErrorBoundary>
                  </Suspense>
                </AlertsProvider>
              </WatchlistProvider>
            </PortfolioProvider>
          </OpenDetailProvider>
        </ScreenProvider>
      </div>
    </div>
  );
}
