/**
 * SectorPulse.jsx — Phase 3
 * Hero header block for sector screens. Shows 3–4 key metrics in a compact
 * 60px strip: sector ETF price + YTD return + vs SPX spread + AI summary.
 * Immediately communicates sector state at a glance.
 */
import { memo, useState, useEffect } from 'react';
import { useTickerPrice } from '../../../context/PriceContext';
import { apiFetch } from '../../../utils/api';

/**
 * Single metric cell — renders label, value, and optional color
 */
function PulseMetric({ label, value, color, mono = true }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      minWidth: 80,
    }}>
      <span style={{
        fontSize: 8,
        fontWeight: 600,
        letterSpacing: '1.2px',
        color: 'var(--text-faint)',
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 14,
        fontWeight: 700,
        color: color || 'var(--text-primary)',
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.3px',
      }}>
        {value}
      </span>
    </div>
  );
}

/**
 * SectorPulse — fixed 60px hero strip at top of every sector screen.
 *
 * Props:
 *   etfTicker   — sector ETF (e.g., "XLK", "XLE", "EWZ")
 *   etfLabel    — display name (e.g., "XLK")
 *   spxTicker   — benchmark ticker (default "SPY")
 *   accentColor — sector accent color
 *   aiSummary   — optional one-line AI summary string
 *   extraMetrics — optional [{label, value, color}] for sector-specific KPIs
 */
function SectorPulse({
  etfTicker,
  etfLabel,
  spxTicker = 'SPY',
  accentColor = 'var(--accent)',
  aiSummary,
  extraMetrics = [],
}) {
  const etf = useTickerPrice(etfTicker);
  const spx = useTickerPrice(spxTicker);

  // Compute vs SPX spread
  const spread = (etf?.changePct != null && spx?.changePct != null)
    ? (etf.changePct - spx.changePct)
    : null;

  // Format helpers
  const fmtPrice = (p) => {
    if (p == null) return '—';
    return p >= 1000
      ? p.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fmtPct = (v) => {
    if (v == null) return '—';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}%`;
  };

  const pctColor = (v) => {
    if (v == null) return 'var(--text-muted)';
    return v >= 0 ? 'var(--semantic-up)' : 'var(--semantic-down)';
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 24,
      padding: '10px 16px',
      minHeight: 60,
      maxHeight: 60,
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border-default)',
      borderLeft: `3px solid ${accentColor}`,
      overflowX: 'auto',
    }}>
      {/* ETF Price */}
      <PulseMetric
        label={etfLabel || etfTicker}
        value={fmtPrice(etf?.price)}
      />

      {/* Day Change */}
      <PulseMetric
        label="Day"
        value={fmtPct(etf?.changePct)}
        color={pctColor(etf?.changePct)}
      />

      {/* vs SPX Spread */}
      <PulseMetric
        label="vs SPX"
        value={spread != null ? fmtPct(spread) : '—'}
        color={spread != null ? pctColor(spread) : 'var(--text-muted)'}
      />

      {/* Extra sector-specific metrics */}
      {extraMetrics.map((m, i) => (
        <PulseMetric key={i} label={m.label} value={m.value} color={m.color} mono={m.mono !== false} />
      ))}

      {/* AI Summary — one-liner */}
      {aiSummary && (
        <div style={{
          flex: 1,
          minWidth: 120,
          fontSize: 11,
          color: 'var(--text-secondary)',
          fontStyle: 'italic',
          lineHeight: 1.4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          paddingLeft: 12,
          borderLeft: '1px solid var(--border-default)',
        }}>
          {aiSummary}
        </div>
      )}
    </div>
  );
}

export default memo(SectorPulse);
