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
      // #288 / FIX-popout-scroll — production audit found that on smaller
      // popout windows the body content was cut off because the outer
      // container forced overflow:hidden + height:100vh. Switch to
      // min-height:100vh so the layout still fills the window when
      // content fits, but allows the document to scroll vertically when
      // it doesn't (the chart, AI fundamentals, news, and footer are
      // tall on small popouts).
      minHeight: '100vh', background: '#0a0a0a',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-ui)',
    }}>
      {/* Minimal header for the pop-out window */}
      <div style={{
        height: 34, flexShrink: 0, display: 'flex', alignItems: 'center',
        background: '#000', borderBottom: '1px solid #1e1e1e',
        padding: '0 12px', gap: 10,
      }}>
        <span style={{ color: 'var(--color-particle, #F97316)', fontWeight: 700, fontSize: 11, letterSpacing: '2px' }}>PARTICLE</span>
        <span style={{ color: '#2a2a2a', fontSize: 9, letterSpacing: '1px' }}>INSTRUMENT DETAIL</span>
        <div style={{ flex: 1 }} />
        {user && <span style={{ color: '#2a2a2a', fontSize: 8 }}>{user.username?.toUpperCase()}</span>}
        <button className="btn"
          onClick={() => window.close()}
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
      {/* #288 / FIX-popout-scroll — let content grow naturally on small
          popout windows; the outer minHeight:100vh on the page allows
          the browser to scroll the whole document. */}
      <div style={{ flex: 1 }}>
        <ScreenProvider>
          <OpenDetailProvider>
            <PortfolioProvider>
              <WatchlistProvider>
                <AlertsProvider>
                  <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 11 }}>Loading...</div>}>
                    <InstrumentDetail
                      ticker={decodedSymbol}
                      onClose={() => window.close()}
                      asPage
                    />
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
