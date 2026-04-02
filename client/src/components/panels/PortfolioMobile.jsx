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
import Badge from '../ui/Badge';
import {
  fmtPct, fmtCompact, computeSummary, computeAllocation,
  inferAssetType, assetTypeLabel,
} from '../../utils/portfolioAnalytics';
import './PortfolioMobile.css';

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
    <div className="pm-summary-header">
      {/* Top row: value + P&L */}
      <div className="flex-row pm-summary-top">
        <div>
          {summary.totalCurrentValue != null ? (
            <span className="pm-total-value">
              ${fmtCompact(summary.totalCurrentValue)}
            </span>
          ) : summary.totalInvested != null ? (
            <span className="pm-total-value">
              ${fmtCompact(summary.totalInvested)}
            </span>
          ) : (
            <span className="pm-total-placeholder">—</span>
          )}
          <span className="pm-position-count">
            {summary.positionCount} position{summary.positionCount !== 1 ? 's' : ''}
          </span>
        </div>
        {syncLabel && (
          <span
            className="pm-sync-label"
            onClick={syncStatus === 'error' ? onRetry : undefined}
            style={{
              color: syncColor,
              cursor: syncStatus === 'error' ? 'pointer' : 'default',
            }}
          >
            {syncLabel}
          </span>
        )}
      </div>

      {/* Second row: P&L + daily change */}
      <div className="flex-row pm-metrics-row">
        {summary.totalPnlPct != null && (
          <div className="flex-col">
            <span className="pm-metric-label">Total P&L</span>
            <span className="pm-metric-value" style={{
              color: summary.totalPnlPct >= 0 ? 'var(--price-up)' : 'var(--price-down)',
            }}>
              {fmtPct(summary.totalPnlPct)}
              {summary.totalPnl != null && (
                <span className="pm-metric-note">
                  ({summary.totalPnl >= 0 ? '+' : ''}{fmtCompact(summary.totalPnl)})
                </span>
              )}
            </span>
          </div>
        )}
        {summary.dailyPnlPct != null && (
          <div className="flex-col">
            <span className="pm-metric-label">Day</span>
            <span className="pm-metric-value" style={{
              color: summary.dailyPnlPct >= 0 ? 'var(--price-up)' : 'var(--price-down)',
            }}>
              {fmtPct(summary.dailyPnlPct)}
            </span>
          </div>
        )}
        {summary.bestPerformer && (
          <div className="flex-col">
            <span className="pm-metric-label">Best</span>
            <span className="pm-best-symbol">
              {summary.bestPerformer.symbol}
            </span>
          </div>
        )}
      </div>

      {/* Allocation bar */}
      {allocation.length > 0 && (
        <>
          <div className="flex-row pm-allocation-bar">
            {allocation.map((item, i) => (
              <div
                key={item.key}
                className="pm-allocation-segment"
                style={{
                  flex: item.pct, background: allocationColors[i % allocationColors.length],
                  minWidth: item.pct > 1 ? 2 : 0,
                }}
              />
            ))}
          </div>
          <div className="flex-row pm-allocation-legend">
            {allocation.filter(a => a.pct >= 5).map((item, i) => (
              <span key={item.key} className="pm-allocation-legend-item">
                <span className="pm-allocation-dot" style={{
                  background: allocationColors[i % allocationColors.length],
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
    <div className="flex-col pm-panel">
      {/* Header */}
      <div className="flex-row pm-header">
        <span className="pm-header-title">
          Portfolio
        </span>
        <div className="flex-row pm-header-controls">
          {positions.length > 0 && (
            <Badge variant="accent" size="xs">{positions.length}</Badge>
          )}
          <button className="btn flex-row pm-add-btn" onClick={onManage} title="Add instruments">+</button>
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
          <div className="pm-search-container">
            <input
              type="text"
              className="m-search"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Sort chips */}
          <div className="pm-sort-row">
            {['Added', 'Name', 'Change', 'Price', 'P&L'].map((label) => {
              const sortKey = label.toLowerCase();
              const isActive = sortBy === sortKey;
              return (
                <button className="btn m-chip"
                  key={label}
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
            <div className="pm-filter-row">
              {portfolioFilterOptions.map((opt) => {
                const isActive = selectedPortfolios.has(opt.id);
                const chipClass = opt.type === 'subportfolio' ? 'pm-filter-chip-sub' : 'pm-filter-chip-main';
                return (
                  <button className={`btn m-chip ${chipClass}`}
                    key={opt.id}
                    data-active={isActive}
                    onClick={() => togglePortfolioFilter(opt.id)}
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
        <div className="pp-empty">
          <div className="pp-empty-title">No positions yet</div>
          <div className="pp-empty-sub">Track your investments and monitor P&L in real time</div>
          <button className="pp-add-btn" onClick={onManage}>
            + Add Position
          </button>
        </div>
      ) : (
        <div className="pm-list-container">
          {sorted.length === 0 ? (
            <div className="pm-no-results">
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
                  className="m-row pm-position-row"
                  onClick={() => onOpenDetail?.(pos.symbol)}
                >
                  {/* Symbol + subportfolio name */}
                  <div className="pm-position-left">
                    <div className="pm-position-symbol">
                      {pos.symbol}
                    </div>
                    {subName && (
                      <div className="pm-position-subname">
                        {subName}
                      </div>
                    )}
                  </div>

                  {/* Price + change */}
                  <div className="pm-position-price">
                    <div className="pm-position-price-value">
                      {d?.price ? fmtPrice(d.price) : '--'}
                    </div>
                    <div className="pm-position-change" style={{
                      color: pct == null ? 'var(--text-muted)' : pct >= 0 ? 'var(--price-up)' : 'var(--price-down)',
                    }}>
                      {fmtPct(pct)}
                    </div>
                  </div>

                  {/* Entry amount / invested amount */}
                  <div className="pm-position-amount">
                    <div className="pm-position-amount-value">
                      {displayAmount}
                    </div>
                  </div>

                  {/* Alert button */}
                  <button className="btn pm-alert-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCreateAlert(pos, d?.price);
                    }}
                    title="Create alert"
                  ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>

                  {/* Remove button */}
                  <button className="btn pm-remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePosition(pos.id, pos.symbol);
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
          <button className="btn pm-undo-btn"
            onClick={handleUndo}
          >
            UNDO
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(PortfolioMobile);
