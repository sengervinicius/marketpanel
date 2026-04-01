/**
 * HomePanelMobile.jsx
 *
 * Premium mobile-first home panel redesign.
 * - Market Summary Bar: horizontal scroll with key indices (SPY, QQQ, BTC)
 * - Search Bar: refined with icon styling
 * - MY SCREENS: card layout, expandable with all tickers (56px min-height), watchlist star
 * - TODAY'S MOVERS: horizontal cards, gainers/losers tabs
 * - Skeleton loaders, empty state, World Clock (subtle)
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

// Subtle world clock
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
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);
  const fmt = (d) => {
    if (!d || isNaN(d.getTime())) return '--:--';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return (
    <div style={{
      fontSize: 9,
      color: '#444',
      letterSpacing: '0.1em',
      marginBottom: 12,
      textAlign: 'center',
      fontFamily: 'inherit',
    }}>
      NY {fmt(times.ny)} | SP {fmt(times.sp)} | LDN {fmt(times.ldn)}
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

// Market Summary Bar — horizontal scroll with key indices
function MarketSummaryBar({ stocksData, cryptoData, onOpenDetail }) {
  const summarySymbols = ['SPY', 'QQQ', 'DIA', 'BTCUSD'];
  return (
    <div style={{
      display: 'flex',
      gap: 8,
      overflowX: 'auto',
      overflowY: 'hidden',
      paddingBottom: 8,
      marginBottom: 12,
      scrollBehavior: 'smooth',
      WebkitOverflowScrolling: 'touch',
    }}>
      {summarySymbols.map((sym) => {
        const data = getPrice(sym, stocksData, {}, cryptoData);
        if (!data || data.price == null) return null;
        const isPositive = (data.changePct ?? 0) >= 0;
        return (
          <button
            key={sym}
            onClick={() => onOpenDetail?.(sym)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px 12px',
              backgroundColor: '#0d0d0d',
              border: '1px solid #1a1a1a',
              borderRadius: 8,
              minWidth: 80,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#161616';
              e.currentTarget.style.borderColor = '#ff6600';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#0d0d0d';
              e.currentTarget.style.borderColor = '#1a1a1a';
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 'bold', color: '#e8e8e8', marginBottom: 4 }}>
              {displaySymbol(sym)}
            </div>
            <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: '#e8e8e8', marginBottom: 2 }}>
              {fmtPrice(data.price, 2)}
            </div>
            <div style={{
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
              color: isPositive ? '#00cc66' : '#ff4444',
              fontWeight: '500',
            }}>
              {fmtPct(data.changePct)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Skeleton loader card
function SkeletonCard() {
  return (
    <div style={{
      backgroundColor: '#0d0d0d',
      border: '1px solid #1a1a1a',
      borderRadius: 8,
      marginBottom: 10,
      height: 56,
      animation: 'shimmer 1.5s infinite',
    }} />
  );
}

// Expanded row for each ticker
function ExpandedTickerRow({ sym, data, onOpenDetail, onToggleWatch, isWatching }) {
  const price = data?.price ?? null;
  const changePct = data?.changePct ?? null;
  const isPositive = (changePct ?? 0) >= 0;

  return (
    <div
      onClick={() => onOpenDetail?.(sym)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 12px',
        borderTop: '1px solid #1a1a1a',
        minHeight: 56,
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#161616';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 'bold',
          color: '#e8e8e8',
          marginBottom: 2,
        }}>
          {displaySymbol(sym)}
        </div>
        <div style={{
          fontSize: 11,
          color: '#888',
        }}>
          {sym}
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <div style={{
          textAlign: 'right',
        }}>
          <div style={{
            fontSize: 13,
            fontVariantNumeric: 'tabular-nums',
            color: '#e8e8e8',
            marginBottom: 2,
          }}>
            {fmtPrice(price, 2)}
          </div>
          <div style={{
            fontSize: 12,
            fontVariantNumeric: 'tabular-nums',
            color: isPositive ? '#00cc66' : '#ff4444',
            fontWeight: '500',
          }}>
            {fmtPct(changePct)}
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleWatch(sym);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: isWatching ? '#ff6600' : '#666',
            fontSize: 18,
            cursor: 'pointer',
            padding: '4px 6px',
            minHeight: 36,
            minWidth: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.2s ease',
          }}
          title={isWatching ? 'In watchlist' : 'Add to watchlist'}
        >
          {isWatching ? '★' : '☆'}
        </button>
      </div>
    </div>
  );
}

// TODAY'S MOVERS card (horizontal layout)
function MoversCard({ symbol, data, onOpenDetail }) {
  const isPositive = (data?.changePct ?? 0) >= 0;
  return (
    <button
      onClick={() => onOpenDetail?.(symbol)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px 16px',
        backgroundColor: '#0d0d0d',
        border: '1px solid #1a1a1a',
        borderRadius: 8,
        minWidth: 100,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#161616';
        e.currentTarget.style.borderColor = '#ff6600';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = '#0d0d0d';
        e.currentTarget.style.borderColor = '#1a1a1a';
      }}
    >
      <div style={{
        fontSize: 12,
        fontWeight: 'bold',
        color: '#e8e8e8',
        marginBottom: 6,
      }}>
        {displaySymbol(symbol)}
      </div>
      <div style={{
        fontSize: 13,
        fontVariantNumeric: 'tabular-nums',
        color: '#e8e8e8',
        marginBottom: 4,
      }}>
        {fmtPrice(data.price, 2)}
      </div>
      <div style={{
        display: 'inline-block',
        padding: '3px 8px',
        borderRadius: 4,
        backgroundColor: isPositive ? 'rgba(0, 204, 102, 0.15)' : 'rgba(255, 68, 68, 0.15)',
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
        color: isPositive ? '#00cc66' : '#ff4444',
        fontWeight: '500',
      }}>
        {fmtPct(data.changePct)}
      </div>
    </button>
  );
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
      backgroundColor: '#060606',
      color: '#e8e8e8',
      fontFamily: 'inherit',
      padding: 12,
      paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      minHeight: '100vh',
      WebkitOverflowScrolling: 'touch',
      overflowY: 'auto',
    },
    sectionTitle: {
      color: '#ff6600',
      fontSize: 10,
      letterSpacing: '0.15em',
      fontWeight: 'bold',
      marginBottom: 10,
      marginTop: 12,
      textTransform: 'uppercase',
    },
    searchInput: {
      width: '100%',
      padding: '10px 12px 10px 36px',
      backgroundColor: '#0d0d0d',
      border: '1px solid #1a1a1a',
      borderRadius: 6,
      color: '#e8e8e8',
      fontSize: 13,
      fontFamily: 'inherit',
      cursor: 'pointer',
      boxSizing: 'border-box',
      outline: 'none',
      backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 16 16%22%3E%3Cpath fill=%22%23888%22 d=%22M6.5 1a5.5 5.5 0 014.384 8.884l4.3 4.3a.75.75 0 01-1.06 1.06l-4.3-4.3A5.5 5.5 0 116.5 1zm0 1.5a4 4 0 100 8 4 4 0 000-8z%22/%3E%3C/svg%3E")',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: '10px center',
      transition: 'border-color 0.2s ease',
    },
    card: {
      backgroundColor: '#0d0d0d',
      border: '1px solid #1a1a1a',
      borderRadius: 8,
      marginBottom: 10,
      overflow: 'hidden',
      transition: 'border-color 0.2s ease',
    },
    cardHeader: {
      padding: 12,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      cursor: 'pointer',
      transition: 'background-color 0.15s ease',
      WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.1)',
    },
    cardTitle: {
      color: '#e8e8e8',
      fontSize: 12,
      fontWeight: 'bold',
      letterSpacing: '0.05em',
    },
    cardSubtitle: {
      color: '#888',
      fontSize: 10,
      marginLeft: 8,
    },
    chevron: (expanded) => ({
      color: '#666',
      fontSize: 10,
      transition: 'transform 0.2s ease',
      transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
    }),
    tabBtn: (active) => ({
      padding: '6px 12px',
      fontSize: 10,
      fontWeight: 'bold',
      letterSpacing: '0.05em',
      backgroundColor: active ? '#ff6600' : '#1a1a1a',
      color: active ? '#060606' : '#888',
      border: 'none',
      borderRadius: 4,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'all 0.2s ease',
    }),
    emptyState: {
      padding: 24,
      textAlign: 'center',
      color: '#444',
      fontSize: 12,
      borderTop: '1px solid #1a1a1a',
    },
  };

  const isLoadingBoxes = boxes.length === 0;
  const hasGainers = gainers.length > 0;
  const hasLosers = losers.length > 0;

  return (
    <div style={S.container}>
      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>

      <WorldClock />

      {/* Market Summary Bar */}
      <MarketSummaryBar stocksData={stocksData} cryptoData={cryptoData} onOpenDetail={onOpenDetail} />

      {/* Search Bar */}
      <div style={{ marginBottom: 12, position: 'relative' }}>
        <input
          type="text"
          placeholder="Search instruments..."
          style={S.searchInput}
          onClick={onSearchClick}
          readOnly
        />
      </div>

      {/* MY SCREENS Section */}
      <div style={{ marginBottom: 12 }}>
        <div style={S.sectionTitle}>MY SCREENS</div>

        {isLoadingBoxes ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : boxes.length === 0 ? (
          <div style={{ ...S.card, ...S.emptyState }}>
            No screens configured. Add screens from the desktop view.
          </div>
        ) : (
          boxes.map((box) => {
            const expanded = expandedBox === box.id;
            const hasSymbols = box.symbols.length > 0;
            // Show first 3 tickers inline when collapsed
            const previewSymbols = box.symbols.slice(0, 3);

            return (
              <div key={box.id} style={S.card}>
                {/* Card Header */}
                <div
                  style={S.cardHeader}
                  onClick={() => setExpandedBox(expanded ? null : box.id)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#161616';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <div>
                    <span style={S.cardTitle}>{box.title}</span>
                    {hasSymbols && (
                      <span style={S.cardSubtitle}>
                        {previewSymbols.map((sym) => displaySymbol(sym)).join(' · ')}
                        {box.symbols.length > 3 && ` +${box.symbols.length - 3}`}
                      </span>
                    )}
                  </div>
                  <span style={S.chevron(expanded)}>▼</span>
                </div>

                {/* Expanded List */}
                {expanded && (
                  <div>
                    {!hasSymbols ? (
                      <div style={S.emptyState}>No instruments configured</div>
                    ) : (
                      box.symbols.map((sym) => {
                        const data = getPrice(sym, stocksData, forexData, cryptoData);
                        return (
                          <ExpandedTickerRow
                            key={sym}
                            sym={sym}
                            data={data}
                            onOpenDetail={onOpenDetail}
                            onToggleWatch={addTicker}
                            isWatching={isWatching(sym)}
                          />
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

      {/* TODAY'S MOVERS Section */}
      <div style={{ marginBottom: 12 }}>
        <div style={S.sectionTitle}>TODAY'S MOVERS</div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {['gainers', 'losers'].map((tab) => (
            <button
              key={tab}
              onClick={() => setMoversTab(tab)}
              style={S.tabBtn(moversTab === tab)}
            >
              {tab === 'gainers' ? 'GAINERS' : 'LOSERS'}
            </button>
          ))}
        </div>

        {/* Horizontal Scroll Cards */}
        <div style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          overflowY: 'hidden',
          paddingBottom: 8,
          scrollBehavior: 'smooth',
          WebkitOverflowScrolling: 'touch',
        }}>
          {moversTab === 'gainers' ? (
            hasGainers ? (
              gainers.map(([sym, data]) => (
                <MoversCard
                  key={sym}
                  symbol={sym}
                  data={data}
                  onOpenDetail={onOpenDetail}
                />
              ))
            ) : (
              <div style={{ ...S.emptyState, width: '100%' }}>No gainers data available</div>
            )
          ) : (
            hasLosers ? (
              losers.map(([sym, data]) => (
                <MoversCard
                  key={sym}
                  symbol={sym}
                  data={data}
                  onOpenDetail={onOpenDetail}
                />
              ))
            ) : (
              <div style={{ ...S.emptyState, width: '100%' }}>No losers data available</div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(HomePanelMobile);
