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
import './HomePanelMobile.css';

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
    <div className="hpm-skeleton" />
  );
}

// Expanded row for each ticker inside a box
function ExpandedTickerRow({ sym, data, onOpenDetail, onToggleWatch, isWatching }) {
  const price = data?.price ?? null;
  const changePct = data?.changePct ?? null;
  const isPositive = (changePct ?? 0) >= 0;

  return (
    <div
      className="hpm-ticker-row"
      onClick={() => onOpenDetail?.(sym)}
    >
      <div className="hpm-ticker-info">
        <div className="hpm-ticker-display">
          {displaySymbol(sym)}
        </div>
        <div className="hpm-ticker-symbol">
          {sym}
        </div>
      </div>

      <div className="flex-row" style={{ gap: 12 }}>
        <div className="hpm-ticker-price">
          <div className="hpm-ticker-price-value">
            {fmtPrice(price, 2)}
          </div>
          <div className={`hpm-ticker-price-change ${isPositive ? 'hpm-ticker-price-change-positive' : 'hpm-ticker-price-change-negative'}`}>
            {fmtPct(changePct)}
          </div>
        </div>

        <button className={`btn flex-row hpm-ticker-watch-btn ${isWatching ? 'hpm-ticker-watch-btn-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleWatch(sym);
          }}
          title={isWatching ? 'In watchlist' : 'Add to watchlist'}
        >
          {isWatching ? '★' : '☆'}
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
    <div className="hpm-container">
      {/* Search Bar */}
      <div className="hpm-search-container">
        <input
          type="text"
          className="m-search"
          placeholder="Search instruments..."
          onClick={onSearchClick}
          readOnly
        />
      </div>

      {/* Your Screens — derived from desktop layout */}
      <div className="hpm-screens-section">
        <div className="hpm-section-label">YOUR SCREENS</div>

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
              <div key={box.id} className="hpm-card">
                {/* Card Header */}
                <div
                  className="hpm-card-header"
                  onClick={() => setExpandedBox(expanded ? null : box.id)}
                >
                  <div className="hpm-card-header-info">
                    <span className="hpm-card-title">{box.title}</span>
                    {hasSymbols && (
                      <span className="hpm-card-subtitle">
                        {previewSymbols.map((sym) => displaySymbol(sym)).join(' · ')}
                        {box.symbols.length > 3 && ` +${box.symbols.length - 3}`}
                      </span>
                    )}
                  </div>
                  <span className={`hpm-card-chevron ${expanded ? 'hpm-card-chevron-rotated' : ''}`}>▼</span>
                </div>

                {/* Expanded List */}
                {expanded && (
                  <div className="hpm-card-content">
                    {!hasSymbols ? (
                      <div className="hpm-card-empty">No instruments configured</div>
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
