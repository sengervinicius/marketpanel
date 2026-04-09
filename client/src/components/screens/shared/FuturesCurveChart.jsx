/**
 * FuturesCurveChart.jsx — Phase C
 * Line chart showing the term structure of commodity futures.
 * Fetches from /api/derivatives/futures/:symbol.
 * Shows contango/backwardation visual cues.
 */
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from 'recharts';
import { apiFetch } from '../../../utils/api';

const TOKEN_HEX = {
  bgSurface:     '#0d0d14',
  borderDefault: '#1a1a2a',
  textPrimary:   '#e8e8ed',
  textSecondary: '#999999',
  textMuted:     '#555570',
  textFaint:     '#3a3a4a',
  accent:        '#ff6600',
  up:            '#22c55e',
  down:          '#ef4444',
};

function CurveTooltip({ active, payload }) {
  if (active && payload && payload[0]) {
    const d = payload[0].payload;
    return (
      <div style={{
        background: 'var(--bg-tooltip, #111118)',
        border: '1px solid var(--border-strong, #2a2a3a)',
        padding: '6px 10px',
        borderRadius: 4,
        fontSize: 10,
        color: TOKEN_HEX.textPrimary,
        boxShadow: '0 2px 12px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontWeight: 600 }}>{d.contract || d.label || d.month}</div>
        <div style={{ marginTop: 2 }}>
          Price: <span style={{ color: TOKEN_HEX.accent }}>${d.price?.toFixed(2) || '—'}</span>
        </div>
        {d.change != null && (
          <div style={{ color: d.change >= 0 ? TOKEN_HEX.up : TOKEN_HEX.down }}>
            Chg: {d.change >= 0 ? '+' : ''}{d.change.toFixed(2)}%
          </div>
        )}
      </div>
    );
  }
  return null;
}

export const FuturesCurveChart = memo(function FuturesCurveChart({
  symbol = 'CL',
  title,
  height = 220,
  accentColor,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const fetchCurve = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/derivatives/futures/${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!mountedRef.current) return;

      let curve = json.curve || [];
      // If curve is empty, generate placeholder based on symbol
      if (curve.length === 0 && json.source === 'unavailable') {
        // Generate synthetic placeholder
        curve = generatePlaceholderCurve(symbol);
      }

      // Normalize data shape
      const normalized = curve.map((c, i) => ({
        contract: c.contract || c.label || c.month || `M+${i + 1}`,
        price: c.price || c.settle || c.last || c.close || 0,
        change: c.change || c.changePct || null,
        volume: c.volume || null,
        oi: c.openInterest || c.oi || null,
      }));

      setData(normalized);
    } catch (e) {
      if (mountedRef.current) {
        setError(e.message);
        setData(null);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    mountedRef.current = true;
    fetchCurve();
    return () => { mountedRef.current = false; };
  }, [fetchCurve]);

  const spotPrice = data && data.length > 0 ? data[0].price : null;
  const isContango = data && data.length >= 2 && data[data.length - 1].price > data[0].price;

  const displayTitle = title || `${symbol} FUTURES CURVE`;
  const color = accentColor || TOKEN_HEX.accent;

  return (
    <div style={{ padding: '8px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
      }}>
        <span style={{
          fontSize: 9,
          color: accentColor || 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          fontWeight: 600,
        }}>
          {displayTitle}
        </span>
        {data && data.length >= 2 && (
          <span style={{
            fontSize: 8,
            padding: '1px 6px',
            borderRadius: 2,
            background: isContango
              ? 'rgba(239,68,68,0.15)'
              : 'rgba(34,197,94,0.15)',
            color: isContango ? TOKEN_HEX.down : TOKEN_HEX.up,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}>
            {isContango ? 'CONTANGO' : 'BACKWARDATION'}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-faint)',
          fontSize: 10,
        }}>
          Loading futures curve…
        </div>
      ) : error || !data || data.length === 0 ? (
        <div style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 10,
        }}>
          {error ? 'Data unavailable' : 'No futures curve data'}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
            <defs>
              <linearGradient id={`fc-grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="contract"
              stroke={TOKEN_HEX.borderDefault}
              tick={{ fontSize: 8, fill: TOKEN_HEX.textMuted }}
              angle={-30}
              textAnchor="end"
              height={35}
            />
            <YAxis
              domain={['auto', 'auto']}
              stroke={TOKEN_HEX.borderDefault}
              tick={{ fontSize: 9, fill: TOKEN_HEX.textMuted }}
              tickFormatter={(v) => v.toFixed(1)}
            />
            <Tooltip content={<CurveTooltip />} />
            {spotPrice != null && (
              <ReferenceLine y={spotPrice} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
            )}
            <Area
              type="monotone"
              dataKey="price"
              stroke={color}
              strokeWidth={2}
              fill={`url(#fc-grad-${symbol})`}
              dot={{ r: 3, fill: color, stroke: TOKEN_HEX.bgSurface, strokeWidth: 1 }}
              activeDot={{ r: 5, fill: color }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
});

/** Generate placeholder curve for demo when Eulerpool is not configured */
function generatePlaceholderCurve(symbol) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const spotPrices = {
    CL: 72, BZ: 76, GC: 2350, SI: 28, NG: 2.8, HG: 4.2, ZW: 5.6, ZC: 4.5,
  };
  const spot = spotPrices[symbol] || 100;
  const contracts = [];

  for (let i = 0; i < 8; i++) {
    const month = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const label = `${MONTHS[month.getMonth()]} ${month.getFullYear().toString().slice(2)}`;
    // Slight contango slope
    const price = spot * (1 + 0.003 * (i + 1) + (Math.random() - 0.5) * 0.005);
    contracts.push({
      contract: label,
      price: parseFloat(price.toFixed(2)),
      change: null,
    });
  }
  return contracts;
}

export default FuturesCurveChart;
