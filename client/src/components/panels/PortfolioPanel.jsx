/**
 * PortfolioPanel.jsx — Desktop portfolio holdings panel
 *
 * Phase 4A: Replaces WatchlistPanel with full portfolio view.
 * Phase 4C: Summary strip (total invested, current value, P&L, daily, best/worst),
 *           allocation mini-bars, benchmark comparison, sync-status indicator.
 *
 *   - Grid layout: TICKER | QTY | COST | LAST | P&L% | ✕
 *   - Live prices via useTickerPrice per row
 *   - Portfolio/subportfolio filter dropdown
 *   - Quick-add by symbol, Alt/Ctrl+click to edit, right-click context menu
 *   - PositionEditor modal for add/edit
 */

import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import PanelShell from '../common/PanelShell';
import PositionEditor from '../common/PositionEditor';
import EmptyState from '../common/EmptyState';
import AlertEditor from '../common/AlertEditor';
import { usePortfolio } from '../../context/PortfolioContext';
import { useTickerPrice } from '../../context/PriceContext';
import {
  fmt, fmtPct, fmtCompact, computeSummary, computeAllocation,
  computeBenchmarkComparison, suggestBenchmark, inferAssetType, assetTypeLabel,
} from '../../utils/portfolioAnalytics';
import './PortfolioPanel.css';

const COLS = '72px 56px 72px 72px 64px 20px 24px';

const showInfo = (e, symbol) => {
  e.preventDefault();
  let assetType = 'EQUITY';
  if (/^[A-Z]{6}$/.test(symbol)) assetType = symbol.endsWith('USD') ? 'CRYPTO' : 'FX';
  if (symbol.endsWith('.SA')) assetType = 'BR';
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label: symbol, type: assetType, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

// ── Sync status badge ──
const SyncBadge = memo(function SyncBadge({ syncStatus, onRetry }) {
  const styles = {
    idle:    { bg: 'transparent', color: 'var(--text-faint)', label: '' },
    syncing: { bg: 'rgba(255,153,0,0.15)', color: 'var(--accent-text)', label: 'syncing…' },
    synced:  { bg: 'rgba(76,175,80,0.12)',  color: 'var(--price-up)',    label: 'synced' },
    error:   { bg: 'rgba(244,67,54,0.12)',  color: 'var(--price-down)',  label: 'sync failed' },
  };
  const s = styles[syncStatus] || styles.idle;
  if (!s.label) return null;
  return (
    <span
      onClick={syncStatus === 'error' ? onRetry : undefined}
      title={syncStatus === 'error' ? 'Click to retry sync' : ''}
      className="pp-sync-badge"
      style={{
        background: s.bg, color: s.color,
        cursor: syncStatus === 'error' ? 'pointer' : 'default',
      }}
    >
      {s.label}
    </span>
  );
});

// ── Allocation mini-bar ──
const AllocationBar = memo(function AllocationBar({ items }) {
  if (!items || items.length === 0) return null;
  const colors = ['var(--accent)', 'var(--price-up)', '#5c6bc0', '#ab47bc', '#26a69a', '#ef5350', '#78909c'];
  return (
    <div className="flex-row pp-allocation-container">
      {items.map((item, i) => (
        <div
          key={item.key}
          title={`${item.label}: ${item.pct.toFixed(1)}%`}
          className="pp-allocation-segment"
          style={{
            flex: item.pct, background: colors[i % colors.length],
            minWidth: item.pct > 1 ? 2 : 0,
          }}
        />
      ))}
    </div>
  );
});

// ── Summary strip ──
const SummaryStrip = memo(function SummaryStrip({ positions, getPriceData, portfolios, benchmarkSymbol, benchmarkData }) {
  const summary = useMemo(() => computeSummary(positions, getPriceData), [positions, getPriceData]);
  const allocation = useMemo(() => computeAllocation(positions, getPriceData, 'assetType', portfolios), [positions, getPriceData, portfolios]);
  const benchmark = useMemo(() => {
    if (!benchmarkSymbol || !benchmarkData) return null;
    return computeBenchmarkComparison(summary, benchmarkData, benchmarkSymbol);
  }, [summary, benchmarkData, benchmarkSymbol]);

  if (positions.length === 0) return null;

  return (
    <div className="pp-summary-strip">
      {/* Metrics row */}
      <div className="flex-row pp-metrics-row">
        {summary.totalInvested != null && (
          <div className="metric-col">
            <span className="pp-metric-label">Invested</span>
            <span className="pp-metric-value">{fmtCompact(summary.totalInvested)}</span>
          </div>
        )}
        {summary.totalCurrentValue != null && (
          <div className="metric-col">
            <span className="pp-metric-label">Value</span>
            <span className="pp-metric-value">{fmtCompact(summary.totalCurrentValue)}</span>
          </div>
        )}
        {summary.totalPnlPct != null && (
          <div className="metric-col">
            <span className="pp-metric-label">P&L</span>
            <span className="pp-metric-value" style={{ color: summary.totalPnlPct >= 0 ? 'var(--price-up)' : 'var(--price-down)' }}>
              {fmtPct(summary.totalPnlPct)}
            </span>
          </div>
        )}
        {summary.dailyPnlPct != null && (
          <div className="metric-col">
            <span className="pp-metric-label">Day</span>
            <span className="pp-metric-value" style={{ color: summary.dailyPnlPct >= 0 ? 'var(--price-up)' : 'var(--price-down)' }}>
              {fmtPct(summary.dailyPnlPct)}
            </span>
          </div>
        )}
        {summary.bestPerformer && (
          <div className="metric-col">
            <span className="pp-metric-label">Best</span>
            <span className="pp-metric-value pp-metric-value-positive pp-metric-value-small">
              {summary.bestPerformer.symbol} {fmtPct(summary.bestPerformer.pnlPct)}
            </span>
          </div>
        )}
        {summary.worstPerformer && (
          <div className="metric-col">
            <span className="pp-metric-label">Worst</span>
            <span className="pp-metric-value pp-metric-value-negative pp-metric-value-small">
              {summary.worstPerformer.symbol} {fmtPct(summary.worstPerformer.pnlPct)}
            </span>
          </div>
        )}
        {benchmark && benchmark.relativePerformance != null && (
          <div className="metric-col">
            <span className="pp-metric-label">vs {benchmark.benchmarkSymbol}</span>
            <span className="pp-metric-value pp-metric-value-small" style={{ color: benchmark.outperforming ? 'var(--price-up)' : 'var(--price-down)' }}>
              {fmtPct(benchmark.relativePerformance)}
            </span>
          </div>
        )}
      </div>

      {/* Allocation bar */}
      <AllocationBar items={allocation} />
    </div>
  );
});

// ── Individual position row with live price ──
const PositionRow = memo(function PositionRow({ position, onTickerClick, onOpenDetail, onEdit, onRemove }) {
  const { price, changePct } = useTickerPrice(position.symbol) || {};
  const ptRef = useRef(null);

  const entryPrice = position.entryPrice;
  const livePrice  = price || null;
  let pnlPct = null;
  if (livePrice && entryPrice) {
    pnlPct = ((livePrice - entryPrice) / entryPrice) * 100;
  }

  return (
    <div
      data-ticker={position.symbol}
      onClick={(e) => {
        if (e.ctrlKey || e.altKey || e.metaKey) { onEdit(position); }
        else { onTickerClick?.(position.symbol); }
      }}
      onDoubleClick={() => onOpenDetail?.(position.symbol)}
      onContextMenu={(e) => showInfo(e, position.symbol)}
      onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(position.symbol), 500); }}
      onTouchEnd={() => clearTimeout(ptRef.current)}
      onTouchMove={() => clearTimeout(ptRef.current)}
      className="pp-row-container"
      style={{ gridTemplateColumns: COLS }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      <span className="pp-ticker-cell">{position.symbol}</span>
      <span className="pp-numeric-cell">
        {position.quantity != null ? position.quantity : '—'}
      </span>
      <span className="pp-numeric-cell">
        {fmt(entryPrice)}
      </span>
      <span className="pp-numeric-cell">
        {fmt(livePrice)}
      </span>
      <span className={`pp-pnl-cell ${pnlPct != null ? (pnlPct >= 0 ? 'pp-pnl-positive' : 'pp-pnl-negative') : 'pp-pnl-neutral'}`}>
        {fmtPct(pnlPct)}
      </span>
      <button className="btn pp-row-button pp-remove-button"
        onClick={e => { e.stopPropagation(); onRemove(position.id); }}
        title="Remove position"
        onMouseEnter={e => e.currentTarget.style.color = 'var(--price-down)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
      >✕</button>
    </div>
  );
});

// ── Main panel ──
function PortfolioPanel({ onTickerClick, onOpenDetail }) {
  const { portfolios, positions, removePosition, addTicker, syncStatus, retrySync } = usePortfolio();
  const [filterSubId, setFilterSubId] = useState('all');
  const [addInput, setAddInput]       = useState('');
  const [showAdd, setShowAdd]         = useState(false);
  const [editorPos, setEditorPos]     = useState(null);
  const [showEditor, setShowEditor]   = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (showAdd) setTimeout(() => inputRef.current?.focus(), 50);
  }, [showAdd]);

  // Build filter options
  const filterOptions = [];
  portfolios.forEach(p => {
    p.subportfolios.forEach(sp => {
      filterOptions.push({ value: sp.id, label: `${p.name} / ${sp.name}` });
    });
  });

  // Filter positions
  const filtered = filterSubId === 'all'
    ? positions
    : positions.filter(p => p.subportfolioId === filterSubId);

  // Determine benchmark symbol from first portfolio or suggest one
  const benchmarkSymbol = useMemo(() => {
    const firstPortfolio = portfolios[0];
    if (firstPortfolio?.benchmark) return firstPortfolio.benchmark;
    return suggestBenchmark(filtered);
  }, [portfolios, filtered]);

  // Get benchmark price data
  const benchmarkData = useTickerPrice(benchmarkSymbol);

  // Build a getPriceData function for summary metrics
  // We register all position symbols via PositionRow already.
  // For the summary strip we need a way to read their prices.
  // We'll use a PositionPriceCollector pattern: each row reports its price up.
  // Simpler: we create a PriceCollector component that registers all symbols
  // and passes data up. But that's complex. Instead, just use useTickerPrice
  // in a custom hook per symbol — not possible with dynamic list in hooks.
  //
  // Best approach: use a single component that maps all symbols and collects prices.
  // We'll use the position symbol list + a ref to store latest prices from PositionRow.
  //
  // Actually the simplest: import PriceCtx directly and use getPrice.
  const [priceSnapshot, setPriceSnapshot] = useState({});
  const priceSnapshotRef = useRef({});

  // Collect prices reported by rows
  const reportPrice = useCallback((symbol, data) => {
    if (data && data.price != null) {
      priceSnapshotRef.current[symbol] = data;
    }
  }, []);

  // Periodically update the snapshot for summary recomputation
  useEffect(() => {
    const timer = setInterval(() => {
      setPriceSnapshot({ ...priceSnapshotRef.current });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const getPriceData = useCallback((symbol) => {
    return priceSnapshot[symbol] || null;
  }, [priceSnapshot]);

  const handleAdd = (e) => {
    e.preventDefault();
    const sym = addInput.trim().toUpperCase();
    if (sym) { addTicker(sym); setAddInput(''); setShowAdd(false); }
  };

  const handleEdit = useCallback((position) => {
    setEditorPos(position);
  }, []);

  // Alert editor state
  const [alertEditorData, setAlertEditorData] = useState(null); // { symbol, price, entryPrice, positionId }

  const handleCreateAlert = useCallback((position, livePrice) => {
    setAlertEditorData({
      symbol: position.symbol,
      price: livePrice,
      entryPrice: position.entryPrice,
      positionId: position.id,
    });
  }, []);

  const handleCloseEditor = useCallback(() => {
    setEditorPos(null);
    setShowEditor(false);
    setAlertEditorData(null);
  }, []);

  return (
    <PanelShell>
      {/* Header */}
      <div className="flex-row pp-header">
        <span className="pp-header-title">📊 PORTFOLIO</span>
        <span className="pp-header-count">{filtered.length} positions</span>
        <SyncBadge syncStatus={syncStatus} onRetry={retrySync} />
        <div className="pp-spacer" />
        {filterOptions.length > 1 && (
          <select
            value={filterSubId}
            onChange={e => setFilterSubId(e.target.value)}
            className="pp-filter-select"
          >
            <option value="all">ALL</option>
            {filterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <button className="btn pp-add-button"
          onClick={() => setShowAdd(s => !s)}
          style={{ background: showAdd ? '#1a0d00' : 'none' }}
        >+ ADD</button>
      </div>

      {/* Summary strip */}
      <SummaryStrip
        positions={filtered}
        getPriceData={getPriceData}
        portfolios={portfolios}
        benchmarkSymbol={benchmarkSymbol}
        benchmarkData={benchmarkData}
      />

      {/* Quick-add ticker */}
      {showAdd && (
        <form onSubmit={handleAdd} className="flex-row pp-quick-add-form">
          <input
            ref={inputRef}
            value={addInput}
            onChange={e => setAddInput(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL or VALE3.SA"
            className="pp-add-input"
          />
          <button className="btn pp-submit-button" type="submit">ADD</button>
          <button className="btn pp-cancel-button" type="button" onClick={() => { setShowAdd(false); setAddInput(''); }}>✕</button>
        </form>
      )}

      {/* Column headers */}
      <div className="pp-headers" style={{ gridTemplateColumns: COLS }}>
        {['TICKER', 'QTY', 'COST', 'LAST', 'P&L%', '', ''].map((h, i) => (
          <span key={i} className={`pp-header-cell ${i >= 1 ? 'pp-header-cell-right' : ''}`}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div className="pp-rows-container">
        {filtered.length === 0 ? (
          <EmptyState
            icon="📊"
            title="No positions"
            message="Add a ticker to start tracking your portfolio."
          />
        ) : (
          filtered.map(pos => (
            <PositionRowWithReport
              key={pos.id}
              position={pos}
              onTickerClick={onTickerClick}
              onOpenDetail={onOpenDetail}
              onEdit={handleEdit}
              onRemove={removePosition}
              onReportPrice={reportPrice}
              onCreateAlert={handleCreateAlert}
            />
          ))
        )}
      </div>

      {/* PositionEditor modal — edit existing */}
      {editorPos && (
        <PositionEditor
          position={editorPos}
          onClose={handleCloseEditor}
        />
      )}

      {/* PositionEditor modal — add new */}
      {showEditor && (
        <PositionEditor
          position={null}
          defaultPortfolioId={portfolios[0]?.id}
          defaultSubportfolioId={portfolios[0]?.subportfolios[0]?.id}
          onClose={handleCloseEditor}
        />
      )}

      {/* AlertEditor modal — create alert from position */}
      {alertEditorData && (
        <AlertEditor
          alert={null}
          defaultSymbol={alertEditorData.symbol}
          defaultPrice={alertEditorData.price}
          defaultEntryPrice={alertEditorData.entryPrice}
          defaultPositionId={alertEditorData.positionId}
          onClose={handleCloseEditor}
        />
      )}
    </PanelShell>
  );
}

// ── Position row wrapper that reports price back to parent ──
const PositionRowWithReport = memo(function PositionRowWithReport({ position, onTickerClick, onOpenDetail, onEdit, onRemove, onReportPrice, onCreateAlert }) {
  const priceData = useTickerPrice(position.symbol);
  const ptRef = useRef(null);

  // Report price to parent for summary computation
  useEffect(() => {
    if (priceData) {
      onReportPrice(position.symbol, priceData);
    }
  }, [priceData, position.symbol, onReportPrice]);

  const entryPrice = position.entryPrice;
  const livePrice  = priceData?.price || null;
  let pnlPct = null;
  if (livePrice && entryPrice) {
    pnlPct = ((livePrice - entryPrice) / entryPrice) * 100;
  }

  return (
    <div
      data-ticker={position.symbol}
      onClick={(e) => {
        if (e.ctrlKey || e.altKey || e.metaKey) { onEdit(position); }
        else { onTickerClick?.(position.symbol); }
      }}
      onDoubleClick={() => onOpenDetail?.(position.symbol)}
      onContextMenu={(e) => showInfo(e, position.symbol)}
      onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(position.symbol), 500); }}
      onTouchEnd={() => clearTimeout(ptRef.current)}
      onTouchMove={() => clearTimeout(ptRef.current)}
      className="pp-row-container"
      style={{ gridTemplateColumns: COLS }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      <span className="pp-ticker-cell">{position.symbol}</span>
      <span className="pp-numeric-cell">
        {position.quantity != null ? position.quantity : '—'}
      </span>
      <span className="pp-numeric-cell">
        {fmt(entryPrice)}
      </span>
      <span className="pp-numeric-cell">
        {fmt(livePrice)}
      </span>
      <span className={`pp-pnl-cell ${pnlPct != null ? (pnlPct >= 0 ? 'pp-pnl-positive' : 'pp-pnl-negative') : 'pp-pnl-neutral'}`}>
        {fmtPct(pnlPct)}
      </span>
      <button className="btn pp-row-button"
        onClick={e => { e.stopPropagation(); onCreateAlert(position, livePrice); }}
        title="Create alert"
        style={{ fontSize: 8 }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
      >🔔</button>
      <button className="btn pp-row-button pp-remove-button"
        onClick={e => { e.stopPropagation(); onRemove(position.id); }}
        title="Remove position"
        onMouseEnter={e => e.currentTarget.style.color = 'var(--price-down)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
      >✕</button>
    </div>
  );
});

export default memo(PortfolioPanel);
