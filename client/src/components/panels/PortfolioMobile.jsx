/**
 * PortfolioMobile.jsx
 * Mobile-first portfolio panel showing holdings with prices
 *
 * Phase 4A: Portfolio/subportfolio filtering, entry price display, undo toast.
 * Phase 4C: Summary header (total value, P&L, daily move, positions count),
 *           allocation bar, sync-status indicator.
 *
 * Uses shared mobile CSS primitives (.m-search, .m-chip, .m-row, .m-toast, etc.)
 */

import { memo, useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { usePortfolio } from '../../context/PortfolioContext';
import { useStocksData, useForexData, useCryptoData } from '../../context/MarketContext';
import AlertEditor from '../common/AlertEditor';
import {
  fmtPct, fmtCompact, computeSummary, computeAllocation,
  inferAssetType, assetTypeLabel,
} from '../../utils/portfolioAnalytics';

function fmtPrice(v, dec = 2) {
  if (v == null) return '--';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ── Summary header for mobile ──
const MobileSummaryHeader = memo(function MobileSummaryHeader({ positions, getPriceData, portfolios, syncStatus, onRetry }) {
  const summary = useMemo(() => computeSummary(positions, getPriceData), [positions, getPriceData]);
  const allocation = useMemo(() => computeAllocation(positions, getPriceData, 'assetType', portfolios), [positions, getPriceData, portfolios]);

  if (positions.length === 0) return null;

  const syncLabel = syncStatus === 'syncing' ? 'syncing…'
    : syncStatus === 'synced' ? 'synced'
    : syncStatus === 'error' ? 'sync failed' : '';
  const syncColor = syncStatus === 'syncing' ? 'var(--accent-text)'
    : syncStatus === 'synced' ? 'var(--price-up)'
    : syncStatus === 'error' ? 'var(--price-down)' : 'transparent';

  const allocationColors = ['var(--accent)', 'var(--price-up)', '#5c6bc0', '#ab47bc', '#26a69a', '#ef5350', '#78909c'];

  return (
    <div style={{
      padding: 'var(--sp-3) var(--sp-4)',
      borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-surface)',
      flexShrink: 0,
    }}>
      {/* Top row: value + P&L */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div>
          {summary.totalCurrentValue != null ? (
            <span style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>
              ${fmtCompact(summary.totalCurrentValue)}
            </span>
          ) : summary.totalInvested != null ? (
            <span style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>
              ${fmtCompact(summary.totalInvested)}
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)', fontSize: 18, fontWeight: 700 }}>—</span>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>
            {summary.positionCount} position{summary.positionCount !== 1 ? 's' : ''}
          </span>
        </div>
        {syncLabel && (
          <span
            onClick={syncStatus === 'error' ? onRetry : undefined}
            style={{
              fontSize: 10, fontWeight: 600, color: syncColor,
              cursor: syncStatus === 'error' ? 'pointer' : 'default',
              textTransform: 'uppercase', letterSpacing: '0.5px',
            }}
          >
            {syncLabel}
          </span>
        )}
      </div>

      {/* Second row: P&L + daily change */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 6 }}>
        {summary.totalPnlPct != null && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total P&L</span>
            <span style={{
              color: summary.totalPnlPct >= 0 ? 'var(--price-up)' : 'var(--price-down)',
              fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            }}>
              {fmtPct(summary.totalPnlPct)}
              {summary.totalPnl != null && (
                <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 4, opacity: 0.7 }}>
                  ({summary.totalPnl >= 0 ? '+' : ''}{fmtCompact(summary.totalPnl)})
                </span>
              )}
            </span>
          </div>
        )}
        {summary.dailyPnlPct != null && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Day</span>
            <span style={{
              color: summary.dailyPnlPct >= 0 ? 'var(--price-up)' : 'var(--price-down)',
              fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            }}>
              {fmtPct(summary.dailyPnlPct)}
            </span>
          </div>
        )}
        {summary.bestPerformer && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Best</span>
            <span style={{ color: 'var(--price-up)', fontSize: 12, fontWeight: 600 }}>
              {summary.bestPerformer.symbol}
            </span>
          </div>
        )}
      </div>

      {/* Allocation bar */}
      {allocation.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 1, height: 5, borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
            {allocation.map((item, i) => (
              <div
                key={item.key}
                style={{
                  flex: item.pct, background: allocationColors[i % allocationColors.length],
                  minWidth: item.pct > 1 ? 2 : 0,
                  transition: 'flex 0.3s ease',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {allocation.filter(a => a.pct >= 5).map((item, i) => (
              <span key={item.key} style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                <span style={{
                  display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                  background: allocationColors[i % allocationColors.length],
                  marginRight: 3, verticalAlign: 'middle',
                }} />
                {item.label} {item.pct.toFixed(0)}%
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
});

function PortfolioMobile({ onOpenDetail, onManage }) {
  const { positions, portfolios, removePosition, addPosition, syncStatus, retrySync } = usePortfolio();
  const stocks = useStocksData();
  const forex = useForexData();
  const crypto = useCryptoData();

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('added');
  const [selectedPortfolios, setSelectedPortfolios] = useState(new Set());
  const [undoItem, setUndoItem] = useState(null);
  const undoTimerRef = useRef(null);

  const getData = useCallback((sym) => stocks[sym] || forex[sym] || crypto[sym] || null, [stocks, forex, crypto]);

  // Build portfolio filter options
  const portfolioFilterOptions = useMemo(() => {
    const options = [];
    portfolios.forEach(portfolio => {
      options.push({ label: portfolio.name, type: 'portfolio', id: portfolio.id });
      portfolio.subportfolios.forEach(sub => {
        options.push({ label: sub.name, type: 'subportfolio', id: sub.id });
      });
    });
    return options;
  }, [portfolios]);

  // Filter by search query and selected portfolios
  const filtered = useMemo(() => {
    let result = positions;
    if (searchQuery.trim()) {
      const q = searchQuery.toUpperCase();
      result = result.filter(pos => pos.symbol.toUpperCase().includes(q));
    }
    if (selectedPortfolios.size > 0) {
      result = result.filter(pos => selectedPortfolios.has(pos.subportfolioId));
    }
    return result;
  }, [positions, searchQuery, selectedPortfolios]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === 'name') {
      arr.sort((a, b) => a.symbol.localeCompare(b.symbol));
    } else if (sortBy === 'change') {
      arr.sort((a, b) => {
        const pctA = getData(a.symbol)?.changePct ?? 0;
        const pctB = getData(b.symbol)?.changePct ?? 0;
        return pctB - pctA;
      });
    } else if (sortBy === 'price') {
      arr.sort((a, b) => {
        const priceA = getData(a.symbol)?.price ?? 0;
        const priceB = getData(b.symbol)?.price ?? 0;
        return priceB - priceA;
      });
    } else if (sortBy === 'p&l') {
      arr.sort((a, b) => {
        const dataA = getData(a.symbol);
        const dataB = getData(b.symbol);
        const pnlA = dataA && a.quantity ? (dataA.price - (a.entryPrice ?? 0)) * a.quantity : 0;
        const pnlB = dataB && b.quantity ? (dataB.price - (b.entryPrice ?? 0)) * b.quantity : 0;
        return pnlB - pnlA;
      });
    }
    return arr;
  }, [filtered, sortBy, getData]);

  // Get subportfolio name for a position
  const getSubportfolioName = (pos) => {
    for (const portfolio of portfolios) {
      for (const sub of portfolio.subportfolios) {
        if (sub.id === pos.subportfolioId) return sub.name;
      }
    }
    return '';
  };

  const handleRemovePosition = (posId, symbol) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const posToUndo = positions.find(p => p.id === posId);
    setUndoItem({ id: posId, symbol, data: posToUndo });
    removePosition(posId);
    undoTimerRef.current = setTimeout(() => setUndoItem(null), 4000);
  };

  const handleUndo = () => {
    if (undoItem && undoItem.data) {
      addPosition(undoItem.data);
      setUndoItem(null);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    }
  };

  const togglePortfolioFilter = (id) => {
    const newSet = new Set(selectedPortfolios);
    if (newSet.has(id)) { newSet.delete(id); } else { newSet.add(id); }
    setSelectedPortfolios(newSet);
  };

  // Alert editor state
  const [alertEditorData, setAlertEditorData] = useState(null);

  const handleCreateAlert = useCallback((pos, price) => {
    setAlertEditorData({
      symbol: pos.symbol,
      price: price,
      entryPrice: pos.entryPrice,
      positionId: pos.id,
    });
  }, []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-app)', fontFamily: 'inherit',
    }}>
      {/* Header */}
      <div style={{
        padding: 'var(--sp-4)',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 600, letterSpacing: '-0.3px' }}>
          Portfolio
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {positions.length > 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(255, 102, 0, 0.12)',
              color: 'var(--accent)',
              fontSize: 12, fontWeight: 600,
              borderRadius: '50%', width: 24, height: 24,
            }}>{positions.length}</div>
          )}
          <button onClick={onManage} style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '2px solid var(--accent)',
            background: 'none', color: 'var(--accent)',
            fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
            WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.1)',
          }} title="Add instruments">+</button>
        </div>
      </div>

      {/* Summary header */}
      <MobileSummaryHeader
        positions={filtered}
        getPriceData={getData}
        portfolios={portfolios}
        syncStatus={syncStatus}
        onRetry={retrySync}
      />

      {/* Search, Sort, and Portfolio Filter (only when not empty) */}
      {positions.length > 0 && (
        <>
          <div style={{ padding: 'var(--sp-2) var(--sp-4)', flexShrink: 0 }}>
            <input
              type="text"
              className="m-search"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Sort chips */}
          <div style={{
            display: 'flex', gap: 8,
            padding: 'var(--sp-3) var(--sp-4)',
            flexShrink: 0, overflowX: 'auto', overflowY: 'hidden',
            scrollBehavior: 'smooth',
          }}>
            {['Added', 'Name', 'Change', 'Price', 'P&L'].map((label) => {
              const sortKey = label.toLowerCase();
              const isActive = sortBy === sortKey;
              return (
                <button
                  key={label}
                  className="m-chip"
                  data-active={isActive}
                  onClick={() => setSortBy(sortKey)}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Portfolio filter chips */}
          {portfolioFilterOptions.length > 0 && (
            <div style={{
              display: 'flex', gap: 8,
              padding: '0 var(--sp-4) var(--sp-3)',
              flexShrink: 0, overflowX: 'auto', overflowY: 'hidden',
              scrollBehavior: 'smooth',
            }}>
              {portfolioFilterOptions.map((opt) => {
                const isActive = selectedPortfolios.has(opt.id);
                return (
                  <button
                    key={opt.id}
                    className="m-chip"
                    data-active={isActive}
                    onClick={() => togglePortfolioFilter(opt.id)}
                    style={{
                      opacity: opt.type === 'subportfolio' ? 0.75 : 1,
                      fontSize: opt.type === 'subportfolio' ? 12 : 13,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* List or Empty State */}
      {positions.length === 0 ? (
        <div className="m-empty">
          <div className="m-empty-icon">★</div>
          <div className="m-empty-text">
            Your portfolio is empty.
            <br />
            Add instruments to track holdings.
          </div>
          <button className="m-btn-primary" onClick={onManage}>
            Add Instruments
          </button>
        </div>
      ) : (
        <div style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}>
          {sorted.length === 0 ? (
            <div style={{
              padding: 'var(--sp-8) var(--sp-4)',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}>
              {searchQuery.trim() ? `No results for "${searchQuery}"` : 'No positions match selected filters'}
            </div>
          ) : (
            sorted.map((pos) => {
              const d = getData(pos.symbol);
              const pct = d?.changePct;
              const subName = getSubportfolioName(pos);

              const displayAmount = pos.investedAmount != null
                ? fmtPrice(pos.investedAmount)
                : pos.entryPrice != null
                  ? fmtPrice(pos.entryPrice)
                  : '--';

              return (
                <div
                  key={pos.id}
                  className="m-row"
                  onClick={() => onOpenDetail?.(pos.symbol)}
                  style={{ padding: '0 var(--sp-4)', minHeight: 60 }}
                >
                  {/* Symbol + subportfolio name */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, letterSpacing: '-0.2px', marginBottom: 3 }}>
                      {pos.symbol}
                    </div>
                    {subName && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {subName}
                      </div>
                    )}
                  </div>

                  {/* Price + change */}
                  <div style={{ textAlign: 'right', marginRight: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginBottom: 3 }}>
                      {d?.price ? fmtPrice(d.price) : '--'}
                    </div>
                    <div style={{
                      color: pct == null ? 'var(--text-muted)' : pct >= 0 ? 'var(--price-up)' : 'var(--price-down)',
                      fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums',
                    }}>
                      {fmtPct(pct)}
                    </div>
                  </div>

                  {/* Entry amount / invested amount */}
                  <div style={{ textAlign: 'right', marginRight: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 60, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {displayAmount}
                    </div>
                  </div>

                  {/* Alert button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCreateAlert(pos, d?.price);
                    }}
                    style={{
                      width: 32, height: 32,
                      background: 'none', border: 'none',
                      color: 'var(--text-faint)', cursor: 'pointer',
                      fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                    title="Create alert"
                  >🔔</button>

                  {/* Remove button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePosition(pos.id, pos.symbol);
                    }}
                    style={{
                      width: 40, height: 40,
                      background: 'none', border: 'none',
                      color: 'var(--text-faint)', cursor: 'pointer',
                      fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0,
                      borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'color 0.15s ease',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Alert editor modal */}
      {alertEditorData && (
        <AlertEditor
          alert={null}
          defaultSymbol={alertEditorData.symbol}
          defaultPrice={alertEditorData.price}
          defaultEntryPrice={alertEditorData.entryPrice}
          defaultPositionId={alertEditorData.positionId}
          onClose={() => setAlertEditorData(null)}
          mobile
        />
      )}

      {/* Undo Toast */}
      {undoItem && (
        <div className="m-toast">
          <span>{undoItem.symbol} removed</span>
          <button
            onClick={handleUndo}
            style={{
              background: 'none', border: 'none',
              color: 'var(--accent)', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, padding: 0,
              minWidth: 'auto', minHeight: 'auto',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            UNDO
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(PortfolioMobile);
