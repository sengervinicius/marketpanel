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
import { SearchPanel } from './components/panels/SearchPanel';
import { RatesPanel } from './components/panels/RatesPanel';
import BrazilPanel from './components/panels/BrazilPanel';
import GlobalIndicesPanel from './components/panels/GlobalIndicesPanel';

const TABS = [
  { id: 'markets', label: 'MARKETS' },
  { id: 'brazil',  label: 'BRASIL'  },
  { id: 'global',  label: 'GLOBAL'  },
  { id: 'fxcrypto',label: 'FX/CRYPTO'},
  { id: 'rates',   label: 'RATES'   },
  { id: 'search',  label: 'SEARCH'  },
  { id: 'news',    label: 'NEWS'    },
];

export default function App() {
  const { stocks, forex, crypto, news, connected, marketStatus, flashes, history } = useMarketData();
  const [activeTab, setActiveTab] = useState('markets');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const baseStyle = {
    background: '#0a0a0f', color: '#c8c8c8',
    fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
  };

  const tabBarStyle = {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    background: '#0d0d14', borderTop: '1px solid #e55a00',
    display: 'flex', zIndex: 1000, height: 44, padding: '0 2px',
  };

  const tabBtnStyle = (active) => ({
    flex: 1, background: 'none', border: 'none',
    color: active ? '#e55a00' : '#444',
    fontSize: 7.5, fontFamily: "'IBM Plex Mono', monospace",
    textTransform: 'uppercase', letterSpacing: '0.06em',
    cursor: 'pointer', padding: '4px 1px',
    borderTop: active ? '2px solid #e55a00' : '2px solid transparent',
    transition: 'color 0.2s',
  });

  if (isMobile) {
    const panelStyle = { flex: 1, padding: 4, paddingBottom: 52, overflowY: 'auto' };
    return (
      <div style={baseStyle}>
        <Header stocks={stocks} forex={forex} marketStatus={marketStatus} />
        <div style={panelStyle}>
          {activeTab === 'markets' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <IndexPanel stocks={stocks} flashes={flashes} history={history} />
              <StockPanel stocks={stocks} flashes={flashes} history={history} />
              <CommoditiesPanel stocks={stocks} flashes={flashes} history={history} />
            </div>
          )}
          {activeTab === 'brazil'   && <BrazilPanel />}
          {activeTab === 'global'   && <GlobalIndicesPanel />}
          {activeTab === 'fxcrypto' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <ForexPanel forex={forex} flashes={flashes} history={history} />
              <CryptoPanel crypto={crypto} flashes={flashes} history={history} />
            </div>
          )}
          {activeTab === 'rates'  && <RatesPanel />}
          {activeTab === 'search' && <SearchPanel />}
          {activeTab === 'news'   && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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

  // ── Desktop layout (3 rows) ──────────────────────────────────────────────
  const H1 = 'calc(36vh - 14px)';
  const H2 = 'calc(36vh - 14px)';
  const H3 = 'calc(28vh - 14px)';

  const row1 = {
    display: 'grid',
    gridTemplateColumns: '190px 210px 1fr 230px 190px',
    gap: 2, padding: '2px 2px 1px', flex: 'none',
  };
  const row2 = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 190px 190px 170px',
    gap: 2, padding: '1px 2px 1px', flex: 'none',
  };
  const row3 = {
    display: 'grid',
    gridTemplateColumns: '1fr 220px 220px',
    gap: 2, padding: '1px 2px 2px', flex: 'none',
  };

  return (
    <div style={baseStyle}>
      <Header stocks={stocks} forex={forex} marketStatus={marketStatus} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Row 1 */}
        <div style={row1}>
          <div style={{ height: H1 }}><IndexPanel stocks={stocks} flashes={flashes} history={history} /></div>
          <div style={{ height: H1 }}><StockPanel stocks={stocks} flashes={flashes} history={history} /></div>
          <div style={{ height: H1 }}><ChartPanel stocks={stocks} /></div>
          <div style={{ height: H1 }}><NewsPanel news={news} /></div>
          <div style={{ height: H1 }}><SentimentPanel stocks={stocks} forex={forex} crypto={crypto} /></div>
        </div>

        {/* Row 2 */}
        <div style={row2}>
          <div style={{ height: H2 }}><BrazilPanel /></div>
          <div style={{ height: H2 }}><GlobalIndicesPanel /></div>
          <div style={{ height: H2 }}><ForexPanel forex={forex} flashes={flashes} history={history} /></div>
          <div style={{ height: H2 }}><CryptoPanel crypto={crypto} flashes={flashes} history={history} /></div>
          <div style={{ height: H2 }}><CommoditiesPanel stocks={stocks} flashes={flashes} history={history} /></div>
        </div>

        {/* Row 3: Search + Rates */}
        <div style={row3}>
          <div style={{ height: H3 }}><SearchPanel /></div>
          <div style={{ height: H3 }}><RatesPanel /></div>
          <div style={{ height: H3 }}><SentimentPanel stocks={stocks} forex={forex} crypto={crypto} /></div>
        </div>

      </div>
    </div>
  );
}
