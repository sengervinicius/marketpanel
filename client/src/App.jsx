import { useState, useEffect, useCallback } from 'react';
import { useMarketData } from './hooks/useMarketData';
import { Header } from './components/Header';
import { IndexPanel } from './components/panels/IndexPanel';
import { StockPanel } from './components/panels/StockPanel';
import { ForexPanel } from './components/panels/ForexPanel';
import { CryptoPanel } from './components/panels/CryptoPanel';
import { CommoditiesPanel } from './components/panels/CommoditiesPanel';
import { NewsPanel } from './components/panels/NewsPanel';
import { ChartPanel } from './components/panels/ChartPanel';
import { SentimentPanel } from './components/panels/SentimentPanel';
import { SearchPanel } from './components/panels/SearchPanel';
import { RatesPanel } from './components/panels/RatesPanel';
import BrazilPanel from './components/panels/BrazilPanel';
import GlobalIndicesPanel from './components/panels/GlobalIndicesPanel';
import './App.css';

// World clock: NY · SP · LDN · FRA · HKG · TKY shown in header
function WorldClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const zones = [
    { label: 'NY',  tz: 'America/New_York'    },
    { label: 'SP',  tz: 'America/Sao_Paulo'   },
    { label: 'LDN', tz: 'Europe/London'       },
    { label: 'FRA', tz: 'Europe/Berlin'       },
    { label: 'HKG', tz: 'Asia/Hong_Kong'      },
    { label: 'TKY', tz: 'Asia/Tokyo'          },
  ];
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      {zones.map(z => (
        <span key={z.label} style={{ display: 'flex', gap: 3, alignItems: 'baseline' }}>
          <span style={{ color: '#444', fontSize: 7, letterSpacing: '0.05em' }}>{z.label}</span>
          <span style={{ color: '#666', fontSize: 8, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>
            {now.toLocaleTimeString('en-US', { timeZone: z.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </span>
        </span>
      ))}
    </div>
  );
}

const TABS = [
  { id: 'markets', label: 'MARKETS' },
  { id: 'brazil',  label: 'BRAZIL'  },
  { id: 'global',  label: 'GLOBAL'  },
  { id: 'fxcrypto',label: 'FX/CRYPTO'},
  { id: 'rates',   label: 'RATES'   },
  { id: 'search',  label: 'SEARCH'  },
  { id: 'news',    label: 'NEWS'    },
];

const LS_TAB          = 'activeTab';
const LS_CHART_TICKER = 'chartTicker';

export default function App() {hh
  const { data, loading, isRefreshing, lastUpdated } = useMarketData();
  const [activeTab, setActiveTab]   = useState(() => localStorage.getItem(LS_TAB) || 'markets');
  const setActiveTabPersist = (t) => { setActiveTab(t); localStorage.setItem(LS_TAB, t); };
  const [chartTicker, setChartTickerState] = useState(() => localStorage.getItem(LS_CHART_TICKER) || 'SPY');
  const setChartTicker = useCallback((t) => { setChartTickerState(t); localStorage.setItem(LS_CHART_TICKER, t); }, []);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const border  = '1px solid #1e1e1e';
  const border2 = '2px solid #1e1e1e';

  // ── DESKTOP ──────────────────────────────────────────────────────────────────
  if (!isMobile) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateRows: '36px 2fr 1.5fr 1.5fr',
        height: '100vh',
        background: '#0a0a0a',
        fontFamily: "'IBM Plex Mono','Roboto Mono','Courier New',monospace",
        overflow: 'hidden',
        color: '#e0e0e0',
      }}>

        {/* ── Header row ── */}
        <div style={{ display:'flex', alignItems:'center', background:'#000', borderBottom:'2px solid #ff6600', padding:'0 12px', gap:12 }}>
          <span style={{ color:'#ff6600', fontWeight:700, fontSize:'13px', letterSpacing:'2px' }}>SENGER</span>
          <span style={{ color:'#444', fontSize:'9px', letterSpacing:'1px' }}>MARKET SCREEN</span>
          {/* World clocks centred in header */}
          <div style={{ flex:1, display:'flex', justifyContent:'center' }}>
            <WorldClock />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {isRefreshing && <span style={{ color:'#ff6600', fontSize:'8px', letterSpacing:'1px' }}>● UPDATING</span>}
            {lastUpdated && !isRefreshing && <span style={{ color:'#333', fontSize:'8px' }}>⟳ {lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>}
          </div>
        </div>

        {/* ── Row 2: Charts | Stocks | Crypto | Forex ── */}
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', borderBottom:border2, overflow:'hidden' }}>
          <div style={{ borderRight:border, overflow:'hidden' }}><ChartPanel ticker={chartTicker} onTickerChange={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><StockPanel  data={data?.stocks} loading={loading} onTickerClick={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><CryptoPanel data={data?.crypto} loading={loading} onTickerClick={setChartTicker} /></div>
          <div style={{ overflow:'hidden' }}><ForexPanel data={data?.forex} loading={loading} onTickerClick={setChartTicker} /></div>
        </div>

        {/* ── Row 3: Indexes | Brazil | Global Indices | Commodities ── */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', borderBottom:border2, overflow:'hidden' }}>
          <div style={{ borderRight:border, overflow:'hidden' }}><IndexPanel data={data?.indices} loading={loading} onTickerClick={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><BrazilPanel onTickerClick={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><GlobalIndicesPanel onTickerClick={setChartTicker} /></div>
          <div style={{ overflow:'hidden' }}><CommoditiesPanel data={data?.stocks} loading={loading} onTickerClick={setChartTicker} /></div>
        </div>

        {/* ── Row 4: Rates | Search | News | Sentiment ── */}
        <div style={{ display:'grid', gridTemplateColumns:'180px 1fr 2fr 1fr', overflow:'hidden' }}>
          <div style={{ borderRight:border, overflow:'hidden' }}><RatesPanel /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><SearchPanel onTickerSelect={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><NewsPanel /></div>
          <div style={{ overflow:'hidden' }}><SentimentPanel data={data} loading={loading} /></div>
        </div>

      </div>
    );
  }

  // ── MOBILE ───────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100dvh', paddingTop: 'env(safe-area-inset-top)',
      background: '#0a0a0a',
      fontFamily: "'IBM Plex Mono','Roboto Mono','Courier New',monospace",
      color: '#e0e0e0',
      overflow: 'hidden',
    }}>

      {/* Mobile header — SENGER MARKET */}
      <div style={{
        background: '#000', borderBottom: '3px solid #ff6600',
        padding: '0 12px', height: '44px',
        display: 'flex', alignItems: 'center', flexShrink: 0, gap: 8,
      }}>
        <span style={{ color:'#ff6600', fontWeight:800, fontSize:'13px', letterSpacing:'2px' }}>SENGER</span>
        <span style={{ color:'#555', fontSize:'9px', letterSpacing:'1px' }}>MARKET</span>
        {isRefreshing && <span style={{ color:'#ff6600', fontSize:'8px', marginLeft:4 }}>● LIVE</span>}
        {lastUpdated && !isRefreshing && (
          <span style={{ color:'#2a2a2a', fontSize:'8px', marginLeft:'auto' }}>
            {lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
          </span>
        )}
      </div>

      {/* Tab content area */}
      <div style={{ flex:1, overflow:'auto', minHeight:0 }}>
        {activeTab==='markets' && (
          <div>
            <div style={{ borderBottom:'2px solid #1e1e1e', height:'56vw', minHeight:220 }}>
              <ChartPanel ticker={chartTicker} onTickerChange={setChartTicker} />
            </div>
            <div style={{ borderBottom:'1px solid #1e1e1e' }}>
              <StockPanel data={data?.stocks} loading={loading} onTickerClick={setChartTicker} />
            </div>
            <CryptoPanel data={data?.crypto} loading={loading} onTickerClick={setChartTicker} />
          </div>
        )}
        {activeTab==='brazil'   && <BrazilPanel onTickerClick={setChartTicker} />}
        {activeTab==='global'   && (
          <div>
            <GlobalIndicesPanel onTickerClick={setChartTicker} />
            <div style={{ borderTop:'1px solid #1e1e1e' }}>
              <IndexPanel data={data?.indices} loading={loading} onTickerClick={setChartTicker} />
            </div>
          </div>
        )}
        {activeTab==='fxcrypto' && (
          <div>
            <ForexPanel data={data?.forex} loading={loading} onTickerClick={setChartTicker} />
            <div style={{ borderTop:'1px solid #1e1e1e' }}>
              <CommoditiesPanel data={data?.stocks} loading={loading} onTickerClick={setChartTicker} />
            </div>
          </div>
        )}
        {activeTab==='rates'  && <RatesPanel />}
        {activeTab==='search' && <SearchPanel onTickerSelect={(sym)=>{ setChartTicker(sym); setActiveTabPersist('markets'); }} />}
        {activeTab==='news'   && <NewsPanel />}
      </div>

      {/* Bottom tab bar */}
      <nav style={{
        display: 'flex', background: '#000',
        borderTop: '2px solid #1e1e1e',
        flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTabPersist(tab.id)}
              style={{
                flex: '1 0 auto', minWidth: '48px', minHeight: '52px',
                padding: '8px 4px 6px',
                background: active ? '#1a0900' : 'transparent',
                color: active ? '#ff6600' : '#444',
                border: 'none',
                borderTop: `3px solid ${active ? '#ff6600' : 'transparent'}`,
                fontSize: '8px', fontWeight: 800, letterSpacing: '0.3px',
                cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
