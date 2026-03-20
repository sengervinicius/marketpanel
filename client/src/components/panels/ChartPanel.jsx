// ChartPanel.jsx â BBG-style chart with timeframe toggles, OHLV stats,
// FX ticker normalization, drop zone support, localStorage persistence, live refresh
import { useState, useEffect, useRef, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const API = import.meta.env.VITE_API_URL || '';

const RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y'];
const LIVE_RANGES = new Set(['1D', '1W']); // refresh these more often

// ââ Ticker format normalization âââââââââââââââââââââââââââââââ
// Yahoo Finance uses EURUSD=X; Polygon uses C:EURUSD
// Yahoo Finance uses BTC-USD; Polygon uses X:BTCUSD
function normalizeTicker(raw) {
  if (!raw) return 'SPY';
  const t = raw.trim().toUpperCase();
  // Yahoo FX pair: EURUSD=X â C:EURUSD
  if (t.endsWith('=X')) return 'C:' + t.slice(0, -2);
  // Yahoo crypto: BTC-USD â X:BTCUSD
  if (t.endsWith('-USD') && !t.startsWith('C:')) return 'X:' + t.replace('-USD', 'USD');
  // Already normalized
  return t;
}

function displayTicker(normalized) {
  // Convert back for display: C:EURUSD â EUR/USD, X:BTCUSD â BTC/USD
  if (normalized.startsWith('C:')) return normalized.slice(2, 5) + '/' + normalized.slice(5);
  if (normalized.startsWith('X:')) return normalized.slice(2, 5) + '/' + normalized.slice(5);
  return normalized;
}

const fmtDate = (ts, range) => {
  const d = new Date(ts);
  if (range === '1D') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range === '5Y') return d.getFullYear().toString();
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const fmt2 = (n) => n == null ? 'â' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtVol = (n) => {
  if (!n) return 'â';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
};

const LS_TICKER = 'chartTicker';
const LS_RANGE  = 'chartRange';

export function ChartPanel({ ticker: externalTicker, onTickerChange }) {
  // Read persisted values from localStorage
  const [ticker, setTickerState] = useState(() => {
    const saved = localStorage.getItem(LS_TICKER);
    return saved || externalTicker || 'SPY';
  });
  const [range, setRange] = useState(() => localStorage.getItem(LS_RANGE) || '1Y');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [inputVal, setInputVal] = useState(ticker);
  const [liveIndicator, setLiveIndicator] = useState(false);
  const intervalRef = useRef(null);
  const prevDataRef = useRef([]);

  // When external ticker prop changes, adopt it
  useEffect(() => {
    if (externalTicker && externalTicker !== ticker) {
      const norm = normalizeTicker(externalTicker);
      setTickerState(norm);
      setInputVal(displayTicker(norm));
      localStorage.setItem(LS_TICKER, norm);
    }
  }, [externalTicker]);

  // Persist range
  const setRange2 = (r) => { setRange(r); localStorage.setItem(LS_RANGE, r); };

  const fetchChart = useCallback(async (t, r, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/chart/${encodeURIComponent(t)}?range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.results?.length) throw new Error('No data â market may be closed or invalid ticker');
      const points = json.results.map(bar => ({
        t: bar.t,
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: bar.v,
      }));
      setData(points);
      prevDataRef.current = points;
      if (silent) {
        // Briefly flash live indicator
        setLiveIndicator(true);
        setTimeout(() => setLiveIndicator(false), 800);
      }
    } catch (e) {
      if (!silent) {
        setError(e.message);
        setData(prevDataRef.current); // keep stale data on background refresh fail
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial + ticker/range change fetch
  useEffect(() => {
    fetchChart(ticker, range);
  }, [ticker, range, fetchChart]);

  // Live refresh for short ranges
  useEffect(() => {
    clearInterval(intervalRef.current);
    if (LIVE_RANGES.has(range)) {
      intervalRef.current = setInterval(() => {
        fetchChart(ticker, range, true /* silent */);
      }, 30_000); // 30s for chart data (Polygon free tier is delayed)
    }
    return () => clearInterval(intervalRef.current);
  }, [ticker, range, fetchChart]);

  const handleTickerSubmit = (e) => {
    e.preventDefault();
    const norm = normalizeTicker(inputVal);
    setTickerState(norm);
    setInputVal(displayTicker(norm));
    localStorage.setItem(LS_TICKER, norm);
    if (onTickerChange) onTickerChange(norm);
  };

  // Drag-over drop zone
  const handleDragOver = (e) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const raw = e.dataTransfer.getData('application/x-ticker');
    if (!raw) return;
    try {
      const { symbol } = JSON.parse(raw);
      const norm = normalizeTicker(symbol);
      setTickerState(norm);
      setInputVal(displayTicker(norm));
      localStorage.setItem(LS_TICKER, norm);
      if (onTickerChange) onTickerChange(norm);
    } catch {}
  };

  // Derived stats from data
  const first = data[0];
  const last  = data[data.length - 1];
  const basePrice = first?.c ?? first?.o;
  const lastPrice = last?.c;
  const high = data.length ? Math.max(...data.map(d => d.h)) : null;
  const low  = data.length ? Math.min(...data.map(d => d.l)) : null;
  const vol  = data.length ? data.reduce((s, d) => s + (d.v || 0), 0) : null;
  const chg  = basePrice && lastPrice ? lastPrice - basePrice : null;
  const chgPct = basePrice && chg != null ? (chg / basePrice) * 100 : null;
  const isPos = chgPct == null || chgPct >= 0;
  const lineColor = isPos ? '#4caf50' : '#f44336';

  // Y domain with 2% padding
  const yMin = low  != null ? low  * 0.998 : 'auto';
  const yMax = high != null ? high * 1.002 : 'auto';

  const customTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{ background: '#111', border: '1px solid #2a2a2a', padding: '6px 10px', fontSize: '10px', fontFamily: 'inherit' }}>
        <div style={{ color: '#888', marginBottom: 2 }}>{fmtDate(d.t, range)}</div>
        <div style={{ color: '#e0e0e0', fontWeight: 700 }}>C: {fmt2(d.c)}</div>
        {d.o != null && <div style={{ color: '#888' }}>O: {fmt2(d.o)}  H: {fmt2(d.h)}  L: {fmt2(d.l)}</div>}
        {d.v > 0 && <div style={{ color: '#555' }}>V: {fmtVol(d.v)}</div>}
      </div>
    );
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: isDragOver ? '#1a1200' : '#0a0a0a',
        border: isDragOver ? '2px solid #ff6600' : '2px solid transparent',
        transition: 'background 0.15s, border 0.15s',
        position: 'relative',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay hint */}
      {isDragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(20,10,0,0.7)',
          color: '#ff6600', fontSize: '18px', fontWeight: 700, letterSpacing: '2px',
          pointerEvents: 'none',
        }}>
          DROP TO CHART
        </div>
      )}

      {/* Header row */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: 8, background: '#111', flexShrink: 0 }}>
        {/* Ticker input */}
        <form onSubmit={handleTickerSubmit} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            style={{
              background: 'transparent', border: 'none', borderBottom: '1px solid #333',
              color: '#ff6600', fontSize: '12px', fontWeight: 700, fontFamily: 'inherit',
              width: '80px', outline: 'none', letterSpacing: '1px',
            }}
            onFocus={e => e.target.style.borderBottomColor = '#ff6600'}
            onBlur={e => e.target.style.borderBottomColor = '#333'}
          />
          <button type="submit" style={{ display: 'none' }} />
        </form>

        {/* OHLV stats */}
        {data.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flex: 1, overflow: 'hidden' }}>
            <span style={{ color: '#ccc', fontSize: '11px', fontWeight: 700 }}>{fmt2(lastPrice)}</span>
            <span style={{ color: isPos ? '#4caf50' : '#f44336', fontSize: '10px' }}>
              {chg != null && (isPos ? '+' : '')}{fmt2(chg)} ({chgPct != null && (isPos ? '+' : '')}{chgPct?.toFixed(2)}%)
            </span>
            <span style={{ color: '#555', fontSize: '9px' }}>H {fmt2(high)}</span>
            <span style={{ color: '#555', fontSize: '9px' }}>L {fmt2(low)}</span>
            {vol > 0 && <span style={{ color: '#555', fontSize: '9px' }}>V {fmtVol(vol)}</span>}
          </div>
        )}

        {/* Live indicator */}
        {liveIndicator && (
          <span style={{ color: '#ff6600', fontSize: '8px', animation: 'pulse 0.8s ease', opacity: 0.8 }}>âLIVE</span>
        )}

        {/* Range toggles */}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange2(r)}
              style={{
                padding: '2px 5px',
                background: range === r ? '#ff6600' : 'transparent',
                color: range === r ? '#000' : '#555',
                border: '1px solid ' + (range === r ? '#ff6600' : '#2a2a2a'),
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
                letterSpacing: '0.5px',
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '4px 0' }}>
        {loading && (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: '10px', letterSpacing: '2px' }}>
            LOADING {displayTicker(ticker)}...
          </div>
        )}
        {error && !loading && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#f44336', fontSize: '9px', padding: 16, textAlign: 'center', gap: 8 }}>
            <span>{error}</span>
            <button onClick={() => fetchChart(ticker, range)} style={{ color: '#ff6600', background: 'none', border: '1px solid #ff6600', padding: '3px 8px', fontSize: '9px', cursor: 'pointer', fontFamily: 'inherit' }}>RETRY</button>
          </div>
        )}
        {!loading && data.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
              <XAxis
                dataKey="t"
                tickFormatter={ts => fmtDate(ts, range)}
                tick={{ fill: '#333', fontSize: 8 }}
                axisLine={{ stroke: '#1e1e1e' }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={60}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fill: '#333', fontSize: 8 }}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={v => fmt2(v)}
              />
              <Tooltip content={customTooltip} />
              <ReferenceLine y={basePrice} stroke="#2a2a2a" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="c"
                stroke={lineColor}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: lineColor, stroke: 'none' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Footer: ticker source */}
      {data.length > 0 && (
        <div style={{ padding: '2px 8px', borderTop: '1px solid #141414', color: '#2a2a2a', fontSize: '8px', flexShrink: 0, display: 'flex', justifyContent: 'space-between' }}>
          <span>{ticker} Â· POLYGON.IO</span>
          <span>{LIVE_RANGES.has(range) ? 'â³ 30s' : ''}</span>
        </div>
      )}
    </div>
  );
}
