/**
 * CrossAssetPanel.jsx — #292 F3: the cross-asset ribbon.
 *
 * Replaces the sector heatmap in the bottom row with the question a desk
 * actually asks at a glance: what moved today, across everything. Twelve
 * cells — equities, rates, FX, commodities, crypto, Brazil — each with the
 * live price, the day's move and a 1-day sparkline, from PriceContext and
 * the sparkline cache already feeding the grid. Click opens the detail.
 */
import { useMemo } from 'react';
import { useTickerPrice } from '../../context/PriceContext';
import { useSparklineData } from '../../hooks/useSparklineData';
import { useOpenDetail } from '../../context/OpenDetailContext';
import PanelChrome from '../common/PanelChrome';
import Sparkline from '../common/Sparkline';
import './CrossAssetPanel.css';

const CELLS = [
  { t: '^GSPC',   label: 'S&P 500',  group: 'EQ' },
  { t: '^IXIC',   label: 'NASDAQ',   group: 'EQ' },
  { t: '^RUT',    label: 'RUSSELL',  group: 'EQ' },
  { t: '^BVSP',   label: 'IBOV',     group: 'BR' },
  { t: 'EWZ',     label: 'EWZ',      group: 'BR' },
  { t: 'USDBRL=X', label: 'USD/BRL', group: 'FX', digits: 4 },
  { t: '^TNX',    label: 'UST 10Y',  group: 'RATES', suffix: '%', scale: 0.1, digits: 2 },
  { t: 'DX-Y.NYB', label: 'DXY',     group: 'FX', digits: 2 },
  { t: 'EURUSD=X', label: 'EUR/USD', group: 'FX', digits: 4 },
  { t: 'GC=F',    label: 'GOLD',     group: 'CMD' },
  { t: 'BZ=F',    label: 'BRENT',    group: 'CMD' },
  { t: 'BTC-USD', label: 'BTC',      group: 'CRYPTO' },
];

function Cell({ cell, spark, onOpen }) {
  const q = useTickerPrice(cell.t);
  const price = q?.price != null ? q.price * (cell.scale || 1) : null;
  const pct = q?.changePct;
  const tone = pct == null ? '' : pct > 0 ? ' xa-cell--up' : pct < 0 ? ' xa-cell--down' : '';
  return (
    <button type="button" className={`xa-cell${tone}`} onClick={() => onOpen(cell.t)} title={`${cell.label} · ${cell.t}`}>
      <span className="xa-label">{cell.label}</span>
      <span className="xa-spark">{spark && spark.length >= 2 ? <Sparkline data={spark} width={54} height={14} baseline="first" /> : null}</span>
      <span className="xa-price">{price != null ? price.toLocaleString('en-US', { minimumFractionDigits: cell.digits ?? (price < 10 ? 2 : 0), maximumFractionDigits: cell.digits ?? 2 }) : '—'}{price != null && cell.suffix ? cell.suffix : ''}</span>
      <span className="xa-pct">{pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}</span>
    </button>
  );
}

export default function CrossAssetPanel() {
  const openDetail = useOpenDetail();
  const tickers = useMemo(() => CELLS.map(c => c.t), []);
  const sparks = useSparklineData(tickers);
  return (
    <div className="xa-panel">
      <PanelChrome title="CROSS-ASSET" subtitle="WHAT MOVED TODAY · 1D" />
      <div className="xa-grid">
        {CELLS.map(c => <Cell key={c.t} cell={c} spark={sparks[c.t]} onOpen={openDetail} />)}
      </div>
    </div>
  );
}
