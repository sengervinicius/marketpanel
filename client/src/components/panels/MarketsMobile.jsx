/**
 * MarketsMobile.jsx — Mobile Wave 1 Markets tab.
 *
 * Folds the five dense desktop grids (Indexes · FX · Commodities ·
 * Rates · Sectors) into one segmented screen per the approved mockup
 * (particle-mobile-mockups.html · Markets). Reuses the existing symbol
 * sets from utils/constants and the sector ETF map from SectorPulsePanel,
 * live prices via PriceContext, tap → detail bottom-sheet.
 */

import { useState, memo } from 'react';
import { useTickerPrice } from '../../context/PriceContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { WORLD_INDEXES, FOREX_PAIRS, COMMODITIES, BOND_YIELDS } from '../../utils/constants';
import { SECTOR_MAP_META } from './SectorPulsePanel';
import MobileQuoteRow from './MobileQuoteRow';
import './MobileWave1.css';

const SEGMENTS = [
  { id: 'idx', label: 'Indexes' },
  { id: 'fx',  label: 'FX' },
  { id: 'cmd', label: 'Comm.' },
  { id: 'rts', label: 'Rates' },
  { id: 'sec', label: 'Sectors' },
];

const COMMODITY_ROWS = COMMODITIES.filter(c => !c.legacy);

/* ── Rates: yield rows (Yahoo ^ symbols report tenths of a percent) ── */
const RatesRow = memo(function RatesRow({ symbol, label }) {
  const q = useTickerPrice(symbol);
  const openDetail = useOpenDetail();
  let y = q?.price;
  if (y != null && y > 20) y = y / 10; // ^TNX etc. → percent
  const pct = q?.changePct;
  const cls = pct == null ? 'flat' : pct >= 0 ? 'u' : 'd';
  return (
    <div className="mw-row tap" onClick={() => openDetail(symbol)}>
      <div className="mw-row-l"><span className="mw-tk">{label}</span></div>
      <div className="mw-row-r">
        <span className="mw-price">{y != null ? `${y.toFixed(2)}%` : '—'}</span>
        <span className={`mw-chg ${cls}`}>{pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '·'}</span>
      </div>
    </div>
  );
});

/* ── Sectors: pulse ramp, tap → sector ETF detail ── */
const SectorRow = memo(function SectorRow({ etf, name }) {
  const q = useTickerPrice(etf);
  const openDetail = useOpenDetail();
  const pct = q?.changePct;
  const up = pct != null && pct >= 0;
  const width = pct == null ? 4 : Math.max(4, Math.min(100, Math.abs(pct) * 40));
  return (
    <div className="mw-sec" onClick={() => openDetail(etf)}>
      <span className="mw-sec-n">{etf} · {name}</span>
      <div className="mw-sec-bar" style={{ width: `${width}%`, background: up ? 'var(--price-up)' : 'var(--price-down)' }} />
      <span className={`mw-sec-v ${up ? 'u' : pct != null ? 'd' : ''}`}>
        {pct != null ? `${up ? '+' : ''}${pct.toFixed(1)}%` : '·'}
      </span>
    </div>
  );
});

function MarketsMobile() {
  const [seg, setSeg] = useState('idx');

  return (
    <div className="mw-scroll">
      <div className="mw-seg">
        {SEGMENTS.map(s => (
          <button key={s.id} data-on={seg === s.id} onClick={() => setSeg(s.id)}>{s.label}</button>
        ))}
      </div>

      {seg === 'idx' && (
        <div className="mw-card mw-card--list">
          {WORLD_INDEXES.map(i => (
            <MobileQuoteRow key={i.symbol} symbol={i.symbol} display={i.symbol} name={i.label} />
          ))}
        </div>
      )}

      {seg === 'fx' && (
        <div className="mw-card mw-card--list">
          {FOREX_PAIRS.map(f => (
            <MobileQuoteRow key={f.symbol} symbol={`C:${f.symbol}`} display={f.label} />
          ))}
        </div>
      )}

      {seg === 'cmd' && (
        <div className="mw-card mw-card--list">
          {COMMODITY_ROWS.map(c => (
            <MobileQuoteRow key={c.symbol} symbol={c.symbol} display={c.label} name={c.group} />
          ))}
        </div>
      )}

      {seg === 'rts' && (
        <div className="mw-card">
          <div className="mw-sechead" style={{ margin: '0 0 8px' }}>US Treasury yields</div>
          {BOND_YIELDS.map(b => (
            <RatesRow key={b.symbol} symbol={b.symbol} label={b.label} />
          ))}
        </div>
      )}

      {seg === 'sec' && (
        <div className="mw-card">
          <div className="mw-sechead" style={{ margin: '0 0 8px' }}>Sector pulse · tap to drill</div>
          {Object.entries(SECTOR_MAP_META).map(([etf, meta]) => (
            <SectorRow key={etf} etf={etf} name={meta.name} />
          ))}
        </div>
      )}
    </div>
  );
}

export default MarketsMobile;
