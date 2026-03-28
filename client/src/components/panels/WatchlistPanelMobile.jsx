/**
 * WatchlistPanelMobile.jsx
 * Mobile watchlist view — shows user's saved instruments, tapping opens detail.
 */

import { memo } from 'react';
import { useWatchlist } from '../../context/WatchlistContext';
import { useStocksData, useForexData, useCryptoData } from '../../context/MarketContext';

function fmtPrice(v, dec = 2) {
  if (v == null) return '--';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(v) {
  if (v == null) return '--';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function WatchlistPanelMobile({ onOpenDetail, onManage }) {
  const { watchlist, removeTicker } = useWatchlist();
  const stocks = useStocksData();
  const forex  = useForexData();
  const crypto = useCryptoData();

  const getData = (sym) => stocks[sym] || forex[sym] || crypto[sym] || null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0a0a0a', fontFamily: '"Courier New", monospace',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #1e1e1e',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ color: '#ff6600', fontSize: 11, fontWeight: 'bold', letterSpacing: '0.2em' }}>
          WATCHLIST
        </span>
        <button
          onClick={onManage}
          style={{
            background: 'none', border: '1px solid #2a2a2a', color: '#888',
            padding: '4px 12px', fontSize: 9, cursor: 'pointer',
            fontFamily: 'inherit', letterSpacing: '0.1em', borderRadius: 2,
          }}
        >
          + MANAGE
        </button>
      </div>

      {/* Empty state */}
      {watchlist.length === 0 && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <div style={{ color: '#2a2a2a', fontSize: 24 }}>☆</div>
          <div style={{ color: '#444', fontSize: 11, textAlign: 'center', lineHeight: 1.6 }}>
            Your watchlist is empty.<br />
            Use SEARCH to add instruments.
          </div>
          <button
            onClick={onManage}
            style={{
              background: '#1a0900', border: '1px solid #ff6600', color: '#ff6600',
              padding: '8px 20px', fontSize: 10, cursor: 'pointer',
              fontFamily: 'inherit', letterSpacing: '0.15em', borderRadius: 3, marginTop: 8,
            }}
          >
            GO TO SEARCH
          </button>
        </div>
      )}

      {/* List */}
      {watchlist.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {watchlist.map(sym => {
            const d    = getData(sym);
            const pct  = d?.changePct;
            const color = pct == null ? '#555' : pct >= 0 ? '#00cc44' : '#cc2200';
            return (
              <div
                key={sym}
                onClick={() => onOpenDetail(sym)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderBottom: '1px solid #141414',
                  cursor: 'pointer', minHeight: 56,
                }}
              >
                {/* Symbol + name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 'bold' }}>{sym}</div>
                  {d?.name && (
                    <div style={{ color: '#444', fontSize: 9, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.name}
                    </div>
                  )}
                </div>

                {/* Price + change */}
                <div style={{ textAlign: 'right', marginRight: 14 }}>
                  <div style={{ color: '#e0e0e0', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {d?.price ? fmtPrice(d.price) : '--'}
                  </div>
                  <div style={{ color, fontSize: 10, marginTop: 2 }}>
                    {fmtPct(pct)}
                  </div>
                </div>

                {/* Remove */}
                <button
                  onClick={e => { e.stopPropagation(); removeTicker(sym); }}
                  style={{
                    background: 'none', border: 'none', color: '#2a2a2a',
                    cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '4px 6px',
                    flexShrink: 0,
                  }}
                >×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default memo(WatchlistPanelMobile);
