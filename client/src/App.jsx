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

const TABS = [
  { id: 'markets',  label: 'MARKETS' },
  { id: 'brazil',   label: 'BRAZIL' },
  { id: 'global',   label: 'GLOBAL' },
  { id: 'fxcrypto', label: 'FX/CRYPTO' },
  { id: 'rates',    label: 'RATES' },
  { id: 'search',   label: 'SEARCH' },
  { id: 'news',     label: 'NEWS' },
];

const LS_TAB = 'activeTab';
const LS_CHART_TICKER = 'chartTicker';

export default function App() {
  const { data, loading, isRefreshing, lastUpdated } = useMarketData();
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem(LS_TAB) || 'markets');
  const setActiveTabPersist = (t) => { setActiveTab(t); localStorage.setItem(LS_TAB, t); };
  const [chartTicker, setChartTickerState] = useState(() => localStorage.getItem(LS_CHART_TICKER) || 'SPY');
  const setChartTicker = useCallback((t) => { setChartTickerState(t); localStorage.setItem(LS_CHART_TICKER, t); }, []);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const border = '1px solid #1e1e1e';
  const border2 = '2px solid #1e1e1e';

  if (!isMobile) {
    return (
      <div style={{ display:'grid', gridTemplateRows:'36px 36vh 36vh 1fr', height:'100vh', background:'#0a0a0a', fontFamily:"'IBM Plex Mono','Roboto Mono','Courier New',monospace", overflow:'hidden', color:'#e0e0e0' }}>
        <div style={{ display:'flex', alignItems:'center', background:'#000', borderBottom:'2px solid #ff6600', padding:'0 12px', gap:12 }}>
          <span style={{ color:'#ff6600', fontWeight:700, fontSize:'13px', letterSpacing:'2px' }}>BLOOMBERG</span>
          <span style={{ color:'#333', fontSize:'9px', letterSpacing:'1px' }}>TERMINAL</span>
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
            {isRefreshing && <span style={{ color:'#444', fontSize:'8px', letterSpacing:'1px' }}>UPDATING...</span>}
            {lastUpdated && !isRefreshing && <span style={{ color:'#333', fontSize:'8px' }}>⟳ {lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>}
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', borderBottom:border2, overflow:'hidden' }}>
          <div style={{ borderRight:border, overflow:'hidden' }}><ChartPanel ticker={chartTicker} onTickerChange={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><StockPanel data={data?.stocks} loading={loading} onTickerClick={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><CryptoPanel data={data?.crypto} loading={loading} onTickerClick={setChartTicker} /></div>
          <div style={{ overflow:'hidden' }}><ForexPanel data={data?.forex} loading={loading} onTickerClick={setChartTicker} /></div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', borderBottom:border2, overflow:'hidden' }}>
          <div style={{ borderRight:border, overflow:'hidden' }}><IndexPanel data={data?.indices} loading={loading} onTickerClick={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><BrazilPanel onTickerClick={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><GlobalIndicesPanel onTickerClick={setChartTicker} /></div>
          <div style={{ overflow:'hidden' }}><CommoditiesPanel data={data?.stocks} loading={loading} onTickerClick={setChartTicker} /></div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'180px 1fr 2fr 1fr', overflow:'hidden' }}>
          <div style={{ borderRight:border, overflow:'hidden' }}><RatesPanel /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><SearchPanel onTickerSelect={setChartTicker} /></div>
          <div style={{ borderRight:border, overflow:'hidden' }}><NewsPanel /></div>
          <div style={{ overflow:'hidden' }}><SentimentPanel data={data} loading={loading} /></div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100dvh', background:'#0a0a0a', fontFamily:"'IBM Plex Mono','Roboto Mono','Courier New',monospace", color:'#e0e0e0', overflow:'hidden' }}>
      <div style={{ background:'#000', borderBottom:'3px solid #ff6600', padding:'0 12px', height:'40px', display:'flex', alignItems:'center', flexShrink:0, gap:10 }}>
        <span style={{ color:'#ff6600', fontWeight:800, fontSize:'13px', letterSpacing:'2px' }}>BLOOMBERG</span>
        {isRefreshing ? <span style={{ color:'#ff6600', fontSize:'8px' }}>●LIVE</span> : <span style={{ color:'#333', fontSize:'8px' }}>TERMINAL</span>}
        {lastUpdated && <span style={{ color:'#2a2a2a', fontSize:'8px', marginLeft:'auto' }}>{lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>}
      </div>
      <div style={{ flex:1, overflow:'auto', minHeight:0 }}>
        {activeTab==='markets' && <div>
          <div style={{ borderBottom:'2px solid #1e1e1e', height:'45vw', minHeight:180 }}><ChartPanel ticker={chartTicker} onTickerChange={setChartTicker} /></div>
          <div style={{ borderBottom:'1px solid #1e1e1e' }}><StockPanel data={data?.stocks} loading={loading} onTickerClick={setChartTicker} /></div>
          <CryptoPanel data={data?.crypto} loading={loading} onTickerClick={setChartTicker} />
        </div>}
        {activeTab==='brazil' && <BrazilPanel onTickerClick={setChartTicker} />}
        {activeTab==='global' && <div>
          <GlobalIndicesPanel onTickerClick={setChartTicker} />
          <div style={{ borderTop:'1px solid #1e1e1e' }}><IndexPanel data={data?.indices} loading={loading} onTickerClick={setChartTicker} /></div>
        </div>}
        {activeTab==='fxcrypto' && <div>
          <ForexPanel data={data?.forex} loading={loading} onTickerClick={setChartTicker} />
          <div style={{ borderTop:'1px solid #1e1e1e' }}><CommoditiesPanel data={data?.stocks} loading={loading} onTickerClick={setChartTicker} /></div>
        </div>}
        {activeTab==='rates' && <RatesPanel />}
        {activeTab==='search' && <SearchPanel onTickerSelect={(sym)=>{setChartTicker(sym);setActiveTabPersist('markets');}} />}
        {activeTab==='news' && <NewsPanel />}
      </div>
      <nav style={{ display:'flex', background:'#000', borderTop:'3px solid #2a2a2a', flexShrink:0, overflowX:'auto', scrollbarWidth:'none' }}>
        {TABS.map(tab => {
          const active = activeTab===tab.id;
          return (
            <button key={tab.id} onClick={()=>setActiveTabPersist(tab.id)} style={{ flex:'1 0 auto', minWidth:'52px', minHeight:'52px', padding:'10px 4px 8px', background:active?'#1a0900':'transparent', color:active?'#ff6600':'#555', border:'none', borderTop:`3px solid ${active?'#ff6600':'transparent'}`, fontSize:'8px', fontWeight:800, letterSpacing:'0.3px', cursor:'pointer', fontFamily:'inherit', textTransform:'uppercase' }}>
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
