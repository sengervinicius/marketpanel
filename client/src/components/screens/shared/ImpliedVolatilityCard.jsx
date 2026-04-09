/**
 * ImpliedVolatilityCard.jsx — Phase C
 * Compact card showing implied volatility metrics for a ticker.
 * Fetches from /api/derivatives/iv/:ticker.
 */
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { apiFetch } from '../../../utils/api';

const TOKEN_HEX = {
  textPrimary:   '#e8e8ed',
  textSecondary: '#999999',
  textMuted:     '#555570',
  textFaint:     '#3a3a4a',
  accent:        '#ff6600',
  up:            '#22c55e',
  down:          '#ef4444',
};

function MetricRow({ label, value, color }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '4px 0',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
    }}>
      <span style={{ fontSize: 9, color: TOKEN_HEX.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </span>
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        color: color || TOKEN_HEX.textPrimary,
        fontFamily: 'var(--font-mono, monospace)',
      }}>
        {value || '—'}
      </span>
    </div>
  );
}

/** Visual gauge for IV percentile (0-100) */
function IVGauge({ value, accentColor }) {
  if (value == null) return null;
  const pct = Math.max(0, Math.min(100, value));
  const gaugeColor = pct > 70 ? TOKEN_HEX.down : pct > 40 ? TOKEN_HEX.accent : TOKEN_HEX.up;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 8,
        color: TOKEN_HEX.textFaint,
        marginBottom: 2,
      }}>
        <span>LOW</span>
        <span>IV RANK</span>
        <span>HIGH</span>
      </div>
      <div style={{
        width: '100%',
        height: 4,
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 2,
        position: 'relative',
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: gaugeColor,
          borderRadius: 2,
          transition: 'width 0.3s ease',
        }} />
        <div style={{
          position: 'absolute',
          top: -2,
          left: `${pct}%`,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: gaugeColor,
          border: '1px solid #0a0a0f',
          transform: 'translateX(-50%)',
        }} />
      </div>
    </div>
  );
}

export const ImpliedVolatilityCard = memo(function ImpliedVolatilityCard({
  ticker,
  label,
  accentColor,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchIV = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/derivatives/iv/${encodeURIComponent(ticker)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (mountedRef.current) setData(json);
    } catch {
      if (mountedRef.current) setData(null);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    mountedRef.current = true;
    fetchIV();
    return () => { mountedRef.current = false; };
  }, [fetchIV]);

  const displayTicker = label || ticker?.replace(/^C:/, '').replace(/^X:/, '');

  return (
    <div style={{
      background: 'var(--bg-elevated, #111118)',
      border: '1px solid var(--border-default, #1a1a2a)',
      borderRadius: 4,
      padding: '10px 12px',
      minWidth: 160,
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        color: accentColor || TOKEN_HEX.accent,
        marginBottom: 8,
        letterSpacing: 0.5,
      }}>
        {displayTicker}
      </div>

      {loading ? (
        <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TOKEN_HEX.textFaint, fontSize: 9 }}>
          Loading…
        </div>
      ) : !data || data.source === 'unavailable' ? (
        <div style={{ textAlign: 'center', color: TOKEN_HEX.textMuted, fontSize: 9, padding: '8px 0' }}>
          IV data unavailable
        </div>
      ) : (
        <>
          <MetricRow
            label="Implied Vol"
            value={data.iv != null ? `${(data.iv * 100).toFixed(1)}%` : null}
            color={TOKEN_HEX.textPrimary}
          />
          <MetricRow
            label="IV Rank"
            value={data.ivRank != null ? `${data.ivRank.toFixed(0)}` : null}
            color={data.ivRank > 70 ? TOKEN_HEX.down : data.ivRank > 40 ? TOKEN_HEX.accent : TOKEN_HEX.up}
          />
          <MetricRow
            label="IV Percentile"
            value={data.ivPercentile != null ? `${data.ivPercentile.toFixed(0)}th` : null}
          />
          <MetricRow
            label="Put/Call Ratio"
            value={data.putCallRatio != null ? data.putCallRatio.toFixed(2) : null}
            color={data.putCallRatio > 1.0 ? TOKEN_HEX.down : TOKEN_HEX.up}
          />
          <IVGauge value={data.ivRank} accentColor={accentColor} />
        </>
      )}
    </div>
  );
});

export default ImpliedVolatilityCard;
