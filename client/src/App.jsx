import { useState, useEffect } from 'react';
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
import BrazilPanel from './components/panels/BrazilPanel';
import GlobalIndicesPanel from './components/panels/GlobalIndicesPanel';

const TABS = [
  { id:'markets', label:'MARKETS' },
  { id:'brazil', label:'BRASIL' },
  { id:'global', label:'GLOBAL' },
  { id:'fxcrypto', label:'FX/CRYPTO' },
  { id:'news', label:'NEWS' }
];

export default function App() {
  const { stocks, forex, crypto, news, connected, marketStatus, flashes, history } = useMarketData();
  const [activeTab, setActiveTab] = useState('markets');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const baseStyle = {
    background: '#0a0a0f', color: '#c8c8c8',
    fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
    minHeight: '100vh', display: 'flex', flexDirection: 'column'
  };

  const tabBarStyle = {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    background: '#0d0d14', borderTop: '1px solid #e55a00',
    display: 'flex', zIndex: 1000, height: 48, padding: '0 4px'
  };

  const tabBtnStyle = (active) => ({
    flex: 1, background: 'none', border: 'none',
    color: active ? '#e55a00' : '#444',
    fontSize: 8, fontFamily: "'IBM Plex Mono', monospace",
    textTransform: 'uppercase', letterSpacing: '0.06em',
    cursor: 'pointer', padding: '4px 2px',
    borderTop: active ? '2px solid #e55a00' : '2px solid transparent',
    transition: 'color 0.2s'
  });

  if (isMobile) {
    const panelStyle = { flex: 1, padding: 4, paddingBottom: 56, overflowY: 'auto' };
    return (
      <div style={baseStyle}>
        <Header stocks={stocks} forex={forex} marketStatus={marketStatus} />
        <div style={panelStyle}>
          {activeTab === 'markets' && (
            <div style={{display:'flex', flexDirection:'column', gap:4}}>
              <IndexPanel stocks={stocks} flashes={flashes} history={history} />
              <StockPanel stocks={stocks} flashes={flashes} history={history} />
              <CommoditiesPanel stocks={stocks} flashes={flashes} history={history} />
            </div>
          )}
          {activeTab === 'brazil' && <BrazilPanel />}
          {activeTab === 'global' && <GlobalIndicesPanel />}
          {activeTab === 'fxcrypto' && (
            <div style={{display:'flex', flexDirection:'column', gap:4}}>
              <ForexPanel forex={forex} flashes={flashes} history={history} />
              <CryptoPanel crypto={crypto} flashes={flashes} history={history} />
            </div>
          )}
          {activeTab === 'news' && (
            <div style={{display:'flex', flexDirection:'column', gap:4}}>
              <NewsPanel news={news} />
              <SentimentPanel stocks={stocks} forex={forex} crypto={crypto} />
            </div>
          )}
        </div>
        <nav style={tabBarStyle}>
          {TABS.map(t => (
            <button key={t.id} style={tabBtnStyle(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    );
  }

  // Desktop layout
  const gridRow1 = {
    display: 'grid',
    gridTemplateColumns: '200px 220px 1fr 240px 200px',
    gap: 2, padding: '2px', flex: 1
  };
  const gridRow2 = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 200px 200px 180px',
    gap: 2, padding: '0 2px 2px', flex: 1
  };
  const panelH = 'calc(50vh - 28px)';

  return (
    <div style={baseStyle}>
      <Header stocks={stocks} forex={forex} marketStatus={marketStatus} />
      <div style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden'}}>
        <div style={gridRow1}>
          <div style={{height: panelH}}><IndexPanel stocks={stocks} flashes={flashes} history={history} /></div>
          <div style={{height: panelH}}><StockPanel stocks={stocks} flashes={flashes} history={history} /></div>
          <div style={{height: panelH}}><ChartPanel stocks={stocks} /></div>
          <div style={{height: panelH}}><NewsPanel news={news} /></div>
          <div style={{height: panelH}}><SentimentPanel stocks={stocks} forex={forex} crypto={crypto} /></div>
        </div>
        <div style={gridRow2}>
          <div style={{height: panelH}}><BrazilPanel /></div>
          <div style={{height: panelH}}><GlobalIndicesPanel /></div>
          <div style={{height: panelH}}><ForexPanel forex={forex} flashes={flashes} history={history} /></div>
          <div style={{height: panelH}}><CryptoPanel crypto={crypto} flashes={flashes} history={history} /></div>
          <div style={{height: panelH}}><CommoditiesPanel stocks={stocks} flashes={flashes} history={history} /></div>
        </div>
      </div>
    </div>
  );
}
