/**
 * HeatmapPanel.jsx — S6
 * Bloomberg-style sector performance heatmap.
 * Shows a grid of colored tiles representing stocks grouped by sector.
 * Color intensity maps to daily change magnitude.
 */
import { memo, useState } from 'react';
import { useTickerPrice } from '../../context/PriceContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import './HeatmapPanel.css';

const SECTORS = [
  { name: 'Technology', tickers: ['AAPL', 'MSFT', 'GOOGL', 'META', 'NVDA', 'AMD', 'AVGO', 'TSM', 'CRM', 'ORCL'] },
  { name: 'Energy', tickers: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'NEE'] },
  { name: 'Finance', tickers: ['JPM', 'BAC', 'GS', 'MS', 'V', 'MA'] },
  { name: 'Healthcare', tickers: ['UNH', 'JNJ', 'LLY', 'PFE', 'ABBV', 'MRK'] },
  { name: 'Defence', tickers: ['LMT', 'NOC', 'RTX', 'BA', 'GD'] },
  { name: 'Consumer', tickers: ['AMZN', 'TSLA', 'WMT', 'HD', 'NKE', 'SBUX'] },
  { name: 'Industrials', tickers: ['CAT', 'DE', 'HON', 'GE', 'UPS'] },
];

function getChangeColor(pct) {
  if (pct == null) return '#222';
  if (pct > 3)   return '#1b5e20';
  if (pct > 1.5) return '#2e7d32';
  if (pct > 0)   return 'rgba(56,142,60,0.4)';
  if (pct === 0)  return '#333';
  if (pct > -1.5) return 'rgba(198,40,40,0.4)';
  if (pct > -3)  return '#b71c1c';
  return '#7f0000';
}

// Each tile needs its own hook call — wrap in a component
function Tile({ ticker }) {
  const openDetail = useOpenDetail();
  const q = useTickerPrice(ticker);
  const pct = q?.changePct;
  const bg = getChangeColor(pct);
  const txt = pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—';

  return (
    <div
      className="hm-tile"
      style={{ background: bg }}
      onClick={() => openDetail(ticker)}
      title={`${ticker}: ${txt}`}
    >
      <span className="hm-tile-sym">{ticker}</span>
      <span className="hm-tile-chg">{txt}</span>
    </div>
  );
}

function SectorGroup({ sector }) {
  return (
    <div className="hm-sector">
      <div className="hm-sector-label">{sector.name.toUpperCase()}</div>
      <div className="hm-sector-tiles">
        {sector.tickers.map(t => <Tile key={t} ticker={t} />)}
      </div>
    </div>
  );
}

function HeatmapPanel() {
  const [tf, setTf] = useState('1D');

  return (
    <div className="hm-panel">
      <div className="hm-head">
        <span className="hm-title">SECTOR HEATMAP</span>
        <div className="hm-tf-bar">
          {['1D', '1W'].map(v => (
            <button key={v} className={`hm-tf-btn ${tf === v ? 'hm-tf-btn--active' : ''}`} onClick={() => setTf(v)}>
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="hm-body">
        {SECTORS.map(s => <SectorGroup key={s.name} sector={s} />)}
      </div>
    </div>
  );
}

export default memo(HeatmapPanel);
