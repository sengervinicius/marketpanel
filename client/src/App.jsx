import { useState, useEffect, useCallback, useRef } from 'react';
import { useMarketData } from './hooks/useMarketData';
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
import { TickerTooltip } from './components/common/TickerTooltip';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ── World Clock ─────────────────────────────────────────────────────────────────
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

// ── Resize Handle ──────────────────────────────────────────────────────────────
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

// ── Resizable flex-row hook ────────────────────────────────────────────────────
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
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(sizes));
  }, [sizes, storageKey]);

  return [sizes, startResize];
}

// ── Mobile tab definitions ─────────────────────────────────────────────────────
const MOBILE_TABS = [
  { id: 'charts',   label: 'CHARTS' },
  { id: 'usequity', label: 'US EQ' },
  { id: 'brazil',   label: 'BRAZIL' },
  { id: 'fxcrypto', label: 'FX/₿' },
  { id: 'global',   label: 'GLOBAL' },
  { id: 'rates',    label: 'CURVES' },
  { id: 'news',     label: 'NEWS' },
];

const LS_TAB          = 'activeTab_m2';
const LS_CHART_TICKER = 'chartTicker';
const LS_CHART_GRID   = 'chartGrid_v3';

export default function App() {
  const { data, loading, isRefreshing, lastUpdated } = useMarketData();

  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem(LS_TAB);
    return MOBILE_TABS.find(t => t.id === saved) ? saved : 'charts';
  });
  const setActiveTabPersist = (t) => { setActiveTab(t); localStorage.setItem(LS_TAB, t); };

  const [chartTicker, setChartTickerState] = useState(
    () => localStorage.getItem(LS_CHART_TICKER) || 'SPY'
  );

  // ── Cross-device sync ────────────────────────────────────────────────────────
  const syncTimer = useRef(null);

  // Load settings from server on first mount
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
    // Debounced save to server for cross-device sync
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

  const [rowSizes, startRowResize] = useResizableFlex('rowFlexSizes_v1', [2, 1.5, 1.5]);

  const border = '1px solid #1e1e1e';

  const goChart = useCallback((t) => {
    const sym = typeof t === 'object' ? (t.symbol || t) : t;
    setChartTicker(sym);
    setActiveTabPersist('charts');
  }, [setChartTicker]);

  // ── DESKTOP ──────────────────────────────────────────────────────────────────
  if (!isMobile) {
    return (
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
            {isRefreshing && <span style={{ color:'#ff6600', fontSize:'8px', letterSpacing:'1px' }}>● UPDATING</span>}
            {lastUpdated && !isRefreshing && <span style={{ color:'#333', fontSize:'8px' }}>⟳ {lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>}
          </div>
        </div>

        {/* Row 1: Charts | Stocks | Forex+Crypto */}
        <div style={{ flex: rowSizes[0], flexShrink: 0, display:'grid', gridTemplateColumns:'2fr 1fr 1.6fr', overflow:'hidden', minHeight: 220 }}>
          <div style={{ borderRight:border, overflow:'hidden', height:'100%' }}>
            <ChartPanel ticker={chartTicker} onTickerChange={setChartTicker} onGridChange={setChartGridCount} />
          </div>
          <div style={{ borderRight:border, overflow:'hidden', height:'100%' }}>
            <StockPanel data={data?.stocks} loading={loading} onTickerClick={setChartTicker} />
          </div>
          <div style={{ overflow:'hidden', height:'100%' }}>
            <ForexPanel data={data?.forex} cryptoData={data?.crypto} loading={loading} onTickerClick={setChartTicker} />
          </div>
        </div>

        <ResizeHandle onStart={e => startRowResize(0, e)} />

        {/* Row 2: US Indices | Brazil | Global Indexes | Commodities */}
        <div style={{ flex: rowSizes[1], flexShrink: 0, display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', overflow:'hidden', minHeight: 180 }}>
          <div style={{ borderRight:border, overflow:'hidden', height:'100%' }}><IndexPanel data={data?.indices} loading={loading} onTickerClick={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden', height:'100%' }}><BrazilPanel onTickerClick={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden', height:'100%' }}><GlobalIndicesPanel onTickerClick={setChartTicker} /></div>
          <div style={{ overflow:'hidden', height:'100%' }}><CommoditiesPanel data={data?.stocks} loading={loading} onTickerClick={setChartTicker} /></div>
        </div>

        <ResizeHandle onStart={e => startRowResize(1, e)} />

        {/* Row 3: Yield Curves | Search | News | Sentiment */}
        <div style={{ flex: rowSizes[2], flexShrink: 0, display:'grid', gridTemplateColumns:'320px 1fr 1.5fr 1fr', overflow:'hidden', minHeight: 160 }}>
          <div style={{ borderRight:border, overflow:'hidden', height:'100%' }}><DICurvePanel compact /></div>
          <div style={{ borderRight:border, overflow:'hidden', height:'100%' }}><SearchPanel onTickerSelect={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden', height:'100%' }}><NewsPanel /></div>
          <div style={{ overflow:'hidden', height:'100%' }}><SentimentPanel data={data} loading={loading} /></div>
        </div>

        {/* Global right-click ticker info tooltip */}
        <TickerTooltip />
      </div>
    );
  }

  // ── MOBILE ────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100dvh',
      paddingTop: 'env(safe-area-inset-top)',
      background: '#0a0a0a',
      fontFamily: "'IBM Plex Mono','Roboto Mono','Courier New',monospace",
      color: '#e0e0e0', overflow: 'hidden',
    }}>
      <div style={{ background: '#000', borderBottom: '3px solid #ff6600', padding: '0 12px', height: '44px', display: 'flex', alignItems: 'center', flexShrink: 0, gap: 8 }}>
        <span style={{ color:'#ff6600', fontWeight:800, fontSize:'13px', letterSpacing:'2px' }}>SENGER</span>
        <span style={{ color:'#555', fontSize:'9px', letterSpacing:'1px' }}>MARKET</span>
        {isRefreshing
          ? <span style={{ color:'#ff6600', fontSize:'8px', marginLeft:4 }}>● LIVE</span>
          : lastUpdated && <span style={{ color:'#333', fontSize:'8px', marginLeft:'auto' }}>⟳ {lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
        }
      </div>

      <div style={{ flex:1, overflowY:'auto', overflowX:'hidden', minHeight:0, WebkitOverflowScrolling:'touch' }}>
        {activeTab === 'charts' && (
          <ChartPanel ticker={chartTicker} onTickerChange={setChartTicker} onGridChange={setChartGridCount} mobile={true} />
        )}
        {activeTab === 'usequity' && (
          <StockPanel data={data?.stocks} loading={loading} onTickerClick={t => goChart(t)} />
        )}
        {activeTab === 'brazil' && (
          <BrazilPanel onTickerClick={t => goChart(t)} />
        )}
        {activeTab === 'fxcrypto' && (
          <div>
            <ForexPanel data={data?.forex} cryptoData={data?.crypto} loading={loading} onTickerClick={setChartTicker} />
            <div style={{ borderTop:'1px solid #1e1e1e' }}>
              <CommoditiesPanel data={data?.stocks} loading={loading} onTickerClick={setChartTicker} />
            </div>
          </div>
        )}
        {activeTab === 'global' && (
          <div>
            <GlobalIndicesPanel onTickerClick={t => goChart(t)} />
            <div style={{ borderTop:'1px solid #1e1e1e' }}>
              <IndexPanel data={data?.indices} loading={loading} onTickerClick={t => goChart(t)} />
            </div>
          </div>
        )}
        {activeTab === 'rates' && <DICurvePanel />}
        {activeTab === 'news' && <NewsPanel />}
      </div>

      <nav style={{
        display: 'flex', background: '#000',
        borderTop: '2px solid #1e1e1e',
        flexShrink: 0, overflowX: 'auto',
        scrollbarWidth: 'none',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {MOBILE_TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTabPersist(tab.id)}
              style={{
                flex: '1 0 auto', minWidth: '44px', minHeight: '52px',
                padding: '8px 4px 6px',
                background: isActive ? '#1a0900' : 'transparent',
                color: isActive ? '#ff6600' : '#444',
                border: 'none',
                borderTop: '3px solid ' + (isActive ? '#ff6600' : 'transparent'),
                fontSize: '8px', fontWeight: 800, letterSpacing: '0.3px',
                cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase',
              }}>
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
