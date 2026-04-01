import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiFetch } from './utils/api';
import { useMarketData } from './hooks/useMarketData';
import { useWebSocket } from './hooks/useWebSocket';
import { useAuth } from './context/AuthContext';
import { useSettings } from './context/SettingsContext';
import { PriceProvider } from './context/PriceContext';
import { FeedStatusProvider } from './context/FeedStatusContext';
import { WatchlistProvider } from './context/WatchlistContext';
import { MarketProvider, useMarketDispatch } from './context/MarketContext';
import { DragProvider } from './context/DragContext';
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
import WatchlistPanel from './components/panels/WatchlistPanel';
import { DEFAULT_LAYOUT, PANEL_DEFINITIONS } from './config/panels';
import WatchlistPanelMobile from './components/panels/WatchlistPanelMobile';
import { ChatPanel } from './components/panels/ChatPanel';
import HomePanelMobile from './components/panels/HomePanelMobile';
import ChartsPanelMobile from './components/panels/ChartsPanelMobile';
import MobileMoreScreen from './components/panels/MobileMoreScreen';
import ETFPanel from './components/panels/ETFPanel';
import OnboardingPresets from './components/onboarding/OnboardingPresets';
import SuggestedScreens from './components/settings/SuggestedScreens';
import { TickerTooltip } from './components/common/TickerTooltip';
import InstrumentDetail from './components/common/InstrumentDetail';
import './App.css';


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
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      {zones.map(z => (
        <span key={z.label} style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
          <span style={{ color: 'var(--text-faint)', fontSize: 9, letterSpacing: '0.06em', fontWeight: 600 }}>{z.label}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.03em' }}>
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
      style={{
        height: 6, flexShrink: 0, cursor: 'row-resize',
        background: 'var(--bg-app)',
        borderTop: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        userSelect: 'none', zIndex: 20,
      }}
    >
      <div style={{ width: 36, height: 2, background: 'var(--border-default)', borderRadius: 1 }} />
    </div>
  );
}

// ── Column Resize Handle ─────────────────────────────────────────────────────
function ColResizeHandle({ onStart }) {
  return (
    <div
      onMouseDown={e => { e.preventDefault(); onStart(e); }}
      style={{
        width: 5, flexShrink: 0, cursor: 'col-resize',
        background: 'var(--bg-app)',
        borderLeft: '1px solid var(--border-default)', borderRight: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        userSelect: 'none', zIndex: 20,
      }}
    >
      <div style={{ width: 1, height: 24, background: 'var(--border-strong)', borderRadius: 1 }} />
    </div>
  );
}

// ── Layout Move Overlay ──────────────────────────────────────────────────────
// Shown over each panel when layout-edit mode is active
// Displays directional movement buttons and the panel name
function LayoutMoveOverlay({ panelId, rowIdx, colIdx, rowLen, totalRows, onMove }) {
  const btn = (dir, label, disabled) => (
    <button
      onClick={() => !disabled && onMove(panelId, rowIdx, colIdx, dir)}
      disabled={disabled}
      style={{
        background: disabled ? 'var(--bg-elevated)' : '#1a0900',
        border: `1px solid ${disabled ? 'var(--border-default)' : 'var(--accent)'}`,
        color:  disabled ? 'var(--border-strong)' : 'var(--accent)',
        width: 22, height: 22, borderRadius: 'var(--radius-sm)', cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontFamily: 'monospace', padding: 0,
      }}
    >{label}</button>
  );
  // Get panel label from PANEL_DEFINITIONS for better UX
  const panelLabel = PANEL_DEFINITIONS[panelId]?.label || panelId;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'auto',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        {btn('up',    '↑', rowIdx === 0)}
        <div style={{ display: 'flex', gap: 4 }}>
          {btn('left',  '←', colIdx === 0)}
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)', padding: '2px 8px',
            color: 'var(--accent)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px',
            whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{panelLabel}</div>
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
      return <WatchlistPanel onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'sentiment':
      return <SentimentPanel />;
    case 'chat':
      return <ChatPanel />;
    case 'curves':
      return <DICurvePanel compact />;
    case 'indices':
      return <IndexPanel data={mergedData?.indices} loading={loading} onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    default:
      return <div style={{ padding: 12, color: '#333', fontSize: 9 }}>Panel: {panelId}</div>;
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
  { value: '/watchlist', label: 'WATCHLIST' },
  { value: '/search',    label: 'SEARCH' },
  { value: '/news',      label: 'NEWS' },
];

const PRESET_LIST = [
  { key: 'brazilianInvestor',   label: 'Brazilian Investor' },
  { key: 'globalInvestor',      label: 'Global Investor' },
  { key: 'debtInvestor',        label: 'Debt / Fixed Income' },
  { key: 'cryptoInvestor',      label: 'Crypto Trader' },
  { key: 'commoditiesInvestor', label: 'Commodities' },
  { key: 'custom',              label: 'Custom' },
];

function SettingsSection({ label }) {
  return (
    <div style={{ padding: '8px 12px 4px', borderBottom: '1px solid var(--border-default)', marginTop: 4 }}>
      <span style={{ color: 'var(--accent)', fontSize: 'var(--font-sm)', fontWeight: 700, letterSpacing: '1.2px' }}>{label}</span>
    </div>
  );
}

function SettingsDrawer({ panelVisible, togglePanel, onClose }) {
  const { settings, updateSettings, applyPreset } = useSettings();
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
    padding: '5px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
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
    <div style={{
      position: 'absolute', top: 36, right: 0, zIndex: 1000,
      background: 'var(--bg-overlay)', border: '1px solid var(--border-strong)', borderTop: 'none',
      width: 260, maxHeight: 'calc(100vh - 60px)', overflowY: 'auto',
      boxShadow: 'var(--shadow-overlay)',
      animation: 'slideInRight 200ms ease-out',
    }}>
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
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent)', fontSize: 9, fontWeight: 700, letterSpacing: '1px' }}>SETTINGS</span>
        <button
          onClick={onClose}
          title="Close (Esc)"
          style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, padding: 0 }}
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
          <span style={{ color: defaultStartPage === value ? 'var(--accent)' : 'var(--border-strong)', fontSize: 10 }}>{defaultStartPage === value ? '●' : '○'}</span>
        </div>
      ))}

      {/* ── Theme ── */}
      <SettingsSection label="APPEARANCE" />
      <div
        role="button"
        tabIndex={0}
        style={rowStyle}
        {...makeRowClickable(handleTheme)}
        onMouseEnter={e => e.currentTarget.style.background = '#141414'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.5px' }}>{theme === 'dark' ? '◑ DARK MODE' : '☀ LIGHT MODE'}</span>
        <span style={{ color: 'var(--accent)', fontSize: 8, fontWeight: 700, letterSpacing: '0.5px' }}>TOGGLE</span>
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
          <span style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.5px' }}>{label}</span>
          {applyingPreset === key
            ? <span style={{ color: 'var(--accent)', fontSize: 8 }}>APPLYING…</span>
            : <span style={{ color: 'var(--text-faint)', fontSize: 8, letterSpacing: '0.5px' }}>APPLY →</span>}
        </div>
      ))}

      {/* ── Reset Layout ── */}
      <SettingsSection label="LAYOUT" />
      <div
        role="button"
        tabIndex={0}
        style={rowStyle}
        {...makeRowClickable(handleResetLayout)}
        onMouseEnter={e => e.currentTarget.style.background = '#141414'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.5px' }}>Reset to Default</span>
        {resettingLayout
          ? <span style={{ color: 'var(--accent)', fontSize: 8 }}>RESETTING…</span>
          : <span style={{ color: 'var(--text-faint)', fontSize: 8, letterSpacing: '0.5px' }}>↻ RESET</span>}
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

      {/* ── Suggested Screens ── */}
      <SettingsSection label="SUGGESTED SCREENS" />
      <SuggestedScreens onApply={onClose} />
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
      <button
        onClick={() => setOpen(s => !s)}
        style={{
          background: 'none', border: '1px solid var(--border-strong)', color: 'var(--text-muted)',
          fontSize: 9, padding: '2px 8px', cursor: 'pointer',
          fontFamily: 'inherit', borderRadius: 'var(--radius-sm)', letterSpacing: '0.5px',
          display: 'flex', alignItems: 'center', gap: 5,
        }}
      >
        <span style={{ color: open ? 'var(--accent)' : 'var(--text-faint)', fontSize: 8 }}>▼</span>
        {user.username?.toUpperCase()}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 2px)', right: 0, zIndex: 2000,
          background: 'var(--bg-overlay)', border: '1px solid var(--border-strong)',
          width: 150, boxShadow: 'var(--shadow-dropdown)',
          borderRadius: 'var(--radius-sm)',
        }}>
          {isPaid && onBilling && (
            <div
              onClick={() => { setOpen(false); onBilling(); }}
              style={{ padding: '7px 12px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.5px', borderBottom: '1px solid var(--border-default)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--price-up)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = ''; }}
            >💳 BILLING</div>
          )}
          <div
            onClick={() => { setOpen(false); onSettings(); }}
            style={{ padding: '7px 12px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.5px', borderBottom: '1px solid var(--border-default)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = ''; }}
          >⚙ SETTINGS</div>
          <div
            onClick={() => { setOpen(false); onLogout(); }}
            style={{ padding: '7px 12px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.5px' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--price-down)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = ''; }}
          >→ LOG OUT</div>
        </div>
      )}
    </div>
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
      display: 'flex', alignItems: 'center', gap: 20, padding: '0 12px',
    }}>
      <span style={{ color: '#282828', fontSize: 8, letterSpacing: '1px' }}>FEED</span>
      {feeds.map(({ key, label }) => {
        const level = feedStatus?.[key] || 'connecting';
        return (
          <span key={key} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
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
    <div style={{
      background: '#1a0000', borderBottom: '1px solid #ff333344',
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '4px 12px', flexShrink: 0, flexWrap: 'wrap',
    }}>
      <span style={{ color: '#ff4444', fontSize: 9, fontWeight: 700, letterSpacing: '1px' }}>⚠ {msg}</span>
      <span style={{ color: '#883333', fontSize: 8, letterSpacing: '0.3px' }}>{detail}</span>
      {failingFeeds && (
        <span style={{ color: '#552222', fontSize: 8, marginLeft: 4 }}>{failingFeeds}</span>
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
    <div style={{
      background: bg, borderBottom: `1px solid ${clr}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
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
                <button
                  onClick={onUpgrade}
                  style={{
                    background: '#ff6600', border: 'none', color: '#000',
                    fontSize: 8, fontWeight: 700, padding: '2px 8px', cursor: 'pointer',
                    fontFamily: 'inherit', letterSpacing: '0.5px', borderRadius: 2,
                  }}
                >UPGRADE →</button>
              )}
              {isPaid && onManageBilling && (
                <button
                  onClick={onManageBilling}
                  style={{
                    background: 'transparent', border: `1px solid ${clr}`, color: clr,
                    fontSize: 8, fontWeight: 700, padding: '2px 8px', cursor: 'pointer',
                    fontFamily: 'inherit', letterSpacing: '0.5px', borderRadius: 2,
                  }}
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
function SubscriptionExpiredScreen({ onUpgrade, onLogout, onManageBilling, checkoutState, subscription }) {
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingCheckout = checkoutState?.isLoading || isLoading;
  const checkoutError = checkoutState?.error;
  const hasStripeCustomerId = subscription?.stripeCustomerId;

  const handleUpgrade = async () => {
    setIsLoading(true);
    try {
      await onUpgrade();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 16, padding: 32, background: '#0a0a0a',
    }}>
      <div style={{ color: '#ff3333', fontSize: 32 }}>⊘</div>
      <div style={{ color: '#ff3333', fontSize: 13, fontWeight: 700, letterSpacing: '2px' }}>
        SUBSCRIPTION REQUIRED
      </div>
      <div style={{ color: '#555', fontSize: 10, textAlign: 'center', maxWidth: 320, lineHeight: 1.6 }}>
        Your free trial has ended. Subscribe to Senger Market Terminal to continue accessing real-time data.
      </div>
      {checkoutError && (
        <div style={{ color: '#ff6666', fontSize: 9, textAlign: 'center', maxWidth: 320 }}>
          Error: {checkoutError}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={handleUpgrade}
          disabled={isLoadingCheckout}
          style={{
            background: isLoadingCheckout ? '#aa4400' : '#ff6600',
            border: 'none', color: '#000',
            fontSize: 10, fontWeight: 700, padding: '8px 20px', cursor: isLoadingCheckout ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', letterSpacing: '1px', borderRadius: 2,
            opacity: isLoadingCheckout ? 0.7 : 1,
          }}
        >{isLoadingCheckout ? 'Setting up...' : 'SUBSCRIBE NOW →'}</button>
        {hasStripeCustomerId && onManageBilling && (
          <button
            onClick={onManageBilling}
            style={{
              background: 'none', border: '1px solid #ff9900', color: '#ff9900',
              fontSize: 10, fontWeight: 700, padding: '8px 14px', cursor: 'pointer',
              fontFamily: 'inherit', borderRadius: 2, letterSpacing: '0.5px',
            }}
          >MANAGE BILLING</button>
        )}
        <button
          onClick={onLogout}
          style={{
            background: 'none', border: '1px solid #2a2a2a', color: '#444',
            fontSize: 10, padding: '8px 14px', cursor: 'pointer',
            fontFamily: 'inherit', borderRadius: 2,
          }}
        >LOG OUT</button>
      </div>
    </div>
  );
}

// ── Mobile tab definitions (4 primary tabs) ──────────────────────────────────
const MOBILE_TABS = [
  { id: 'markets',   label: 'Markets' },
  { id: 'charts',    label: 'Charts' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'more',      label: 'More' },
];

// SVG tab icons (24x24, stroke-based)
function TabIcon({ id, active }) {
  const color = active ? '#ff6600' : '#555';
  const sw = active ? 2 : 1.5;
  const s = { width: 22, height: 22, display: 'block' };
  switch (id) {
    case 'markets': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    );
    case 'charts': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    );
    case 'watchlist': return (
      <svg style={s} viewBox="0 0 24 24" fill={active ? '#ff6600' : 'none'} stroke={color} strokeWidth={sw} strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    );
    case 'more': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round">
        <circle cx="12" cy="5" r="1.5" fill={color} stroke="none" /><circle cx="12" cy="12" r="1.5" fill={color} stroke="none" /><circle cx="12" cy="19" r="1.5" fill={color} stroke="none" />
      </svg>
    );
    default: return null;
  }
}

const LS_TAB          = 'activeTab_m3';
const LS_CHART_TICKER = 'chartTicker';
const LS_CHART_GRID   = 'chartGrid_v3';

export default function App() {
  const { data, loading, isRefreshing, lastUpdated, error: feedError, endpointErrors } = useMarketData();
  const { user, subscription, startCheckout, logout, authReady, openBillingPortal, refreshSubscription } = useAuth();
  const { settings, loaded: settingsLoaded } = useSettings();

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
    const saved = localStorage.getItem(LS_TAB);
    // Migrate old tab IDs
    if (saved === 'home') return 'markets';
    return MOBILE_TABS.find(t => t.id === saved) ? saved : 'markets';
  });
  // Secondary view inside "more" tab (search, news, etf, chat)
  const [moreView, setMoreView] = useState(null);
  const setActiveTabPersist = (t) => { setActiveTab(t); localStorage.setItem(LS_TAB, t); };

  const [chartTicker, setChartTickerState] = useState(
    () => localStorage.getItem(LS_CHART_TICKER) || 'SPY'
  );

  const syncTimer = useRef(null);

  useEffect(() => {
    apiFetch('/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (s?.settings?.chartTicker && s.settings.chartTicker !== localStorage.getItem(LS_CHART_TICKER)) {
          setChartTickerState(s.settings.chartTicker);
          localStorage.setItem(LS_CHART_TICKER, s.settings.chartTicker);
        } else if (s?.chartTicker && s.chartTicker !== localStorage.getItem(LS_CHART_TICKER)) {
          setChartTickerState(s.chartTicker);
          localStorage.setItem(LS_CHART_TICKER, s.chartTicker);
        }
      })
      .catch(() => {});
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
      const arr = JSON.parse(localStorage.getItem(LS_CHART_GRID) || '["SPY","QQQ"]');
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
  const showOnboarding = settingsLoaded && !!user && settings && !settings.onboardingCompleted;

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

  // ── DESKTOP ──────────────────────────────────────────────────────────────
  if (!isMobile) {
    return (
      <DragProvider>
      <WatchlistProvider>
      <FeedStatusProvider status={feedStatus}>
      <MarketProvider restData={mergedData}>
      <PriceProvider marketData={data}>
      <div style={{
        display: 'flex', flexDirection: 'column', height: '100vh',
        background: '#0a0a0a',
        fontFamily: "'IBM Plex Mono','Roboto Mono','Courier New',monospace",
        overflowY: 'auto', overflowX: 'hidden',
        color: '#e0e0e0', userSelect: 'none',
      }}>

        {/* Onboarding overlay */}
        {showOnboarding && <OnboardingPresets />}

        {/* Header */}
        <div style={{ height: 36, flexShrink: 0, display:'flex', alignItems:'center', background:'var(--bg-app)', borderBottom:'2px solid var(--accent)', padding:'0 12px', gap:12, position: 'relative', zIndex: 10 }}>
          <span style={{ color:'var(--accent)', fontWeight:700, fontSize:'13px', letterSpacing:'2px' }}>SENGER</span>
          <span style={{ color:'var(--text-faint)', fontSize:'9px', letterSpacing:'1px' }}>MARKET TERMINAL</span>
          <div style={{ flex:1, display:'flex', justifyContent:'center' }}><WorldClock /></div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {isRefreshing && <span style={{ color:'var(--accent)', fontSize:'8px', letterSpacing:'1px' }}>&#9679; UPDATING</span>}
            {lastUpdated && !isRefreshing && <span style={{ color:'var(--text-faint)', fontSize:'8px' }}>SNAP {lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>}
            <button
              onClick={() => setLayoutEdit(s => !s)}
              title="Reorder panels"
              style={{ background: layoutEdit ? '#1a0800' : 'none', border:`1px solid ${layoutEdit ? 'var(--accent)' : 'var(--border-strong)'}`, color: layoutEdit ? 'var(--accent)' : 'var(--text-faint)', fontSize:9, padding:'2px 6px', cursor:'pointer', fontFamily:'inherit', borderRadius:'var(--radius-sm)', letterSpacing:'0.5px' }}
            >⇄ LAYOUT</button>
            {user
              ? <UserDropdown
                  user={user}
                  onSettings={() => setSettingsOpen(s => !s)}
                  onLogout={logout}
                  onBilling={openBillingPortal}
                  isPaid={subscription?.status === 'active'}
                />
              : <button onClick={() => setSettingsOpen(s => !s)} style={{ background:'none', border:'1px solid var(--border-strong)', color: settingsOpen ? 'var(--accent)' : 'var(--text-faint)', fontSize:9, padding:'2px 6px', cursor:'pointer', fontFamily:'inherit', borderRadius:'var(--radius-sm)', letterSpacing:'0.5px' }}>⚙ SETTINGS</button>
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
                  <div key={rowIdx} style={{ display: 'contents' }}>
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
      </WatchlistProvider>
      </DragProvider>
    );
  }

  // ── MOBILE ───────────────────────────────────────────────────────────────
  const handleMoreNavigate = useCallback((view) => {
    setMoreView(view);
  }, []);
  const handleMoreBack = useCallback(() => {
    setMoreView(null);
  }, []);

  return (
    <DragProvider>
    <WatchlistProvider>
    <FeedStatusProvider status={feedStatus}>
    <MarketProvider restData={mergedData}>
    <MarketTickBridge batchTicks={batchTicks} />
    <PriceProvider marketData={data}>
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100dvh',
      paddingTop: 'env(safe-area-inset-top)',
      background: '#060606',
      fontFamily: "'IBM Plex Mono','Roboto Mono','Courier New',monospace",
      color: '#e0e0e0', overflow: 'hidden',
    }}>

      {/* Onboarding overlay */}
      {showOnboarding && <OnboardingPresets />}

      {/* ── Mobile header ── */}
      <div style={{
        height: 44, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        background: '#000',
        borderBottom: '1px solid #141414',
        padding: '0 16px', gap: 10,
      }}>
        {/* Back button for secondary views */}
        {(activeTab === 'more' && moreView) ? (
          <button
            onClick={handleMoreBack}
            style={{
              background: 'none', border: 'none', color: '#ff6600',
              fontSize: 18, cursor: 'pointer', padding: '4px 8px 4px 0',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center',
            }}
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff6600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        ) : null}
        <span style={{ color: '#ff6600', fontWeight: 700, fontSize: 12, letterSpacing: '2.5px' }}>SENGER</span>
        {/* Feed status dot */}
        <div style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: Object.values(feedStatus).every(s => s === 'live') ? '#22c55e'
            : Object.values(feedStatus).some(s => s === 'live') ? '#f59e0b' : '#555',
        }} />
        <div style={{ flex: 1 }} />
        {/* Mini clock */}
        <MobileClockCompact />
      </div>

      {/* Settings drawer overlay */}
      {settingsOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.7)' }}>
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '85%', maxWidth: 340, background: '#0a0a0a', overflowY: 'auto' }}>
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
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, WebkitOverflowScrolling: 'touch' }}>

            {activeTab === 'markets' && (
              <HomePanelMobile
                onOpenDetail={goDetail}
                onSearchClick={() => { setActiveTabPersist('more'); setMoreView('search'); }}
              />
            )}

            {activeTab === 'charts' && (
              <ChartsPanelMobile onOpenDetail={goDetail} />
            )}

            {activeTab === 'watchlist' && (
              <WatchlistPanelMobile
                onOpenDetail={goDetail}
                onManage={() => { setActiveTabPersist('more'); setMoreView('search'); }}
              />
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

            {activeTab === 'more' && moreView === 'search' && (
              <SearchPanel onTickerSelect={goDetail} onOpenDetail={goDetail} />
            )}

            {activeTab === 'more' && moreView === 'news' && <NewsPanel />}

            {activeTab === 'more' && moreView === 'etf' && (
              <ETFPanel onOpenDetail={goDetail} />
            )}

            {activeTab === 'more' && moreView === 'chat' && <ChatPanel mobile />}
          </div>

          {/* ── Bottom tab bar ── */}
          <nav style={{
            display: 'flex', background: '#000',
            borderTop: '1px solid #1a1a1a',
            flexShrink: 0,
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}>
            {MOBILE_TABS.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (tab.id === 'more' && activeTab === 'more') {
                      // Tapping more again goes back to menu
                      setMoreView(null);
                    }
                    setActiveTabPersist(tab.id);
                    if (tab.id !== 'more') setMoreView(null);
                  }}
                  style={{
                    flex: 1, minHeight: 56,
                    padding: '6px 4px 8px',
                    background: isActive ? 'rgba(255,102,0,0.06)' : 'transparent',
                    color: isActive ? '#ff6600' : '#555',
                    border: 'none',
                    borderTop: isActive ? '2px solid #ff6600' : '2px solid transparent',
                    fontSize: 9, fontWeight: 600, letterSpacing: '0.02em',
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: 3,
                    WebkitTapHighlightColor: 'transparent',
                    touchAction: 'manipulation',
                    transition: 'color 0.15s, background 0.15s',
                  }}>
                  <TabIcon id={tab.id} active={isActive} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </>
      )}

      {/* ── Instrument Detail slide-up overlay ── */}
      {detailTicker && !subscriptionExpired && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1500,
          background: '#060606',
          display: 'flex', flexDirection: 'column',
          paddingTop: 'env(safe-area-inset-top)',
        }}>
          {/* Detail header with close button */}
          <div style={{
            height: 48, flexShrink: 0,
            display: 'flex', alignItems: 'center',
            background: '#000', borderBottom: '1px solid #141414',
            padding: '0 12px', gap: 10,
          }}>
            <button
              onClick={() => setDetailTicker(null)}
              style={{
                background: 'none', border: 'none', color: '#ff6600',
                fontSize: 11, cursor: 'pointer', padding: '8px 8px 8px 0',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
                letterSpacing: '0.05em',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff6600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>
            <div style={{ flex: 1 }} />
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
    </WatchlistProvider>
    </DragProvider>
  );
}

// ── Compact clock for mobile header ──
function MobileClockCompact() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const ny = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <span style={{ color: '#444', fontSize: 9, letterSpacing: '0.05em', fontVariantNumeric: 'tabular-nums' }}>
      NY {ny}
    </span>
  );
}
