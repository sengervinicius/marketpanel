// InstrumentDetail.jsx â Bloomberg GP-style full-screen instrument overlay
// Triggered by double-clicking any ticker row, chart tile, or search result.
import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, Tooltip,
  ReferenceLine, CartesianGrid,
} from 'recharts';

const API = import.meta.env.VITE_API_URL || '';
const ORANGE = '#ff6b00';
const GREEN  = '#00c851';
const RED    = '#ff4444';

const RANGES = [
  { label: '1D', multiplier: 5,  timespan: 'minute', days: 1    },
  { label: '5D', multiplier: 30, timespan: 'minute', days: 5    },
  { label: '1M', multiplier: 1,  timespan: 'day',    days: 30   },
  { label: '3M', multiplier: 1,  timespan: 'day',    days: 90   },
  { label: '6M', multiplier: 1,  timespan: 'day',    days: 180  },
  { label: '1Y', multiplier: 1,  timespan: 'day',    days: 365  },
  { label: '5Y', multiplier: 1,  timespan: 'week',   days: 1825 },
];

function normalizeTicker(raw) {
  if (!raw) return 'SPY';
  // Already in Polygon prefixed format: X:BTCUSD, C:EURUSD, I:SPX etc
  if (/^[A-Z]:/.test(raw)) return raw;
  // 6-char uppercase FX pairs (EURUSD, USDBRL, GBPUSD) -> add C: prefix
  if (/^[A-Z]{6}$/.test(raw)) return 'C:' + raw;
  // Equities, ETFs, Brazilian .SA tickers - pass through as-is
  return raw;
}

function displayTicker(norm) {
  if (norm.startsWith('C:')) return norm.slice(2, 5) + '/' + norm.slice(5);
  if (norm.startsWith('X:')) return norm.slice(2, 5) + '/' + norm.slice(5);
  if (norm.endsWith('.SA')) return norm.slice(0, -3);
  return norm;
}

function getFromDate(range) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - range.days);
  return from.toISOString().split('T')[0];
}

function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '--';
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (Math.abs(n) >= 1e9)  return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtLabel(ts, timespan) {
  if (!ts) return '';
  const d = new Date(ts);
  if (timespan === 'minute') {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function InstrumentDetail({ ticker, onClose }) {
  const norm     = normalizeTicker(ticker);
  const disp     = displayTicker(norm);
  const isFX     = norm.startsWith('C:');
  const isCrypto = norm.startsWith('X:');

  const [rangeIdx,  setRangeIdx]  = useState(0);
  const [bars,      setBars]      = useState([]);
  const [snap,      setSnap]      = useState(null);
  const [info,      setInfo]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [deltaMode, setDeltaMode] = useState(false);
  const [deltaA,    setDeltaA]    = useState(null);
  const [deltaB,    setDeltaB]    = useState(null);
  const [hovered,   setHovered]   = useState(null);

  const [fundsData, setFundsData] = useState(null);
  const range = RANGES[rangeIdx];

  // ââ Fetch bars âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  useEffect(() => {
    setLoading(true);
    setBars([]);
    setDeltaA(null);
    setDeltaB(null);
    const from = getFromDate(range);
    const to   = new Date().toISOString().split('T')[0];
    fetch(
      `${API}/api/chart/${encodeURIComponent(norm)}` +
      `?multiplier=${range.multiplier}&timespan=${range.timespan}&from=${from}&to=${to}`
    )
      .then(r => r.json())
      .then(d => {
        const results = Array.isArray(d.results) ? d.results : (Array.isArray(d) ? d : []);
        setBars(results.map(b => ({
          t:      b.t,
          label:  fmtLabel(b.t, range.timespan),
          open:   b.o,
          high:   b.h,
          low:    b.l,
          close:  b.c,
          volume: b.v ?? 0,
        })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [norm, rangeIdx]);

  // ââ Fetch snapshot âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  useEffect(() => {
    fetch(`${API}/api/snapshot/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.json())
      .then(d => setSnap(d?.ticker ?? d))
      .catch(() => {});
  }, [norm]);

  // ââ Fetch reference info âââââââââââââââââââââââââââââââââââââââââââââââââââââ
  useEffect(() => {
    if (isFX || isCrypto) return;
    fetch(`${API}/api/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.json())
      .then(d => setInfo(d?.results ?? d))
      .catch(() => {});
  }, [norm]);

  useEffect(() => {
    if (!norm) return;
    setFundsData(null);
    fetch(API + '/api/fundamentals/' + encodeURIComponent(norm))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setFundsData(d); })
      .catch(() => {});
  }, [norm]);

  // ââ Escape key âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  // ââ Derived values ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const livePrice = snap?.min?.c || snap?.day?.c || snap?.lastTrade?.p || snap?.prevDay?.c
                 || (bars.length ? bars[bars.length - 1].close : null);
  const prevClose  = snap?.prevDay?.c;
  const dayChange  = (livePrice && prevClose) ? livePrice - prevClose : null;
  const dayChgPct  = (dayChange && prevClose) ? (dayChange / prevClose) * 100 : null;
  const isPos      = (dayChgPct ?? 0) >= 0;
  const name       = info?.name || disp;
  const dayHigh    = snap?.day?.h;
  const dayLow     = snap?.day?.l;
  const volume     = snap?.day?.v;
  const mktCap     = info?.market_cap;
  const desc       = info?.description;

  const chartMin   = bars.length ? Math.min(...bars.map(b => b.close)) * 0.998 : 0;
  const chartMax   = bars.length ? Math.max(...bars.map(b => b.close)) * 1.002 : 1;
  const rangeHigh  = bars.length ? Math.max(...bars.map(b => b.high)) : null;
  const rangeLow   = bars.length ? Math.min(...bars.map(b => b.low))  : null;
  const rangeOpen  = bars.length ? bars[0].open : null;
  const rangeClose = bars.length ? bars[bars.length - 1].close : null;
  const rangeChg   = (rangeOpen && rangeClose) ? ((rangeClose - rangeOpen) / rangeOpen) * 100 : null;

  // ââ Delta tool ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const deltaInfo = (() => {
    if (deltaA === null || deltaB === null || bars.length < 2) return null;
    const [i1, i2] = [deltaA, deltaB].sort((a, b) => a - b);
    const a = bars[i1], b = bars[i2];
    if (!a || !b) return null;
    const d = b.close - a.close;
    const p = (d / a.close) * 100;
    return { a, b, delta: d, pct: p };
  })();

  const handleChartClick = useCallback(chartData => {
    if (!deltaMode) return;
    const idx = chartData?.activeTooltipIndex;
    if (idx == null) return;
    if (deltaA === null)      setDeltaA(idx);
    else if (deltaB === null) setDeltaB(idx);
    else { setDeltaA(idx); setDeltaB(null); }
  }, [deltaMode, deltaA, deltaB]);

  // ââ Render ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const isMobile = window.innerWidth < 768;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.97)',
        display: 'flex', flexDirection: 'column',
        fontFamily: '"Courier New", monospace', color: '#e0e0e0',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >

      {/* ââ HEADER âââââââââââââââââââââââââââââââââââââââââââââââââ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 16px', borderBottom: '1px solid #222',
        background: '#0f0f0f', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 20, fontWeight: 'bold', color: ORANGE }}>{disp}</span>
        {name !== disp && (
          <span style={{ fontSize: 12, color: '#666' }}>{name}</span>
        )}

        {livePrice != null && (
          <span style={{ fontSize: 21, color: '#fff', marginLeft: 8 }}>{fmt(livePrice)}</span>
        )}
        {dayChgPct != null && (
          <span style={{ fontSize: 13, color: isPos ? GREEN : RED }}>
            {isPos ? '+' : ''}{fmt(dayChange)} ({isPos ? '+' : ''}{fmt(dayChgPct)}%)
          </span>
        )}
        {hovered && (
          <span style={{ fontSize: 11, color: '#555', marginLeft: 6 }}>
            {hovered.label}: {fmt(hovered.close)}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {deltaInfo && (
          <span style={{
            fontSize: 12, padding: '3px 10px', borderRadius: 3,
            background: '#161616', border: '1px solid #2a2a2a',
            color: deltaInfo.pct >= 0 ? GREEN : RED,
          }}>
            {deltaInfo.pct >= 0 ? '+' : ''}{fmt(deltaInfo.pct)}%
            &nbsp;({fmt(deltaInfo.delta)})
            <span style={{ color: '#444', marginLeft: 8, fontSize: 10 }}>
              {deltaInfo.a.label} → {deltaInfo.b.label}
            </span>
          </span>
        )}

        <button
          onClick={() => { setDeltaMode(m => !m); setDeltaA(null); setDeltaB(null); }}
          style={{
            padding: '3px 10px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
            border: `1px solid ${deltaMode ? ORANGE : '#333'}`,
            background: deltaMode ? ORANGE : 'transparent',
            color: deltaMode ? '#fff' : '#666',
          }}
        >⟷ Δ MEASURE</button>

        <button
          onClick={onClose}
          style={{
            width: isMobile ? 44 : 26, height: isMobile ? 44 : 26, borderRadius: '50%',
            border: '1px solid #333', background: '#1a1a1a',
            color: '#888', cursor: 'pointer', fontSize: 15, lineHeight: '1',
          }}
        >✕</button>
      </div>

      {/* ââ BODY âââââââââââââââââââââââââââââââââââââââââââââââââââ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: 0, overflowY: isMobile ? 'auto' : 'hidden' }}>

        {/* ââ LEFT: CHARTS ââ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8px 10px', minWidth: 0, minHeight: isMobile ? '55vh' : 0 }}>

          {/* Range selector row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            {RANGES.map((r, i) => (
              <button key={r.label}
                onClick={() => setRangeIdx(i)}
                style={{
                  padding: '2px 9px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
                  border: `1px solid ${i === rangeIdx ? ORANGE : '#2a2a2a'}`,
                  background: i === rangeIdx ? ORANGE : 'transparent',
                  color: i === rangeIdx ? '#fff' : '#555',
                }}
              >{r.label}</button>
            ))}
            {rangeChg != null && (
              <span style={{ fontSize: 11, color: rangeChg >= 0 ? GREEN : RED, marginLeft: 10 }}>
                {range.label}: {rangeChg >= 0 ? '+' : ''}{fmt(rangeChg)}%
              </span>
            )}
            {deltaMode && (
              <span style={{ fontSize: 11, color: '#555', marginLeft: 'auto' }}>
                {deltaA === null ? 'Click start point on chart'
                  : deltaB === null ? 'Click end point on chart'
                  : 'Click to reset start'}
              </span>
            )}
          </div>

          {/* Charts area */}
          {loading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}>
              Loading chart data…
            </div>
          )}

          {!loading && bars.length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}>
              No data for this range
            </div>
          )}

          {!loading && bars.length > 0 && (
            <>
              {/* Price chart */}
              <div style={{ flex: 7, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={bars}
                    margin={{ top: 4, right: 6, bottom: 0, left: 6 }}
                    onClick={handleChartClick}
                    onMouseMove={e => e?.activePayload?.[0] && setHovered(e.activePayload[0].payload)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ cursor: deltaMode ? 'crosshair' : 'default' }}
                  >
                    <defs>
                      <linearGradient id="idGradFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={isPos ? GREEN : RED} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={isPos ? GREEN : RED} stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#181818" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#3a3a3a', fontSize: 9 }}
                      interval="preserveStartEnd"
                      tickLine={false}
                      axisLine={{ stroke: '#222' }}
                    />
                    <YAxis
                      domain={[chartMin, chartMax]}
                      tick={{ fill: '#3a3a3a', fontSize: 9 }}
                      width={64}
                      tickFormatter={v => fmt(v, v > 999 ? 0 : 2)}
                      axisLine={{ stroke: '#222' }}
                    />
                    <Tooltip
                      contentStyle={{ background: '#0f0f0f', border: '1px solid #2a2a2a', fontSize: 11, borderRadius: 3 }}
                      formatter={(v, n) => [fmt(v), n]}
                      labelStyle={{ color: '#555', marginBottom: 4 }}
                    />
                    {deltaA !== null && bars[deltaA] && (
                      <ReferenceLine
                        x={bars[deltaA].label}
                        stroke={ORANGE} strokeDasharray="4 2" strokeWidth={1.5}
                        label={{ value: 'A', fill: ORANGE, fontSize: 10, position: 'top' }}
                      />
                    )}
                    {deltaB !== null && bars[deltaB] && (
                      <ReferenceLine
                        x={bars[deltaB].label}
                        stroke={ORANGE} strokeDasharray="4 2" strokeWidth={1.5}
                        label={{ value: 'B', fill: ORANGE, fontSize: 10, position: 'top' }}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="close"
                      name="Close"
                      stroke={isPos ? GREEN : RED}
                      strokeWidth={1.5}
                      fill="url(#idGradFill)"
                      dot={false}
                      activeDot={{ r: 3, fill: isPos ? GREEN : RED, strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Volume chart */}
              <div style={{ flex: 3, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={bars}
                    margin={{ top: 2, right: 6, bottom: 0, left: 6 }}
                  >
                    <XAxis dataKey="label" hide axisLine={false} />
                    <YAxis
                      tick={{ fill: '#2a2a2a', fontSize: 8 }}
                      width={64}
                      tickFormatter={v =>
                        v >= 1e9 ? (v/1e9).toFixed(1)+'B'
                        : v >= 1e6 ? (v/1e6).toFixed(0)+'M'
                        : v >= 1e3 ? (v/1e3).toFixed(0)+'K'
                        : String(v)
                      }
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{ background: '#0f0f0f', border: '1px solid #2a2a2a', fontSize: 11, borderRadius: 3 }}
                      formatter={v => [fmt(v, 0), 'Volume']}
                      labelStyle={{ color: '#555' }}
                    />
                    <Bar dataKey="volume" fill="#1a3352" opacity={0.85} radius={[1, 1, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        {/* -- RIGHT: KEY STATS -- */}
        <div style={{
          width: isMobile ? '100%' : 220, background: '#080808',
          borderLeft: isMobile ? 'none' : '1px solid #1a1a1a',
          borderTop: isMobile ? '1px solid #1a1a1a' : 'none',
          padding: '12px 14px', overflowY: 'auto', fontSize: 11, flexShrink: 0,
        }}>
          <Section title="PRICE">
            <Stat label="LAST"       value={fmt(livePrice)} color="#e0e0e0" />
            <Stat label="CHANGE"     value={dayChgPct != null ? (isPos?'+':'')+fmt(dayChgPct)+'%' : '--'} color={dayChgPct != null ? (isPos ? GREEN : RED) : '#555'} />
            <Stat label="OPEN"       value={fmt(snap?.day?.o)} />
            <Stat label="PREV CLOSE" value={fmt(prevClose)} />
            <Stat label="DAY HIGH"   value={fmt(dayHigh)} />
            <Stat label="DAY LOW"    value={fmt(dayLow)} />
            {snap?.day?.vw != null && <Stat label="VWAP" value={fmt(snap.day.vw)} />}
            <Stat label="VOLUME"     value={volume != null ? fmt(volume, 0) : '--'} />
          </Section>
          <Section title="RANGE">
            <Stat label={range.label + ' HIGH'}   value={fmt(rangeHigh)} />
            <Stat label={range.label + ' LOW'}    value={fmt(rangeLow)} />
            <Stat label={range.label + ' RETURN'} value={rangeChg != null ? (rangeChg>=0?'+':'')+fmt(rangeChg)+'%' : '--'} color={rangeChg != null ? (rangeChg>=0 ? GREEN : RED) : '#555'} />
            {fundsData?.fiftyTwoWeekHigh != null && <Stat label="52W HIGH" value={fmt(fundsData.fiftyTwoWeekHigh)} />}
            {fundsData?.fiftyTwoWeekLow  != null && <Stat label="52W LOW"  value={fmt(fundsData.fiftyTwoWeekLow)} />}
          </Section>
          {!isFX && !isCrypto && (
            <Section title="FUNDAMENTALS">
              {fundsData == null && <Stat label="" value="Loading..." color="#333" />}
              {fundsData?.marketCap      != null && <Stat label="MARKET CAP"   value={fundsData.marketCap >= 1e12 ? '$'+(fundsData.marketCap/1e12).toFixed(2)+'T' : fundsData.marketCap >= 1e9 ? '$'+(fundsData.marketCap/1e9).toFixed(2)+'B' : '$'+(fundsData.marketCap/1e6).toFixed(1)+'M'} />}
              {fundsData?.peRatio        != null && <Stat label="P/E (TTM)"    value={fundsData.peRatio.toFixed(1)+'x'} />}
              {fundsData?.forwardPE      != null && <Stat label="P/E (FWD)"    value={fundsData.forwardPE.toFixed(1)+'x'} />}
              {fundsData?.eps            != null && <Stat label="EPS (TTM)"    value={'$'+fundsData.eps.toFixed(2)} />}
              {fundsData?.beta           != null && <Stat label="BETA"         value={fundsData.beta.toFixed(2)} />}
              {fundsData?.dividendYield  != null && <Stat label="DIV YIELD"    value={(fundsData.dividendYield*100).toFixed(2)+'%'} />}
              {fundsData?.returnOnEquity != null && <Stat label="ROE"          value={(fundsData.returnOnEquity*100).toFixed(1)+'%'} />}
              {fundsData?.sharesOutstanding != null && <Stat label="SHARES OUT" value={fundsData.sharesOutstanding >= 1e9 ? (fundsData.sharesOutstanding/1e9).toFixed(2)+'B' : (fundsData.sharesOutstanding/1e6).toFixed(0)+'M'} />}
            </Section>
          )}
          {!isFX && !isCrypto && (fundsData?.sector || fundsData?.industry) && (
            <Section title="PROFILE">
              {fundsData.sector   && <Stat label="SECTOR"   value={fundsData.sector} />}
              {fundsData.industry && <Stat label="INDUSTRY" value={fundsData.industry} />}
            </Section>
          )}
          {desc && (
            <Section title="ABOUT">
              <p style={{ color: '#484848', fontSize: 10, lineHeight: 1.6, margin: 0 }}>
                {desc.length > 400 ? desc.slice(0, 400) + '...' : desc}
              </p>
            </Section>
          )}
          <Section title="MEASURE TOOL">
            <p style={{ color: '#383838', fontSize: 10, lineHeight: 1.6, margin: 0 }}>
              Click the measure button, then click two points on the chart to calculate price change and return between any two dates.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        color: ORANGE, fontWeight: 'bold', fontSize: 10,
        letterSpacing: 1, marginBottom: 8,
        borderBottom: '1px solid #1a1a1a', paddingBottom: 4,
      }}>{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: '#333', fontSize: 9, marginBottom: 1 }}>{label}</div>
      <div style={{ color: color || '#c0c0c0', fontWeight: 'bold', fontSize: 12 }}>{value}</div>
    </div>
  );
}
