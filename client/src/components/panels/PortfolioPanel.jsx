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
import Badge from '../ui/Badge';
import ShareModal from '../common/ShareModal';
import { usePortfolio } from '../../context/PortfolioContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useAuth } from '../../context/AuthContext';
import { apiJSON } from '../../utils/api';
import {
  fmt, fmtPct, fmtCompact, computeSummary, computeAllocation,
  computeBenchmarkComparison, suggestBenchmark, inferAssetType, assetTypeLabel,
} from '../../utils/portfolioAnalytics';
import './PortfolioPanel.css';

const COLS = '72px 56px 72px 72px 64px 20px 24px';

// ── MiniSparkline component ──
function MiniSparkline({ positive }) {
  // Generate a simple representative sparkline path
  const points = positive
    ? '0,16 8,14 16,12 24,13 32,10 40,8 48,6 56,5 60,3'
    : '0,3 8,5 16,6 24,5 32,8 40,10 48,13 56,14 60,16';
  const color = positive ? '#4caf50' : '#f44336';
  return (
    <svg width="60" height="18" viewBox="0 0 60 18" style={{ flexShrink: 0, opacity: 0.7 }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── AllocationDonut component ──
function AllocationDonut({ positions }) {
  if (!positions || positions.length < 2) return null;

  const total = positions.reduce((s, p) => s + Math.abs(p.value || p.quantity * (p.currentPrice || 0)), 0);
  if (total === 0) return null;

  // Top 5 + Other
  const sorted = [...positions].sort((a, b) =>
    Math.abs(b.value || b.quantity * (b.currentPrice || 0)) - Math.abs(a.value || a.quantity * (a.currentPrice || 0))
  );
  const top5 = sorted.slice(0, 5);
  const otherValue = sorted.slice(5).reduce((s, p) => s + Math.abs(p.value || p.quantity * (p.currentPrice || 0)), 0);

  const colors = ['#ff6600', '#4fc3f7', '#4caf50', '#e91e63', '#ffd54f', '#888'];
  const segments = top5.map((p, i) => ({
    label: p.symbol,
    value: Math.abs(p.value || p.quantity * (p.currentPrice || 0)),
    color: colors[i],
  }));
  if (otherValue > 0) segments.push({ label: 'Other', value: otherValue, color: colors[5] });

  // Build SVG arcs
  const size = 48, cx = 24, cy = 24, r = 18, strokeW = 6;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const dash = circumference * pct;
          const el = (
            <circle key={i} cx={cx} cy={cy} r={r}
              fill="none" stroke={seg.color} strokeWidth={strokeW}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', fontSize: 9, color: 'var(--text-muted)' }}>
        {segments.map((seg, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
            {seg.label}
          </span>
        ))}
      </div>
    </div>
  );
}

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
const SYNC_VARIANT = { syncing: 'accent', synced: 'success', error: 'error' };
const SYNC_LABEL   = { syncing: 'syncing', synced: 'synced', error: 'sync failed' };
const SyncBadge = memo(function SyncBadge({ syncStatus, onRetry }) {
  if (!SYNC_LABEL[syncStatus]) return null;
  return (
    <Badge
      variant={SYNC_VARIANT[syncStatus]}
      size="xs"
      className={syncStatus === 'error' ? 'pp-sync-badge--clickable' : ''}
    >
      <span onClick={syncStatus === 'error' ? onRetry : undefined}
        title={syncStatus === 'error' ? 'Click to retry sync' : ''}>
        {SYNC_LABEL[syncStatus]}
      </span>
    </Badge>
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

// ── AI Health Card ──
const AIHealthCard = memo(function AIHealthCard({ aiInsight, aiLoading, aiError, onRetry, onClose }) {
  if (!aiInsight && !aiLoading && !aiError) return null;

  const getRiskColor = (score) => {
    if (score <= 3) return '#4ade80'; // green
    if (score <= 6) return '#eab308'; // yellow
    return '#ef4444'; // red
  };

  if (aiLoading) {
    return (
      <div className="pp-ai-card">
        <div className="pp-ai-loading">
          <div className="pp-ai-pulse"></div>
          <span>Analyzing portfolio...</span>
        </div>
      </div>
    );
  }

  if (aiError) {
    return (
      <div className="pp-ai-card">
        <div className="pp-ai-error">
          <div className="pp-ai-error-text">{aiError}</div>
          <div className="flex-row" style={{ gap: '4px', marginTop: '8px' }}>
            <button className="pp-ai-retry-btn" onClick={onRetry}>Retry</button>
            <button className="pp-ai-close-btn" onClick={onClose}>Dismiss</button>
          </div>
        </div>
      </div>
    );
  }

  if (aiInsight) {
    return (
      <div className="pp-ai-card">
        <div className="pp-ai-card-header">
          <div className="flex-row" style={{ gap: '8px', alignItems: 'center', flex: 1 }}>
            <div
              className="pp-ai-risk-badge"
              style={{ backgroundColor: getRiskColor(aiInsight.riskScore) }}
              title={`Risk score: ${aiInsight.riskScore}/10`}
            >
              {aiInsight.riskScore}
            </div>
            <div className="pp-ai-risk-label">{aiInsight.riskLabel}</div>
          </div>
          <button className="pp-ai-close-btn" onClick={onClose} title="Close">×</button>
        </div>

        {aiInsight.summary && (
          <div className="pp-ai-summary">{aiInsight.summary}</div>
        )}

        {aiInsight.concentrationWarnings && aiInsight.concentrationWarnings.length > 0 && (
          <div className="pp-ai-warnings">
            <div className="pp-ai-section-title">Concentration Warnings</div>
            <ul className="pp-ai-list">
              {aiInsight.concentrationWarnings.map((warning, i) => (
                <li key={i} className="pp-ai-warning-item">{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {aiInsight.rebalanceSuggestions && aiInsight.rebalanceSuggestions.length > 0 && (
          <div className="pp-ai-suggestions">
            <div className="pp-ai-section-title">Rebalance Suggestions</div>
            <ul className="pp-ai-list">
              {aiInsight.rebalanceSuggestions.map((suggestion, i) => (
                <li key={i} className="pp-ai-suggestion-item">{suggestion}</li>
              ))}
            </ul>
          </div>
        )}

        {aiInsight.sectorExposure && Object.keys(aiInsight.sectorExposure).length > 0 && (
          <div className="pp-ai-sector-exposure">
            <div className="pp-ai-section-title">Sector Exposure</div>
            <div className="pp-ai-sector-grid">
              {Object.entries(aiInsight.sectorExposure).map(([sector, pct]) => (
                <div key={sector} className="pp-ai-sector-item">
                  <span className="pp-ai-sector-name">{sector}</span>
                  <span className="pp-ai-sector-pct">{(pct * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
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

      {/* Allocation donut */}
      <div style={{ marginTop: '8px', paddingBottom: '4px' }}>
        <AllocationDonut positions={positions} />
      </div>
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
  const { portfolios, positions, removePosition, syncStatus, retrySync } = usePortfolio();
  const { triggerGamificationEvent } = useAuth();
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
          🤖 AI HEALTH CHECK
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

      {/* Share modal */}
      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        cardType="portfolio"
        cardData={{ portfolioId: filterSubId !== 'all' ? filterSubId : undefined }}
        triggerGamificationEvent={triggerGamificationEvent}
      />
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
