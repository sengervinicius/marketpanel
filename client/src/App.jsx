import { useState, useEffect, useCallback, useRef, useMemo, Component } from 'react';
import { apiFetch } from './utils/api';
import { useMarketData } from './hooks/useMarketData';
import { useWebSocket } from './hooks/useWebSocket';
import { useAuth } from './context/AuthContext';
import { useSettings } from './context/SettingsContext';
import { PriceProvider } from './context/PriceContext';
import { FeedStatusProvider } from './context/FeedStatusContext';
import { PortfolioProvider } from './context/PortfolioContext';
import { MarketProvider, useMarketDispatch } from './context/MarketContext';
import { DragProvider } from './context/DragContext';
import { AlertsProvider, useAlerts } from './context/AlertsContext';
import { IndexPanel } from './components/panels/IndexPanel';
import { StockPanel } from './components/panels/StockPanel';
import { ForexPanel } from './components/panels/ForexPanel';
import { CommoditiesPanel } from './components/panels/CommoditiesPanel';
import { CryptoPanel } from './components/panels/CryptoPanel';
import { NewsPanel } from './components/panels/NewsPanel';
import { ChartPanel } from './components/panels/ChartPanel';
import { SentimentPanel } from './components/panels/SentimentPanel';
import { SearchPanel } from './components/panels/SearchPanel';
import { DICurvePanel } from './components/panels/DICurvePanel';
import DebtPanel from './components/panels/DebtPanel';
import BrazilPanel from './components/panels/BrazilPanel';
import GlobalIndicesPanel from './components/panels/GlobalIndicesPanel';
import PortfolioPanel from './components/panels/PortfolioPanel';
import AlertsPanel from './components/panels/AlertsPanel';
import { DEFAULT_LAYOUT, PANEL_DEFINITIONS } from './config/panels';
import PortfolioMobile from './components/panels/PortfolioMobile';
import AlertsMobile from './components/panels/AlertsMobile';
import { ChatPanel } from './components/panels/ChatPanel';
import HomePanelMobile from './components/panels/HomePanelMobile';
import ChartsPanelMobile from './components/panels/ChartsPanelMobile';
import MobileMoreScreen from './components/panels/MobileMoreScreen';
import ETFPanel from './components/panels/ETFPanel';
import ScreenerPanel from './components/panels/ScreenerPanel';
import MacroPanel from './components/panels/MacroPanel';
import LeaderboardPanel from './components/panels/LeaderboardPanel';
import OnboardingPresets from './components/onboarding/OnboardingPresets';
import OnboardingTourOverlay from './components/onboarding/OnboardingTourOverlay';
import SuggestedScreens from './components/settings/SuggestedScreens';
import WorkspaceSwitcher from './components/common/WorkspaceSwitcher';
import UserAvatar from './components/common/UserAvatar';
import { TickerTooltip } from './components/common/TickerTooltip';
import InstrumentDetail from './components/common/InstrumentDetail';
import { getMarketState as _getMarketState } from './components/common/MarketStatus';
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


// ── MarketTickBridge — dispatches live WS ticks into MarketContext reducer ────
function MarketTickBridge({ batchTicks }) {
  const dispatch = useMarketDispatch();
  useEffect(() => {
    if (!batchTicks || batchTicks.length === 0) return;
    dispatch({ type: 'BATCH_TICK', payload: { ticks: batchTicks } });
  }, [batchTicks, dispatch]);
  return null;
}

// ── World Clock ──────────────────────────────────────────────────────────────
function WorldClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const zones = [
    { label: 'NY',  tz: 'America/New_York' },
    { label: 'SP',  tz: 'America/Sao_Paulo' },
    { label: 'LDN', tz: 'Europe/London' },
    { label: 'FRA', tz: 'Europe/Berlin' },
    { label: 'HKG', tz: 'Asia/Hong_Kong' },
    { label: 'TKY', tz: 'Asia/Tokyo' },
  ];
  return (
    <div className="flex-row gap-12">
      {zones.map(z => (
        <span key={z.label} className="flex-row app-clock-zone">
          <span className="app-clock-label">{z.label}</span>
          <span className="app-clock-time">
            {now.toLocaleTimeString('en-US', { timeZone: z.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Row Resize Handle ────────────────────────────────────────────────────────
function ResizeHandle({ onStart }) {
  return (
    <div
      onMouseDown={e => { e.preventDefault(); onStart(e); }}
      className="app-resize-handle-horizontal"
    >
      <div className="app-resize-indicator-h" />
    </div>
  );
}

// ── Column Resize Handle ─────────────────────────────────────────────────────
function ColResizeHandle({ onStart }) {
  return (
    <div
      onMouseDown={e => { e.preventDefault(); onStart(e); }}
      className="app-resize-handle-vertical"
    >
      <div className="app-resize-indicator-v" />
    </div>
  );
}

// ── Layout Move Overlay ──────────────────────────────────────────────────────
// Shown over each panel when layout-edit mode is active
// Displays directional movement buttons and the panel name
function LayoutMoveOverlay({ panelId, rowIdx, colIdx, rowLen, totalRows, onMove }) {
  const btn = (dir, label, disabled) => (
    <button className="btn"
      onClick={() => !disabled && onMove(panelId, rowIdx, colIdx, dir)}
      disabled={disabled}
      style={{
        background: disabled ? 'var(--bg-elevated)' : '#1a0900',
        border: `1px solid ${disabled ? 'var(--border-default)' : 'var(--accent)'}`,
        color:  disabled ? 'var(--border-strong)' : 'var(--accent)',
        width: 22, height: 22, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontFamily: 'monospace', padding: 0,
      }}
    >{label}</button>
  );
  // Get panel label from PANEL_DEFINITIONS for better UX
  const panelLabel = PANEL_DEFINITIONS[panelId]?.label || panelId;

  return (
    <div className="app-layout-overlay">
      <div className="flex-col" style={{ alignItems: 'center', gap: 4 }}>
        {btn('up',    '↑', rowIdx === 0)}
        <div className="flex-row gap-2">
          {btn('left',  '←', colIdx === 0)}
          <div className="app-layout-overlay-label">{panelLabel}</div>
          {btn('right', '→', colIdx === rowLen - 1)}
        </div>
        {btn('down',  '↓', rowIdx === totalRows - 1)}
      </div>
    </div>
  );
}

// ── Panel registry — maps panelId → render function ───────────────────────────
function makePanelRenderer(panelId, props) {
  const { mergedData, loading, setChartTicker, setDetailTicker, chartTicker, setChartGridCount } = props;
  switch (panelId) {
    case 'charts':
      return <ChartPanel ticker={chartTicker} onTickerChange={setChartTicker} onGridChange={setChartGridCount} onOpenDetail={setDetailTicker} />;
    case 'usEquities':
      return <StockPanel data={mergedData?.stocks} loading={loading} onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'forex':
      return <ForexPanel data={mergedData?.forex} cryptoData={mergedData?.crypto} loading={loading} onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'globalIndices':
      return <GlobalIndicesPanel data={mergedData?.stocks} loading={loading} onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'brazilB3':
      return <BrazilPanel onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'commodities':
      return <CommoditiesPanel data={mergedData?.stocks} loading={loading} onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'crypto':
      return <CryptoPanel data={mergedData?.crypto} loading={loading} onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'debt':
      return <DebtPanel />;
    case 'search':
      return <SearchPanel onTickerSelect={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'news':
      return <NewsPanel />;
    case 'watchlist':
      return <PortfolioPanel onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'sentiment':
      return <SentimentPanel />;
    case 'chat':
      return <ChatPanel />;
    case 'curves':
      return <DICurvePanel compact />;
    case 'indices':
      return <IndexPanel data={mergedData?.indices} loading={loading} onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'alerts':
      return <AlertsPanel onOpenDetail={setDetailTicker} />;
    case 'screener':
      return <ScreenerPanel onOpenDetail={setDetailTicker} />;
    case 'macro':
      return <MacroPanel />;
    case 'leaderboard':
      return <LeaderboardPanel />;
    default:
      return <div className="app-panel-placeholder">Panel: {panelId}</div>;
  }
}

// ── Resizable row-flex hook ──────────────────────────────────────────────────
// Supports drag to resize and double-click to reset to equal distribution
function useResizableFlex(storageKey, defaults) {
  const [sizes, setSizes] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey));
      return Array.isArray(s) && s.length === defaults.length ? s : defaults;
    } catch { return defaults; }
  });
  const sizesRef = useRef(sizes);
  const cleanupRef = useRef(null);
  const lastClickRef = useRef(null);
  useEffect(() => { sizesRef.current = sizes; }, [sizes]);
  const startResize = useCallback((idx, e) => {
    // Double-click detection: reset to equal distribution
    const now = Date.now();
    if (lastClickRef.current && now - lastClickRef.current < 300) {
      const equalSizes = Array(defaults.length).fill(1);
      setSizes(equalSizes);
      lastClickRef.current = null;
      return;
    }
    lastClickRef.current = now;

    const startY = e.clientY;
    const startSizes = [...sizesRef.current];
    const totalFlex = startSizes.reduce((a, b) => a + b, 0);
    const totalH = window.innerHeight - 42;
    const flexPerPx = totalFlex / totalH;
    const onMove = (mv) => {
      const delta = (mv.clientY - startY) * flexPerPx;
      setSizes(startSizes.map((s, i) => {
        if (i === idx)   return Math.max(0.15, s + delta);
        if (i === idx+1) return Math.max(0.15, s - delta);
        return s;
      }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      cleanupRef.current = null;
    };
    cleanupRef.current = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [defaults]);
  // Debounce localStorage writes to avoid excessive I/O during drag
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(sizes));
    }, 500);
    return () => clearTimeout(timer);
  }, [sizes, storageKey]);
  // Clean up any remaining listeners if component unmounts during a drag
  useEffect(() => {
    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, []);
  return [sizes, startResize];
}

// ── Resizable column-flex hook ───────────────────────────────────────────────
// Supports drag to resize and double-click to reset to equal distribution
function useResizableColumns(storageKey, defaults) {
  const [sizes, setSizes] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey));
      return Array.isArray(s) && s.length === defaults.length ? s : defaults;
    } catch { return defaults; }
  });
  const sizesRef = useRef(sizes);
  const cleanupRef = useRef(null);
  const lastClickRef = useRef(null);
  useEffect(() => { sizesRef.current = sizes; }, [sizes]);
  const startResize = useCallback((idx, e) => {
    // Double-click detection: reset to equal distribution
    const now = Date.now();
    if (lastClickRef.current && now - lastClickRef.current < 300) {
      const equalSizes = Array(defaults.length).fill(1);
      setSizes(equalSizes);
      lastClickRef.current = null;
      return;
    }
    lastClickRef.current = now;

    const startX = e.clientX;
    const startSizes = [...sizesRef.current];
    const totalFlex = startSizes.reduce((a, b) => a + b, 0);
    const totalW = window.innerWidth;
    const flexPerPx = totalFlex / totalW;
    const onMove = (mv) => {
      const delta = (mv.clientX - startX) * flexPerPx;
      setSizes(startSizes.map((s, i) => {
        if (i === idx)   return Math.max(0.08, s + delta);
        if (i === idx+1) return Math.max(0.08, s - delta);
        return s;
      }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      cleanupRef.current = null;
    };
    cleanupRef.current = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [defaults]);
  // Debounce localStorage writes to avoid excessive I/O during drag
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(sizes));
    }, 500);
    return () => clearTimeout(timer);
  }, [sizes, storageKey]);
  // Clean up any remaining listeners if component unmounts during a drag
  useEffect(() => {
    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, []);
  return [sizes, startResize];
}

// ── Settings Drawer ──────────────────────────────────────────────────────────
// Convert PANEL_DEFINITIONS to array of { id, label }
const PANEL_DEFS = Object.values(PANEL_DEFINITIONS).map(def => ({
  id: def.id,
  label: def.label,
}));

const START_PAGE_OPTIONS = [
  { value: '/',          label: 'HOME' },
  { value: '/charts',    label: 'CHARTS' },
  { value: '/watchlist', label: 'PORTFOLIO' },
  { value: '/search',    label: 'SEARCH' },
  { value: '/news',      label: 'NEWS' },
];

import { getTemplateList } from './config/templates';
const PRESET_LIST = getTemplateList('onboarding').map(t => ({ key: t.id, label: t.label }));

function SettingsSection({ label }) {
  return (
    <div className="app-settings-header">
      <span className="app-text-accent-header">{label}</span>
    </div>
  );
}

function SettingsDrawer({ panelVisible, togglePanel, onClose }) {
  const { settings, updateSettings, applyPreset, applyTemplate, resetTour } = useSettings();
  const [applyingPreset, setApplyingPreset] = useState(null);
  const [resettingLayout, setResettingLayout] = useState(false);

  const defaultStartPage = settings?.defaultStartPage || '/';
  const theme = settings?.theme || 'dark';

  const handleStartPage = (val) => { updateSettings({ defaultStartPage: val }); };
  const handleTheme = () => { updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' }); };
  const handlePreset = async (key) => {
    setApplyingPreset(key);
    try { await applyPreset(key); } finally { setApplyingPreset(null); }
  };
  const handleResetLayout = async () => {
    setResettingLayout(true);
    try {
      await updateSettings({ layout: DEFAULT_LAYOUT });
    } finally {
      setResettingLayout(false);
    }
  };

  const rowStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '5px 12px', borderBottom: '1px solid var(--border-subtle)',
    transition: 'background-color 100ms ease-out',
  };

  const makeRowClickable = (handler) => ({
    onClick: handler,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
    },
  });

  return (
    <div className="app-settings-overlay">
      <style>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(12px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>

      {/* Drawer header */}
      <div className="flex-row app-settings-row-header">
        <span className="app-text-accent-bold">SETTINGS</span>
        <button className="btn app-btn-close"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>

      {/* ── Default Start Page ── */}
      <SettingsSection label="DEFAULT START PAGE" />
      {START_PAGE_OPTIONS.map(({ value, label }) => (
        <div
          key={value}
          role="button"
          tabIndex={0}
          style={rowStyle}
          {...makeRowClickable(() => handleStartPage(value))}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ color: defaultStartPage === value ? 'var(--accent)' : 'var(--text-muted)', fontSize: 9, letterSpacing: '0.5px' }}>{label}</span>
          <span style={{ color: defaultStartPage === value ? 'var(--accent)' : 'var(--border-strong)' }}>{defaultStartPage === value ? '●' : '○'}</span>
        </div>
      ))}

      {/* ── Theme ── */}
      <SettingsSection label="APPEARANCE" />
      <div
        role="button"
        tabIndex={0}
        style={rowStyle}
        {...makeRowClickable(handleTheme)}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span className="app-text-muted-small">{theme === 'dark' ? '◑ DARK MODE' : '☀ LIGHT MODE'}</span>
        <span className="app-text-accent-bold-small">TOGGLE</span>
      </div>

      {/* ── Workspace Presets ── */}
      <SettingsSection label="APPLY WORKSPACE PRESET" />
      {PRESET_LIST.map(({ key, label }) => (
        <div
          key={key}
          role="button"
          tabIndex={0}
          style={{ ...rowStyle, cursor: applyingPreset ? 'wait' : 'pointer' }}
          {...makeRowClickable(() => !applyingPreset && handlePreset(key))}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          aria-busy={applyingPreset === key}
        >
          <span className="app-text-muted-small">{label}</span>
          {applyingPreset === key
            ? <span className="app-text-accent-small">APPLYING…</span>
            : <span className="app-text-faint-small">APPLY →</span>}
        </div>
      ))}

      {/* ── Reset Layout ── */}
      <SettingsSection label="LAYOUT" />
      <div
        role="button"
        tabIndex={0}
        style={rowStyle}
        {...makeRowClickable(handleResetLayout)}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span className="app-text-muted-small">Reset to Default</span>
        {resettingLayout
          ? <span className="app-text-accent-small">RESETTING…</span>
          : <span className="app-text-faint-small">↻ RESET</span>}
      </div>

      {/* ── Panel Visibility ── */}
      <SettingsSection label="PANEL VISIBILITY" />
      {PANEL_DEFS.map(({ id, label }) => {
        const visible = panelVisible[id] ?? true;
        return (
          <div
            key={id}
            role="button"
            tabIndex={0}
            style={rowStyle}
            {...makeRowClickable(() => togglePanel(id))}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            aria-pressed={visible}
          >
            <span style={{ color: visible ? 'var(--text-primary)' : 'var(--text-faint)', fontSize: 9, letterSpacing: '0.5px' }}>{label}</span>
            <span style={{ color: visible ? 'var(--price-up)' : 'var(--text-faint)', fontSize: 9, fontWeight: 700 }}>
              {visible ? '● ON' : '○ OFF'}
            </span>
          </div>
        );
      })}

      {/* ── Help ── */}
      <SettingsSection label="HELP" />
      <div
        role="button"
        tabIndex={0}
        style={rowStyle}
        {...makeRowClickable(() => { resetTour(); onClose(); })}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span className="app-text-muted-small">Restart Onboarding Tour</span>
        <span className="app-text-faint-small">&#8635; RESTART</span>
      </div>

      {/* ── Community & Discord ── */}
      <SettingsSection label="COMMUNITY" />
      <DiscordLinkRow />

      {/* ── Suggested Screens ── */}
      <SettingsSection label="SUGGESTED SCREENS" />
      <SuggestedScreens onApply={onClose} />
    </div>
  );
}

// ── Discord Link Row (settings drawer + mobile) ─────────────────────────────
function DiscordLinkRow() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }
    fetch('/api/discord/status', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setStatus(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!status?.configured) return null;

  const handleLink = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/discord/link', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.url) window.open(data.url, '_blank');
  };

  const handleUnlink = async () => {
    const token = localStorage.getItem('token');
    await fetch('/api/discord/unlink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    setStatus(s => ({ ...s, linked: false, discordUsername: null }));
  };

  const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', transition: 'background 150ms' };

  if (status.linked) {
    return (
      <div style={rowStyle}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span className="app-text-muted-small">Discord: {status.discordUsername}</span>
        <span className="app-text-faint-small" style={{ cursor: 'pointer' }} onClick={handleUnlink}>UNLINK</span>
      </div>
    );
  }

  return (
    <div role="button" tabIndex={0} style={rowStyle}
      onClick={handleLink}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span className="app-text-muted-small">Join our Discord</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#5865F2', letterSpacing: '0.3px' }}>CONNECT</span>
    </div>
  );
}

// ── User Dropdown (header avatar menu) ───────────────────────────────────────
function UserDropdown({ user, onSettings, onLogout, onBilling, isPaid }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn flex-row gap-2"
        onClick={() => setOpen(s => !s)}
        style={{
          padding: '2px 8px', gap: 5,
        }}
      >
        <UserAvatar user={user} size="small" interactive />
        <span style={{ color: open ? 'var(--accent)' : 'var(--text-faint)', fontSize: 8 }}>▼</span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
          <span>{user.username?.toUpperCase()}</span>
          {user.gamification && (
            <span style={{ fontSize: 7, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.5px' }}>
              Lv {user.gamification.level || 1} · {user.gamification.xp || 0} XP
            </span>
          )}
        </span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 2px)', right: 0, zIndex: 2000,
          background: 'var(--bg-overlay)', border: '1px solid var(--border-strong)',
          width: 150, boxShadow: 'var(--shadow-dropdown)',
          }}>
          {isPaid && onBilling && (
            <div
              onClick={() => { setOpen(false); onBilling(); }}
              className="app-dropdown-item app-text-muted"
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--price-up)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >💳 BILLING</div>
          )}
          <div
            onClick={() => { setOpen(false); onSettings(); }}
            className="app-dropdown-item"
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >⚙ SETTINGS</div>
          <div
            onClick={() => { setOpen(false); onLogout(); }}
            className="app-dropdown-item-last"
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--price-down)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >→ LOG OUT</div>
        </div>
      )}
    </div>
  );
}

// ── Alert Badge (header bell icon with unread count) ────────────────────────
function AlertBadge() {
  let triggeredCount = 0;
  try {
    const { triggeredAlerts } = useAlerts();
    triggeredCount = triggeredAlerts?.length || 0;
  } catch {
    // AlertsProvider might not be ready yet
    return null;
  }
  if (triggeredCount === 0) return (
    <span title="No triggered alerts" style={{ color: 'var(--text-faint)', fontSize: 11, cursor: 'default', display: 'inline-flex' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
  );
  return (
    <span title={`${triggeredCount} triggered alert${triggeredCount > 1 ? 's' : ''}`} style={{ position: 'relative', fontSize: 11, display: 'inline-flex' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span style={{
        position: 'absolute', top: -4, right: -6,
        background: 'var(--price-down)', color: '#fff',
        fontSize: 7, fontWeight: 700, borderRadius: '50%',
        width: 12, height: 12, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        lineHeight: 1,
      }}>{triggeredCount > 9 ? '9+' : triggeredCount}</span>
    </span>
  );
}

// ── Feed Status Bar ──────────────────────────────────────────────────────────
function FeedStatusBar({ feedStatus }) {
  const feeds = [
    { key: 'stocks', label: 'STOCKS' },
    { key: 'forex',  label: 'FX' },
    { key: 'crypto', label: 'CRYPTO' },
  ];
  const color = (level) => {
    if (level === 'live')      return '#00cc66';
    if (level === 'degraded')  return '#ff9900';
    if (level === 'error')     return '#ff3333';
    return '#444';
  };
  const dot = (level) => {
    if (level === 'live')     return '●';
    if (level === 'degraded') return '◐';
    if (level === 'error')    return '✕';
    return '○';
  };
  return (
    <div style={{
      height: 20, flexShrink: 0,
      background: '#060606', borderTop: '1px solid #1a1a1a',
      padding: '0 12px', gap: 20,
    }} className="flex-row">
      <span style={{ color: '#282828', fontSize: 8, letterSpacing: '1px' }}>FEED</span>
      {feeds.map(({ key, label }) => {
        const level = feedStatus?.[key] || 'connecting';
        return (
          <span key={key} className="flex-row gap-4">
            <span style={{ color: color(level), fontSize: 9 }}>{dot(level)}</span>
            <span style={{ color: '#3a3a3a', fontSize: 8, letterSpacing: '0.8px' }}>{label}</span>
            <span style={{ color: color(level), fontSize: 8, fontWeight: 700, letterSpacing: '0.5px', opacity: 0.9 }}>
              {level.toUpperCase()}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ── Data Error Banner — shown when all market feeds are down ─────────────────
// This surfaces HTTP 402/403/401/network errors that were previously invisible,
// causing users to see blank panels with no explanation.
function DataErrorBanner({ error, endpointErrors }) {
  if (!error) return null;
  // Subscription expired is already handled by SubscriptionExpiredScreen + TrialBanner
  if (error === 'subscription_required') return null;

  let msg, detail;
  if (error === 'api_key_invalid') {
    msg    = 'MARKET DATA UNAVAILABLE';
    detail = 'Server API key not configured (HTTP 403). Contact support or check POLYGON_API_KEY env var.';
  } else if (error === 'auth_required') {
    msg    = 'SESSION EXPIRED';
    detail = 'Your session is no longer valid (HTTP 401). Please log out and log in again.';
  } else if (error === 'Data endpoints unreachable') {
    msg    = 'FEED UNREACHABLE';
    detail = 'Cannot connect to market data server. Check your network or server status.';
  } else {
    // Generic: show the raw error string (includes endpoint path + HTTP status)
    msg    = 'MARKET DATA ERROR';
    detail = error;
  }

  // Also show which individual feeds are failing (non-null entries)
  const failingFeeds = Object.entries(endpointErrors || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
    .join('  |  ');

  return (
    <div className="flex-row" style={{
      background: '#1a0000', borderBottom: '1px solid #ff333344',
      gap: 10,
      padding: '4px 12px', flexShrink: 0, flexWrap: 'wrap',
    }}>
      <span className="app-alert-label">⚠ {msg}</span>
      <span className="app-alert-detail">{detail}</span>
      {failingFeeds && (
        <span className="app-alert-count">{failingFeeds}</span>
      )}
    </div>
  );
}

// ── Trial / Subscription banner ──────────────────────────────────────────────
function TrialBanner({ subscription, onUpgrade, onManageBilling, billingState }) {
  if (!subscription) return null;
  if (subscription.status === 'active' && !billingState?.showSuccess) return null;

  const days = subscription.trialDaysRemaining ?? 0;
  if (subscription.status === 'trial' && days <= 0) return null;

  const isExpired = subscription.status === 'expired';
  const isPaid = subscription.status === 'active';
  const isLoading = billingState?.isLoading;
  const showSuccess = billingState?.showSuccess;
  const checkoutError = billingState?.error;

  let msg, bg, clr;
  if (showSuccess) {
    msg = 'Verifying your subscription...';
    bg = '#003300';
    clr = '#44ff44';
  } else if (isExpired) {
    msg = 'TRIAL EXPIRED — Subscribe to continue';
    bg = '#3a0000';
    clr = '#ff4444';
  } else if (isPaid) {
    msg = 'ACTIVE SUBSCRIPTION';
    bg = '#003300';
    clr = '#44ff44';
  } else {
    msg = `FREE TRIAL: ${days} day${days !== 1 ? 's' : ''} remaining`;
    bg = '#1a1000';
    clr = '#ff9900';
  }

  return (
    <div className="flex-row" style={{
      background: bg, borderBottom: `1px solid ${clr}44`,
      justifyContent: 'center', gap: 12,
      padding: '3px 12px', flexShrink: 0, flexWrap: 'wrap',
    }}>
      {checkoutError && (
        <span style={{ color: '#ff4444', fontSize: 8, letterSpacing: '0.5px', fontWeight: 600 }}>
          Error: {checkoutError}
        </span>
      )}
      {!checkoutError && (
        <>
          <span style={{ color: clr, fontSize: 8, letterSpacing: '0.8px', fontWeight: 700 }}>{msg}</span>
          {isLoading ? (
            <span style={{ color: clr, fontSize: 8, fontWeight: 600 }}>Setting up...</span>
          ) : (
            <>
              {!isPaid && !showSuccess && (
                <button className="btn"
                  onClick={onUpgrade}
                  style={{
                    background: '#ff6600', border: 'none', color: '#000',
                    fontWeight: 700 }}
                >UPGRADE →</button>
              )}
              {isPaid && onManageBilling && (
                <button className="btn"
                  onClick={onManageBilling}
                  style={{
                    background: 'transparent', border: `1px solid ${clr}`, color: clr,
                    fontWeight: 700 }}
                >MANAGE BILLING</button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Subscription Expired Screen ──────────────────────────────────────────────
function SubscriptionExpiredScreen({ onUpgrade, onLogout, onManageBilling, checkoutState, subscription, onRestore, billingPlatform }) {
  const [isLoading, setIsLoading] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState(null);
  const isLoadingCheckout = checkoutState?.isLoading || isLoading;
  const checkoutError = checkoutState?.error;
  const hasStripeCustomerId = subscription?.stripeCustomerId;
  const isApple = billingPlatform === 'apple';

  const handleUpgrade = async () => {
    setIsLoading(true);
    try {
      await onUpgrade();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-col app-error-state" style={{
      flex: 1, background: '#0a0a0a',
    }}>
      <div className="app-error-icon">⊘</div>
      <div className="app-error-title">
        SUBSCRIPTION REQUIRED
      </div>
      <div className="app-error-message">
        Your free trial has ended. Subscribe to Senger Market Terminal to continue accessing real-time data.
      </div>
      {checkoutError && (
        <div className="app-error-detail">
          Error: {checkoutError}
        </div>
      )}
      <div className="flex-row app-button-group">
        <button className="btn"
          onClick={handleUpgrade}
          disabled={isLoadingCheckout}
          style={{
            background: isLoadingCheckout ? '#aa4400' : '#ff6600',
            border: 'none', color: '#000',
            fontWeight: 700, padding: '8px 20px', cursor: isLoadingCheckout ? 'not-allowed' : 'pointer', opacity: isLoadingCheckout ? 0.7 : 1,
          }}
        >{isLoadingCheckout ? 'Setting up...' : 'SUBSCRIBE NOW →'}</button>
        {hasStripeCustomerId && onManageBilling && !isApple && (
          <button className="btn app-btn-secondary"
            onClick={onManageBilling}
          >MANAGE BILLING</button>
        )}
        {isApple && onRestore && (
          <button className="btn app-btn-secondary"
            onClick={async () => {
              setRestoreMsg(null);
              const result = await onRestore();
              setRestoreMsg(result.restored ? 'Subscription restored!' : 'No previous purchases found.');
            }}
          >RESTORE PURCHASES</button>
        )}
        <button className="btn"
          onClick={onLogout}
          style={{
            background: 'none', border: '1px solid #2a2a2a', color: '#444',
            padding: '8px 14px',
          }}
        >LOG OUT</button>
      </div>
      {restoreMsg && (
        <div style={{ color: '#888', marginTop: 8 }}>{restoreMsg}</div>
      )}
    </div>
  );
}

// ── Mobile tab definitions (5 primary tabs) ──────────────────────────────────
const MOBILE_TABS = [
  { id: 'home',      label: 'Home' },
  { id: 'charts',    label: 'Charts' },
  { id: 'watchlist', label: 'Portfolio' },
  { id: 'search',    label: 'Search' },
  { id: 'more',      label: 'More' },
];

// SVG tab icons (24x24, stroke-based) — color driven by CSS class via currentColor
function TabIcon({ id, active }) {
  const sw = active ? 2 : 1.5;
  const s = { width: 22, height: 22, display: 'block' };
  switch (id) {
    case 'home': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" /><polyline points="9 21 9 14 15 14 15 21" />
      </svg>
    );
    case 'charts': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    );
    case 'search': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
    );
    case 'watchlist': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="18" rx="2" /><line x1="2" y1="9" x2="22" y2="9" /><line x1="12" y1="9" x2="12" y2="21" />
      </svg>
    );
    case 'alerts': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    );
    case 'more': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round">
        <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    );
    default: return null;
  }
}

// Badge component for tab bar alert count
function TabBadge({ count }) {
  if (!count || count <= 0) return null;
  return (
    <span className="m-tab-badge">{count > 9 ? '9+' : count}</span>
  );
}

// Mobile tab bar with alert badges
function MobileTabBar({ activeTab, onTabChange }) {
  const { alerts } = useAlerts();
  const triggeredCount = useMemo(
    () => alerts.filter(a => a.triggeredAt && !a.dismissed).length,
    [alerts]
  );

  return (
    <nav className="m-tab-bar">
      {MOBILE_TABS.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <button className="btn m-tab-btn"
            key={tab.id}
            data-active={isActive}
            onClick={() => onTabChange(tab.id)}
          >
            <span className="m-tab-icon-wrap">
              <TabIcon id={tab.id} active={isActive} />
              {tab.id === 'alerts' && <TabBadge count={triggeredCount} />}
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

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

  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

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
      const titles = { news: 'News Feed', etf: 'ETF Screener', screener: 'Fundamental Screener', macro: 'Macro Panel', leaderboard: 'Leaderboard' };
      return titles[moreView] || moreView;
    }
    return null;
  }, [activeTab, moreView]);

  // ── Boot screen ─────────────────────────────────────────────────────────
  if (bootState !== BOOT.READY) {
    return (
      <div className="boot-screen">
        <div className="boot-logo">SENGER</div>
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
          <span className="app-header-title">SENGER</span>
          <span className="app-header-subtitle">MARKET TERMINAL</span>
          <WorkspaceSwitcher />
          <div className="flex-row" style={{ flex:1, justifyContent:'center' }}><WorldClock /></div>
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
                              {makePanelRenderer(panelId, panelProps)}
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

        {detailTicker && !subscriptionExpired && <InstrumentDetail ticker={detailTicker} onClose={() => setDetailTicker(null)} />}
        <TickerTooltip onOpenDetail={setDetailTicker} />
      </div>
      </PriceProvider>
      </MarketProvider>
      </FeedStatusProvider>
      </AlertsProvider>
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
          <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13, letterSpacing: '2.5px' }}>SENGER</span>
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
              <HomePanelMobile
                onOpenDetail={goDetail}
                onSearchClick={() => setActiveTabPersist('search')}
              />
            )}

            {activeTab === 'charts' && (
              <ChartsPanelMobile onOpenDetail={goDetail} />
            )}

            {activeTab === 'search' && (
              <SearchPanel onTickerSelect={goDetail} onOpenDetail={goDetail} />
            )}

            {activeTab === 'watchlist' && (
              <PortfolioMobile
                onOpenDetail={goDetail}
                onManage={() => setActiveTabPersist('search')}
              />
            )}

            {activeTab === 'alerts' && (
              <AlertsMobile onOpenDetail={goDetail} />
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

            {activeTab === 'more' && moreView === 'news' && <NewsPanel />}

            {activeTab === 'more' && moreView === 'etf' && (
              <ETFPanel onOpenDetail={goDetail} />
            )}

            {activeTab === 'more' && moreView === 'screener' && (
              <ScreenerPanel onOpenDetail={goDetail} />
            )}

            {activeTab === 'more' && moreView === 'macro' && (
              <MacroPanel />
            )}

            {activeTab === 'more' && moreView === 'leaderboard' && (
              <LeaderboardPanel mobile />
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
      {/* ── Instrument Detail slide-up overlay ── */}
      {detailTicker && !subscriptionExpired && (
        <div className="flex-col" style={{
          position: 'fixed', inset: 0, zIndex: 1500,
          background: 'var(--bg-app)',
          paddingTop: 'env(safe-area-inset-top)',
        }}>
          {/* Detail header with close button */}
          <div className="m-header">
            <button className="btn flex-row"
              onClick={() => setDetailTicker(null)}
              style={{
                background: 'none', border: 'none', color: 'var(--accent)',
                padding: '8px 8px 8px 0', gap: 4,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>
            <div className="flex-1" />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <InstrumentDetail ticker={detailTicker} onClose={() => setDetailTicker(null)} asPage />
          </div>
        </div>
      )}

      <TickerTooltip onOpenDetail={goDetail} />
    </div>
    </PriceProvider>
    </MarketProvider>
    </FeedStatusProvider>
    </AlertsProvider>
    </PortfolioProvider>
    </DragProvider>
    </AppErrorBoundary>
  );
}

// ── Mobile local clock + city + market status ──
const CITY_OVERRIDES = {
  'Sao Paulo': 'S\u00e3o Paulo', 'New York': 'New York',
  'Los Angeles': 'Los Angeles', 'Ho Chi Minh': 'Ho Chi Minh',
};

function MobileClockCompact() {
  const [time, setTime] = useState('');
  const [city, setCity] = useState('');
  const [mkt, setMkt] = useState(() => _getMarketState());

  useEffect(() => {
    let tz;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) {}
    if (!tz) { setCity('UTC'); }
    else {
      const raw = tz.split('/').pop().replace(/_/g, ' ');
      setCity(CITY_OVERRIDES[raw] || raw);
    }
    const update = () => {
      const opts = { hour: '2-digit', minute: '2-digit', hour12: false };
      if (tz) opts.timeZone = tz;
      try { setTime(new Date().toLocaleTimeString('en-GB', opts)); }
      catch (_) { setTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })); }
      setMkt(_getMarketState());
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  const mktOpen = mkt.status === 'open';
  return (
    <div className="m-clock-strip">
      <span className="m-clock-time">{city} {time}</span>
      <span className={`m-mkt-pill${mktOpen ? ' m-mkt-pill--open' : ''}`}>
        {mktOpen ? 'MKT OPEN' : 'MKT CLOSED'}
      </span>
    </div>
  );
}

