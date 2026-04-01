/**
 * HomePanelMobile.jsx
 *
 * Mobile Home tab — shows the user's desktop screens/boxes.
 * Each box is derived from settings.layout.desktopRows + PANEL_DEFINITIONS.
 * Tapping a box expands it to show its tickers with live prices.
 * Tapping a ticker opens InstrumentDetail.
 */

import { useState, useMemo, memo } from 'react';
import { useStocksData, useForexData, useCryptoData } from '../../context/MarketContext';
import { useSettings } from '../../context/SettingsContext';
import { useWatchlist } from '../../context/PortfolioContext';
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

// Skeleton loader card
function SkeletonCard() {
  return (
    <div className="m-card" style={{ height: 56, animation: 'shimmer 1.5s infinite' }} />
  );
}

// Expanded row for each ticker inside a box
function ExpandedTickerRow({ sym, data, onOpenDetail, onToggleWatch, isWatching }) {
  const price = data?.price ?? null;
  const changePct = data?.changePct ?? null;
  const isPositive = (changePct ?? 0) >= 0;

  return (
    <div
      className="m-row"
      onClick={() => onOpenDetail?.(sym)}
      style={{ padding: '0 var(--sp-4)', borderTop: '1px solid var(--border-subtle)' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 2,
        }}>
          {displaySymbol(sym)}
        </div>
        <div style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {sym}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 14,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-primary)',
            marginBottom: 2,
          }}>
            {fmtPrice(price, 2)}
          </div>
          <div style={{
            fontSize: 12,
            fontVariantNumeric: 'tabular-nums',
            color: isPositive ? 'var(--price-up)' : 'var(--price-down)',
            fontWeight: 500,
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
            color: isWatching ? 'var(--accent)' : 'var(--text-muted)',
            fontSize: 20,
            cursor: 'pointer',
            padding: '4px 6px',
            minHeight: 44,
            minWidth: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.2s ease',
          }}
          title={isWatching ? 'In watchlist' : 'Add to watchlist'}
        >
          {isWatching ? '\u2605' : '\u2606'}
        </button>
      </div>
    </div>
  );
}

function HomePanelMobile({ onOpenDetail, onSearchClick }) {
  const stocksData = useStocksData();
  const forexData = useForexData();
  const cryptoData = useCryptoData();
  const { settings } = useSettings();
  const { addTicker, isWatching } = useWatchlist();

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

  const isLoadingBoxes = boxes.length === 0;

  return (
    <div style={{
      background: 'var(--bg-app)',
      color: 'var(--text-primary)',
      fontFamily: 'inherit',
      padding: 'var(--sp-4)',
      paddingBottom: 'calc(var(--sp-4) + env(safe-area-inset-bottom, 0px))',
      minHeight: '100vh',
      WebkitOverflowScrolling: 'touch',
      overflowY: 'auto',
    }}>
      {/* Search Bar */}
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <input
          type="text"
          className="m-search"
          placeholder="Search instruments..."
          onClick={onSearchClick}
          readOnly
        />
      </div>

      {/* Your Screens — derived from desktop layout */}
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="m-section-label">YOUR SCREENS</div>

        {isLoadingBoxes ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : boxes.length === 0 ? (
          <div className="m-empty">
            <div className="m-empty-text">
              No screens configured. Add screens from the desktop view.
            </div>
          </div>
        ) : (
          boxes.map((box) => {
            const expanded = expandedBox === box.id;
            const hasSymbols = box.symbols.length > 0;
            const previewSymbols = box.symbols.slice(0, 3);

            return (
              <div key={box.id} className="m-card">
                {/* Card Header */}
                <div
                  className="m-card-header"
                  onClick={() => setExpandedBox(expanded ? null : box.id)}
                >
                  <div style={{ minWidth: 0 }}>
                    <span style={{
                      color: 'var(--text-primary)',
                      fontSize: 13,
                      fontWeight: 600,
                      letterSpacing: '0.03em',
                    }}>{box.title}</span>
                    {hasSymbols && (
                      <span style={{
                        color: 'var(--text-secondary)',
                        fontSize: 11,
                        marginLeft: 8,
                      }}>
                        {previewSymbols.map((sym) => displaySymbol(sym)).join(' \u00B7 ')}
                        {box.symbols.length > 3 && ` +${box.symbols.length - 3}`}
                      </span>
                    )}
                  </div>
                  <span style={{
                    color: 'var(--text-muted)',
                    fontSize: 10,
                    transition: 'transform 0.2s ease',
                    transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}>{'\u25BC'}</span>
                </div>

                {/* Expanded List */}
                {expanded && (
                  <div>
                    {!hasSymbols ? (
                      <div style={{
                        padding: 'var(--sp-6)',
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        fontSize: 12,
                        borderTop: '1px solid var(--border-subtle)',
                      }}>No instruments configured</div>
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
    </div>
  );
}

export default memo(HomePanelMobile);
