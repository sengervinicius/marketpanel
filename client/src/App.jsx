import { useState, useEffect, useCallback, useRef, useMemo, Component } from 'react';
import { apiFetch } from './utils/api';
import { useMarketData } from './hooks/useMarketData';
import { useWebSocket } from './hooks/useWebSocket';
import { useAuth } from './context/AuthContext';
import { useSettings } from './context/SettingsContext';
import { PriceProvider } from './context/PriceContext';
import { FeedStatusProvider } from './context/FeedStatusContext';
import { PortfolioProvider } from './context/PortfolioContext';
import { MarketProvider } from './context/MarketContext';
import { DragProvider } from './context/DragContext';
import { AlertsProvider } from './context/AlertsContext';
import { GameProvider } from './context/GameContext';
import NotificationPrefs from './components/common/NotificationPrefs';
import HeaderSearchBar from './components/common/HeaderSearchBar';
import { DEFAULT_LAYOUT } from './config/panels';
import PortfolioMobile from './components/panels/PortfolioMobile';
import HomePanelMobile from './components/panels/HomePanelMobile';
import ChartsPanelMobile from './components/panels/ChartsPanelMobile';
import MobileMoreScreen from './components/panels/MobileMoreScreen';
import ToastContainer from './components/common/ToastContainer';
import OnboardingPresets from './components/onboarding/OnboardingPresets';
import OnboardingTourOverlay from './components/onboarding/OnboardingTourOverlay';
import WorkspaceSwitcher from './components/common/WorkspaceSwitcher';
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
  useResizableFlex,
  useResizableColumns,
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

// ── Boot state machine ─────────────────────────────────────────────────────
const BOOT = {
  INIT: 'INIT',
  AUTH_PENDING: 'AUTH_PENDING',
  AUTH_DONE: 'AUTH_DONE',
  SETTINGS_PENDING: 'SETTINGS_PENDING',
  READY: 'READY',
};

// ── Safe localStorage wrapper ──────────────────────────────────────────────
const safeGet = (key, fallback = null) => {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : fallback;
  } catch {
    console.warn(`localStorage read failed for key: ${key}`);
    return fallback;
  }
};


const LS_TAB          = 'activeTab_m3';
const LS_CHART_TICKER = 'chartTicker';
const LS_CHART_GRID   = 'chartGrid_v3';

export default function App() {
  const { data, loading, isRefreshing, lastUpdated, error: feedError, endpointErrors } = useMarketData();
  const { user, subscription, startCheckout, logout, authReady, openBillingPortal, refreshSubscription, restorePurchases, billingPlatform } = useAuth();
  const { settings, loaded: settingsLoaded } = useSettings();

  // ── Boot state machine ───────────────────────────────────────────────────
  const [bootState, setBootState] = useState(BOOT.INIT);

  // Boot state transitions
  useEffect(() => {
    let mounted = true;
    if (bootState === BOOT.INIT) {
      setBootState(BOOT.AUTH_PENDING);
    } else if (bootState === BOOT.AUTH_PENDING && authReady) {
      setBootState(BOOT.AUTH_DONE);
    } else if (bootState === BOOT.AUTH_DONE) {
      if (user) {
        setBootState(BOOT.SETTINGS_PENDING);
      } else {
        setBootState(BOOT.READY);
      }
    } else if (bootState === BOOT.SETTINGS_PENDING && settingsLoaded) {
      if (!mounted) return;
      setBootState(BOOT.READY);
    }
    return () => { mounted = false; };
  }, [bootState, authReady, user, settingsLoaded]);

  // Emergency boot timeout — force READY after 5 s if boot sequence stalls
  useEffect(() => {
    const timeout = setTimeout(() => {
      setBootState(prev => prev !== BOOT.READY ? BOOT.READY : prev);
    }, 5000);
    return () => clearTimeout(timeout);
  }, []);

  // ── Billing state ────────────────────────────────────────────────────────────
  const [billingState, setBillingState] = useState({ isLoading: false, error: null, showSuccess: false });

  // ── Live WebSocket overlay (throttled at 250 ms) ─────────────────────────
  const [feedStatus, setFeedStatus] = useState({ stocks: 'connecting', forex: 'connecting', crypto: 'connecting' });
  const liveOverlayRef   = useRef({});
  const tickBufferRef    = useRef([]);
  const throttleTimerRef = useRef(null);
  const [liveTick, setLiveTick] = useState(0);
  const [batchTicks, setBatchTicks] = useState([]);

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'status') {
      setFeedStatus(prev => ({ ...prev, [msg.feed]: msg.level }));
      return;
    }
    if (msg.type === 'feedHealth' && Array.isArray(msg.feeds)) {
      setFeedStatus(prev => {
        const next = { ...prev };
        for (const f of msg.feeds) {
          if (!f.feed) continue;
          next[f.feed] = {
            level: f.level || 'connecting',
            latencyMs: f.latencyMs ?? null,
            lastTickAt: f.lastTickAt ?? null,
            reconnects: f.reconnects ?? 0,
            lastError: f.lastError ?? null,
          };
        }
        return next;
      });
      return;
    }
    if (msg.type === 'snapshot') {
      const snap = msg.data;
      ['stocks', 'forex', 'crypto'].forEach(cat => {
        if (!snap?.[cat]) return;
        Object.entries(snap[cat]).forEach(([sym, info]) => {
          liveOverlayRef.current[sym] = { ...info, _cat: cat };
        });
      });
      setLiveTick(n => n + 1);
      return;
    }
    if (msg.type === 'tick' || msg.type === 'quote') {
      tickBufferRef.current.push(msg);
      if (!throttleTimerRef.current) {
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          const ticks = tickBufferRef.current.splice(0);
          if (ticks.length === 0) return;
          const normalizedTicks = [];
          ticks.forEach(t => {
            if (t.symbol && t.data) {
              liveOverlayRef.current[t.symbol] = { ...liveOverlayRef.current[t.symbol], ...t.data, _cat: t.category };
              normalizedTicks.push({ category: t.category, symbol: t.symbol, data: t.data });
            }
          });
          setLiveTick(n => n + 1);
          if (normalizedTicks.length > 0) setBatchTicks(normalizedTicks);
        }, 250);
      }
    }
  }, []);

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

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      // Ignore if typing in input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Ctrl/Cmd + K = focus search (if search panel exists)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        // Find and focus the search input
        const searchInput = document.querySelector('.search-panel input, [placeholder*="Search"], [placeholder*="search"]');
        if (searchInput) searchInput.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Merge REST snapshot with WS live overlay
  const mergedData = useMemo(() => {
    if (!data) return data;
    const overlay = liveOverlayRef.current;
    if (Object.keys(overlay).length === 0) return data;
    const merged = { ...data };
    ['stocks', 'forex', 'crypto'].forEach(cat => {
      if (!data[cat]) return;
      const updates = {};
      Object.entries(overlay).forEach(([sym, info]) => {
        if (info._cat === cat && data[cat][sym]) {
          updates[sym] = { ...data[cat][sym], ...info };
        }
      });
      if (Object.keys(updates).length > 0) {
        merged[cat] = { ...data[cat], ...updates };
      }
    });
    merged.indices = merged.stocks || {};
    return merged;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, liveTick]);

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

  // Use matchMedia for reliable CSS-aware desktop/mobile detection.
  // window.innerWidth can report stale values before CSS is applied or when
  // DevTools is docked, causing desktop Chrome to incorrectly render mobile.
  // We use BOTH matchMedia AND innerWidth as a cross-check: if either says
  // desktop (≥1024), we trust it — this prevents false mobile detection.
  const detectMobile = useCallback(() => {
    const mqDesktop = typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1024px)').matches
      : false;
    const widthDesktop = window.innerWidth >= 1024;
    // If EITHER method says desktop, treat as desktop
    return !(mqDesktop || widthDesktop);
  }, []);
  const [isMobile, setIsMobile] = useState(detectMobile);
  useEffect(() => {
    // Sync on mount (layout may have changed since useState initializer)
    setIsMobile(detectMobile());
    if (typeof window.matchMedia === 'function') {
      const mql = window.matchMedia('(min-width: 1024px)');
      const handler = () => setIsMobile(detectMobile());
      mql.addEventListener('change', handler);
      window.addEventListener('resize', handler);
      return () => {
        mql.removeEventListener('change', handler);
        window.removeEventListener('resize', handler);
      };
    }
    const handler = () => setIsMobile(detectMobile());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [detectMobile]);

  const [chartGridCount, setChartGridCount] = useState(() => {
    try {
      const arr = safeGet(LS_CHART_GRID, ['SPY','QQQ']);
      return Array.isArray(arr) ? Math.max(2, arr.length) : 2;
    } catch { return 2; }
  });

  // ── Dynamic layout from settings ───────────────────────────────────────────
  const { updateLayout } = useSettings();
  const desktopRows = settings?.layout?.desktopRows || DEFAULT_LAYOUT.desktopRows;
  const row0 = desktopRows[0] || [];
  const row1 = desktopRows[1] || [];
  const row2 = desktopRows[2] || [];

  const [layoutEdit, setLayoutEdit] = useState(false);

  const handleLayoutMove = useCallback((panelId, rowIdx, colIdx, direction) => {
    const newRows = desktopRows.map(r => [...r]);

    if (direction === 'left' && colIdx > 0) {
      [newRows[rowIdx][colIdx], newRows[rowIdx][colIdx - 1]] = [newRows[rowIdx][colIdx - 1], newRows[rowIdx][colIdx]];
    } else if (direction === 'right' && colIdx < newRows[rowIdx].length - 1) {
      [newRows[rowIdx][colIdx], newRows[rowIdx][colIdx + 1]] = [newRows[rowIdx][colIdx + 1], newRows[rowIdx][colIdx]];
    } else if (direction === 'up' && rowIdx > 0) {
      newRows[rowIdx].splice(colIdx, 1);
      newRows[rowIdx - 1].push(panelId);
    } else if (direction === 'down' && rowIdx < newRows.length - 1) {
      newRows[rowIdx].splice(colIdx, 1);
      newRows[rowIdx + 1].unshift(panelId);
    } else if (direction === 'down' && rowIdx === newRows.length - 1 && newRows.length < 4) {
      // Allow adding a 4th row if moving down from the last row
      newRows[rowIdx].splice(colIdx, 1);
      newRows.push([panelId]);
    }

    // Prevent creating empty rows (keep at least 1 panel per non-empty row)
    const nonEmptyRows = newRows.filter(r => r.length > 0);
    // If all rows are empty, restore the original layout
    if (nonEmptyRows.length === 0) {
      return;
    }

    // Pad to 3 rows minimum if we have fewer than 3
    while (nonEmptyRows.length < 3) nonEmptyRows.push([]);

    updateLayout({ desktopRows: nonEmptyRows });
  }, [desktopRows, updateLayout]);

  const [rowSizes, startRowResize] = useResizableFlex('rowFlexSizes_v2', [2, 1.5, 1.5]);
  const [colSizes0, startColResize0] = useResizableColumns('colSizes_r0_' + row0.length, Array(Math.max(1, row0.length)).fill(1));
  const [colSizes1, startColResize1] = useResizableColumns('colSizes_r1_' + row1.length, Array(Math.max(1, row1.length)).fill(1));
  const [colSizes2, startColResize2] = useResizableColumns('colSizes_r2_' + row2.length, Array(Math.max(1, row2.length)).fill(1));
  const colSizesPerRow  = [colSizes0,      colSizes1,      colSizes2];
  const startResizePerRow = [startColResize0, startColResize1, startColResize2];

  const border = '1px solid #1e1e1e';

  const [detailTicker, setDetailTicker] = useState(null);
  const [settingsOpen, setSettingsOpen]  = useState(false);

  const [panelVisible, setPanelVisible] = useState(() => {
    try { return JSON.parse(localStorage.getItem('panelVisible_v1')) || {}; } catch { return {}; }
  });
  const togglePanel = useCallback((id) => {
    setPanelVisible(prev => {
      const next = { ...prev, [id]: !(prev[id] ?? true) };
      localStorage.setItem('panelVisible_v1', JSON.stringify(next));
      return next;
    });
  }, []);
  const isPanelVisible = (id) => panelVisible[id] ?? true;

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
  const showOnboarding = bootState === BOOT.READY && !!user && settings && !settings.onboardingCompleted;
  const showTour = bootState === BOOT.READY && !!user && settings && settings.onboardingCompleted && settings.onboarding && !settings.onboarding.completed;

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
      const titles = { news: 'News Feed', etf: 'ETF Screener', screener: 'Fundamental Screener', macro: 'Macro Panel', leaderboard: 'Leaderboard', game: 'Investing Game', missions: 'Missions & Quests' };
      return titles[moreView] || moreView;
    }
    return null;
  }, [activeTab, moreView]);

  // ── Boot screen ─────────────────────────────────────────────────────────
  if (bootState !== BOOT.READY) {
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
      <DragProvider>
      <PortfolioProvider>
      <GameProvider>
      <AlertsProvider>
      <FeedStatusProvider status={feedStatus}>
      <MarketProvider restData={mergedData}>
      <PriceProvider marketData={data}>
      <div className="flex-col" style={{
        height: '100vh',
        background: '#0a0a0a',
        fontFamily: 'var(--font-ui)',
        overflowY: 'auto', overflowX: 'hidden',
        color: '#e0e0e0', userSelect: 'none',
      }}>

        {/* Onboarding overlay */}
        {showOnboarding && <OnboardingPresets />}

        {/* Onboarding tour */}
        {showTour && <OnboardingTourOverlay />}

        {/* Header */}
        <div className="flex-row app-header-bar">
          <img src="/icon-192.png" alt="Senger" style={{ width: 22, height: 22, borderRadius: 4, marginRight: 6 }} /><span className="app-header-title">SENGER</span>
          <span className="app-header-subtitle">MARKET TERMINAL</span>
          <WorkspaceSwitcher />
          <HeaderSearchBar onOpenDetail={setDetailTicker} />
          <WorldClock />
          <div className="flex-row gap-8">
            {isRefreshing && <span className="app-header-status">&#9679; UPDATING</span>}
            {lastUpdated && !isRefreshing && <span style={{ color:'var(--text-faint)', fontSize:'8px' }}>SNAP {lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>}
            <AlertBadge />
            {/* Chat icon */}
            <button
              className="btn"
              onClick={() => setChatOpen(true)}
              title="Messages"
              style={{
                color: chatOpen ? 'var(--accent)' : 'var(--text-faint)',
                padding: '2px 6px',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <button className="btn"
              onClick={() => setLayoutEdit(s => !s)}
              title="Reorder panels"
              style={{ background: layoutEdit ? '#1a0800' : 'none', border:`1px solid ${layoutEdit ? 'var(--accent)' : 'var(--border-strong)'}`, color: layoutEdit ? 'var(--accent)' : 'var(--text-faint)' }}
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

            {/* Dynamic rows from settings.layout.desktopRows */}
            {(() => {
              const panelProps = { mergedData, loading, setChartTicker, setDetailTicker, chartTicker, setChartGridCount };
              const minHeights = [220, 180, 160];
              return [row0, row1, row2].map((row, rowIdx) => {
                if (!row || row.length === 0) return null;
                const colSizes = colSizesPerRow[rowIdx];
                const startResize = startResizePerRow[rowIdx];
                return (
                  <div key={rowIdx} className="display-contents">
                    {rowIdx > 0 && <ResizeHandle onStart={e => startRowResize(rowIdx - 1, e)} />}
                    <div style={{ flex: rowSizes[rowIdx] || 1, flexShrink: 0, display:'flex', overflow:'hidden', minHeight: minHeights[rowIdx] || 160 }}>
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

            <FeedStatusBar feedStatus={feedStatus} />
          </>
        )}

        {detailTicker && !subscriptionExpired && <PanelErrorBoundary name="InstrumentDetail"><InstrumentDetail ticker={detailTicker} onClose={() => setDetailTicker(null)} onOpenChat={() => setChatOpen(true)} /></PanelErrorBoundary>}
        <TickerTooltip onOpenDetail={setDetailTicker} />
        <ToastContainer />
      </div>
      </PriceProvider>
      </MarketProvider>
      </FeedStatusProvider>
      </AlertsProvider>
      </GameProvider>
      </PortfolioProvider>
      </DragProvider>
      </AppErrorBoundary>
    );
  }

  // ── MOBILE ───────────────────────────────────────────────────────────────
  return (
    <AppErrorBoundary>
    <DragProvider>
    <PortfolioProvider>
    <GameProvider>
    <AlertsProvider>
    <FeedStatusProvider status={feedStatus}>
    <MarketProvider restData={mergedData}>
    <MarketTickBridge batchTicks={batchTicks} />
    <PriceProvider marketData={data}>
    <div className="m-app-shell">

      {/* Onboarding overlay */}
      {showOnboarding && <OnboardingPresets />}

      {/* Onboarding tour (mobile) */}
      {showTour && <OnboardingTourOverlay isMobile />}

      {/* ── Mobile header ── */}
      <div className="m-header">
        {/* Back button for secondary views */}
        {(activeTab === 'more' && moreView) ? (
          <button className="btn m-header-back"
            onClick={handleMoreBack}

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

            {activeTab === 'home' && (
              <PanelErrorBoundary name="Home">
                <HomePanelMobile
                  onOpenDetail={goDetail}
                  onSearchClick={() => setActiveTabPersist('search')}
                />
              </PanelErrorBoundary>
            )}

            {activeTab === 'charts' && (
              <PanelErrorBoundary name="Charts">
                <ChartsPanelMobile onOpenDetail={goDetail} />
              </PanelErrorBoundary>
            )}

            {activeTab === 'search' && (
              <PanelErrorBoundary name="Search">
                <SearchPanel onTickerSelect={goDetail} onOpenDetail={goDetail} />
              </PanelErrorBoundary>
            )}

            {activeTab === 'watchlist' && (
              <PanelErrorBoundary name="Portfolio">
                <PortfolioMobile
                  onOpenDetail={goDetail}
                  onManage={() => setActiveTabPersist('search')}
                />
              </PanelErrorBoundary>
            )}

            {activeTab === 'alerts' && (
              <PanelErrorBoundary name="Alerts">
                <AlertCenterPanel onOpenDetail={goDetail} />
              </PanelErrorBoundary>
            )}

            {activeTab === 'more' && !moreView && (
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

            {activeTab === 'more' && moreView === 'news' && (
              <PanelErrorBoundary name="News">
                <NewsPanel />
              </PanelErrorBoundary>
            )}

            {activeTab === 'more' && moreView === 'etf' && (
              <PanelErrorBoundary name="ETF">
                <ETFPanel onOpenDetail={goDetail} />
              </PanelErrorBoundary>
            )}

            {activeTab === 'more' && moreView === 'screener' && (
              <PanelErrorBoundary name="Screener">
                <ScreenerPanel onOpenDetail={goDetail} />
              </PanelErrorBoundary>
            )}

            {activeTab === 'more' && moreView === 'macro' && (
              <PanelErrorBoundary name="Macro">
                <MacroPanel />
              </PanelErrorBoundary>
            )}

            {activeTab === 'more' && moreView === 'leaderboard' && (
              <PanelErrorBoundary name="Leaderboard">
                <LeaderboardPanel mobile />
              </PanelErrorBoundary>
            )}

            {activeTab === 'more' && moreView === 'game' && (
              <PanelErrorBoundary name="Game">
                <GamePortfolioPanel mobile onSelectSymbol={(sym) => { setDetailTicker(sym); goDetail(); }} />
              </PanelErrorBoundary>
            )}

            {activeTab === 'more' && moreView === 'referrals' && (
              <PanelErrorBoundary name="Referrals">
                <ReferralPanel />
              </PanelErrorBoundary>
            )}

            {activeTab === 'more' && moreView === 'notification-prefs' && (
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

      <TickerTooltip onOpenDetail={goDetail} />
      <ToastContainer />
    </div>
    </PriceProvider>
    </MarketProvider>
    </FeedStatusProvider>
    </AlertsProvider>
    </GameProvider>
    </PortfolioProvider>
    </DragProvider>
    </AppErrorBoundary>
  );
}

