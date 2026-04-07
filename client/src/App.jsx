import { useState, useEffect, useCallback, useRef, useMemo, Component } from 'react';
import { apiFetch } from './utils/api';
import { useMarketData } from './hooks/useMarketData';
import { useWebSocket } from './hooks/useWebSocket';
import { useIsMobile } from './hooks/useIsMobile';
import { useBootSequence } from './hooks/useBootSequence';
import { useWebSocketTicks } from './hooks/useWebSocketTicks';
import { useLayoutManager } from './hooks/useLayoutManager';
import { useAuth } from './context/AuthContext';
import { useSettings } from './context/SettingsContext';
import { OpenDetailProvider } from './context/OpenDetailContext';
import { PriceProvider } from './context/PriceContext';
import { FeedStatusProvider } from './context/FeedStatusContext';
import { PortfolioProvider } from './context/PortfolioContext';
import { MarketProvider } from './context/MarketContext';
import { DragProvider } from './context/DragContext';
import { AlertsProvider } from './context/AlertsContext';
import { GameProvider } from './context/GameContext';
import { WatchlistProvider } from './context/WatchlistContext';
import { PanelProvider } from './context/PanelContext';
import NotificationPrefs from './components/common/NotificationPrefs';
import HeaderSearchBar from './components/common/HeaderSearchBar';
import { SearchPanel } from './components/panels/SearchPanel';
import AlertCenterPanel from './components/panels/AlertCenterPanel';
import { NewsPanel } from './components/panels/NewsPanel';
import ETFPanel from './components/panels/ETFPanel';
import ScreenerPanel from './components/panels/ScreenerPanel';
import MacroPanel from './components/panels/MacroPanel';
import LeaderboardPanel from './components/panels/LeaderboardPanel';
import GamePortfolioPanel from './components/panels/GamePortfolioPanel';
import ReferralPanel from './components/common/ReferralPanel';
import ChatPanel from './components/panels/ChatPanel';
import PortfolioMobile from './components/panels/PortfolioMobile';
import HomePanelMobile from './components/panels/HomePanelMobile';
import ChartsPanelMobile from './components/panels/ChartsPanelMobile';
import MobileMoreScreen from './components/panels/MobileMoreScreen';
import ToastContainer from './components/common/ToastContainer';
import WelcomeModal from './components/onboarding/WelcomeModal';
import SectorScreenSelector from './components/common/SectorScreenSelector';
import {
  DefenceScreen, CommoditiesScreen, GlobalMacroScreen, FixedIncomeScreen,
  BrazilScreen, TechAIScreen,
  GlobalRetailScreen, AsianMarketsScreen, EuropeanMarketsScreen, CryptoScreen,
} from './components/screens';
import MarketStatus from './components/common/MarketStatus';
import { TickerTooltip } from './components/common/TickerTooltip';
import InstrumentDetail from './components/common/InstrumentDetail';
import PanelErrorBoundary from './components/common/PanelErrorBoundary';
import {
  MarketTickBridge,
  WorldClock,
  ResizeHandle,
  ColResizeHandle,
  LayoutMoveOverlay,
  makePanelRenderer,
} from './components/app/AppLayoutHelpers';
import {
  SettingsDrawer,
  UserDropdown,
  AlertBadge,
} from './components/app/AppSettings';
import {
  FeedStatusBar,
  DataErrorBanner,
  TrialBanner,
  SubscriptionExpiredScreen,
} from './components/app/AppStatusBanners';
import {
  MOBILE_TABS,
  MobileTabBar,
  MobileClockCompact,
} from './components/app/AppMobile';
import './App.css';
import './components/panels/Chat.css';

// ── Error Boundary — catches runtime crashes and shows diagnostic info ─────
class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[AppErrorBoundary] Caught render crash:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#0a0a0a',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: '#e0e0e0', fontFamily: 'monospace', padding: 24, gap: 16,
        }}>
          <div style={{ color: '#ff6600', fontWeight: 700, fontSize: 13, letterSpacing: '3px' }}>SENGER</div>
          <div style={{ color: '#f44336', fontSize: 14, fontWeight: 600 }}>App crashed — render error</div>
          <div style={{ color: '#ff9900', fontSize: 11, maxWidth: 600, wordBreak: 'break-word', textAlign: 'center' }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          <pre style={{ color: '#888', fontSize: 9, maxWidth: '90vw', maxHeight: '40vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.stack || ''}{'\n'}{this.state.errorInfo?.componentStack || ''}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null, errorInfo: null }); window.location.reload(); }}
            style={{ background: '#ff6600', color: '#fff', border: 'none', padding: '8px 24px', borderRadius: 4, cursor: 'pointer', fontSize: 12, letterSpacing: '1px' }}
          >RELOAD</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const LS_TAB          = 'activeTab_m3';
const LS_CHART_TICKER = 'chartTicker';

export default function App() {
  const { data, loading, isRefreshing, lastUpdated, error: feedError, endpointErrors } = useMarketData();
  const { user, subscription, startCheckout, logout, authReady, openBillingPortal, refreshSubscription, restorePurchases, billingPlatform } = useAuth();
  const { settings, loaded: settingsLoaded, updateLayout } = useSettings();

  // ── Boot sequence ────────────────────────────────────────────────────────
  const { isReady: bootReady } = useBootSequence({ authReady, user, settingsLoaded });

  // ── Billing state ────────────────────────────────────────────────────────────
  const [billingState, setBillingState] = useState({ isLoading: false, error: null, showSuccess: false });

  // ── Live WebSocket overlay (throttled at 250 ms) ─────────────────────────
  const { feedStatus, batchTicks, mergedData, handleWsMessage } = useWebSocketTicks(data);
  useWebSocket(handleWsMessage);

  // ── Billing success handling ──────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success') {
      setBillingState({ isLoading: true, error: null, showSuccess: true });
      // Refresh subscription after a brief delay to let server update
      const timer = setTimeout(() => {
        refreshSubscription().then(() => {
          // Clear success banner after 3 seconds
          setTimeout(() => {
            setBillingState({ isLoading: false, error: null, showSuccess: false });
          }, 3000);
        }).catch((err) => {
          setBillingState({ isLoading: false, error: 'Failed to verify subscription', showSuccess: false });
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [refreshSubscription]);

  const [activeTab, setActiveTab] = useState(() => {
    let saved;
    try { saved = localStorage.getItem(LS_TAB); } catch { saved = null; }
    // Migrate old tab IDs
    if (saved === 'markets') return 'home';
    // charts is now a primary tab (Phase M)
    return MOBILE_TABS.find(t => t.id === saved) ? saved : 'home';
  });
  // Secondary view inside "more" tab (charts, news, etf, chat)
  const [moreView, setMoreView] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const setActiveTabPersist = (t) => { setActiveTab(t); localStorage.setItem(LS_TAB, t); };

  const [chartTicker, setChartTickerState] = useState(
    () => { try { return localStorage.getItem(LS_CHART_TICKER) || 'SPY'; } catch { return 'SPY'; } }
  );

  const syncTimer = useRef(null);

  useEffect(() => {
    let mounted = true;
    apiFetch('/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (!mounted) return;
        let currentTicker;
        try { currentTicker = localStorage.getItem(LS_CHART_TICKER); } catch { currentTicker = null; }
        if (s?.settings?.chartTicker && s.settings.chartTicker !== currentTicker) {
          setChartTickerState(s.settings.chartTicker);
          try { localStorage.setItem(LS_CHART_TICKER, s.settings.chartTicker); } catch {}
        } else if (s?.chartTicker && s.chartTicker !== currentTicker) {
          setChartTickerState(s.chartTicker);
          try { localStorage.setItem(LS_CHART_TICKER, s.chartTicker); } catch {}
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const setChartTicker = useCallback((t) => {
    const sym = typeof t === 'object' ? (t.symbol || t) : t;
    setChartTickerState(sym);
    localStorage.setItem(LS_CHART_TICKER, sym);
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chartTicker: sym }),
      }).catch(() => {});
    }, 800);
  }, []);

  // ── Mobile detection ─────────────────────────────────────────────────────
  const isMobile = useIsMobile();

  // ── Layout manager ───────────────────────────────────────────────────────
  const {
    desktopRows, row0, row1, row2,
    layoutEdit, setLayoutEdit,
    handleLayoutMove,
    rowSizes, startRowResize,
    colSizesPerRow, startResizePerRow,
    chartGridCount, setChartGridCount,
    panelVisible, togglePanel, isPanelVisible,
  } = useLayoutManager();

  const border = '1px solid #1e1e1e';

  // ── Shared panel context value ──────────────────────────────────────────
  const panelCtx = useMemo(() => ({
    mergedData, loading, setChartTicker, chartTicker, setChartGridCount,
  }), [mergedData, loading, setChartTicker, chartTicker, setChartGridCount]);

  // ── Detail ticker state ──────────────────────────────────────────────────
  const [detailTicker, setDetailTicker] = useState(null);
  const [settingsOpen, setSettingsOpen]  = useState(false);

  // ── Sector screen state (Wave 2) ────────────────────────────────────────
  const [activeSectorScreen, setActiveSectorScreen] = useState(null);
  const [sectorSelectorOpen, setSectorSelectorOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  // ── First-visit onboarding hint ─────────────────────────────────────────
  const [showLayoutHint, setShowLayoutHint] = useState(() => {
    try { return !localStorage.getItem('senger_layout_seen'); } catch { return true; }
  });
  const dismissLayoutHint = useCallback(() => {
    setShowLayoutHint(false);
    try { localStorage.setItem('senger_layout_seen', '1'); } catch {}
  }, []);

  // Map selector IDs → screen components
  const SCREEN_MAP = useMemo(() => ({
    'defence':          DefenceScreen,
    'commodities':      CommoditiesScreen,
    'brazil-em':        BrazilScreen,
    'technology':       TechAIScreen,
    'global-macro':     GlobalMacroScreen,
    'fixed-income':     FixedIncomeScreen,
    // Wave 4 — all 10 screens fully built:
    'global-retail':    GlobalRetailScreen,
    'asian-markets':    AsianMarketsScreen,
    'european-markets': EuropeanMarketsScreen,
    'crypto':           CryptoScreen,
  }), []);

  const handleSelectSectorScreen = useCallback((screenId) => {
    setActiveSectorScreen(screenId);
    setSectorSelectorOpen(false);
  }, []);

  const handleGoHome = useCallback(() => {
    setActiveSectorScreen(null);
    setSectorSelectorOpen(false);
  }, []);

  // Global keyboard shortcuts (placed after state/callback declarations it depends on)
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Ctrl/Cmd + K = toggle AI chat
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setChatOpen(prev => !prev);
      }
      // / = focus search (when not in input)
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const searchInput = document.querySelector('.search-panel input, [placeholder*="Search"], [placeholder*="search"]');
        if (searchInput) searchInput.focus();
      }

      // Ctrl/Cmd + 1-9 and 0 = sector screens
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const screens = ['defence', 'commodities', 'brazil-em', 'technology', 'global-macro', 'fixed-income', 'global-retail', 'asian-markets', 'european-markets'];
        const idx = parseInt(e.key) - 1;
        if (idx < screens.length) setActiveSectorScreen(screens[idx]);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setActiveSectorScreen('crypto');
      }

      // Ctrl/Cmd + H = home
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        handleGoHome();
      }

      // Escape = close selector or go home
      if (e.key === 'Escape') {
        if (sectorSelectorOpen) setSectorSelectorOpen(false);
        else if (activeSectorScreen) handleGoHome();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setActiveSectorScreen, handleGoHome, sectorSelectorOpen, activeSectorScreen, setSectorSelectorOpen]);

  const goChart = useCallback((t) => {
    const sym = typeof t === 'object' ? (t.symbol || t) : t;
    setChartTicker(sym);
    setActiveTabPersist('charts');
  }, [setChartTicker]);

  const goDetail = useCallback((t) => {
    const sym = typeof t === 'object' ? (t.symbol || t.ticker || t) : t;
    if (!sym) return;
    setDetailTicker(sym);
  }, []);

  // ── Onboarding check ─────────────────────────────────────────────────────
  // Only show onboarding AFTER settings are fully loaded from the server (not the
  // default settings), and only if the user has not yet completed onboarding.
  // This ensures a logged-in user with onboardingCompleted=true never sees the
  // preset screen again on refresh.
  // Wave 2: Old onboarding removed — WelcomeModal is shown via showWelcome state

  // ── Subscription gating ──────────────────────────────────────────────────
  // Show paywall if subscription has expired
  const subscriptionExpired = subscription && subscription.status === 'expired';

  // ── Checkout handler with loading state ───────────────────────────────────
  const handleCheckout = useCallback(async () => {
    setBillingState({ isLoading: true, error: null, showSuccess: false });
    try {
      await startCheckout();
    } catch (err) {
      setBillingState({ isLoading: false, error: 'Failed to start checkout', showSuccess: false });
      throw err;
    }
  }, [startCheckout]);

  // ── Mobile-specific hooks (must be before any early return) ─────────────
  const handleMoreNavigate = useCallback((view) => {
    setMoreView(view);
  }, []);
  const handleMoreBack = useCallback(() => {
    setMoreView(null);
  }, []);
  const mobileScreenTitle = useMemo(() => {
    if (activeTab === 'more' && moreView) {
      const titles = { news: 'News Feed', etf: 'ETF Screener', screener: 'Fundamental Screener', macro: 'Macro Panel' };
      return titles[moreView] || moreView;
    }
    return null;
  }, [activeTab, moreView]);

  // ── Boot screen ─────────────────────────────────────────────────────────
  if (!bootReady) {
    return (
      <div className="boot-screen">
        <img src="/icon-192.png" alt="Senger" className="boot-logo-img" /><div className="boot-logo">SENGER</div>
        <div className="boot-bar"><div className="boot-bar-fill" /></div>
      </div>
    );
  }

  // ── DESKTOP ──────────────────────────────────────────────────────────────
  if (!isMobile) {
    return (
      <AppErrorBoundary>
      <OpenDetailProvider externalTicker={detailTicker} externalSetTicker={setDetailTicker}>
      <DragProvider>
      <PortfolioProvider>
      <WatchlistProvider>
      <GameProvider>
      <AlertsProvider>
      <FeedStatusProvider status={feedStatus}>
      <MarketProvider restData={mergedData}>
      <PriceProvider marketData={data}>
      <PanelProvider value={panelCtx}>
      <div className="flex-col" style={{
        height: '100vh',
        background: '#0a0a0a',
        fontFamily: 'var(--font-ui)',
        overflowY: 'auto', overflowX: 'hidden',
        color: '#e0e0e0', userSelect: 'none',
      }}>

        {/* Welcome modal (replaces old onboarding) */}
        {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}

        {/* Sector Screen Selector overlay */}
        <SectorScreenSelector
          isOpen={sectorSelectorOpen}
          onClose={() => setSectorSelectorOpen(false)}
          onSelect={handleSelectSectorScreen}
          activeScreen={activeSectorScreen}
        />

        {/* Header */}
        <div className="flex-row app-header-bar">
          <img src="/icon-192.png" alt="Senger" style={{ width: 22, height: 22, borderRadius: 4, marginRight: 6 }} /><span className="app-header-title">SENGER</span>
          <span className="app-header-subtitle">MARKET TERMINAL</span>
          {/* Navigation buttons */}
          <button
            className="btn"
            onClick={handleGoHome}
            title="Home Screen"
            style={{
              marginLeft: 16,
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.5px',
              color: !activeSectorScreen ? 'var(--accent)' : 'var(--text-faint)',
              border: `1px solid ${!activeSectorScreen ? 'var(--accent)' : 'var(--border-strong)'}`,
              background: !activeSectorScreen ? '#1a0800' : 'none',
              borderRadius: 4,
            }}
          >⌂ HOME</button>
          <button
            className="btn"
            onClick={() => setSectorSelectorOpen(s => !s)}
            title="Open Sector Screens"
            style={{
              marginLeft: 6,
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.5px',
              color: sectorSelectorOpen || activeSectorScreen ? 'var(--accent)' : 'var(--text-faint)',
              border: `1px solid ${sectorSelectorOpen || activeSectorScreen ? 'var(--accent)' : 'var(--border-strong)'}`,
              background: sectorSelectorOpen || activeSectorScreen ? '#1a0800' : 'none',
              borderRadius: 4,
            }}
          >◈ SECTOR SCREENS</button>
          <div style={{ flex: 1 }} />
          <WorldClock />
          <MarketStatus />
          <div className="flex-row gap-8">
            <span className="app-refresh-indicator" data-active={isRefreshing || undefined}>
              <span className="app-refresh-dot" />
              {isRefreshing ? 'LIVE' : lastUpdated ? lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : ''}
            </span>
            <AlertBadge />
            {/* Chat icon */}
            <button
              className="btn"
              onClick={() => setChatOpen(prev => !prev)}
              title="AI Chat (Cmd+K)"
              style={{
                color: chatOpen ? 'var(--accent)' : 'var(--text-faint)',
                padding: '2px 6px',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span style={{ fontSize: 9, letterSpacing: '0.5px', opacity: 0.6 }}>AI</span>
            </button>
            <button className={`btn${showLayoutHint && !layoutEdit ? ' layout-btn-pulse' : ''}`}
              onClick={() => { setLayoutEdit(s => !s); if (showLayoutHint) dismissLayoutHint(); }}
              title="Customize your workspace — drag, resize, and rearrange panels"
              style={{ background: layoutEdit ? '#1a0800' : 'none', border:`1px solid ${layoutEdit ? 'var(--accent)' : showLayoutHint ? 'var(--accent)' : 'var(--border-strong)'}`, color: layoutEdit ? 'var(--accent)' : showLayoutHint ? 'var(--accent)' : 'var(--text-faint)' }}
            >⇄ LAYOUT</button>
            {user
              ? <UserDropdown
                  user={user}
                  onSettings={() => setSettingsOpen(s => !s)}
                  onLogout={logout}
                  onBilling={openBillingPortal}
                  isPaid={subscription?.status === 'active'}
                />
              : <button className="btn" onClick={() => setSettingsOpen(s => !s)} style={{ color: settingsOpen ? 'var(--accent)' : 'var(--text-faint)' }}>⚙ SETTINGS</button>
            }
          </div>
        </div>

        {/* Search command strip — full width */}
        <div className="app-search-strip">
          <HeaderSearchBar />
        </div>

        {/* (MarketScreenGallery removed — Wave 2: use Sector Screens button instead) */}

        {/* Trial banner */}
        <TrialBanner
          subscription={subscription}
          onUpgrade={handleCheckout}
          onManageBilling={openBillingPortal}
          billingState={billingState}
        />

        {/* Data feed error banner — shows when Polygon/Yahoo endpoints are failing */}
        <DataErrorBanner error={feedError} endpointErrors={endpointErrors} />

        {/* Subscription expired screen */}
        {subscriptionExpired ? (
          <SubscriptionExpiredScreen
            onUpgrade={handleCheckout}
            onLogout={logout}
            onManageBilling={openBillingPortal}
            onRestore={restorePurchases}
            billingPlatform={billingPlatform}
            checkoutState={billingState}
            subscription={subscription}
          />
        ) : (
          <>
            {/* Settings drawer */}
            {settingsOpen && <SettingsDrawer panelVisible={panelVisible} togglePanel={togglePanel} onClose={() => setSettingsOpen(false)} />}

            <MarketTickBridge batchTicks={batchTicks} />

            {/* Full-page sector screen OR home panel grid */}
            {activeSectorScreen && SCREEN_MAP[activeSectorScreen] ? (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <PanelErrorBoundary name={`Screen:${activeSectorScreen}`}>
                  {(() => {
                    const ScreenComp = SCREEN_MAP[activeSectorScreen];
                    return <ScreenComp />;
                  })()}
                </PanelErrorBoundary>
              </div>
            ) : activeSectorScreen && !SCREEN_MAP[activeSectorScreen] ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 36 }}>🚧</div>
                <div style={{ color: '#888', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                  {activeSectorScreen.replace(/-/g, ' ').toUpperCase()} — Coming in Wave 3/4
                </div>
                <button
                  className="btn"
                  onClick={handleGoHome}
                  style={{ marginTop: 8, padding: '6px 16px', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 4, fontSize: 11, letterSpacing: '0.5px' }}
                >← BACK TO HOME</button>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                {/* Layout edit toolbar */}
                {layoutEdit && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '6px 16px',
                    background: '#1a0800', borderBottom: '1px solid var(--accent)',
                    fontSize: 11, color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.5px',
                    flexShrink: 0,
                  }}>
                    <span>EDITING LAYOUT</span>
                    <span style={{ color: '#666', fontWeight: 400 }}>Use arrows to move panels. Drag borders to resize.</span>
                    <div style={{ flex: 1 }} />
                    <button className="btn" onClick={() => {
                      updateLayout({
                        desktopRows: [
                          ['charts',       'usEquities',    'globalIndices'],
                          ['forex',        'commodities',   'crypto',  'brazilB3'],
                          ['debt',         'news',          'watchlist'],
                        ],
                      });
                      // Reset column sizes
                      try {
                        Object.keys(localStorage).filter(k => k.startsWith('colSizes_') || k.startsWith('rowFlexSizes_')).forEach(k => localStorage.removeItem(k));
                      } catch {}
                      window.location.reload();
                    }} style={{
                      padding: '3px 12px', background: 'none', color: '#888',
                      border: '1px solid #333', borderRadius: 3, fontWeight: 600, fontSize: 10, letterSpacing: '0.5px',
                    }}>RESET DEFAULT</button>
                    <button className="btn" onClick={() => setLayoutEdit(false)} style={{
                      padding: '3px 12px', background: 'var(--accent)', color: '#000',
                      border: 'none', borderRadius: 3, fontWeight: 700, fontSize: 10, letterSpacing: '0.5px',
                    }}>DONE</button>
                  </div>
                )}
                {/* Dynamic rows from settings.layout.desktopRows */}
                {(() => {
                  const panelProps = { mergedData, loading, setChartTicker, chartTicker, setChartGridCount };
                  const minHeights = [260, 220, 200];
                  return [row0, row1, row2].map((row, rowIdx) => {
                    if (!row || row.length === 0) return null;
                    const colSizes = colSizesPerRow[rowIdx];
                    const startResize = startResizePerRow[rowIdx];
                    return (
                      <div key={rowIdx} className="display-contents">
                        {rowIdx > 0 && <ResizeHandle onStart={e => startRowResize(rowIdx - 1, e)} />}
                        <div style={{ flex: rowSizes[rowIdx] || 1, flexShrink: 0, display:'flex', overflow:'hidden', minHeight: minHeights[rowIdx] || 200 }}>
                          {row.map((panelId, colIdx) => {
                            if (!isPanelVisible(panelId)) return null;
                            const isLast = colIdx === row.filter(id => isPanelVisible(id)).length - 1;
                            return (
                              <div key={panelId} style={{ display: 'contents' }}>
                                {colIdx > 0 && <ColResizeHandle onStart={e => startResize(colIdx - 1, e)} />}
                                <div style={{ flex: colSizes[colIdx] || 1, minWidth: 0, borderRight: isLast ? 'none' : border, overflow:'hidden', height:'100%', position: 'relative' }}>
                                  <PanelErrorBoundary name={panelId}>
                                    {makePanelRenderer(panelId, panelProps)}
                                  </PanelErrorBoundary>
                                  {layoutEdit && (
                                    <LayoutMoveOverlay
                                      panelId={panelId} rowIdx={rowIdx} colIdx={colIdx}
                                      rowLen={row.length} totalRows={[row0, row1, row2].filter(r => r.length > 0).length}
                                      onMove={handleLayoutMove}
                                    />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            <FeedStatusBar feedStatus={feedStatus} />
          </>
        )}

        {detailTicker && !subscriptionExpired && <PanelErrorBoundary name="InstrumentDetail"><InstrumentDetail ticker={detailTicker} onClose={() => setDetailTicker(null)} onOpenChat={() => setChatOpen(true)} /></PanelErrorBoundary>}
        <TickerTooltip />
        <ToastContainer />
      </div>
      </PanelProvider>
      </PriceProvider>
      </MarketProvider>
      </FeedStatusProvider>
      </AlertsProvider>
      </GameProvider>
      </WatchlistProvider>
      </PortfolioProvider>
      </DragProvider>
      </OpenDetailProvider>
      </AppErrorBoundary>
    );
  }

  // ── MOBILE ───────────────────────────────────────────────────────────────
  return (
    <AppErrorBoundary>
    <OpenDetailProvider externalTicker={detailTicker} externalSetTicker={setDetailTicker}>
    <DragProvider>
    <PortfolioProvider>
    <WatchlistProvider>
    <GameProvider>
    <AlertsProvider>
    <FeedStatusProvider status={feedStatus}>
    <MarketProvider restData={mergedData}>
    <MarketTickBridge batchTicks={batchTicks} />
    <PriceProvider marketData={data}>
    <PanelProvider value={panelCtx}>
    <div className="m-app-shell">

      {/* Welcome modal (mobile) */}
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}

      {/* Sector Screen Selector overlay (mobile) */}
      <SectorScreenSelector
        isOpen={sectorSelectorOpen}
        onClose={() => setSectorSelectorOpen(false)}
        onSelect={handleSelectSectorScreen}
        activeScreen={activeSectorScreen}
      />

      {/* ── Mobile header ── */}
      <div className="m-header">
        {/* Back button for secondary views or active sector screen */}
        {(activeTab === 'more' && moreView) || activeSectorScreen ? (
          <button className="btn m-header-back"
            onClick={activeSectorScreen ? handleGoHome : handleMoreBack}
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        ) : null}
        {mobileScreenTitle ? (
          <span className="m-header-title">{mobileScreenTitle}</span>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><img src="/icon-192.png" alt="Senger" style={{ width: 22, height: 22, borderRadius: 4 }} /><span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13, letterSpacing: '2.5px' }}>SENGER</span></span>
        )}
        {/* Sector Screens button (mobile) */}
        <button
          className="btn"
          onClick={() => setSectorSelectorOpen(s => !s)}
          title="Sector Screens"
          style={{
            marginLeft: 8,
            padding: '2px 8px',
            fontSize: 10,
            fontWeight: 600,
            color: sectorSelectorOpen || activeSectorScreen ? 'var(--accent)' : 'var(--text-faint)',
            border: `1px solid ${sectorSelectorOpen || activeSectorScreen ? 'var(--accent)' : 'var(--border-strong)'}`,
            background: sectorSelectorOpen || activeSectorScreen ? '#1a0800' : 'none',
            borderRadius: 4,
            whiteSpace: 'nowrap',
            flexShrink: 0,
            maxWidth: 90,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >◈ SCREENS</button>
        {/* Feed status dot */}
        <div className="m-feed-dot" data-status={
          Object.values(feedStatus).every(s => s === 'live') ? 'live'
          : Object.values(feedStatus).some(s => s === 'live') ? 'partial' : 'off'
        } />
        <div className="flex-1" />
        {/* Chat icon */}
        <button className="chat-icon-btn" onClick={() => setChatOpen(true)} aria-label="Open chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        </button>
        {/* Mini clock */}
        <MobileClockCompact />
      </div>

      {/* Settings drawer overlay */}
      {settingsOpen && (
        <div className="app-modal-overlay">
          <div className="app-modal-drawer">
            <SettingsDrawer panelVisible={panelVisible} togglePanel={togglePanel} onClose={() => setSettingsOpen(false)} />
          </div>
        </div>
      )}

      {/* Trial banner (mobile) */}
      <TrialBanner
        subscription={subscription}
        onUpgrade={handleCheckout}
        onManageBilling={openBillingPortal}
        billingState={billingState}
      />

      {/* Data feed error banner */}
      <DataErrorBanner error={feedError} endpointErrors={endpointErrors} />

      {/* Subscription expired screen */}
      {subscriptionExpired ? (
        <SubscriptionExpiredScreen
          onUpgrade={handleCheckout}
          onLogout={logout}
          onManageBilling={openBillingPortal}
          checkoutState={billingState}
          subscription={subscription}
        />
      ) : (
        <>
          {/* ── Tab content area ── */}
          <div className="m-app-content">

            {/* Full-page sector screen on mobile */}
            {activeSectorScreen && SCREEN_MAP[activeSectorScreen] ? (
              <PanelErrorBoundary name={`Screen:${activeSectorScreen}`}>
                {(() => { const S = SCREEN_MAP[activeSectorScreen]; return <S />; })()}
              </PanelErrorBoundary>
            ) : activeSectorScreen && !SCREEN_MAP[activeSectorScreen] ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24 }}>
                <div style={{ fontSize: 36 }}>🚧</div>
                <div style={{ color: '#888', fontSize: 12, fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                  {activeSectorScreen.replace(/-/g, ' ').toUpperCase()} — Coming Soon
                </div>
                <button className="btn" onClick={handleGoHome}
                  style={{ marginTop: 8, padding: '6px 16px', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 4, fontSize: 11 }}
                >← BACK TO HOME</button>
              </div>
            ) : null}

            {!activeSectorScreen && activeTab === 'home' && (
              <PanelErrorBoundary name="Home">
                <HomePanelMobile
                  onSearchClick={() => setActiveTabPersist('search')}
                />
              </PanelErrorBoundary>
            )}

            {!activeSectorScreen && activeTab === 'charts' && (
              <PanelErrorBoundary name="Charts">
                <ChartsPanelMobile />
              </PanelErrorBoundary>
            )}

            {!activeSectorScreen && activeTab === 'search' && (
              <PanelErrorBoundary name="Search">
                <SearchPanel onTickerSelect={goDetail} />
              </PanelErrorBoundary>
            )}

            {!activeSectorScreen && activeTab === 'watchlist' && (
              <PanelErrorBoundary name="Portfolio">
                <PortfolioMobile
                  onManage={() => setActiveTabPersist('search')}
                />
              </PanelErrorBoundary>
            )}

            {!activeSectorScreen && activeTab === 'alerts' && (
              <PanelErrorBoundary name="Alerts">
                <AlertCenterPanel />
              </PanelErrorBoundary>
            )}

            {!activeSectorScreen && activeTab === 'more' && !moreView && (
              <MobileMoreScreen
                onNavigate={handleMoreNavigate}
                user={user}
                onSettings={() => setSettingsOpen(true)}
                onLogout={logout}
                onBilling={openBillingPortal}
                isPaid={subscription?.status === 'active'}
                subscription={subscription}
              />
            )}

            {!activeSectorScreen && activeTab === 'more' && moreView === 'news' && (
              <PanelErrorBoundary name="News">
                <NewsPanel />
              </PanelErrorBoundary>
            )}

            {!activeSectorScreen && activeTab === 'more' && moreView === 'etf' && (
              <PanelErrorBoundary name="ETF">
                <ETFPanel />
              </PanelErrorBoundary>
            )}

            {!activeSectorScreen && activeTab === 'more' && moreView === 'screener' && (
              <PanelErrorBoundary name="Screener">
                <ScreenerPanel />
              </PanelErrorBoundary>
            )}

            {!activeSectorScreen && activeTab === 'more' && moreView === 'macro' && (
              <PanelErrorBoundary name="Macro">
                <MacroPanel />
              </PanelErrorBoundary>
            )}


            {!activeSectorScreen && activeTab === 'more' && moreView === 'notification-prefs' && (
              <NotificationPrefs onClose={() => setMoreView(null)} />
            )}

          </div>

          {/* ── Bottom tab bar ── */}
          <MobileTabBar
            activeTab={activeTab}
            onTabChange={(tabId) => {
              if (tabId === 'more' && activeTab === 'more') {
                setMoreView(null);
              }
              setActiveTabPersist(tabId);
              if (tabId !== 'more') setMoreView(null);
            }}
          />
        </>
      )}


      {/* ── Chat overlay (mobile full-screen / desktop slide-over) ── */}
      {chatOpen && (
        <>
          <div className="chat-overlay-backdrop" onClick={() => setChatOpen(false)} />
          <div className="chat-overlay">
            <div className="chat-overlay-header">
              <button className="chat-overlay-header-btn" onClick={() => setChatOpen(false)} aria-label="Close chat">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <span className="chat-overlay-header-title">Conversations</span>
              <button className="chat-overlay-header-btn" aria-label="New conversation" onClick={() => {}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
            </div>
            <ChatPanel mobile />
          </div>
        </>
      )}
      {/* ── Instrument Detail bottom-sheet overlay ── */}
      {detailTicker && !subscriptionExpired && (
        <div className="m-detail-overlay">
          <div className="m-detail-backdrop" onClick={() => setDetailTicker(null)} />
          <div className="m-detail-sheet">
            {/* Handle bar */}
            <div className="m-detail-handle-row">
              <div className="m-detail-handle" />
            </div>
            {/* Sheet header */}
            <div className="m-detail-header">
              <button
                className="m-detail-close-btn"
                onClick={() => setDetailTicker(null)}
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Back
              </button>
            </div>
            {/* Scrollable content */}
            <div className="m-detail-content">
              <PanelErrorBoundary name="InstrumentDetail"><InstrumentDetail ticker={detailTicker} onClose={() => setDetailTicker(null)} asPage onOpenChat={() => setChatOpen(true)} /></PanelErrorBoundary>
            </div>
          </div>
        </div>
      )}

      <TickerTooltip />
      <ToastContainer />
    </div>
    </PanelProvider>
    </PriceProvider>
    </MarketProvider>
    </FeedStatusProvider>
    </AlertsProvider>
    </GameProvider>
    </WatchlistProvider>
    </PortfolioProvider>
    </DragProvider>
    </OpenDetailProvider>
    </AppErrorBoundary>
  );
}
