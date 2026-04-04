/**
 * EquityCurveChart.jsx — Compact equity curve using Recharts.
 *
 * Props:
 *   snapshots: [{ asOf, equity, totalReturnPct }]
 *   height: number (default 120)
 *   startBalance: number (default 1_000_000)
 *   loading: boolean
 */

import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

function fmtUSD(v) {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtPct(v) {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(2)}%`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-strong)',
      borderRadius: 6,
      padding: '6px 10px',
      fontSize: 11,
      color: 'var(--text-primary)',
      lineHeight: '1.4',
    }}>
      <div style={{ fontWeight: 600 }}>{fmtUSD(d.equity)}</div>
      <div style={{ color: d.totalReturnPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
        {fmtPct(d.totalReturnPct)}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{fmtDate(d.asOf)}</div>
    </div>
  );
}

export default function EquityCurveChart({ snapshots = [], height = 120, startBalance = 1_000_000, loading = false }) {
  const chartData = useMemo(() =>
    snapshots.map(s => ({
      ...s,
      time: new Date(s.asOf).getTime(),
    })),
  [snapshots]);

  // Loading skeleton
  if (loading) {
    return (
      <div style={{
        height,
        background: 'var(--bg-surface)',
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 11,
      }}>
        Loading equity curve...
      </div>
    );
  }

  // Placeholder for < 2 snapshots
  if (chartData.length < 2) {
    return (
      <div style={{
        height,
        background: 'var(--bg-surface)',
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 12,
        textAlign: 'center',
        padding: '0 16px',
      }}>
        Place your first trade to start your equity curve.
      </div>
    );
  }

  const latestEquity = chartData[chartData.length - 1]?.equity ?? startBalance;
  const lineColor = latestEquity >= startBalance ? 'var(--green, #10b981)' : 'var(--red, #ef4444)';
  const fillColor = latestEquity >= startBalance ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)';

  return (
    <div style={{ width: '100%', height, overflow: 'hidden' }}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.15} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="time" hide />
          <YAxis domain={['auto', 'auto']} hide />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="equity"
            stroke={lineColor}
            strokeWidth={1.5}
            fill="url(#equityGradient)"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: lineColor }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
