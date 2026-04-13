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
import ShareModal from '../common/ShareModal';
import { usePortfolio } from '../../context/PortfolioContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useAuth } from '../../context/AuthContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { apiJSON } from '../../utils/api';
import {
  fmt, fmtPct, suggestBenchmark, inferAssetType, assetTypeLabel,
} from '../../utils/portfolioAnalytics';
import {
  MiniSparkline, AllocationDonut, showInfo, SyncBadge,
  AllocationBar, AIHealthCard, SummaryStrip,
} from './PortfolioPanelWidgets';
import './PortfolioPanel.css';

const COLS = '72px 56px 72px 72px 64px 20px 24px';

// ── Individual position row with live price ──
const PositionRow = memo(function PositionRow({ position, onTickerClick, onEdit, onRemove }) {
  const openDetail = useOpenDetail();
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
      onDoubleClick={() => openDetail(position.symbol)}
      onContextMenu={(e) => showInfo(e, position.symbol)}
      onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => openDetail(position.symbol), 500); }}
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
function PortfolioPanel({ onTickerClick }) {
  const openDetail = useOpenDetail();
  const { portfolios, positions, removePosition, syncStatus, retrySync } = usePortfolio();
  const [filterSubId, setFilterSubId] = useState('all');
  const [editorPos, setEditorPos]     = useState(null);
  const [showEditor, setShowEditor]   = useState(false);
  const [shareOpen, setShareOpen]     = useState(false);

  // AI Health Check state
  const [aiInsight, setAiInsight] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const priceSnapshotRef = useRef({});

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

  // AI Health Check handler
  const handleAIHealthCheck = useCallback(async () => {
    if (filtered.length === 0) {
      setAiError('No positions to analyze');
      return;
    }

    setAiLoading(true);
    setAiError(null);
    setAiInsight(null);

    try {
      // Calculate total portfolio value from positions
      let totalValue = 0;
      const positionsData = filtered.map(pos => {
        const priceData = priceSnapshot[pos.symbol] || {};
        const currentPrice = priceData.price || pos.entryPrice || 0;
        const positionValue = (pos.quantity || 0) * currentPrice;
        totalValue += positionValue;
        return {
          symbol: pos.symbol,
          weight: positionValue,
          returnPct: pos.entryPrice
            ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100
            : 0,
          sector: pos.sector || 'Unknown',
        };
      });

      // Compute weights as fractions
      if (totalValue > 0) {
        positionsData.forEach(p => {
          p.weight = p.weight / totalValue;
        });
      }

      const response = await apiJSON('/api/search/portfolio-insight', {
        method: 'POST',
        body: JSON.stringify({
          positions: positionsData,
          totalValue,
        }),
      });

      setAiInsight(response);
    } catch (err) {
      setAiError(err.message || 'Failed to analyze portfolio');
    } finally {
      setAiLoading(false);
    }
  }, [filtered, priceSnapshot]);

  const handleAIRetry = useCallback(() => {
    handleAIHealthCheck();
  }, [handleAIHealthCheck]);

  const handleAIClose = useCallback(() => {
    setAiInsight(null);
    setAiError(null);
    setAiLoading(false);
  }, []);

  return (
    <PanelShell>
      {/* Header */}
      <div className="flex-row pp-header">
        <span className="pp-header-title">PORTFOLIO</span>
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
        <button
          className="pp-ai-btn"
          onClick={handleAIHealthCheck}
          disabled={filtered.length === 0 || aiLoading}
          title="Run AI health check on portfolio"
        >
          AI HEALTH CHECK
        </button>
        <button className="pp-add-btn pp-add-btn--compact" onClick={() => setShareOpen(true)} title="Share portfolio">
          SHARE
        </button>
        <button className="pp-add-btn pp-add-btn--compact" onClick={() => setShowEditor(true)}>
          + ADD
        </button>
      </div>

      {/* AI Health Card */}
      <AIHealthCard
        aiInsight={aiInsight}
        aiLoading={aiLoading}
        aiError={aiError}
        onRetry={handleAIRetry}
        onClose={handleAIClose}
      />

      {/* Summary strip */}
      <SummaryStrip
        positions={filtered}
        getPriceData={getPriceData}
        portfolios={portfolios}
        benchmarkSymbol={benchmarkSymbol}
        benchmarkData={benchmarkData}
      />

      {/* Column headers */}
      <div className="pp-headers" style={{ gridTemplateColumns: COLS }}>
        {['TICKER', 'QTY', 'COST', 'LAST', 'P&L%', '', ''].map((h, i) => (
          <span key={i} className={`pp-header-cell ${i >= 1 ? 'pp-header-cell-right' : ''}`}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div className="pp-rows-container">
        {filtered.length === 0 ? (
          <div className="pp-empty">
            <div className="pp-empty-title">No positions yet</div>
            <div className="pp-empty-sub">Track your investments and monitor P&L in real time</div>
            <button className="pp-add-btn" onClick={() => setShowEditor(true)}>
              + Add Position
            </button>
          </div>
        ) : (
          filtered.map(pos => (
            <PositionRowWithReport
              key={pos.id}
              position={pos}
              onTickerClick={onTickerClick}
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

      {/* Share modal */}
      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        cardType="portfolio"
        cardData={{ portfolioId: filterSubId !== 'all' ? filterSubId : undefined }}
      />
    </PanelShell>
  );
}

// ── Position row wrapper that reports price back to parent ──
const PositionRowWithReport = memo(function PositionRowWithReport({ position, onTickerClick, onEdit, onRemove, onReportPrice, onCreateAlert }) {
  const openDetail = useOpenDetail();
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
      onDoubleClick={() => openDetail(position.symbol)}
      onContextMenu={(e) => showInfo(e, position.symbol)}
      onTouchStart={(e) => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => openDetail(position.symbol), 500); }}
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
      <span className={`pp-pnl-cell ${pnlPct != null ? (pnlPct >= 0 ? 'pp-pnl-positive' : 'pp-pnl-negative') : 'pp-pnl-neutral'}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
        {fmtPct(pnlPct)}
        <MiniSparkline positive={pnlPct != null && pnlPct >= 0} />
      </span>
      <button className="btn pp-row-button"
        onClick={e => { e.stopPropagation(); onCreateAlert(position, livePrice); }}
        title="Create alert"
        style={{ fontSize: 8 }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
      ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>
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
