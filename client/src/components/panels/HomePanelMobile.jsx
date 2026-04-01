/**
 * HomePanelMobile.jsx
 *
 * Mobile home panel — mirrors the user's desktop Home Saved Screen.
 * Each desktop panel becomes a tappable "box" showing its instruments.
 * - World clock header
 * - Search bar (navigates to search tab)
 * - "MY BOXES" derived from settings.panels + settings.layout.desktopRows
 * - "Today's Movers" section at bottom
 * Dark theme trading terminal interface.
 */

import { useState, useEffect, useMemo, memo } from 'react';
import { useStocksData, useForexData, useCryptoData } from '../../context/MarketContext';
import { useSettings } from '../../context/SettingsContext';
import { useWatchlist } from '../../context/WatchlistContext';
import { PANEL_DEFINITIONS } from '../../config/panels';

// Formatting helpers
function fmtPct(v) {
  return v == null ? '--' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
function fmtPrice(v, dec = 2) {
  return v == null ? '--' : v.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

// World clock (NY, SP, LDN) — updates every minute (seconds not displayed)
function WorldClock() {
  const [times, setTimes] = useState({});
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTimes({
        ny: new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })),
        sp: new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })),
        ldn: new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' })),
      });
    };
    update();
    const interval = setInterval(update, 60000); // 1-minute interval (seconds not displayed)
    return () => clearInterval(interval);
  }, []);
  const fmt = (d) => {
    if (!d || isNaN(d.getTime())) return '--:--';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return (
    <div style={{ display: 'flex', gap: 16, justifyContent: 'center', fontSize: 9, color: '#666', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'monospace' }}>
      <div>NY: {fmt(times.ny)}</div>
      <div>SP: {fmt(times.sp)}</div>
      <div>LDN: {fmt(times.ldn)}</div>
    </div>
  );
}

/** Look up price data across all markets */
function getPrice(sym, stocksData, forexData, cryptoData) {
  return stocksData[sym] || forexData[sym] || cryptoData[sym] || null;
}

/** Display-friendly symbol */
function displaySymbol(sym) {
  if (!sym) return '';
  if (sym.startsWith('C:')) return sym.slice(2, 5) + '/' + sym.slice(5);
  if (sym.startsWith('X:')) return sym.slice(2).replace('USD', '') + '/USD';
  if (sym.endsWith('.SA')) return sym.slice(0, -3);
  return sym;
}

function HomePanelMobile({ onOpenDetail, onSearchClick }) {
  const stocksData = useStocksData();
  const forexData = useForexData();
  const cryptoData = useCryptoData();
  const { settings } = useSettings();
  const { addTicker, isWatching } = useWatchlist();

  const [moversTab, setMoversTab] = useState('gainers');
  const [expandedBox, setExpandedBox] = useState(null);

  // Derive boxes from desktop panel settings + layout order
  const boxes = useMemo(() => {
    const desktopRows = settings?.layout?.desktopRows || [];
    // Flatten desktop rows to get panel order
    const orderedIds = desktopRows.flat();

    return orderedIds.map(panelId => {
      const userCfg = settings?.panels?.[panelId] || {};
      const def = PANEL_DEFINITIONS[panelId] || {};
      return {
        id: panelId,
        title: userCfg.title || def.defaultTitle || panelId,
        symbols: userCfg.symbols || def.defaultSymbols || [],
      };
    });
  }, [settings]);

  // Top gainers / losers from stocks data
  const gainers = useMemo(() =>
    Object.entries(stocksData)
      .filter(([, d]) => d.price != null && d.changePct != null)
      .sort(([, a], [, b]) => (b.changePct ?? 0) - (a.changePct ?? 0))
      .slice(0, 5),
    [stocksData]
  );
  const losers = useMemo(() =>
    Object.entries(stocksData)
      .filter(([, d]) => d.price != null && d.changePct != null)
      .sort(([, a], [, b]) => (a.changePct ?? 0) - (b.changePct ?? 0))
      .slice(0, 5),
    [stocksData]
  );

  // Styles
  const S = {
    container: {
      backgroundColor: '#0a0a0a', color: '#e0e0e0', fontFamily: 'monospace',
      padding: 12, paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      minHeight: '100vh', WebkitOverflowScrolling: 'touch', overflowY: 'auto',
    },
    skeleton: {
      backgroundColor: '#111', border: '1px solid #1e1e1e', borderRadius: 6,
      marginBottom: 10, height: 48, animation: 'pulse 1.5s ease-in-out infinite',
    },
    searchInput: {
      width: '100%', padding: 12, backgroundColor: '#0d0d0d',
      border: '2px solid #ff6600', borderRadius: 6, color: '#e0e0e0',
      fontSize: 14, fontFamily: 'monospace', cursor: 'pointer', boxSizing: 'border-box', outline: 'none',
    },
    sectionTitle: {
      color: '#ff6600', fontSize: 9, letterSpacing: '0.15em', fontWeight: 'bold',
      marginBottom: 8, marginTop: 12, textTransform: 'uppercase',
    },
    box: {
      backgroundColor: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 6,
      marginBottom: 10, overflow: 'hidden',
    },
    boxHeader: {
      padding: '12px', display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', cursor: 'pointer',
      WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.15)',
    },
    boxTitle: {
      color: '#ccc', fontSize: 10, fontWeight: 'bold', letterSpacing: '0.1em',
    },
    boxCount: {
      color: '#444', fontSize: 8, letterSpacing: '0.05em',
    },
    boxChevron: (expanded) => ({
      color: '#555', fontSize: 10, transition: 'transform 0.15s',
      transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
    }),
    row: {
      display: 'flex', justifyContent: 'space-between', padding: '8px 12px',
      borderTop: '1px solid #1a1a1a', fontSize: 11, cursor: 'pointer',
      alignItems: 'center', minHeight: 40,
      WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.15)',
    },
    rowSym: { display: 'flex', alignItems: 'center', gap: 8, flex: 1 },
    rowPrice: { fontSize: 12, fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right' },
    rowChange: (pct) => ({
      color: pct >= 0 ? '#00cc66' : '#ff4444', minWidth: 55, textAlign: 'right',
      fontSize: 11, fontVariantNumeric: 'tabular-nums',
    }),
    watchBtn: (watching) => ({
      background: 'none', border: 'none', color: watching ? '#ff6600' : '#666',
      fontSize: 16, cursor: 'pointer', padding: '4px 6px', flexShrink: 0, minHeight: 32, minWidth: 32,
    }),
    tabBtn: (active) => ({
      padding: '4px 8px', fontSize: 9, backgroundColor: active ? '#ff6600' : '#1a1a1a',
      color: active ? '#000' : '#666', border: 'none', borderRadius: 3, cursor: 'pointer',
      letterSpacing: '0.1em', fontWeight: 'bold', fontFamily: 'monospace',
    }),
  };

  return (
    <div style={S.container}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }`}</style>
      <WorldClock />

      {/* Search Bar */}
      <div style={{ padding: '0 0 12px', marginBottom: 12 }}>
        <input type="text" placeholder="Search instruments..." style={S.searchInput} onClick={onSearchClick} readOnly />
      </div>

      {/* My Boxes — mirrors desktop panels */}
      <div style={{ marginBottom: 12 }}>
        <div style={S.sectionTitle}>MY BOXES</div>

        {boxes.length === 0 ? (
          // Loading skeleton
          <>
            <div style={S.skeleton} />
            <div style={S.skeleton} />
            <div style={S.skeleton} />
          </>
        ) : (
          boxes.map((box) => {
          const expanded = expandedBox === box.id;
          return (
            <div key={box.id} style={S.box}>
              {/* Box header — tap to expand/collapse */}
              <div style={S.boxHeader} onClick={() => setExpandedBox(expanded ? null : box.id)}>
                <div>
                  <span style={S.boxTitle}>{box.title}</span>
                  <span style={{ ...S.boxCount, marginLeft: 8 }}>{box.symbols.length} instruments</span>
                </div>
                <span style={S.boxChevron(expanded)}>▼</span>
              </div>

              {/* Expanded: show instrument list */}
              {expanded && (
                <div>
                  {box.symbols.length === 0 ? (
                    <div style={{ color: '#333', fontSize: 10, padding: 12, textAlign: 'center', borderTop: '1px solid #1a1a1a' }}>
                      No instruments configured
                    </div>
                  ) : (
                    box.symbols.map((sym) => {
                      const data = getPrice(sym, stocksData, forexData, cryptoData);
                      const price = data?.price ?? null;
                      const changePct = data?.changePct ?? null;
                      return (
                        <div key={sym} style={S.row} onClick={() => onOpenDetail?.(sym)}>
                          <div style={S.rowSym}>
                            <span>{displaySymbol(sym)}</span>
                          </div>
                          <div style={S.rowPrice}>
                            {fmtPrice(price, sym.includes('USD') || sym.includes('/') ? 4 : 2)}
                          </div>
                          <div style={S.rowChange(changePct)}>
                            {fmtPct(changePct)}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); addTicker(sym); }}
                            style={S.watchBtn(isWatching(sym))}
                            title={isWatching(sym) ? 'In watchlist' : 'Add to watchlist'}
                          >
                            {isWatching(sym) ? '★' : '+'}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
          })
        )}
      </div>

      {/* Today's Movers */}
      <div style={S.box}>
        <div style={{ ...S.boxHeader, cursor: 'default' }}>
          <span style={S.boxTitle}>TODAY'S MOVERS</span>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 12px 8px' }}>
          {['gainers', 'losers'].map((tab) => (
            <button key={tab} onClick={() => setMoversTab(tab)} style={S.tabBtn(moversTab === tab)}>
              {tab === 'gainers' ? 'GAINERS' : 'LOSERS'}
            </button>
          ))}
        </div>

        {(moversTab === 'gainers' ? gainers : losers).map(([sym, data]) => (
          <div key={sym} style={S.row} onClick={() => onOpenDetail?.(sym)}>
            <div style={S.rowSym}><span>{sym}</span></div>
            <div style={S.rowPrice}>{fmtPrice(data.price, 2)}</div>
            <div style={S.rowChange(data.changePct)}>{fmtPct(data.changePct)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(HomePanelMobile);
