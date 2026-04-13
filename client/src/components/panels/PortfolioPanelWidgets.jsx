/**
 * PortfolioPanelWidgets.jsx — Extracted sub-components for PortfolioPanel.
 * Pure presentational components: MiniSparkline, AllocationDonut, SyncBadge,
 * AllocationBar, AIHealthCard, SummaryStrip, showInfo helper.
 */

import { memo, useMemo } from 'react';
import Badge from '../ui/Badge';
import {
  fmtPct, fmtCompact, computeSummary, computeAllocation,
  computeBenchmarkComparison,
} from '../../utils/portfolioAnalytics';

// ── MiniSparkline component ──
export function MiniSparkline({ positive }) {
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
export function AllocationDonut({ positions }) {
  if (!positions || positions.length < 2) return null;

  const total = positions.reduce((s, p) => s + Math.abs(p.value || p.quantity * (p.currentPrice || 0)), 0);
  if (total === 0) return null;

  // Top 5 + Other
  const sorted = [...positions].sort((a, b) =>
    Math.abs(b.value || b.quantity * (b.currentPrice || 0)) - Math.abs(a.value || a.quantity * (a.currentPrice || 0))
  );
  const top5 = sorted.slice(0, 5);
  const otherValue = sorted.slice(5).reduce((s, p) => s + Math.abs(p.value || p.quantity * (p.currentPrice || 0)), 0);

  const colors = ['#F97316', '#4fc3f7', '#4caf50', '#e91e63', '#ffd54f', '#888'];
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

export const showInfo = (e, symbol) => {
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
export const SyncBadge = memo(function SyncBadge({ syncStatus, onRetry }) {
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
export const AllocationBar = memo(function AllocationBar({ items }) {
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
export const AIHealthCard = memo(function AIHealthCard({ aiInsight, aiLoading, aiError, onRetry, onClose }) {
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
export const SummaryStrip = memo(function SummaryStrip({ positions, getPriceData, portfolios, benchmarkSymbol, benchmarkData }) {
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
