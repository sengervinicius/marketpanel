import { useState, useEffect, useCallback, useRef, useMemo, Component, lazy, Suspense } from 'react';

// Lazy import with auto-retry on chunk load failure (stale deploy cache)
function lazyRetry(importFn) {
  return lazy(() =>
    importFn().catch((err) => {
      // If a dynamic import fails (chunk hash changed after deploy), reload once
      const hasReloaded = sessionStorage.getItem('chunk_reload');
      if (!hasReloaded) {
        sessionStorage.setItem('chunk_reload', '1');
        window.location.reload();
        return new Promise(() => {}); // never resolves — page is reloading
      }
      sessionStorage.removeItem('chunk_reload');
      throw err; // second time — let the error boundary catch it
    })
  );
}

import { apiFetch } from './utils/api';
import { useMarketData } from './hooks/useMarketData';
import { useWebSocket } from './hooks/useWebSocket';
import { useIsMobile } from './hooks/useIsMobile';
import { useBootSequence } from './hooks/useBootSequence';
import { useWebSocketTicks } from './hooks/useWebSocketTicks';
import { useLayoutManager } from './hooks/useLayoutManager';
import { syncSettingToServer } from './hooks/useSettingsSync';
import { useAuth } from './context/AuthContext';
import { useSettings } from './context/SettingsContext';
import { OpenDetailProvider } from './context/OpenDetailContext';
import { PriceProvider } from './context/PriceContext';
import { FeedStatusProvider } from './context/FeedStatusContext';
import { PortfolioProvider } from './context/PortfolioContext';
import { MarketProvider } from './context/MarketContext';
import { DragProvider } from './context/DragContext';
import { AlertsProvider } from './context/AlertsContext';
import { WatchlistProvider } from './context/WatchlistContext';
import { PanelProvider } from './context/PanelContext';
import { ScreenProvider } from './context/ScreenContext';
import NotificationPrefs from './components/common/NotificationPrefs';
import HeaderSearchBar from './components/common/HeaderSearchBar';
import KeyboardShortcutsModal from './components/common/KeyboardShortcutsModal';
import CommandPalette from './components/common/CommandPalette';
import { SearchPanel } from './components/panels/SearchPanel';
const ETFPanel = lazyRetry(() => import('./components/panels/ETFPanel'));
const AlertCenterPanel = lazyRetry(() => import('./components/panels/AlertCenterPanel'));
const NewsPanel = lazyRetry(() => import('./components/panels/NewsPanel'));
const ScreenerPanel = lazyRetry(() => import('./components/panels/ScreenerPanel'));
const MacroPanel = lazyRetry(() => import('./components/panels/MacroPanel'));
const ChatPanel = lazyRetry(() => import('./components/panels/ChatPanel'));
// openChatWindow is a standalone utility, import directly
import { openChatWindow } from './components/panels/ChatPanel';
const PortfolioMobile = lazyRetry(() => import('./components/panels/PortfolioMobile'));
const HomePanelMobile = lazyRetry(() => import('./components/panels/HomePanelMobile'));
const ChartsPanelMobile = lazyRetry(() => import('./components/panels/ChartsPanelMobile'));
const MobileMoreScreen = lazyRetry(() => import('./components/panels/MobileMoreScreen'));
import ToastContainer from './components/common/ToastContainer';
const WelcomeTour = lazyRetry(() => import('./components/onboarding/WelcomeTour'));
const VaultPanel = lazyRetry(() => import('./components/app/VaultPanel'));
import SectorScreenSelector from './components/common/SectorScreenSelector';
import MarketStatus from './components/common/MarketStatus';
import { TickerTooltip } from './components/common/TickerTooltip';
const AdminDashboard = lazyRetry(() => import('./components/admin/AdminDashboard'));
const PredictionPanel = lazyRetry(() => import('./components/panels/PredictionPanel'));

// Lazy-loaded sector screens — split into separate chunks (lazyRetry auto-reloads on stale deploy)
const DefenceScreen = lazyRetry(() => import('./components/screens/DefenceScreen'));
const CommoditiesScreen = lazyRetry(() => import('./components/screens/CommoditiesScreen'));
const GlobalMacroScreen = lazyRetry(() => import('./components/screens/GlobalMacroScreen'));
const FixedIncomeScreen = lazyRetry(() => import('./components/screens/FixedIncomeScreen'));
const BrazilScreen = lazyRetry(() => import('./components/screens/BrazilScreen'));
const TechAIScreen = lazyRetry(() => import('./components/screens/TechAIScreen'));
const GlobalRetailScreen = lazyRetry(() => import('./components/screens/GlobalRetailScreen'));
const AsianMarketsScreen = lazyRetry(() => import('./components/screens/AsianMarketsScreen'));
const EuropeanMarketsScreen = lazyRetry(() => import('./components/screens/EuropeanMarketsScreen'));
const CryptoScreen = lazyRetry(() => import('./components/screens/CryptoScreen'));

const InstrumentDetail = lazyRetry(() => import('./components/common/InstrumentDetail'));
import PanelErrorBoundary from './components/common/PanelErrorBoundary';
import ParticleLogo from './components/ui/ParticleLogo';
import ParticleSidebar from './components/app/ParticleSidebar';
// ParticleSpotlight removed — Cmd+K focuses header search, deep questions go to ParticleScreen
import BriefNotification from './components/app/BriefNotification';
import TickerContextMenu from './components/app/TickerContextMenu';
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
  WelcomeSubscriptionModal,
} from './components/app/AppStatusBanners';
import {
  MOBILE_TABS,
  MobileTabBar,
  MobileClockCompact,
  ParticleModeBar,
  TerminalSubNav,
} from './components/app/AppMobile';
import ParticleScreen from './components/app/ParticleScreen';
import PricingModal from './components/app/PricingModal';
import './App.css';
import './components/panels/Chat.css';
// react-joyride v2+ uses inline styles — no separate CSS import needed

// ── Terms of Service acceptance modal ──────────────────────────────────────
function TermsAcceptanceModal({ onAccept }) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const contentRef = useRef(null);

  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) {
      setScrolledToBottom(true);
    }
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        background: 'var(--bg-secondary, #141414)', borderRadius: 12,
        maxWidth: 520, width: '100%', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        border: '1px solid var(--border-subtle, #222)',
        boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
      }}>
        <div style={{
          padding: '20px 24px 12px', borderBottom: '1px solid var(--border-subtle, #222)',
        }}>
          <div style={{ color: 'var(--accent, #e55a00)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', marginBottom: 4 }}>PARTICLE</div>
          <div style={{ color: 'var(--text-primary, #e0e0e0)', fontSize: 18, fontWeight: 600 }}>Terms of Service</div>
          <div style={{ color: 'var(--text-faint, #666)', fontSize: 12, marginTop: 4 }}>Please review and accept to continue</div>
        </div>
        <div
          ref={contentRef}
          onScroll={handleScroll}
          style={{
            flex: 1, overflow: 'auto', padding: '16px 24px',
            fontSize: 12, lineHeight: 1.7, color: 'var(--text-secondary, #aaa)',
            maxHeight: '50vh',
          }}
        >
          <p style={{ marginBottom: 12 }}>By using Particle Market Terminal, you agree to the following terms:</p>
          <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text-primary, #e0e0e0)' }}>Financial Disclaimer:</strong> All data and information provided through Particle Market Terminal is for informational and educational purposes only. It should not be construed as financial advice, investment recommendations, or an offer to buy or sell securities.</p>
          <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text-primary, #e0e0e0)' }}>No Guarantee of Accuracy:</strong> While we strive for accuracy, market data may be delayed or contain errors. Particle makes no warranty regarding the completeness or reliability of any information displayed.</p>
          <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text-primary, #e0e0e0)' }}>AI-Generated Content:</strong> Some content is generated by artificial intelligence models and may contain inaccuracies. AI-generated insights do not constitute professional financial advice.</p>
          <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text-primary, #e0e0e0)' }}>User Responsibility:</strong> You are solely responsible for your investment decisions. Past performance does not guarantee future results. Always consult a qualified financial advisor before making investment decisions.</p>
          <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text-primary, #e0e0e0)' }}>Subscription & Billing:</strong> Your subscription is governed by the billing terms presented at checkout. Cancellations take effect at the end of the current billing period.</p>
          <p style={{ marginBottom: 12, color: 'var(--text-faint, #666)', fontSize: 11 }}>For the full Terms of Service, visit <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent, #e55a00)' }}>particle.market/terms</a></p>
        </div>
        <div style={{
          padding: '16px 24px 20px', borderTop: '1px solid var(--border-subtle, #222)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <button
            onClick={onAccept}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 8,
              background: 'var(--accent, #e55a00)', color: '#fff',
              fontWeight: 600, fontSize: 14, border: 'none', cursor: 'pointer',
              opacity: 1, transition: 'opacity 150ms',
            }}
          >
            I Accept the Terms of Service
          </button>
          <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-faint, #555)' }}>
            Data provided for informational purposes only. Not financial advice.
          </div>
        </div>
      </div>
    </div>
  );
}

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
          <div style={{ color: '#F97316', fontWeight: 700, fontSize: 13, letterSpacing: '3px' }}>PARTICLE</div>
          <div style={{ color: '#f44336', fontSize: 14, fontWeight: 600 }}>App crashed — render error</div>
          <div style={{ color: '#ff9900', fontSize: 11, maxWidth: 600, wordBreak: 'break-word', textAlign: 'center' }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          <pre style={{ color: '#888', fontSize: 9, maxWidth: '90vw', maxHeight: '40vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.stack || ''}{'\n'}{this.state.errorInfo?.componentStack || ''}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null, errorInfo: null }); window.location.reload(); }}
            style={{ background: 'var(--color-particle, #F97316)', color: '#fff', border: 'none', padding: '8px 24px', borderRadius: 4, cursor: 'pointer', fontSize: 12, letterSpacing: '1px' }}
          >RELOAD</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Lazy-load fallback — matches dark terminal aesthetic ──────────────────────────
function ScreenFallback() {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-panel)', color: 'var(--text-faint)', fontSize: 12,
      fontFamily: 'var(--font-mono)', letterSpacing: '1px',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: 'var(--accent)', fontSize: 11, marginBottom: 8 }}>LOADING</div>
        <div className="boot-bar" style={{ width: 120, height: 2, margin: '0 auto' }}>
          <div className="boot-bar-fill" />
        </div>
      </div>
    </div>
  );
}

// ── InstrumentDetail skeleton (shimmer placeholder) ──────────────────────────
function InstrumentDetailSkeleton() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0, 0, 0, 0.97)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-ui)', color: 'var(--text-primary)',
    }}>
      {/* Header skeleton */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 16px', borderBottom: '1px solid var(--border-default)',
        background: 'var(--bg-panel)',
      }}>
        <div className="skeleton-shimmer" style={{ width: 32, height: 32, borderRadius: '50%' }} />
        <div className="skeleton-shimmer" style={{ width: 80, height: 18, borderRadius: 4 }} />
        <div className="skeleton-shimmer" style={{ width: 120, height: 14, borderRadius: 4 }} />
        <div style={{ flex: 1 }} />
        <div className="skeleton-shimmer" style={{ width: 100, height: 24, borderRadius: 4 }} />
        <div className="skeleton-shimmer" style={{ width: 80, height: 18, borderRadius: 4 }} />
      </div>
      {/* Chart skeleton */}
      <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="skeleton-shimmer" style={{ width: '100%', height: 300, borderRadius: 8 }} />
        {/* Metrics strip skeleton */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[1,2,3,4,5].map(i => (
            <div key={i} className="skeleton-shimmer" style={{ flex: 1, height: 48, borderRadius: 6 }} />
          ))}
        </div>
        {/* Fundamentals skeleton */}
        <div className="skeleton-shimmer" style={{ width: '100%', height: 200, borderRadius: 8 }} />
      </div>
    </div>
  );
}

const LS_TAB          = 'activeTab_m3';
const LS_CHART_TICKER = 'chartTicker';

export default function App() {
  const { data, loading, isRefreshing, lastUpdated, error: feedError, endpointErrors } = useMarketData();
  const { user, token, subscription, startCheckout, logout, authReady, openBillingPortal, refreshSubscription, restorePurchases, billingPlatform } = useAuth();
  const { settings, loaded: settingsLoaded, updateLayout, acceptTerms } = useSettings();

  // ── Boot sequence ────────────────────────────────────────────────────────
  const { isReady: bootReady } = useBootSequence({ authReady, user, settingsLoaded });

  // ── Billing state ────────────────────────────────────────────────────────────
  const [billingState, setBillingState] = useState({ isLoading: false, error: null, showSuccess: false });
  const [showPricingModal, setShowPricingModal] = useState(false);

  // ── Live WebSocket overlay (throttled at 250 ms) ─────────────────────────
  const { feedStatus, batchTicks, mergedData, handleWsMessage } = useWebSocketTicks(data);
  useWebSocket(handleWsMessage, token);

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
    // Use saved tab if valid, otherwise fall back to defaultStartTab from settings
    if (MOBILE_TABS.find(t => t.id === saved)) return saved;
    const startTab = settings?.defaultStartTab;
    if (startTab && ['home','charts','watchlist','search'].includes(startTab)) return startTab;
    return 'home';
  });
  // ── 2-state mobile mode: 'particle' (AI screen) or 'terminal' (classic tabs) ──
  const [mobileMode, setMobileMode] = useState(() => {
    try { return localStorage.getItem('mobileMode') || 'terminal'; } catch { return 'terminal'; }
  });
  const setMobileModePersist = (m) => { setMobileMode(m); try { localStorage.setItem('mobileMode', m); } catch {} syncSettingToServer('mobileMode', m); };

  // Secondary view inside "more" tab (charts, news, etf, chat)
  const [moreView, setMoreView] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  // Wave 13: Desktop Particle sidebar + Spotlight
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('particleSidebarCollapsed') === 'true'; } catch { return false; }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(c => {
      const next = !c;
      try { localStorage.setItem('particleSidebarCollapsed', String(next)); } catch {}
      syncSettingToServer('sidebarCollapsed', next);
      return next;
    });
  }, []);
  // spotlightOpen removed — spotlight replaced by header search focus
  const setActiveTabPersist = (t) => { setActiveTab(t); localStorage.setItem(LS_TAB, t); syncSettingToServer('activeTab', t); };

  const [chartTicker, setChartTickerState] = useState(
    () => { try { return localStorage.getItem(LS_CHART_TICKER) || 'SPY'; } catch { return 'SPY'; } }
  );

  const syncTimer = useRef(null);

  // Sync chartTicker from SettingsContext (no extra /api/settings call needed)
  useEffect(() => {
    const serverTicker = settings?.chartTicker;
    if (!serverTicker) return;
    let currentTicker;
    try { currentTicker = localStorage.getItem(LS_CHART_TICKER); } catch { currentTicker = null; }
    if (serverTicker !== currentTicker) {
      setChartTickerState(serverTicker);
      try { localStorage.setItem(LS_CHART_TICKER, serverTicker); } catch {}
    }
  }, [settings?.chartTicker]);

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
    handleLayoutMove, handlePanelSwap,
    rowSizes, startRowResize,
    colSizesPerRow, startResizePerRow,
    chartGridCount, setChartGridCount,
    panelVisible, togglePanel, isPanelVisible,
  } = useLayoutManager();

  const border = '1px solid var(--border-subtle)';

  // Panel drag & drop swap state
  const [draggedPanelId, setDraggedPanelId] = useState(null);
  const [dropTargetPanelId, setDropTargetPanelId] = useState(null);

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
  // Phase 4: Show onboarding for new users (never completed + not dismissed)
  // showWelcome removed — WelcomeTour component manages its own visibility
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // ── First-visit onboarding hint ─────────────────────────────────────────
  const [showLayoutHint, setShowLayoutHint] = useState(() => {
    // Migrate legacy key
    try { const v = localStorage.getItem('senger_layout_seen'); if (v !== null) { localStorage.setItem('particle_layout_seen', v); localStorage.removeItem('senger_layout_seen'); } } catch {}
    try { return !localStorage.getItem('particle_layout_seen'); } catch { return true; }
  });
  const dismissLayoutHint = useCallback(() => {
    setShowLayoutHint(false);
    try { localStorage.setItem('particle_layout_seen', '1'); } catch {}
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
    // Phase 4: special navigation targets
    if (screenId === 'vault') {
      setMobileModePersist('vault');
      return;
    }
    if (screenId === 'predictions') {
      // Navigate to predictions via More tab sub-view
      setActiveTabPersist('more');
      setMoreView('predictions');
      return;
    }
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
      // Ctrl/Cmd + K = Open command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
        return;
      }

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
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

      // ? = show keyboard shortcuts
      if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setActiveSectorScreen, handleGoHome, sectorSelectorOpen, activeSectorScreen, setSectorSelectorOpen]);

  // Listen for particle-prefill events from HeaderSearchBar / TickerContextMenu
  // Navigates to ParticleScreen and persists query for mount-time pickup
  useEffect(() => {
    const handler = (e) => {
      setMobileModePersist('particle');
      // Store query so ParticleScreen can pick it up on mount (race condition fix:
      // if ParticleScreen isn't mounted yet, the event listener wouldn't exist)
      if (e.detail) {
        try { sessionStorage.setItem('particle-prefill', e.detail); } catch {}
      }
    };
    window.addEventListener('particle-prefill', handler);
    return () => window.removeEventListener('particle-prefill', handler);
  }, []);

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

  // Listen for particle:action events from AI chat action buttons
  // Routes button clicks to appropriate terminal actions
  useEffect(() => {
    const handler = (e) => {
      const { type, ticker } = e.detail || {};
      if (!ticker) return;
      switch (type) {
        case 'detail_open':
          setDetailTicker(ticker);
          break;
        case 'chart_open':
          setChartTicker(ticker);
          setActiveTabPersist('charts');
          break;
        case 'watchlist_add':
          // Dispatch a secondary event that the WatchlistProvider child can pick up,
          // or update via API + localStorage directly (since WatchlistContext persists to both)
          try {
            const LS_KEY = 'particle_watchlist_v1';
            const raw = localStorage.getItem(LS_KEY);
            const list = JSON.parse(raw) || [];
            const upper = ticker.toUpperCase();
            if (!list.some(s => s.toUpperCase() === upper)) {
              const next = [...list, upper];
              localStorage.setItem(LS_KEY, JSON.stringify(next));
              // Also sync to server
              apiFetch('/api/settings', {
                method: 'POST',
                body: JSON.stringify({ watchlist: next }),
              }).catch(() => {});
              // Force WatchlistContext to pick up the change
              window.dispatchEvent(new CustomEvent('particle:watchlist-changed', { detail: { watchlist: next } }));
            }
          } catch { /* non-critical */ }
          break;
        default:
          break;
      }
    };
    window.addEventListener('particle:action', handler);
    return () => window.removeEventListener('particle:action', handler);
  }, [setChartTicker, setActiveTabPersist]);

  // ── Onboarding check ─────────────────────────────────────────────────────
  // Only show onboarding AFTER settings are fully loaded from the server (not the
  // default settings), and only if the user has not yet completed onboarding.
  // This ensures a logged-in user with onboardingCompleted=true never sees the
  // preset screen again on refresh.
  // Wave 2: Old onboarding removed — WelcomeModal is shown via showWelcome state

  // ── Terms of Service acceptance ──────────────────────────────────────────
  // Only show terms if settings are loaded FROM THE SERVER (not defaults) and
  // the user explicitly has termsAccepted === false. This prevents a flash of
  // the terms modal on page refresh while settings are still loading.
  const showTermsModal = settingsLoaded && user && settings?.termsAccepted === false
    && !localStorage.getItem('particle_terms_accepted');

  // Wrapped handlers that also set localStorage for instant re-render protection on refresh
  const handleAcceptTerms = useCallback(() => {
    localStorage.setItem('particle_terms_accepted', '1');
    acceptTerms();
  }, [acceptTerms]);

  // ── Subscription gating ──────────────────────────────────────────────────
  // Show paywall if subscription has expired
  const subscriptionExpired = subscription && subscription.status === 'expired';

  // ── Checkout handler — opens pricing modal for tier selection ─────────────
  const handleCheckout = useCallback(() => {
    setShowPricingModal(true);
  }, []);

  // ── Tier-specific checkout — called by PricingModal ─────────────────────
  const handleTierCheckout = useCallback(async (tier, plan) => {
    setBillingState({ isLoading: true, error: null, showSuccess: false });
    try {
      await startCheckout(tier, plan);
    } catch (err) {
      const msg = err?.message || 'Failed to start checkout';
      setBillingState({ isLoading: false, error: msg, showSuccess: false });
      throw err; // Let PricingModal display the error too
    }
  }, [startCheckout]);

  // ── Mobile-specific hooks (must be before any early return) ─────────────
  const handleMoreNavigate = useCallback((view) => {
    // Phase 4: Vault navigates to vault mode instead of a sub-view
    if (view === 'vault') {
      setMobileModePersist('vault');
      return;
    }
    setMoreView(view);
  }, []);
  const handleMoreBack = useCallback(() => {
    setMoreView(null);
  }, []);
  const mobileScreenTitle = useMemo(() => {
    if (activeTab === 'more' && moreView) {
      const titles = { news: 'News Feed', etf: 'ETF Screener', screener: 'Fundamental Screener', macro: 'Macro Panel', sectors: 'Sector Screens', predictions: 'Prediction Markets' };
      return titles[moreView] || moreView;
    }
    return null;
  }, [activeTab, moreView]);

  // ── Boot screen ─────────────────────────────────────────────────────────
  if (!bootReady) {
    return (
      <div className="boot-screen">
        <ParticleLogo size={64} glow className="boot-logo-img" /><div className="boot-logo">PARTICLE</div>
        <div className="boot-bar"><div className="boot-bar-fill" /></div>
      </div>
    );
  }

  // ── DESKTOP ──────────────────────────────────────────────────────────────
  if (!isMobile) {
    return (
      <AppErrorBoundary>
      <ScreenProvider>
      <OpenDetailProvider externalTicker={detailTicker} externalSetTicker={setDetailTicker}>
      <DragProvider>
      <PortfolioProvider>
      <WatchlistProvider>
      <AlertsProvider>
      <FeedStatusProvider status={feedStatus}>
      <MarketProvider restData={mergedData}>
      <PriceProvider marketData={data}>
      <PanelProvider value={panelCtx}>
      <div className="flex-col" style={{
        height: '100vh',
        background: 'var(--bg-app)',
        fontFamily: 'var(--font-ui)',
        overflowY: 'auto', overflowX: 'hidden',
        color: 'var(--text-primary)', userSelect: 'none',
      }}>

        {/* Terms of Service acceptance (first login) */}
        {showTermsModal && <TermsAcceptanceModal onAccept={handleAcceptTerms} />}

        {/* Unified welcome tour (first login only — handles desktop + mobile via portal) */}
        <WelcomeTour />

        {/* Welcome subscription modal removed — was showing on every login */}

        {/* Tier pricing modal */}
        <PricingModal
          visible={showPricingModal}
          onDismiss={() => setShowPricingModal(false)}
          onSelectTier={handleTierCheckout}
          currentTier={subscription?.tier || (subscription?.status === 'active' ? 'new_particle' : 'trial')}
        />

        {/* Keyboard shortcuts modal */}
        {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}

        {/* Command Palette (Cmd+K) */}
        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          onCommand={(cmd) => {
            setCommandPaletteOpen(false);
            if (cmd.action === 'navigate') {
              if (cmd.target === 'home') handleGoHome();
              else if (cmd.target === 'admin') setMobileModePersist('admin');
              else setActiveSectorScreen(cmd.target);
            } else if (cmd.action === 'chat') {
              if (isMobile) setChatOpen(true);
              else { const el = document.querySelector('[data-tour="header"] input, .search-panel input'); if (el) el.focus(); }
            } else if (cmd.action === 'ai-action') {
              if (cmd.target === 'morning-brief') setMobileModePersist('particle');
              else if (cmd.target === 'deep-analysis') setMobileModePersist('particle');
            } else if (cmd.action === 'action') {
              if (cmd.target === 'toggle-theme') document.body.classList.toggle('light-theme');
              else if (cmd.target === 'clear-chat') window.dispatchEvent(new CustomEvent('particle-clear-chat'));
            }
          }}
        />

        {/* Sector Screen Selector overlay */}
        <SectorScreenSelector
          isOpen={sectorSelectorOpen}
          onClose={() => setSectorSelectorOpen(false)}
          onSelect={handleSelectSectorScreen}
          activeScreen={activeSectorScreen}
        />

        {/* Header */}
        <div className="flex-row app-header-bar" data-tour="header">
          <ParticleLogo size={22} style={{ marginRight: 6 }} /><span className="app-header-title">PARTICLE</span>

          {/* ── Desktop mode toggle: Particle / Terminal / Vault / Admin ── */}
          <div className="desktop-mode-toggle" style={{ display: 'inline-flex', marginLeft: 12, gap: 2, background: 'var(--bg-panel, #111)', borderRadius: 6, padding: 2, border: '1px solid var(--border-default, rgba(255,255,255,0.07))' }}>
            <button
              className="btn desktop-mode-btn"
              onClick={() => { setMobileModePersist('particle'); }}
              style={{
                padding: '3px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                borderRadius: 4, border: 'none', cursor: 'pointer',
                color: mobileMode === 'particle' ? 'var(--bg-app, #000)' : 'var(--text-faint)',
                background: mobileMode === 'particle' ? 'var(--accent, #F97316)' : 'transparent',
                transition: 'all 150ms ease',
              }}
            >PARTICLE</button>
            <button
              className="btn desktop-mode-btn"
              onClick={() => { setMobileModePersist('terminal'); }}
              style={{
                padding: '3px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                borderRadius: 4, border: 'none', cursor: 'pointer',
                color: mobileMode === 'terminal' ? 'var(--text-primary, #fff)' : 'var(--text-faint)',
                background: mobileMode === 'terminal' ? 'var(--bg-surface, #1a1a1a)' : 'transparent',
                transition: 'all 150ms ease',
              }}
            >TERMINAL</button>
            <button
              className="btn desktop-mode-btn"
              onClick={() => { setMobileModePersist('vault'); }}
              style={{
                padding: '3px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                borderRadius: 4, border: 'none', cursor: 'pointer',
                color: mobileMode === 'vault' ? '#000' : 'var(--text-faint)',
                background: mobileMode === 'vault' ? 'var(--color-vault-accent)' : 'transparent',
                transition: 'all 150ms ease',
              }}
            >VAULT</button>
            <button
              className="btn desktop-mode-btn"
              onClick={() => { setMobileModePersist('admin'); }}
              style={{
                padding: '3px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                borderRadius: 4, border: 'none', cursor: 'pointer',
                color: mobileMode === 'admin' ? '#000' : 'var(--text-faint)',
                background: mobileMode === 'admin' ? '#00ff88' : 'transparent',
                transition: 'all 150ms ease',
              }}
              title="Admin Dashboard (Cmd+Shift+A)"
            >ADMIN</button>
          </div>

          {/* Navigation buttons (terminal mode only) */}
          {mobileMode === 'terminal' && (<>
          <button
            className="btn"
            onClick={handleGoHome}
            title="Home Screen"
            aria-label="Go to home screen"
            style={{
              marginLeft: 16,
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.5px',
              color: !activeSectorScreen ? 'var(--accent)' : 'var(--text-faint)',
              border: `1px solid ${!activeSectorScreen ? 'var(--accent)' : 'var(--border-strong)'}`,
              background: !activeSectorScreen ? 'rgba(255, 102, 0, 0.08)' : 'none',
              borderRadius: 4,
            }}
          >HOME</button>
          <button
            className="btn"
            data-tour="sector-screens"
            onClick={() => setSectorSelectorOpen(s => !s)}
            title="Open Sector Screens"
            aria-label="Open sector screens"
            aria-expanded={sectorSelectorOpen}
            style={{
              marginLeft: 6,
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.5px',
              color: sectorSelectorOpen || activeSectorScreen ? 'var(--accent)' : 'var(--text-faint)',
              border: `1px solid ${sectorSelectorOpen || activeSectorScreen ? 'var(--accent)' : 'var(--border-strong)'}`,
              background: sectorSelectorOpen || activeSectorScreen ? 'rgba(255, 102, 0, 0.08)' : 'none',
              borderRadius: 4,
            }}
          >SECTOR SCREENS</button>
          </>)}
          <div style={{ flex: 1 }} />
          <WorldClock />
          <MarketStatus />
          <div className="flex-row gap-8">
            <span className="app-refresh-indicator" data-active={isRefreshing || undefined}>
              <span className="app-refresh-dot" />
              {isRefreshing ? 'LIVE' : lastUpdated ? lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : ''}
            </span>
            <AlertBadge />
            {/* Chat icon — opens in a new window */}
            <button
              className="btn"
              onClick={() => openChatWindow()}
              title="Direct Messages (Cmd+Shift+M)"
              aria-label="Open conversations"
              style={{
                color: 'var(--text-faint)',
                padding: '2px 6px',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span style={{ fontSize: 9, letterSpacing: '0.5px', opacity: 0.6 }}>DM</span>
            </button>
            <button data-tour="layout" className={`btn${showLayoutHint && !layoutEdit ? ' layout-btn-pulse' : ''}`}
              onClick={() => { setLayoutEdit(s => !s); if (showLayoutHint) dismissLayoutHint(); }}
              title="Customize your workspace — drag, resize, and rearrange panels"
              aria-label="Customize workspace layout"
              aria-pressed={layoutEdit}
              style={{ background: layoutEdit ? 'rgba(255, 102, 0, 0.08)' : 'none', border:`1px solid ${layoutEdit ? 'var(--accent)' : showLayoutHint ? 'var(--accent)' : 'var(--border-strong)'}`, color: layoutEdit ? 'var(--accent)' : showLayoutHint ? 'var(--accent)' : 'var(--text-faint)' }}
            >LAYOUT</button>
            {user
              ? <UserDropdown
                  user={user}
                  onSettings={() => setSettingsOpen(s => !s)}
                  onLogout={logout}
                  onBilling={openBillingPortal}
                  isPaid={subscription?.status === 'active'}
                />
              : <button className="btn" onClick={() => setSettingsOpen(s => !s)} style={{ color: settingsOpen ? 'var(--accent)' : 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> SETTINGS</button>
            }
          </div>
        </div>

        {/* Morning Brief notification — renders as toast regardless of active screen */}
        <BriefNotification />

        {/* Right-click contextual AI for tickers — navigates to ParticleScreen */}
        <TickerContextMenu onAskParticle={(tickerOrQuery) => {
          const q = tickerOrQuery.startsWith('What') || tickerOrQuery.length > 10
            ? tickerOrQuery
            : `Tell me about $${tickerOrQuery} — latest price action, news, and outlook.`;
          // Navigate to ParticleScreen and pre-fill the query
          setMobileModePersist('particle');
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('particle-prefill', { detail: q }));
          }, 100);
        }} />

        {/* ── Desktop Particle Mode ── */}
        {mobileMode === 'particle' && !subscriptionExpired && (
          <div className="desktop-particle-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <ParticleScreen />
          </div>
        )}

        {/* ── Desktop Vault Mode ── */}
        {mobileMode === 'vault' && !subscriptionExpired && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>Loading Vault...</div>}>
              <VaultPanel fullScreen />
            </Suspense>
          </div>
        )}

        {/* ── Desktop Terminal Mode ── */}
        {mobileMode === 'terminal' && (<>
        {/* Search command strip — full width */}
        <div className="app-search-strip" data-tour="search">
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

            {/* Wave 13: Flex row wrapping main content + Particle sidebar */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

            {/* Sector screen — ALWAYS mounted when active, hidden when not */}
            {activeSectorScreen && (
              <div className="screen-transition-enter" style={{ flex: 1, overflow: 'auto', display: SCREEN_MAP[activeSectorScreen] ? 'block' : 'flex', alignItems: SCREEN_MAP[activeSectorScreen] ? undefined : 'center', justifyContent: SCREEN_MAP[activeSectorScreen] ? undefined : 'center', flexDirection: SCREEN_MAP[activeSectorScreen] ? undefined : 'column', gap: SCREEN_MAP[activeSectorScreen] ? undefined : 12 }}>
                {SCREEN_MAP[activeSectorScreen] ? (
                  <Suspense fallback={<ScreenFallback />}>
                    <PanelErrorBoundary name={`Screen:${activeSectorScreen}`}>
                      {(() => {
                        const ScreenComp = SCREEN_MAP[activeSectorScreen];
                        return <ScreenComp />;
                      })()}
                    </PanelErrorBoundary>
                  </Suspense>
                ) : (
                  <>
                    <div style={{ fontSize: 36, color: 'var(--text-faint)' }}><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7"/><path d="M7 14v7"/><path d="M17 3v3"/><path d="M7 3v3"/><path d="M10 14 2.3 6.3"/><path d="m14 6 7.7 7.7"/><path d="M8 6h8"/></svg></div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                      {activeSectorScreen.replace(/-/g, ' ').toUpperCase()} — Coming in Wave 3/4
                    </div>
                    <button
                      className="btn"
                      onClick={handleGoHome}
                      style={{ marginTop: 8, padding: '6px 16px', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 4, fontSize: 11, letterSpacing: '0.5px' }}
                    >{'<'} BACK TO HOME</button>
                  </>
                )}
              </div>
            )}

            {/* Home grid — ALWAYS mounted, hidden via display:none when sector screen is active */}
            <div data-tour="workspace" style={{ flex: 1, display: activeSectorScreen ? 'none' : 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              {/* Layout edit toolbar */}
              {layoutEdit && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '6px 16px',
                  background: 'rgba(255, 102, 0, 0.08)', borderBottom: '1px solid var(--accent)',
                  fontSize: 11, color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.5px',
                  flexShrink: 0,
                }}>
                  <span>EDITING LAYOUT</span>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Use arrows to move panels. Drag borders to resize.</span>
                  <div style={{ flex: 1 }} />
                  <button className="btn" onClick={() => {
                    updateLayout({
                      desktopRows: [
                        ['charts',       'usEquities',    'globalIndices'],
                        ['forex',        'commodities',   'crypto',  'brazilB3'],
                        ['debt',         'news',          'optionsFlow',  'watchlist'],
                      ],
                    });
                    // Reset column sizes
                    try {
                      Object.keys(localStorage).filter(k => k.startsWith('colSizes_') || k.startsWith('rowFlexSizes_')).forEach(k => localStorage.removeItem(k));
                    } catch {}
                    window.location.reload();
                  }} style={{
                    padding: '3px 12px', background: 'none', color: 'var(--text-secondary)',
                    border: '1px solid var(--border-default)', borderRadius: 3, fontWeight: 600, fontSize: 10, letterSpacing: '0.5px',
                  }}>RESET DEFAULT</button>
                  <button className="btn" onClick={() => setLayoutEdit(false)} style={{
                    padding: '3px 12px', background: 'var(--accent)', color: 'var(--bg-app)',
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
                          // Charts panel itself is not draggable, but neighbors in row 0 are
                          const canDragPanel = panelId !== 'charts';
                          const isDropTarget = dropTargetPanelId === panelId && draggedPanelId !== panelId;
                          return (
                            <div
                              key={panelId}
                              draggable={canDragPanel}
                              onDragStart={canDragPanel ? (e) => {
                                // Only start panel drag if not dragging a ticker
                                if (e.dataTransfer.types.includes('application/x-ticker')) return;
                                e.dataTransfer.setData('application/x-panel-id', panelId);
                                e.dataTransfer.effectAllowed = 'move';
                                setDraggedPanelId(panelId);
                              } : undefined}
                              onDragOver={canDragPanel ? (e) => {
                                // Accept panel drops (not ticker drops)
                                if (!e.dataTransfer.types.includes('application/x-panel-id')) return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                if (dropTargetPanelId !== panelId) setDropTargetPanelId(panelId);
                              } : undefined}
                              onDragLeave={canDragPanel ? () => {
                                if (dropTargetPanelId === panelId) setDropTargetPanelId(null);
                              } : undefined}
                              onDrop={canDragPanel ? (e) => {
                                const sourcePanelId = e.dataTransfer.getData('application/x-panel-id');
                                if (sourcePanelId && sourcePanelId !== panelId) {
                                  e.preventDefault();
                                  handlePanelSwap(sourcePanelId, panelId);
                                }
                                setDraggedPanelId(null);
                                setDropTargetPanelId(null);
                              } : undefined}
                              onDragEnd={() => { setDraggedPanelId(null); setDropTargetPanelId(null); }}
                              style={{
                                flex: colSizes[colIdx] || 1,
                                minWidth: 0,
                                borderRight: isLast ? 'none' : border,
                                overflow: 'hidden',
                                height: '100%',
                                position: 'relative',
                                display: 'flex',
                                flexDirection: 'column',
                                opacity: draggedPanelId === panelId ? 0.4 : 1,
                                outline: isDropTarget ? '2px solid var(--accent)' : 'none',
                                outlineOffset: '-2px',
                                transition: 'opacity 0.15s, outline 0.15s',
                                cursor: canDragPanel ? 'grab' : undefined,
                              }}
                            >
                              {colIdx > 0 && <ColResizeHandle onStart={e => startResize(colIdx - 1, e)} />}
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
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <FeedStatusBar feedStatus={feedStatus} />
            </div>{/* end inner content column */}

            {/* Wave 13A: Particle sidebar */}
            <ParticleSidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
            </div>{/* end flex row (content + sidebar) */}
          </>
        )}
        </>)}

        {detailTicker && !subscriptionExpired && <Suspense fallback={<InstrumentDetailSkeleton />}><PanelErrorBoundary name="InstrumentDetail"><InstrumentDetail ticker={detailTicker} onClose={() => setDetailTicker(null)} onOpenChat={() => setChatOpen(true)} /></PanelErrorBoundary></Suspense>}

        <TickerTooltip />
        <ToastContainer />
      </div>
      </PanelProvider>
      </PriceProvider>
      </MarketProvider>
      </FeedStatusProvider>
      </AlertsProvider>
      </WatchlistProvider>
      </PortfolioProvider>
      </DragProvider>
      </OpenDetailProvider>
      </ScreenProvider>
      </AppErrorBoundary>
    );
  }

  // ── MOBILE ───────────────────────────────────────────────────────────────
  return (
    <AppErrorBoundary>
    <ScreenProvider>
    <OpenDetailProvider externalTicker={detailTicker} externalSetTicker={setDetailTicker}>
    <DragProvider>
    <PortfolioProvider>
    <WatchlistProvider>
    <AlertsProvider>
    <FeedStatusProvider status={feedStatus}>
    <MarketProvider restData={mergedData}>
    <MarketTickBridge batchTicks={batchTicks} />
    <PriceProvider marketData={data}>
    <PanelProvider value={panelCtx}>
    <div className="m-app-shell">

      {/* Terms of Service acceptance (first login, mobile) */}
      {showTermsModal && <TermsAcceptanceModal onAccept={handleAcceptTerms} />}

      {/* Welcome tour rendered via portal from desktop branch — no duplicate needed */}

      {/* Particle first-launch arrival sequence (mobile) */}
      {/* Tier pricing modal (mobile) */}
      <PricingModal
        visible={showPricingModal}
        onDismiss={() => setShowPricingModal(false)}
        onSelectTier={handleTierCheckout}
        currentTier={subscription?.tier || (subscription?.status === 'active' ? 'new_particle' : 'trial')}
      />

      {/* Keyboard shortcuts modal (mobile) */}
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {/* Command Palette (mobile) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onCommand={(cmd) => {
          setCommandPaletteOpen(false);
          if (cmd.action === 'navigate') {
            if (cmd.target === 'home') handleGoHome();
            else setActiveSectorScreen(cmd.target);
          } else if (cmd.action === 'chat') {
            setChatOpen(true);
          }
        }}
      />

      {/* Sector Screen Selector overlay (mobile) */}
      <SectorScreenSelector
        isOpen={sectorSelectorOpen}
        onClose={() => setSectorSelectorOpen(false)}
        onSelect={handleSelectSectorScreen}
        activeScreen={activeSectorScreen}
      />

      {/* ── Mobile header ── */}
      <div className="m-header" style={mobileMode === 'particle' ? { borderBottom: 'none' } : undefined}>
        {/* Back button for secondary views or active sector screen (terminal only) */}
        {mobileMode === 'terminal' && ((activeTab === 'more' && moreView) || activeSectorScreen) ? (
          <button className="btn m-header-back"
            onClick={activeSectorScreen ? handleGoHome : handleMoreBack}
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        ) : null}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ParticleLogo size={22} /><span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13, letterSpacing: '2.5px' }}>PARTICLE</span></span>
        {/* Sector Screens pill (terminal mode only) */}
        {mobileMode === 'terminal' && (
        <button
          className="btn"
          onClick={() => setSectorSelectorOpen(s => !s)}
          title="Sector Screens"
          aria-label="Open sector screens"
          aria-expanded={sectorSelectorOpen}
          style={{
            marginLeft: 8,
            padding: '3px 10px',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: sectorSelectorOpen || activeSectorScreen ? '#000' : 'var(--text-muted)',
            border: 'none',
            background: sectorSelectorOpen || activeSectorScreen ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
            borderRadius: 9999,
            whiteSpace: 'nowrap',
            flexShrink: 0,
            transition: 'all 0.15s ease',
          }}
        >SCREENS</button>
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
            <SettingsDrawer mobile panelVisible={panelVisible} togglePanel={togglePanel} onClose={() => setSettingsOpen(false)} />
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
          {/* ── Terminal sub-nav (compact pills) — shown only in terminal mode ── */}
          {mobileMode === 'terminal' && !activeSectorScreen && (
            <TerminalSubNav
              activeTab={activeTab}
              onTabChange={(tabId) => {
                if (tabId === 'more' && activeTab === 'more') {
                  setMoreView(null);
                }
                setActiveTabPersist(tabId);
                if (tabId !== 'more') setMoreView(null);
              }}
            />
          )}

          {/* ── Tab content area ── */}
          <div className="m-app-content">

            {/* ── Particle AI screen (shown when mobileMode === 'particle') ── */}
            <div style={{ flex: 1, display: mobileMode !== 'particle' ? 'none' : 'flex' }}>
              <ParticleScreen />
            </div>

            {/* ── Vault screen (shown when mobileMode === 'vault') ── */}
            <div style={{ flex: 1, display: mobileMode !== 'vault' ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>Loading Vault...</div>}>
                <VaultPanel fullScreen />
              </Suspense>
            </div>

            {/* ── Admin Dashboard (shown when mobileMode === 'admin') ── */}
            <div style={{ flex: 1, display: mobileMode !== 'admin' ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>Loading admin dashboard...</div>}>
                <PanelErrorBoundary name="AdminDashboard">
                  <AdminDashboard />
                </PanelErrorBoundary>
              </Suspense>
            </div>

            {/* Full-page sector screen on mobile — ALWAYS mounted when active, hidden when not */}
            {activeSectorScreen && mobileMode === 'terminal' && (
              <div style={{ flex: 1, overflow: 'auto', display: SCREEN_MAP[activeSectorScreen] ? 'block' : 'flex', alignItems: SCREEN_MAP[activeSectorScreen] ? undefined : 'center', justifyContent: SCREEN_MAP[activeSectorScreen] ? undefined : 'center', flexDirection: SCREEN_MAP[activeSectorScreen] ? undefined : 'column', gap: SCREEN_MAP[activeSectorScreen] ? undefined : 12, padding: SCREEN_MAP[activeSectorScreen] ? undefined : 24 }}>
                {SCREEN_MAP[activeSectorScreen] ? (
                  <Suspense fallback={<ScreenFallback />}>
                    <PanelErrorBoundary name={`Screen:${activeSectorScreen}`}>
                      {(() => { const S = SCREEN_MAP[activeSectorScreen]; return <S />; })()}
                    </PanelErrorBoundary>
                  </Suspense>
                ) : (
                  <>
                    <div style={{ fontSize: 36, color: 'var(--text-faint)' }}><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7"/><path d="M7 14v7"/><path d="M17 3v3"/><path d="M7 3v3"/><path d="M10 14 2.3 6.3"/><path d="m14 6 7.7 7.7"/><path d="M8 6h8"/></svg></div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                      {activeSectorScreen.replace(/-/g, ' ').toUpperCase()} — Coming Soon
                    </div>
                    <button className="btn" onClick={handleGoHome}
                      style={{ marginTop: 8, padding: '6px 16px', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 4, fontSize: 11 }}
                    >{'<'} BACK TO HOME</button>
                  </>
                )}
              </div>
            )}

            {/* Mobile tabs — ALWAYS mounted, hidden via display:none when not active, sector screen showing, or in particle mode */}
            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'home' ? 'none' : 'flex' }}>
              <PanelErrorBoundary name="Home">
                <HomePanelMobile
                  onSearchClick={() => setActiveTabPersist('search')}
                  onSectorScreen={handleSelectSectorScreen}
                />
              </PanelErrorBoundary>
            </div>

            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'charts' ? 'none' : 'flex' }}>
              <PanelErrorBoundary name="Charts">
                <ChartsPanelMobile />
              </PanelErrorBoundary>
            </div>

            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'search' ? 'none' : 'flex' }}>
              <PanelErrorBoundary name="Search">
                <SearchPanel onTickerSelect={goDetail} />
              </PanelErrorBoundary>
            </div>

            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'watchlist' ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, width: '100%' }}>
              <PanelErrorBoundary name="Portfolio">
                <PortfolioMobile
                  onManage={() => setActiveTabPersist('search')}
                />
              </PanelErrorBoundary>
            </div>

            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'alerts' ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, width: '100%' }}>
              <PanelErrorBoundary name="Alerts">
                <Suspense fallback={null}>
                  <AlertCenterPanel />
                </Suspense>
              </PanelErrorBoundary>
            </div>

            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'more' || moreView ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, width: '100%' }}>
              <MobileMoreScreen
                onNavigate={handleMoreNavigate}
                onOpenChat={() => setChatOpen(true)}
                user={user}
                onSettings={() => setSettingsOpen(true)}
                onLogout={logout}
                onBilling={openBillingPortal}
                isPaid={subscription?.status === 'active'}
                subscription={subscription}
              />
            </div>

            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'more' || moreView !== 'news' ? 'none' : 'flex' }}>
              <PanelErrorBoundary name="News">
                <Suspense fallback={null}>
                  <NewsPanel />
                </Suspense>
              </PanelErrorBoundary>
            </div>

            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'more' || moreView !== 'etf' ? 'none' : 'flex' }}>
              <PanelErrorBoundary name="ETF">
                <ETFPanel />
              </PanelErrorBoundary>
            </div>

            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'more' || moreView !== 'screener' ? 'none' : 'flex' }}>
              <PanelErrorBoundary name="Screener">
                <Suspense fallback={null}>
                  <ScreenerPanel />
                </Suspense>
              </PanelErrorBoundary>
            </div>

            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'more' || moreView !== 'macro' ? 'none' : 'flex' }}>
              <PanelErrorBoundary name="Macro">
                <Suspense fallback={null}>
                  <MacroPanel />
                </Suspense>
              </PanelErrorBoundary>
            </div>

            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'more' || moreView !== 'sectors' ? 'none' : 'flex' }}>
              <PanelErrorBoundary name="Sectors">
                <SectorScreenSelector
                  isOpen={true}
                  onClose={() => setMoreView(null)}
                  onSelect={handleSelectSectorScreen}
                  activeScreen={activeSectorScreen}
                />
              </PanelErrorBoundary>
            </div>

            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'more' || moreView !== 'notification-prefs' ? 'none' : 'flex' }}>
              <NotificationPrefs onClose={() => setMoreView(null)} />
            </div>

            {/* Phase 4: Prediction Markets mobile view */}
            <div style={{ flex: 1, display: mobileMode !== 'terminal' || activeSectorScreen || activeTab !== 'more' || moreView !== 'predictions' ? 'none' : 'flex' }}>
              <PanelErrorBoundary name="Predictions">
                <Suspense fallback={null}>
                  <PredictionPanel />
                </Suspense>
              </PanelErrorBoundary>
            </div>

          </div>

          {/* ── Bottom 2-state mode bar (Particle | Terminal) ── */}
          <ParticleModeBar
            mode={mobileMode}
            onModeChange={(m) => {
              setMobileModePersist(m);
              // When switching to terminal, clear any sector screen overlay
              if (m === 'terminal' && activeSectorScreen) {
                handleGoHome();
              }
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
              <Suspense fallback={<InstrumentDetailSkeleton />}><PanelErrorBoundary name="InstrumentDetail"><InstrumentDetail ticker={detailTicker} onClose={() => setDetailTicker(null)} asPage onOpenChat={() => setChatOpen(true)} /></PanelErrorBoundary></Suspense>
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
    </WatchlistProvider>
    </PortfolioProvider>
    </DragProvider>
    </OpenDetailProvider>
    </ScreenProvider>
    </AppErrorBoundary>
  );
}
