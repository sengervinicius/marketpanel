import { useState, useEffect, useCallback, useRef } from 'react';
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
import {
  DefenceScreen, CommoditiesScreen, GlobalMacroScreen, FixedIncomeScreen,
  BrazilScreen, FxCryptoScreen, EnergyScreen, TechAIScreen,
} from '../screens';

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
    >
      <div className="app-resize-indicator-v" />
    </div>
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

// ── Panel registry — maps panelId → render function ───────────────────────────
export function makePanelRenderer(panelId, props) {
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
      return <AlertCenterPanel onOpenDetail={setDetailTicker} />;
    case 'screener':
      return <ScreenerPanel onOpenDetail={setDetailTicker} />;
    case 'macro':
      return <MacroPanel />;
    case 'leaderboard':
      return <LeaderboardPanel />;
    case 'game':
      return <GamePortfolioPanel onSelectSymbol={setDetailTicker} />;
    case 'referrals':
      return <ReferralPanel />;
    case 'calendar':
      return <CalendarPanel />;
    // ── Phase D1 sector screens ──────────────────────────
    case 'defenceScreen':
      return <DefenceScreen onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'commoditiesScreen':
      return <CommoditiesScreen onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'globalMacroScreen':
      return <GlobalMacroScreen onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'fixedIncomeScreen':
      return <FixedIncomeScreen onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'brazilScreen':
      return <BrazilScreen onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'fxCryptoScreen':
      return <FxCryptoScreen onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'energyScreen':
      return <EnergyScreen onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    case 'techAIScreen':
      return <TechAIScreen onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />;
    default:
      return <div className="app-panel-placeholder">Panel: {panelId}</div>;
  }
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
