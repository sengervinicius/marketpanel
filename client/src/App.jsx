import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useMarketData } from './hooks/useMarketData';
import { useWebSocket } from './hooks/useWebSocket';
import { useAuth } from './context/AuthContext';
import { PriceProvider } from './context/PriceContext';
import { FeedStatusProvider } from './context/FeedStatusContext';
import { WatchlistProvider } from './context/WatchlistContext';
import { MarketProvider, useMarketDispatch } from './context/MarketContext';
import { IndexPanel } from './components/panels/IndexPanel';
import { StockPanel } from './components/panels/StockPanel';
import { ForexPanel } from './components/panels/ForexPanel';
import { CommoditiesPanel } from './components/panels/CommoditiesPanel';
import { NewsPanel } from './components/panels/NewsPanel';
import { ChartPanel } from './components/panels/ChartPanel';
import { SentimentPanel } from './components/panels/SentimentPanel';
import { SearchPanel } from './components/panels/SearchPanel';
import { DICurvePanel } from './components/panels/DICurvePanel';
import BrazilPanel from './components/panels/BrazilPanel';
import GlobalIndicesPanel from './components/panels/GlobalIndicesPanel';
import WatchlistPanel from './components/panels/WatchlistPanel';
import { ChatPanel } from './components/panels/ChatPanel';
import HomePanelMobile from './components/panels/HomePanelMobile';
import { TickerTooltip } from './components/common/TickerTooltip';
import InstrumentDetail from './components/common/InstrumentDetail';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ── MarketTickBridge — dispatches live WS ticks into MarketContext reducer ────
// Must be rendered inside <MarketProvider> so it can call useMarketDispatch()
function MarketTickBridge({ batchTicks }) {
  const dispatch = useMarketDispatch();
  useEffect(() => {
    if (!batchTicks || batchTicks.length === 0) return;
    dispatch({ type: 'BATCH_TICK', payload: { ticks: batchTicks } });
  }, [batchTicks, dispatch]);
  return null;
}

// ── World Clock ────────────────────────────────────────────────────────────────────────────────
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
          <span style={{ color: '#555', fontSize: 9, letterSpacing: '0.06em', fontWeight: 600 }}>{z.label}</span>
          <span style={{ color: '#888', fontSize: 11, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.03em' }}>
            {now.toLocaleTimeString('en-US', { timeZone: z.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Row Resize Handle ────────────────────────────────────────────────────────────────────────────────
function ResizeHandle({ onStart }) {
  return (
    <div
      onMouseDown={e => { e.preventDefault(); onStart(e); }}
      style={{
        height: 6, flexShrink: 0, cursor: 'row-resize',
        background: '#0a0a0a',
        borderTop: '1px solid #1e1e1e', borderBottom: '1px solid #1e1e1e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        userSelect: 'none', zIndex: 20,
      }}
    >
      <div style={{ width: 36, height: 2, background: '#222', borderRadius: 1 }} />
    </div>
  );
}

// ── Column Resize Handle ────────────────────────────────────────────────────────────────────────────────
function ColResizeHandle({ onStart }) {
  return (
    <div
      onMouseDown={e => { e.preventDefault(); onStart(e); }}
      style={{
        width: 5, flexShrink: 0, cursor: 'col-resize',
        background: '#070707',
        borderLeft: '1px solid #1e1e1e', borderRight: '1px solid #1e1e1e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        userSelect: 'none', zIndex: 20,
      }}
    >
      <div style={{ width: 1, height: 24, background: '#252525', borderRadius: 1 }} />
    </div>
  );
}

// ── Resizable row-flex hook ──────────────────────────────────────────────────────────────────────────────
function useResizableFlex(storageKey, defaults) {
  const [sizes, setSizes] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey));
      return Array.isArray(s) && s.length === defaults.length ? s : defaults;
    } catch { return defaults; }
  });
  const sizesRef = useRef(sizes);
  useEffect(() => { sizesRef.current = sizes; }, [sizes]);
  const startResize = useCallback((idx, e) => {
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
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(sizes)); }, [sizes, storageKey]);
  return [sizes, startResize];
}

// ── Resizable column-flex hook ──────────────────────────────────────────────────────────────────────────────
function useResizableColumns(storageKey, defaults) {
  const [sizes, setSizes] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey));
      return Array.isArray(s) && s.length === defaults.length ? s : defaults;
    } catch { return defaults; }
  });
  const sizesRef = useRef(sizes);
  useEffect(() => { sizesRef.current = sizes; }, [sizes]);
  const startResize = useCallback((idx, e) => {
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
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(sizes)); }, [sizes, storageKey]);
  return [sizes, startResize];
}

// ── Settings Drawer ─────────────────────────────────────────────────────────────────────────────────────
const PANEL_DEFS = [
  { id: 'charts',      label: 'Chart Grid' },
  { id: 'usequity',   label: 'US Equities' },
  { id: 'forex',      label: 'Forex / Crypto' },
  { id: 'indices',    label: 'US Indices' },
  { id: 'brazil',     label: 'Brazil (B3)' },
  { id: 'global',     label: 'Global Indices' },
  { id: 'commodities',label: 'Commodities' },
  { id: 'watchlist',  label: 'Watchlist' },
  { id: 'curves',     label: 'Yield Curves' },
  { id: 'search',     label: 'Search' },
  { id: 'news',       label: 'News' },
  { id: 'sentiment',  label: 'Sentiment' },
];

function SettingsDrawer({ panelVisible, togglePanel, onClose }) {
  return (
    <div style={{
      position: 'absolute', top: 36, right: 0, zIndex: 1000,
      background: '#0d0d0d', border: '1px solid #2a2a2a', borderTop: 'none',
      width: 240, padding: '12px 0', boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
    }}>
      <div style={{ padding: '4px 12px 8px', borderBottom: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#ff6600', fontSize: 9, fontWeight: 700, letterSpacing: '1px' }}>PANEL VISIBILITY</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>
      </div>
      {PANEL_DEFS.map(({ id, label }) => {
        const visible = panelVisible[id] ?? true;
        return (
          <div key={id} onClick={() => togglePanel(id)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', cursor: 'pointer', borderBottom: '1px solid #141414' }}
            onMouseEnter={e => e.currentTarget.style.background = '#141414'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{ color: visible ? '#ccc' : '#444', fontSize: 9, letterSpacing: '0.5px' }}>{label}</span>
            <span style={{ color: visible ? '#00cc66' : '#333', fontSize: 9, fontWeight: 700 }}>
              {visible ? '● ON' : '○ OFF'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Feed Status Bar ─────────────────────────────────────────────────────────────────────────────────────
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
    return '#444'; // connecting
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

// ── Mobile tab definitions ──────────────────────────────────────────────────────────────────────────────
// 5 tabs: HOME, WATCHLIST, SEARCH, DETAIL, NEWS
const MOBILE_TABS = [
  { id: 'home',      label: 'HOME',   icon: '⌂' },
  { id: 'watchlist', label: 'WATCH',  icon: '☆' },
  { id: 'search',    label: 'FIND',   icon: '⊕' },
  { id: 'detail',    label: 'DETAIL', icon: '▦' },
  { id: 'news',      label: 'NEWS',   icon: '◎' },
];

const LS_TAB          = 'activeTab_m3'; // bumped to reset stale saved tab
const LS_CHART_TICKER = 'chartTicker';
const LS_CHART_GRID   = 'chartGrid_v3';

export default function App() {
  const { data, loading, isRefreshing, lastUpdated } = useMarketData();
  const { user } = useAuth();

  // ── Live WebSocket overlay (throttled at 250 ms) ──────────────────────────
  const [feedStatus, setFeedStatus] = useState({ stocks: 'connecting', forex: 'connecting', crypto: 'connecting' });
  const liveOverlayRef    = useRef({});  // { [symbol]: partial price obj } — updated every tick
  const tickBufferRef     = useRef([]);  // accumulate incoming ticks between flushes
  const throttleTimerRef  = useRef(null);
  const [liveTick, setLiveTick] = useState(0); // bump to trigger re-render after flush
  // batchTicks fed into MarketTickBridge → MarketContext reducer (BATCH_TICK)
  const [batchTicks, setBatchTicks] = useState([]);

  const handleWsMessage = useCallback((msg) => {
    // Status updates are immediate — don't throttle
    if (msg.type === 'status') {
      setFeedStatus(prev => ({ ...prev, [msg.feed]: msg.level }));
      return;
    }
    // Initial snapshot — merge into overlay immediately, one re-render
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
    // Live ticks — buffer and flush at 250 ms to avoid render flooding
    if (msg.type === 'tick' || msg.type === 'quote') {
      tickBufferRef.current.push(msg);
      if (!throttleTimerRef.current) {
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          const ticks = tickBufferRef.current.splice(0);
          if (ticks.length === 0) return;
          // Normalize ticks for MarketContext BATCH_TICK
          const normalizedTicks = [];
          ticks.forEach(t => {
            if (t.symbol && t.data) {
              liveOverlayRef.current[t.symbol] = { ...liveOverlayRef.current[t.symbol], ...t.data, _cat: t.category };
              normalizedTicks.push({ category: t.category, symbol: t.symbol, data: t.data });
            }
          });
          // Update both the old mergedData path AND MarketContext reducer
          setLiveTick(n => n + 1);
          if (normalizedTicks.length > 0) setBatchTicks(normalizedTicks);
        }, 250);
      }
    }
  }, []);

  useWebSocket(handleWsMessage);

  // Merge REST snapshot with WS live overlay — WS wins on matching symbols
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
    // indices mirrors stocks
    merged.indices = merged.stocks || {};
    return merged;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, liveTick]);

  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem(LS_TAB);
    return MOBILE_TABS.find(t => t.id === saved) ? saved : 'home';
  });
  const setActiveTabPersist = (t) => { setActiveTab(t); localStorage.setItem(LS_TAB, t); };

  const [chartTicker, setChartTickerState] = useState(
    () => localStorage.getItem(LS_CHART_TICKER) || 'SPY'
  );

  // ── Cross-device sync ────────────────────────────────────────────────────────────────────────────────
  const syncTimer = useRef(null);

  useEffect(() => {
    fetch(API_BASE + '/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (s?.chartTicker && s.chartTicker !== localStorage.getItem(LS_CHART_TICKER)) {
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
      fetch(API_BASE + '/api/settings', {
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

  const [rowSizes,  startRowResize]  = useResizableFlex('rowFlexSizes_v1',     [2, 1.5, 1.5]);
  const [colSizes1, startColResize1] = useResizableColumns('colFlexSizes_r1_v1', [2, 1, 1.6]);
  const [colSizes2, startColResize2] = useResizableColumns('colFlexSizes_r2_v1', [1, 1, 1, 1]);
  const [colSizes3, startColResize3] = useResizableColumns('colFlexSizes_r3_v1', [0.8, 0.8, 1.5, 0.9]);

  const border = '1px solid #1e1e1e';

  const [detailTicker, setDetailTicker] = useState(null);
  const [settingsOpen, setSettingsOpen]  = useState(false);

  // ── Panel visibility (settings drawer) ────────────────────────────────────
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

  // Mobile: tap any ticker → set detail ticker + navigate to DETAIL tab
  const goDetail = useCallback((t) => {
    const sym = typeof t === 'object' ? (t.symbol || t.ticker || t) : t;
    if (!sym) return;
    setDetailTicker(sym);
    setActiveTabPersist('detail');
  }, []);

  // ── DESKTOP ──────────────────────────────────────────────────────────────────────────────────────────────
  if (!isMobile) {
    return (
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
        {/* Header */}
        <div style={{ height: 36, flexShrink: 0, display:'flex', alignItems:'center', background:'#000', borderBottom:'2px solid #ff6600', padding:'0 12px', gap:12 }}>
          <span style={{ color:'#ff6600', fontWeight:700, fontSize:'13px', letterSpacing:'2px' }}>SENGER</span>
          <span style={{ color:'#444', fontSize:'9px', letterSpacing:'1px' }}>MARKET SCREEN</span>
          <div style={{ flex:1, display:'flex', justifyContent:'center' }}><WorldClock /></div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {isRefreshing && <span style={{ color:'#ff6600', fontSize:'8px', letterSpacing:'1px' }}>&#9679; UPDATING</span>}
            {lastUpdated && !isRefreshing && <span style={{ color:'#333', fontSize:'8px' }}>SNAP {lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>}
            <button
              onClick={() => setSettingsOpen(s => !s)}
              title="Settings"
              style={{ background:'none', border:'1px solid #282828', color: settingsOpen ? '#ff6600' : '#444', fontSize:9, padding:'2px 6px', cursor:'pointer', fontFamily:'inherit', borderRadius:2, letterSpacing:'0.5px' }}
            >⚙ PANELS</button>
          </div>
        </div>

        {/* Settings drawer */}
        {settingsOpen && <SettingsDrawer panelVisible={panelVisible} togglePanel={togglePanel} onClose={() => setSettingsOpen(false)} />}

        <MarketTickBridge batchTicks={batchTicks} />

        {/* Row 1: Charts | Stocks | Forex+Crypto */}
        <div style={{ flex: rowSizes[0], flexShrink: 0, display:'flex', overflow:'hidden', minHeight: 220 }}>
          {isPanelVisible('charts') && (<>
          <div style={{ flex: colSizes1[0], minWidth: 0, borderRight:border, overflow:'hidden', height:'100%' }}>
            <ChartPanel ticker={chartTicker} onTickerChange={setChartTicker} onGridChange={setChartGridCount} onOpenDetail={setDetailTicker} />
          </div>
          <ColResizeHandle onStart={e => startColResize1(0, e)} />
          </>)}
          {isPanelVisible('usequity') && (<>
          <div style={{ flex: colSizes1[1], minWidth: 0, borderRight:border, overflow:'hidden', height:'100%' }}>
            <StockPanel data={mergedData?.stocks} loading={loading} onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />
          </div>
          <ColResizeHandle onStart={e => startColResize1(1, e)} />
          </>)}
          {isPanelVisible('forex') && (
          <div style={{ flex: colSizes1[2], minWidth: 0, overflow:'hidden', height:'100%' }}>
            <ForexPanel data={mergedData?.forex} cryptoData={mergedData?.crypto} loading={loading} onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />
          </div>
          )}
        </div>

        <ResizeHandle onStart={e => startRowResize(0, e)} />

        {/* Row 2: US Indices | Brazil | Global Indexes | Commodities */}
        <div style={{ flex: rowSizes[1], flexShrink: 0, display:'flex', overflow:'hidden', minHeight: 180 }}>
          {isPanelVisible('indices') && (<>
          <div style={{ flex: colSizes2[0], minWidth: 0, borderRight:border, overflow:'hidden', height:'100%' }}>
            <IndexPanel data={mergedData?.indices} loading={loading} onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />
          </div>
          <ColResizeHandle onStart={e => startColResize2(0, e)} />
          </>)}
          {isPanelVisible('brazil') && (<>
          <div style={{ flex: colSizes2[1], minWidth: 0, borderRight:border, overflow:'hidden', height:'100%' }}>
            <BrazilPanel onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />
          </div>
          <ColResizeHandle onStart={e => startColResize2(1, e)} />
          </>)}
          {isPanelVisible('global') && (<>
          <div style={{ flex: colSizes2[2], minWidth: 0, borderRight:border, overflow:'hidden', height:'100%' }}>
            <GlobalIndicesPanel onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />
          </div>
          <ColResizeHandle onStart={e => startColResize2(2, e)} />
          </>)}
          {isPanelVisible('commodities') && (
          <div style={{ flex: colSizes2[3], minWidth: 0, overflow:'hidden', height:'100%' }}>
            <CommoditiesPanel data={mergedData?.stocks} loading={loading} onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />
          </div>
          )}
        </div>

        <ResizeHandle onStart={e => startRowResize(1, e)} />

        {/* Row 3: Yield Curves | Search | News | Sentiment | Watchlist */}
        <div style={{ flex: rowSizes[2], flexShrink: 0, display:'flex', overflow:'hidden', minHeight: 160 }}>
          {isPanelVisible('curves') && (<>
          <div style={{ flex: colSizes3[0], minWidth: 0, borderRight:border, overflow:'hidden', height:'100%' }}>
            <DICurvePanel compact />
          </div>
          <ColResizeHandle onStart={e => startColResize3(0, e)} />
          </>)}
          {isPanelVisible('search') && (<>
          <div style={{ flex: colSizes3[1], minWidth: 0, borderRight:border, overflow:'hidden', height:'100%' }}>
            <SearchPanel onTickerSelect={setChartTicker} onOpenDetail={setDetailTicker} />
          </div>
          <ColResizeHandle onStart={e => startColResize3(1, e)} />
          </>)}
          {isPanelVisible('news') && (<>
          <div style={{ flex: colSizes3[2], minWidth: 0, borderRight:border, overflow:'hidden', height:'100%' }}>
            <NewsPanel />
          </div>
          <ColResizeHandle onStart={e => startColResize3(2, e)} />
          </>)}
          {isPanelVisible('sentiment') && (<>
          <div style={{ flex: colSizes3[3], minWidth: 0, borderRight:border, overflow:'hidden', height:'100%' }}>
            <SentimentPanel data={mergedData} loading={loading} />
          </div>
          <ColResizeHandle onStart={e => startColResize3(2, e)} />
          </>)}
          {isPanelVisible('watchlist') && (
          <div style={{ flex: 0.6, minWidth: 0, overflow:'hidden', height:'100%' }}>
            <WatchlistPanel onTickerClick={setChartTicker} onOpenDetail={setDetailTicker} />
          </div>
          )}
          {isPanelVisible('chat') && (
          <div style={{ flex: 0.5, minWidth: 0, borderLeft:border, overflow:'hidden', height:'100%' }}>
            <ChatPanel user={user} />
          </div>
          )}
        </div>

        <FeedStatusBar feedStatus={feedStatus} />
        {detailTicker && <InstrumentDetail ticker={detailTicker} onClose={() => setDetailTicker(null)} />}
      <TickerTooltip onOpenDetail={setDetailTicker} />
      </div>
      </PriceProvider>
      </MarketProvider>
      </FeedStatusProvider>
      </WatchlistProvider>
    );
  }

  // ── MOBILE ────────────────────────────────────────────────────────────────────────────────────────────────
  return (
    <WatchlistProvider>
    <FeedStatusProvider status={feedStatus}>
    <MarketProvider restData={mergedData}>
    <MarketTickBridge batchTicks={batchTicks} />
    <PriceProvider marketData={data}>
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100dvh',
      paddingTop: 'env(safe-area-inset-top)',
      background: '#0a0a0a',
      fontFamily: "'IBM Plex Mono','Roboto Mono','Courier New',monospace",
      color: '#e0e0e0', overflow: 'hidden',
    }}>

      {/* ── Tab content area ── */}
      <div style={{ flex:1, overflowY:'auto', overflowX:'hidden', minHeight:0, WebkitOverflowScrolling:'touch' }}>

        {/* HOME — market overview dashboard */}
        {activeTab === 'home' && (
          <HomePanelMobile onOpenDetail={goDetail} />
        )}

        {/* WATCHLIST — user's saved instruments */}
        {activeTab === 'watchlist' && (
          <WatchlistPanel onTickerClick={goDetail} onOpenDetail={goDetail} />
        )}

        {/* SEARCH — discover and add instruments */}
        {activeTab === 'search' && (
          <SearchPanel onTickerSelect={goDetail} onOpenDetail={goDetail} />
        )}

        {/* DETAIL — full instrument view (inline page, not overlay) */}
        {activeTab === 'detail' && (
          detailTicker
            ? <InstrumentDetail
                ticker={detailTicker}
                onClose={() => setActiveTabPersist('home')}
                asPage
              />
            : <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:12 }}>
                <div style={{ color:'#2a2a2a', fontSize:32 }}>▦</div>
                <div style={{ color:'#333', fontSize:10, letterSpacing:'1px' }}>TAP ANY INSTRUMENT TO VIEW DETAILS</div>
                <button
                  onClick={() => setActiveTabPersist('watchlist')}
                  style={{ marginTop:8, background:'none', border:'1px solid #2a2a2a', color:'#555', fontSize:9, padding:'6px 14px', cursor:'pointer', fontFamily:'inherit', borderRadius:2 }}
                >OPEN WATCHLIST →</button>
              </div>
        )}

        {/* NEWS */}
        {activeTab === 'news' && <NewsPanel />}
      </div>

      {/* ── Bottom tab bar ── */}
      <nav style={{
        display: 'flex', background: '#000',
        borderTop: '2px solid #1e1e1e',
        flexShrink: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {MOBILE_TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const showBadge = tab.id === 'detail' && !!detailTicker;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTabPersist(tab.id)}
              style={{
                flex: 1, minHeight: '54px',
                padding: '8px 4px 6px',
                background: isActive ? '#140800' : 'transparent',
                color: isActive ? '#ff6600' : '#444',
                border: 'none',
                borderTop: '2px solid ' + (isActive ? '#ff6600' : 'transparent'),
                fontSize: '7.5px', fontWeight: 800, letterSpacing: '0.3px',
                cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                position: 'relative',
              }}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>{tab.icon}</span>
              {tab.label}
              {showBadge && (
                <span style={{
                  position: 'absolute', top: 6, right: '50%', transform: 'translateX(8px)',
                  width: 6, height: 6, borderRadius: '50%', background: '#ff6600',
                }} />
              )}
            </button>
          );
        })}
      </nav>
      {/* No overlay InstrumentDetail on mobile — it renders inline in the DETAIL tab */}
      <TickerTooltip onOpenDetail={goDetail} />
    </div>
    </PriceProvider>
    </MarketProvider>
    </FeedStatusProvider>
    </WatchlistProvider>
  );
}
