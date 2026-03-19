/**
 * App.jsx — Bloomberg Terminal Layout
 *
 * Grid: 6 panels arranged to replicate the BBG multi-panel look
 *
 *  ┌─────────────────────────────────────────────────────┐
 *  │                     HEADER / TICKER                  │
 *  ├──────────┬──────────┬──────────┬──────────┬─────────┤
 *  │  INDEXES │  STOCKS  │  CHARTS  │  NEWS    │SENTIMENT│
 *  │          │          │          │          │         │
 *  ├──────────┴──────────┤          ├──────────┴─────────┤
 *  │  FOREX   │  CRYPTO  │          │   COMMODITIES      │
 *  └──────────┴──────────┴──────────┴────────────────────┘
 */

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

const PANEL_BORDER = '1px solid #1a1a1a';

function Panel({ children, style = {} }) {
  return (
    <div style={{
      border: PANEL_BORDER,
      background: '#000',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}>
      {children}
    </div>
  );
}

export default function App() {
  const { stocks, forex, crypto, news, connected, marketStatus, flashes, history } = useMarketData();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      background: '#000',
    }}>
      {/* ── Header ── */}
      <Header connected={connected} stocks={stocks} forex={forex} marketStatus={marketStatus} />

      {/* ── Main grid ── */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '220px 220px 1fr 260px 230px',
        gridTemplateRows: '1fr 1fr',
        gap: '1px',
        background: '#111',
        overflow: 'hidden',
        minHeight: 0,
      }}>

        {/* Col 1 Row 1 — World Indexes */}
        <Panel style={{ gridRow: '1 / 2' }}>
          <IndexPanel stocks={stocks} flashes={flashes} history={history} />
        </Panel>

        {/* Col 2 Row 1 — US Stocks + LatAm */}
        <Panel style={{ gridRow: '1 / 2' }}>
          <StockPanel stocks={stocks} flashes={flashes} history={history} />
        </Panel>

        {/* Col 3 Rows 1+2 — Charts (spans both rows) */}
        <Panel style={{ gridRow: '1 / 3', gridColumn: '3 / 4' }}>
          <ChartPanel stocks={stocks} />
        </Panel>

        {/* Col 4 Row 1 — News */}
        <Panel style={{ gridRow: '1 / 2' }}>
          <NewsPanel news={news} />
        </Panel>

        {/* Col 5 Row 1 — Sentiment + Yields + Heatmap */}
        <Panel style={{ gridRow: '1 / 2' }}>
          <SentimentPanel stocks={stocks} forex={forex} crypto={crypto} />
        </Panel>

        {/* Col 1 Row 2 — Forex */}
        <Panel style={{ gridRow: '2 / 3' }}>
          <ForexPanel forex={forex} flashes={flashes} history={history} />
        </Panel>

        {/* Col 2 Row 2 — Crypto */}
        <Panel style={{ gridRow: '2 / 3' }}>
          <CryptoPanel crypto={crypto} flashes={flashes} history={history} />
        </Panel>

        {/* Col 4+5 Row 2 — Commodities (spans 2 cols) */}
        <Panel style={{ gridRow: '2 / 3', gridColumn: '4 / 6' }}>
          <CommoditiesPanel stocks={stocks} flashes={flashes} history={history} />
        </Panel>
      </div>
    </div>
  );
}
