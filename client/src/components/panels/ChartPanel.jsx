/**
 * ChartPanel — intraday candlestick / line charts
 * Shows mini charts for selected tickers fetched from Polygon REST
 */

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { SectionHeader } from '../common/SectionHeader';
import { fmtPrice, fmtPct } from '../../utils/format';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

const CHART_TICKERS = [
  { symbol: 'SPY',  label: 'S&P 500' },
  { symbol: 'QQQ',  label: 'NASDAQ' },
  { symbol: 'AAPL', label: 'Apple' },
  { symbol: 'NVDA', label: 'NVIDIA' },
];

function MiniChart({ symbol, label, currentPrice, changePct }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const up = (changePct ?? 0) >= 0;

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const res = await fetch(
          `${SERVER_URL}/api/chart/${symbol}?from=${yesterday}&to=${today}&multiplier=5&timespan=minute`
        );
        const json = await res.json();
        const results = (json.results || []).map((bar) => ({
          t: new Date(bar.t).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
          c: bar.c,
          o: bar.o,
        }));
        setData(results);
      } catch (e) {
        console.warn(`Chart load failed for ${symbol}:`, e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 60_000); // refresh every minute
    return () => clearInterval(interval);
  }, [symbol]);

  const open = data[0]?.c || 0;
  const color = up ? '#00cc44' : '#cc2200';

  return (
    <div style={{
      background: '#050505',
      border: '1px solid #1a1a1a',
      padding: '4px 6px',
      flex: 1,
      minWidth: 0,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ color: '#ff6600', fontWeight: 700, fontSize: 10 }}>{symbol}</span>
        <span style={{ color: '#555', fontSize: 9 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ color: '#e8e8e8', fontSize: 12, fontWeight: 700 }}>{fmtPrice(currentPrice)}</span>
        <span style={{ color, fontSize: 10 }}>{fmtPct(changePct)}</span>
      </div>

      {/* Chart */}
      {loading ? (
        <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 9 }}>
          LOADING...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={60}>
          <LineChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
            {open > 0 && <ReferenceLine y={open} stroke="#333" strokeDasharray="2 2" />}
            <Line
              type="monotone"
              dataKey="c"
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <YAxis domain={['auto', 'auto']} hide />
            <XAxis dataKey="t" hide />
            <Tooltip
              contentStyle={{ background: '#0a0a0a', border: '1px solid #333', fontSize: 9, color: '#ccc' }}
              formatter={(v) => [fmtPrice(v), 'Price']}
              labelStyle={{ color: '#888' }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function ChartPanel({ stocks }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SectionHeader title="INTRADAY CHARTS" right="5-MIN BARS" />
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 2, padding: 2, overflow: 'hidden' }}>
        {CHART_TICKERS.map(({ symbol, label }) => {
          const d = stocks[symbol] || {};
          return (
            <MiniChart
              key={symbol}
              symbol={symbol}
              label={label}
              currentPrice={d.price}
              changePct={d.changePct}
            />
          );
        })}
      </div>
    </div>
  );
}
