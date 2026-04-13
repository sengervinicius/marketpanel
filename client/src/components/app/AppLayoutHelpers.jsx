import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useMarketDispatch } from '../../context/MarketContext';
import { PANEL_DEFINITIONS } from '../../config/panels';
import { ChartPanel } from '../panels/ChartPanel';
import { StockPanel } from '../panels/StockPanel';
import { ForexPanel } from '../panels/ForexPanel';
import GlobalIndicesPanel from '../panels/GlobalIndicesPanel';
import BrazilPanel from '../panels/BrazilPanel';
import { CommoditiesPanel } from '../panels/CommoditiesPanel';
import { CryptoPanel } from '../panels/CryptoPanel';
import DebtPanel from '../panels/DebtPanel';
import { SearchPanel } from '../panels/SearchPanel';
import { NewsPanel } from '../panels/NewsPanel';
import PortfolioPanel from '../panels/PortfolioPanel';
import WatchlistPanel from '../panels/WatchlistPanel';
import { SentimentPanel } from '../panels/SentimentPanel';
import { ChatPanel } from '../panels/ChatPanel';
import { DICurvePanel } from '../panels/DICurvePanel';
import { IndexPanel } from '../panels/IndexPanel';
import AlertCenterPanel from '../panels/AlertCenterPanel';
import ScreenerPanel from '../panels/ScreenerPanel';
import MacroPanel from '../panels/MacroPanel';
import LeaderboardPanel from '../panels/LeaderboardPanel';
import GamePortfolioPanel from '../panels/GamePortfolioPanel';
import ReferralPanel from '../common/ReferralPanel';
import { CalendarPanel } from '../panels/CalendarPanel';
import ETFPanel from '../panels/ETFPanel';
import MissionsPanel from '../panels/MissionsPanel';
import RatesPanel from '../panels/RatesPanel';
import HeatmapPanel from '../panels/HeatmapPanel';
import PredictionPanel from '../panels/PredictionPanel';
import WirePanel from '../panels/WirePanel';

// ── Code-split sector screens using React.lazy ──────────────────────────────
const DefenceScreen = lazy(() => import('../screens/DefenceScreen'));
const CommoditiesScreen = lazy(() => import('../screens/CommoditiesScreen'));
const GlobalMacroScreen = lazy(() => import('../screens/GlobalMacroScreen'));
const FixedIncomeScreen = lazy(() => import('../screens/FixedIncomeScreen'));
const BrazilScreen = lazy(() => import('../screens/BrazilScreen'));
const FxCryptoScreen = lazy(() => import('../screens/FxCryptoScreen'));
const EnergyScreen = lazy(() => import('../screens/EnergyScreen'));
const TechAIScreen = lazy(() => import('../screens/TechAIScreen'));

// ── MarketTickBridge — dispatches live WS ticks into MarketContext reducer ────
export function MarketTickBridge({ batchTicks }) {
  const dispatch = useMarketDispatch();
  useEffect(() => {
    if (!batchTicks || batchTicks.length === 0) return;
    dispatch({ type: 'BATCH_TICK', payload: { ticks: batchTicks } });
  }, [batchTicks, dispatch]);
  return null;
}

// ── World Clock ──────────────────────────────────────────────────────────────
export function WorldClock() {
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
export function ResizeHandle({ onStart }) {
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
export function ColResizeHandle({ onStart }) {
  return (
    <div
      onMouseDown={e => { e.preventDefault(); onStart(e); }}
      className="app-resize-handle-vertical"
    />
  );
}

// ── Layout Move Overlay ──────────────────────────────────────────────────────
// Shown over each panel when layout-edit mode is active
// Displays directional movement buttons and the panel name
export function LayoutMoveOverlay({ panelId, rowIdx, colIdx, rowLen, totalRows, onMove }) {
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

// ── Panel registry — data-driven map from panelId → component + prop resolver ─
// Each entry: { component, getProps?, mobileComponent? }
// getProps receives the shared panel context and returns the props for the component.
// If getProps is omitted, the component receives no props.
//
// mobileComponent (S2.D): optional reference to the mobile-specific variant.
// When present, a future S3 merge can unify desktop/mobile rendering by checking
// isMobile and picking the appropriate component automatically.
// Current mobile variants (rendered directly in App.jsx mobile section):
//   charts   → ChartsPanelMobile    (601 lines — separate chart grid UX)
//   watchlist → PortfolioMobile      (451 lines — simplified positions view)
//   home     → HomePanelMobile      (358 lines — mobile-only home screen)
//   watchlistMobile → WatchlistPanelMobile (291 lines — mobile watchlist)
//   alerts   → AlertsMobile          (compact alert list)
const PANEL_REGISTRY = {
  // ── Core panels ──────────────────────────────────────────────────────────
  charts:         { component: ChartPanel,         getProps: (c) => ({ ticker: c.chartTicker, onTickerChange: c.setChartTicker, onGridChange: c.setChartGridCount }), hasMobileVariant: true },
  usEquities:     { component: StockPanel,         getProps: (c) => ({ data: c.mergedData?.stocks, loading: c.loading, onTickerClick: c.setChartTicker }) },
  forex:          { component: ForexPanel,         getProps: (c) => ({ data: c.mergedData?.forex, cryptoData: c.mergedData?.crypto, loading: c.loading, onTickerClick: c.setChartTicker }) },
  globalIndices:  { component: GlobalIndicesPanel,  getProps: (c) => ({ data: c.mergedData?.stocks, loading: c.loading, onTickerClick: c.setChartTicker }) },
  brazilB3:       { component: BrazilPanel,         getProps: (c) => ({ onTickerClick: c.setChartTicker }) },
  commodities:    { component: CommoditiesPanel,    getProps: (c) => ({ data: c.mergedData?.stocks, loading: c.loading, onTickerClick: c.setChartTicker }) },
  crypto:         { component: CryptoPanel,         getProps: (c) => ({ data: c.mergedData?.crypto, loading: c.loading, onTickerClick: c.setChartTicker }) },
  indices:        { component: IndexPanel,          getProps: (c) => ({ data: c.mergedData?.indices, loading: c.loading, onTickerClick: c.setChartTicker }) },
  search:         { component: SearchPanel,         getProps: (c) => ({ onTickerSelect: c.setChartTicker }) },
  watchlist:      { component: WatchlistPanel,       getProps: (c) => ({ onTickerClick: c.setChartTicker }), hasMobileVariant: true },
  portfolio:      { component: PortfolioPanel,      getProps: (c) => ({ onTickerClick: c.setChartTicker }), hasMobileVariant: true },
  curves:         { component: DICurvePanel,        getProps: () => ({ compact: true }) },

  // ── No-prop panels ───────────────────────────────────────────────────────
  debt:           { component: DebtPanel },
  news:           { component: NewsPanel },
  sentiment:      { component: SentimentPanel },
  chat:           { component: ChatPanel },
  alerts:         { component: AlertCenterPanel, hasMobileVariant: true },
  screener:       { component: ScreenerPanel },
  macro:          { component: MacroPanel },
  leaderboard:    { component: LeaderboardPanel },
  game:           { component: GamePortfolioPanel },
  etf:            { component: ETFPanel },
  missions:       { component: MissionsPanel },
  rates:          { component: RatesPanel },
  referrals:      { component: ReferralPanel },
  calendar:       { component: CalendarPanel },
  heatmap:        { component: HeatmapPanel },
  predictions:    { component: PredictionPanel },
  wire:           { component: WirePanel },

  // ── Phase D1 sector screens ──────────────────────────────────────────────
  defenceScreen:      { component: DefenceScreen,      getProps: (c) => ({ onTickerClick: c.setChartTicker }) },
  commoditiesScreen:  { component: CommoditiesScreen,  getProps: (c) => ({ onTickerClick: c.setChartTicker }) },
  globalMacroScreen:  { component: GlobalMacroScreen,  getProps: (c) => ({ onTickerClick: c.setChartTicker }) },
  fixedIncomeScreen:  { component: FixedIncomeScreen,  getProps: (c) => ({ onTickerClick: c.setChartTicker }) },
  brazilScreen:       { component: BrazilScreen,       getProps: (c) => ({ onTickerClick: c.setChartTicker }) },
  fxCryptoScreen:     { component: FxCryptoScreen,     getProps: (c) => ({ onTickerClick: c.setChartTicker }) },
  energyScreen:       { component: EnergyScreen,       getProps: (c) => ({ onTickerClick: c.setChartTicker }) },
  techAIScreen:       { component: TechAIScreen,       getProps: (c) => ({ onTickerClick: c.setChartTicker }) },
};

export { PANEL_REGISTRY };

// ── Identify sector screen panels for Suspense wrapping ───────────────────────
const SCREEN_PANEL_IDS = new Set([
  'defenceScreen', 'commoditiesScreen', 'globalMacroScreen', 'fixedIncomeScreen',
  'brazilScreen', 'fxCryptoScreen', 'energyScreen', 'techAIScreen',
]);

/**
 * makePanelRenderer — resolves a panelId to its React element.
 * Looks up the component and prop-resolver from PANEL_REGISTRY.
 * Wraps lazy-loaded sector screens in Suspense for code-splitting.
 */
export function makePanelRenderer(panelId, ctx) {
  const entry = PANEL_REGISTRY[panelId];
  if (!entry) return <div className="app-panel-placeholder">Panel: {panelId}</div>;
  const { component: Comp, getProps } = entry;
  const panelProps = getProps ? getProps(ctx) : {};

  if (SCREEN_PANEL_IDS.has(panelId)) {
    return (
      <Suspense fallback={<div className="screen-loading">Loading...</div>}>
        <Comp {...panelProps} />
      </Suspense>
    );
  }
  return <Comp {...panelProps} />;
}

// ── Resizable row-flex hook ──────────────────────────────────────────────────
// Supports drag to resize and double-click to reset to equal distribution
export function useResizableFlex(storageKey, defaults) {
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
export function useResizableColumns(storageKey, defaults) {
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
