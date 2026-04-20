// IndexPanel.jsx — world index ETF proxies, BBG-style
import { useRef, useState, memo, useEffect } from 'react';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import SkeletonLoader from '../shared/SkeletonLoader';
import { WORLD_INDEXES } from '../../utils/constants';
import { COLS_STANDARD } from '../../utils/panelColumns';
import './IndexPanel.css';

const fmt    = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
// Was '56px 1fr 68px 64px' — chg% 64px too tight on 2-digit days.
const COLS   = COLS_STANDARD;

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

function IndexPanel({ data = {}, loading, onTickerClick }) {
  const openDetail = useOpenDetail();
  const ptRef = useRef(null);
  const [collapsed, setCollapsed] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const { getBadge } = useFeedStatus();
  const badge = getBadge('stocks');

  // Phase 2: Update timestamp whenever data changes
  useEffect(() => {
    setLastUpdated(new Date());
  }, [data]);
  return (
    <div className="ip-container">
      <div className="ip-header">
        <span className="ip-header-title">WORLD INDEXES</span>
        <span className="ip-header-subtitle">ETF PROXIES</span>
        <span className="ip-header-badge" style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.color}33` }}>
          {badge.text}
        </span>
        {lastUpdated && (
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', paddingLeft: '8px', borderLeft: '1px solid var(--border-subtle)' }} title={new Date(lastUpdated).toLocaleString()}>
            {new Date(lastUpdated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
          </span>
        )}
        <div className="ip-header-spacer" />
        <button className="btn ip-collapse-btn" onClick={() => setCollapsed(v => !v)} title={collapsed ? 'Expand' : 'Collapse'}
        >{collapsed ? '+' : '−'}</button>
      </div>
      {!collapsed && (<>
      {/* Column headers */}
      <div className="ip-col-header">
        {['TICKER', 'NAME', 'LAST', 'CHG%'].map((h, i) => (
          <span key={h} className={`ip-col-header-cell ${i >= 2 ? 'ip-col-header-cell--right' : ''}`}>
            {h}
          </span>
        ))}
      </div>
      <div className="ip-content">
        {loading || !data ? (
          <SkeletonLoader type="table" rows={6} columns={4} width="100%" height="auto" />
        ) : WORLD_INDEXES.map(idx => {
          const d   = data[idx.symbol] || {};
          const pos = (d.changePct ?? 0) >= 0;
          return (
            <div
              key={idx.symbol}
              data-ticker={idx.symbol}
              data-ticker-label={idx.label}
              data-ticker-type="ETF"
              draggable
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: idx.symbol, name: idx.label, type: 'ETF' }));
              }}
              onClick={() => onTickerClick?.(idx.symbol)}
              onDoubleClick={() => openDetail(idx.symbol)}
              onTouchStart={e => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => openDetail(idx.symbol), 500); }}
              onTouchEnd={() => clearTimeout(ptRef.current)}
              onTouchMove={() => clearTimeout(ptRef.current)}
              onContextMenu={e => showInfo(e, idx.symbol, idx.label, 'ETF')}
              className="ip-row"
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span className="ip-row-symbol">{idx.symbol}</span>
              <span className="ip-row-label">{idx.label}</span>
              <span className="ip-row-price">{fmt(d.price)}</span>
              <span className={`ip-row-change ${pos ? 'ip-row-change-positive' : 'ip-row-change-negative'}`}>{fmtPct(d.changePct)}</span>
            </div>
          );
        })}
      </div>
      </>)}
    </div>
  );
}

export { IndexPanel };
export default memo(IndexPanel);
