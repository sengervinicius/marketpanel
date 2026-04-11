/**
 * SectorUI.jsx — Reusable sector screen UI components
 *
 * Professional-grade components for sector screens:
 * - KPICard: Single metric with label, value, change
 * - KPIRibbon: Horizontal row of KPI cards
 * - HeatmapCell: Color-coded cell for performance tables
 * - SparklineRow: Table row with inline mini sparkline
 * - SectorAICard: Formatted AI insight bullets (not essay blocks)
 * - TickerRibbon: Horizontal scrolling ticker strip
 * - SectionHeader: Consistent section header with optional badge
 */
import { memo, useMemo } from 'react';
import { useTickerPrice } from '../../../context/PriceContext';

/* ── Helpers ─────────────────────────────────────────────────────────── */
const fmtNum = (n, d = 2) =>
  n == null || isNaN(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtPct = (n) =>
  n == null || isNaN(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

const fmtCompact = (n) => {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(2)}`;
};

/* ── Color scale for heatmap (-5% to +5% range) ─────────────────────── */
function heatColor(pct, intensity = 1) {
  if (pct == null || isNaN(pct)) return 'transparent';
  const clamped = Math.max(-5, Math.min(5, pct));
  const t = (clamped + 5) / 10; // 0 = deep red, 0.5 = neutral, 1 = deep green
  const r = Math.round(t < 0.5 ? 200 : 200 - (t - 0.5) * 2 * 160);
  const g = Math.round(t < 0.5 ? 40 + t * 2 * 160 : 200);
  const b = Math.round(40);
  return `rgba(${r}, ${g}, ${b}, ${0.15 * intensity})`;
}

/* ═══════════════════════════════════════════════════════════════════════
   KPICard — Single metric display
   ═══════════════════════════════════════════════════════════════════════ */
export const KPICard = memo(function KPICard({
  label,
  value,
  change,
  suffix = '',
  accentColor,
  small = false,
}) {
  const isUp = change != null && change >= 0;
  const changeColor = change == null ? 'var(--text-muted)'
    : isUp ? 'var(--semantic-up)' : 'var(--semantic-down)';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      padding: small ? '8px 10px' : '10px 14px',
      background: 'var(--bg-elevated)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 6,
      minWidth: small ? 90 : 110,
      flex: '1 1 0',
    }}>
      <span style={{
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text-muted)',
        letterSpacing: '0.8px',
        textTransform: 'uppercase',
        lineHeight: 1.2,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: small ? 15 : 17,
        fontWeight: 700,
        color: accentColor || 'var(--text-primary)',
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.2,
      }}>
        {value}{suffix}
      </span>
      {change != null && (
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: changeColor,
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}>
          {fmtPct(change)}
        </span>
      )}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   KPIRibbon — Horizontal row of KPI cards
   ═══════════════════════════════════════════════════════════════════════ */
export const KPIRibbon = memo(function KPIRibbon({ items = [], accentColor }) {
  return (
    <div style={{
      display: 'flex',
      gap: 8,
      padding: '6px 4px',
      overflowX: 'auto',
      scrollbarWidth: 'none',
    }}>
      {items.map((item, i) => (
        <KPICard
          key={i}
          label={item.label}
          value={item.value}
          change={item.change}
          suffix={item.suffix}
          accentColor={i === 0 ? accentColor : undefined}
          small={items.length > 4}
        />
      ))}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   HeatmapCell — Color-coded table cell
   ═══════════════════════════════════════════════════════════════════════ */
export const HeatmapCell = memo(function HeatmapCell({ value, format = 'pct' }) {
  const numVal = typeof value === 'number' ? value : parseFloat(value);
  const cls = numVal == null || isNaN(numVal) ? '' : numVal >= 0 ? 'ds-up' : 'ds-down';

  const formatted = format === 'pct' ? fmtPct(numVal)
    : format === 'number' ? fmtNum(numVal)
    : format === 'compact' ? fmtCompact(numVal)
    : String(value);

  return (
    <td className={cls}>
      {formatted}
    </td>
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   LiveTickerRow — Table row with live price from PriceContext
   ═══════════════════════════════════════════════════════════════════════ */
export const LiveTickerRow = memo(function LiveTickerRow({
  ticker,
  name,
  onClick,
  extraCols = [],
  accentColor,
}) {
  const priceData = useTickerPrice(ticker);
  const price = priceData?.price;
  const changePct = priceData?.changePct;
  const isUp = changePct != null ? changePct >= 0 : true;

  const displayTicker = (ticker || '')
    .replace(/^C:/, '').replace(/^X:/, '')
    .replace('.SA', '').replace('=F', '');

  return (
    <tr
      onClick={() => onClick?.(ticker)}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.15s',
      }}
    >
      <td className="ds-ticker-col" style={{ color: accentColor || 'var(--accent)' }}>
        {displayTicker}
      </td>
      <td style={{
        color: 'var(--text-muted)',
        fontSize: '9px',
        maxWidth: 120,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {name || displayTicker}
      </td>
      <td style={{
        color: 'var(--text-primary)',
        fontWeight: 600,
        textAlign: 'right',
      }}>
        {price != null ? fmtNum(price) : '—'}
      </td>
      <td className={changePct == null ? '' : isUp ? 'ds-up' : 'ds-down'} style={{
        textAlign: 'right',
      }}>
        {changePct != null ? fmtPct(changePct) : '—'}
      </td>
      {extraCols.map((col, i) => (
        <td key={i} style={{
          color: 'var(--text-secondary)',
          textAlign: 'right',
        }}>
          {col}
        </td>
      ))}
    </tr>
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   SectorTable — Professional table wrapper
   ═══════════════════════════════════════════════════════════════════════ */
export const SectorTable = memo(function SectorTable({
  headers = [],
  children,
  compact = false,
}) {
  return (
    <div style={{
      overflowX: 'auto',
      borderRadius: 4,
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: compact ? 10 : 11,
      }}>
        <thead>
          <tr style={{
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            {headers.map((h, i) => (
              <th key={i} style={{
                padding: compact ? '4px 6px' : '6px 8px',
                fontSize: 8,
                fontWeight: 700,
                color: 'var(--text-faint)',
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
                textAlign: i < 2 ? 'left' : 'right',
                whiteSpace: 'nowrap',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(255,255,255,0.02)',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
        </tbody>
      </table>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   TickerRibbon — Horizontal scrolling ticker strip
   ═══════════════════════════════════════════════════════════════════════ */
function TickerChip({ ticker, onClick }) {
  const priceData = useTickerPrice(ticker);
  const changePct = priceData?.changePct;
  const isUp = changePct != null ? changePct >= 0 : true;
  const displayTicker = (ticker || '')
    .replace(/^C:/, '').replace(/^X:/, '')
    .replace('.SA', '').replace('=F', '');

  return (
    <button
      onClick={() => onClick?.(ticker)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: 'var(--bg-elevated)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 4,
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'border-color 0.15s',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--text-primary)',
        letterSpacing: '0.3px',
      }}>
        {displayTicker}
      </span>
      {changePct != null && (
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: isUp ? 'var(--semantic-up)' : 'var(--semantic-down)',
        }}>
          {fmtPct(changePct)}
        </span>
      )}
    </button>
  );
}

export const TickerRibbon = memo(function TickerRibbon({ tickers = [], onClick }) {
  return (
    <div style={{
      display: 'flex',
      gap: 8,
      padding: '6px 0',
      overflowX: 'auto',
      scrollbarWidth: 'none',
    }}>
      {tickers.map(t => (
        <TickerChip key={t} ticker={t} onClick={onClick} />
      ))}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   SectionDivider — Visual section separator
   ═══════════════════════════════════════════════════════════════════════ */
export function SectionDivider({ label }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 0 4px',
    }}>
      <div style={{
        flex: 1,
        height: 1,
        background: 'rgba(255,255,255,0.06)',
      }} />
      {label && (
        <span style={{
          fontSize: 8,
          fontWeight: 700,
          color: 'var(--text-faint)',
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          {label}
        </span>
      )}
      <div style={{
        flex: 1,
        height: 1,
        background: 'rgba(255,255,255,0.06)',
      }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Exports
   ═══════════════════════════════════════════════════════════════════════ */
export { fmtNum, fmtPct, fmtCompact, heatColor };
