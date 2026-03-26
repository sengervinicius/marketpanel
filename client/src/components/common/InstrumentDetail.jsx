// InstrumentDetail.jsx – Bloomberg GP-style full-screen instrument overlay
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, Tooltip,
  ReferenceLine, CartesianGrid, ReferenceArea, Customized,
} from 'recharts';

const API = import.meta.env.VITE_API_URL || '';
const ORANGE = '#ff6b00';
const GREEN  = '#00c851';
const RED    = '#ff4444';
const DIM    = '#333';

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
  if (/^[A-Z]:/.test(raw)) return raw;
  if (/^[A-Z]{6}$/.test(raw)) return 'C:' + raw;
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

function timeAgo(utc) {
  if (!utc) return '';
  const diff = (Date.now() - new Date(utc).getTime()) / 1000;
  if (diff < 60)    return 'now';
  if (diff < 3600)  return Math.round(diff / 60) + 'm';
  if (diff < 86400) return Math.round(diff / 3600) + 'h';
  return Math.round(diff / 86400) + 'd';
}

function pct(v, dec = 1) {
  if (v == null) return '--';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(dec) + '%';
}

// ── Export chart data as CSV ────────────────────────────────────────────────
function exportToCSV(bars, ticker, rangeLabel) {
  if (!bars.length) return;
  const disp = displayTicker(normalizeTicker(ticker));
  const header = 'Date,Open,High,Low,Close,Volume';
  const rows = bars.map(b => {
    const date = b.t ? new Date(b.t).toISOString().split('T')[0] : b.label;
    return [date, b.open ?? '', b.high ?? '', b.low ?? '', b.close ?? '', b.volume ?? ''].join(',');
  });
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${disp}_${rangeLabel}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Custom SVG overlay: diagonal line A→B with delta badge ─────────────────
function DeltaLineOverlay({ xAxisMap, yAxisMap, bars, deltaA, deltaB, deltaInfo }) {
  if (!deltaInfo || deltaA === null || deltaB === null) return null;
  const [i1, i2] = [deltaA, deltaB].sort((a, b) => a - b);
  const barA = bars[i1], barB = bars[i2];
  if (!barA || !barB) return null;

  const xAxis = xAxisMap && xAxisMap[0];
  const yAxis = yAxisMap && yAxisMap[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;

  // Use index-based position via the categorical scale
  const bw = xAxis.scale.bandwidth ? xAxis.scale.bandwidth() / 2 : 0;
  const xA = xAxis.scale(barA.label);
  const xB = xAxis.scale(barB.label);
  if (xA == null || xB == null) return null;
  const xAc = xA + bw, xBc = xB + bw;
  const yAc = yAxis.scale(barA.close);
  const yBc = yAxis.scale(barB.close);

  if ([xAc, xBc, yAc, yBc].some(v => isNaN(v) || v == null)) return null;

  const midX = (xAc + xBc) / 2;
  const midY = (yAc + yBc) / 2 - 18;

  const color  = deltaInfo.pct >= 0 ? GREEN : RED;
  const pctStr = (deltaInfo.pct >= 0 ? '+' : '') + deltaInfo.pct.toFixed(2) + '%';
  const absStr = (deltaInfo.delta >= 0 ? '+' : '') + fmt(Math.abs(deltaInfo.delta));
  const daysStr = deltaInfo.days != null ? `${deltaInfo.days}d` : null;
  const badgeW = 76;
  const badgeH = daysStr ? 44 : 32;

  return (
    <g>
      {/* Shadow for line */}
      <line x1={xAc} y1={yAc} x2={xBc} y2={yBc} stroke="#000" strokeWidth={4} opacity={0.4} />
      {/* Main line */}
      <line x1={xAc} y1={yAc} x2={xBc} y2={yBc} stroke={color} strokeWidth={1.5} strokeDasharray="6 3" opacity={0.9} />
      {/* Endpoint dots */}
      <circle cx={xAc} cy={yAc} r={5} fill={color} stroke="#000" strokeWidth={1.5} />
      <circle cx={xBc} cy={yBc} r={5} fill={color} stroke="#000" strokeWidth={1.5} />
      {/* A / B labels */}
      <text x={xAc} y={yAc - 10} textAnchor="middle" fill={ORANGE} fontSize={9} fontFamily="'Courier New', monospace" fontWeight="bold">A</text>
      <text x={xBc} y={yBc - 10} textAnchor="middle" fill={ORANGE} fontSize={9} fontFamily="'Courier New', monospace" fontWeight="bold">B</text>
      {/* Delta badge */}
      <rect x={midX - badgeW / 2} y={midY - badgeH / 2} width={badgeW} height={badgeH} rx={4}
        fill="#0a0a0a" stroke={color} strokeWidth={1} />
      <text x={midX} y={midY - (daysStr ? 8 : 2)} textAnchor="middle" fill={color}
        fontSize={12} fontFamily="'Courier New', monospace" fontWeight="bold">{pctStr}</text>
      <text x={midX} y={midY + (daysStr ? 8 : 12)} textAnchor="middle" fill="#888"
        fontSize={9} fontFamily="'Courier New', monospace">{absStr}</text>
      {daysStr && (
        <text x={midX} y={midY + 22} textAnchor="middle" fill="#444"
          fontSize={8} fontFamily="'Courier New', monospace">{daysStr}</text>
      )}
    </g>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function InstrumentDetail({ ticker, onClose }) {
  const norm     = normalizeTicker(ticker);
  const disp     = displayTicker(norm);
  const isFX     = norm.startsWith('C:');
  const isCrypto = norm.startsWith('X:');
  const isBrazil = norm.endsWith('.SA');
  const isStock  = !isFX && !isCrypto;

  // Stable mobile detection (updates on resize, not just at mount)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const [rangeIdx,     setRangeIdx]     = useState(0);
  const [bars,         setBars]         = useState([]);
  const [snap,         setSnap]         = useState(null);
  const [info,         setInfo]         = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [deltaMode,    setDeltaMode]    = useState(false);
  const [deltaA,       setDeltaA]       = useState(null);
  const [deltaB,       setDeltaB]       = useState(null);
  const [hovered,      setHovered]      = useState(null);
  const [fundsData,    setFundsData]    = useState(null);
  const [fundsLoading, setFundsLoading] = useState(false);
  const [fundsError,   setFundsError]   = useState(false);
  const [news,         setNews]         = useState([]);
  const [newsLoading,  setNewsLoading]  = useState(true);
  const [activeTab,    setActiveTab]    = useState('STATS');
  const [descExpanded, setDescExpanded] = useState(false);

  const range = RANGES[rangeIdx];

  // ── Fetch bars ─────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setBars([]);
    setDeltaA(null);
    setDeltaB(null);
    setDeltaMode(false); // reset measure tool on range change
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
          t: b.t, label: fmtLabel(b.t, range.timespan),
          open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0,
        })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [norm, rangeIdx]);

  // ── Fetch snapshot ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/snapshot/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.json())
      .then(d => setSnap(d?.ticker ?? d))
      .catch(() => {});
  }, [norm]);

  // ── Fetch reference info (stocks only) ────────────────────────────────
  useEffect(() => {
    if (isFX || isCrypto) return;
    fetch(`${API}/api/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.json())
      .then(d => setInfo(d?.results ?? d))
      .catch(() => {});
  }, [norm]);

  // ── Fetch fundamentals ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isStock) return;
    setFundsData(null);
    setFundsError(false);
    setFundsLoading(true);
    fetch(API + '/api/fundamentals/' + encodeURIComponent(norm))
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(d => {
        if (d && !d.error) setFundsData(d);
        else setFundsError(true);
        setFundsLoading(false);
      })
      .catch(() => { setFundsError(true); setFundsLoading(false); });
  }, [norm]);

  // ── Fetch ticker-specific news ─────────────────────────────────────────
  useEffect(() => {
    setNewsLoading(true);
    setNews([]);
    const newsTicker = norm.replace(/^[XCI]:/, '');
    fetch(`${API}/api/news?ticker=${encodeURIComponent(newsTicker)}&limit=12`)
      .then(r => r.json())
      .then(d => { setNews(d?.results || []); setNewsLoading(false); })
      .catch(() => setNewsLoading(false));
  }, [norm]);

  // ── Escape key + mobile back-button support ────────────────────────────
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const closedByPopRef = useRef(false);
  useEffect(() => {
    closedByPopRef.current = false;
    history.pushState({ overlayDetail: true }, '');

    const handlePop = () => { closedByPopRef.current = true; onCloseRef.current(); };
    const handleKey = e => { if (e.key === 'Escape') onCloseRef.current(); };

    window.addEventListener('popstate', handlePop);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('popstate', handlePop);
      window.removeEventListener('keydown', handleKey);
      if (!closedByPopRef.current && history.state?.overlayDetail) {
        history.back();
      }
    };
  }, []); // empty — only fires on actual mount/unmount

  // ── Derived values ─────────────────────────────────────────────────────
  const livePrice = snap?.min?.c || snap?.day?.c || snap?.lastTrade?.p || snap?.prevDay?.c
                 || (bars.length ? bars[bars.length - 1].close : null);
  const prevClose  = snap?.prevDay?.c;
  const dayChange  = (livePrice && prevClose) ? livePrice - prevClose : null;
  const dayChgPct  = (dayChange && prevClose) ? (dayChange / prevClose) * 100 : null;
  const isPos      = (dayChgPct ?? 0) >= 0;
  const name       = info?.name || fundsData?.longName || disp;
  const dayHigh    = snap?.day?.h;
  const dayLow     = snap?.day?.l;
  const volume     = snap?.day?.v;
  // Market cap: prefer Yahoo (fundsData) → Polygon reference (info) as fallback
  const mktCap     = fundsData?.marketCap ?? info?.market_cap ?? null;
  // Description from Polygon (info) or Yahoo (fundsData) — whichever is non-empty
  const desc       = info?.description || fundsData?.description || null;

  const chartMin   = bars.length ? Math.min(...bars.map(b => b.close)) * 0.997 : 0;
  const chartMax   = bars.length ? Math.max(...bars.map(b => b.close)) * 1.003 : 1;
  const rangeHigh  = bars.length ? Math.max(...bars.map(b => b.high))  : null;
  const rangeLow   = bars.length ? Math.min(...bars.map(b => b.low))   : null;
  const rangeOpen  = bars.length ? bars[0].open : null;
  const rangeClose = bars.length ? bars[bars.length - 1].close : null;
  const rangeChg   = (rangeOpen && rangeClose) ? ((rangeClose - rangeOpen) / rangeOpen) * 100 : null;

  // ── Delta tool ─────────────────────────────────────────────────────────
  const deltaInfo = (() => {
    if (deltaA === null || deltaB === null || bars.length < 2) return null;
    const [i1, i2] = [deltaA, deltaB].sort((a, b) => a - b);
    const a = bars[i1], b = bars[i2];
    if (!a || !b) return null;
    const d = b.close - a.close;
    const p = (d / a.close) * 100;
    const days = (a.t && b.t) ? Math.round(Math.abs(b.t - a.t) / 86400000) : null;
    return { a, b, delta: d, pct: p, days };
  })();

  const handleChartClick = useCallback(chartData => {
    if (!deltaMode) return;
    const idx = chartData?.activeTooltipIndex;
    if (idx == null) return;
    if (deltaA === null)      setDeltaA(idx);
    else if (deltaB === null) setDeltaB(idx);
    else { setDeltaA(idx); setDeltaB(null); }
  }, [deltaMode, deltaA, deltaB]);

  const toggleDelta = () => {
    setDeltaMode(m => !m);
    setDeltaA(null);
    setDeltaB(null);
  };

  // ── Chart sub-render ───────────────────────────────────────────────────
  function renderChart() {
    if (loading) return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: 12 }}>
        Loading…
      </div>
    );
    if (bars.length === 0) return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: 12 }}>
        No data for this range
      </div>
    );

    const aMin = deltaA !== null && deltaB !== null ? Math.min(deltaA, deltaB) : null;
    const aMax = deltaA !== null && deltaB !== null ? Math.max(deltaA, deltaB) : null;

    return (
      <>
        {/* Price chart */}
        <div style={{ flex: 7, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={bars}
              margin={{ top: 8, right: 6, bottom: 0, left: 6 }}
              onClick={handleChartClick}
              onMouseMove={e => e?.activePayload?.[0] && setHovered(e.activePayload[0].payload)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: deltaMode ? 'crosshair' : 'default' }}
            >
              <defs>
                <linearGradient id="idGradFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={isPos ? GREEN : RED} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={isPos ? GREEN : RED} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#111" />
              <XAxis
                dataKey="label"
                tick={{ fill: '#333', fontSize: 9 }}
                interval="preserveStartEnd"
                tickLine={false}
                axisLine={{ stroke: '#1e1e1e' }}
              />
              <YAxis
                domain={[chartMin, chartMax]}
                tick={{ fill: '#333', fontSize: 9 }}
                width={64}
                tickFormatter={v => fmt(v, v > 999 ? 0 : 2)}
                axisLine={{ stroke: '#1e1e1e' }}
              />
              <Tooltip
                contentStyle={{ background: '#0d0d0d', border: '1px solid #2a2a2a', fontSize: 11, borderRadius: 3 }}
                formatter={(v, n) => [fmt(v), n]}
                labelStyle={{ color: '#555', marginBottom: 4 }}
              />

              {/* Shaded region between A and B */}
              {aMin !== null && bars[aMin] && bars[aMax] && (
                <ReferenceArea
                  x1={bars[aMin].label}
                  x2={bars[aMax].label}
                  fill={deltaInfo?.pct >= 0 ? GREEN : RED}
                  fillOpacity={0.06}
                  strokeOpacity={0}
                />
              )}

              {/* Vertical markers */}
              {deltaA !== null && bars[deltaA] && (
                <ReferenceLine x={bars[deltaA].label} stroke={ORANGE} strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: 'A', fill: ORANGE, fontSize: 10, position: 'top' }} />
              )}
              {deltaB !== null && bars[deltaB] && (
                <ReferenceLine x={bars[deltaB].label} stroke={ORANGE} strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: 'B', fill: ORANGE, fontSize: 10, position: 'top' }} />
              )}

              <Area
                type="monotone" dataKey="close" name="Close"
                stroke={isPos ? GREEN : RED} strokeWidth={1.5}
                fill="url(#idGradFill)" dot={false}
                activeDot={{ r: 3, fill: isPos ? GREEN : RED, strokeWidth: 0 }}
              />

              {/* Diagonal A→B line with delta badge */}
              {deltaInfo && (
                <Customized component={(chartProps) => (
                  <DeltaLineOverlay {...chartProps} bars={bars} deltaA={deltaA} deltaB={deltaB} deltaInfo={deltaInfo} />
                )} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Volume chart */}
        <div style={{ flex: 2, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 2, right: 6, bottom: 0, left: 6 }}>
              <XAxis dataKey="label" hide axisLine={false} />
              <YAxis
                tick={{ fill: '#222', fontSize: 8 }} width={64}
                tickFormatter={v =>
                  v >= 1e9 ? (v/1e9).toFixed(1)+'B' :
                  v >= 1e6 ? (v/1e6).toFixed(0)+'M' :
                  v >= 1e3 ? (v/1e3).toFixed(0)+'K' : String(v)
                }
                axisLine={false}
              />
              <Tooltip
                contentStyle={{ background: '#0d0d0d', border: '1px solid #2a2a2a', fontSize: 11, borderRadius: 3 }}
                formatter={v => [fmt(v, 0), 'Volume']}
                labelStyle={{ color: '#555' }}
              />
              <Bar dataKey="volume" fill="#1a3352" opacity={0.85} radius={[1, 1, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </>
    );
  }

  // ── Stats sub-render ───────────────────────────────────────────────────
  function renderStats() {
    return (
      <>
        {/* ── PRICE ── */}
        <Section title="PRICE">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
            <StatRow label="LAST"       value={fmt(livePrice)} color="#fff" big />
            <StatRow label="CHANGE"
              value={dayChgPct != null ? `${isPos?'+':''}${fmt(dayChange)}` : '--'}
              color={dayChgPct != null ? (isPos ? GREEN : RED) : '#555'}
            />
            <StatRow label="CHG %"
              value={dayChgPct != null ? `${isPos?'+':''}${fmt(dayChgPct)}%` : '--'}
              color={dayChgPct != null ? (isPos ? GREEN : RED) : '#555'}
            />
            <StatRow label="OPEN"       value={fmt(snap?.day?.o)} />
            <StatRow label="PREV CLOSE" value={fmt(prevClose)} />
            <StatRow label="DAY HIGH"   value={fmt(dayHigh)} />
            <StatRow label="DAY LOW"    value={fmt(dayLow)} />
            {snap?.day?.vw  != null && <StatRow label="VWAP"   value={fmt(snap.day.vw)} />}
            <StatRow label="VOLUME"     value={volume != null ? fmt(volume, 0) : '--'} />
            {isFX && snap?.lastQuote?.a != null && <StatRow label="ASK" value={fmt(snap.lastQuote.a, 5)} />}
            {isFX && snap?.lastQuote?.b != null && <StatRow label="BID" value={fmt(snap.lastQuote.b, 5)} />}
            {isFX && snap?.lastQuote?.a != null && snap?.lastQuote?.b != null && (
              <StatRow label="SPREAD" value={fmt(Math.abs(snap.lastQuote.a - snap.lastQuote.b), 5)} />
            )}
          </div>
        </Section>

        {/* ── RANGE ── */}
        <Section title={`${range.label} PERFORMANCE`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
            <StatRow label="HIGH"   value={fmt(rangeHigh)} />
            <StatRow label="LOW"    value={fmt(rangeLow)} />
            <StatRow label="RETURN"
              value={rangeChg != null ? (rangeChg>=0?'+':'')+fmt(rangeChg)+'%' : '--'}
              color={rangeChg != null ? (rangeChg>=0 ? GREEN : RED) : '#555'}
            />
            {fundsData?.fiftyTwoWeekHigh != null && <StatRow label="52W HIGH" value={fmt(fundsData.fiftyTwoWeekHigh)} />}
            {fundsData?.fiftyTwoWeekLow  != null && <StatRow label="52W LOW"  value={fmt(fundsData.fiftyTwoWeekLow)} />}
            {fundsData?.fiftyTwoWeekChange != null && (
              <StatRow label="52W CHG"
                value={pct(fundsData.fiftyTwoWeekChange)}
                color={fundsData.fiftyTwoWeekChange >= 0 ? GREEN : RED}
              />
            )}
          </div>
        </Section>

        {/* ── VALUATION ── */}
        {isStock && (
          <Section title="VALUATION">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
              {/* Market cap: always shown — uses Polygon reference (info) when Yahoo fails */}
              {mktCap != null && (
                <StatRow label="MKT CAP"
                  value={mktCap >= 1e12 ? '$'+(mktCap/1e12).toFixed(2)+'T'
                       : mktCap >= 1e9  ? '$'+(mktCap/1e9).toFixed(2)+'B'
                       :                  '$'+(mktCap/1e6).toFixed(1)+'M'} />
              )}
              {/* Yahoo Finance metrics — shown only when fundamentals loaded */}
              {fundsData?.enterpriseValue != null && (
                <StatRow label="EV"
                  value={fundsData.enterpriseValue >= 1e12 ? '$'+(fundsData.enterpriseValue/1e12).toFixed(2)+'T'
                       : fundsData.enterpriseValue >= 1e9  ? '$'+(fundsData.enterpriseValue/1e9).toFixed(2)+'B'
                       :                                     '$'+(fundsData.enterpriseValue/1e6).toFixed(1)+'M'} />
              )}
              {fundsData?.peRatio    != null && <StatRow label="P/E (TTM)"  value={fundsData.peRatio.toFixed(1)+'×'} />}
              {fundsData?.forwardPE  != null && <StatRow label="P/E (FWD)"  value={fundsData.forwardPE.toFixed(1)+'×'} />}
              {fundsData?.pegRatio   != null && <StatRow label="PEG"        value={fundsData.pegRatio.toFixed(2)+'×'} />}
              {fundsData?.priceToBook != null && <StatRow label="P/B"       value={fundsData.priceToBook.toFixed(2)+'×'} />}
              {fundsData?.priceToSales != null && <StatRow label="P/S"      value={fundsData.priceToSales.toFixed(2)+'×'} />}
              {fundsData?.eps        != null && <StatRow label="EPS (TTM)"  value={'$'+fundsData.eps.toFixed(2)} />}
              {fundsData?.forwardEps != null && <StatRow label="EPS (FWD)"  value={'$'+fundsData.forwardEps.toFixed(2)} />}
              {fundsData?.earningsDate && <StatRow label="EARNINGS" value={fundsData.earningsDate} color={ORANGE} />}
              {fundsData?.beta       != null && <StatRow label="BETA"       value={fundsData.beta.toFixed(2)} />}
              {fundsData?.dividendYield != null && (
                <StatRow label="DIV YIELD" value={(fundsData.dividendYield*100).toFixed(2)+'%'} color={GREEN} />
              )}
              {fundsData?.shortPercentFloat != null && (
                <StatRow label="SHORT %"
                  value={(fundsData.shortPercentFloat*100).toFixed(1)+'%'}
                  color={fundsData.shortPercentFloat > 0.1 ? RED : '#aaa'}
                />
              )}
              {fundsData?.sharesOutstanding != null && (
                <StatRow label="SHARES"
                  value={fundsData.sharesOutstanding >= 1e9
                    ? (fundsData.sharesOutstanding/1e9).toFixed(2)+'B'
                    : (fundsData.sharesOutstanding/1e6).toFixed(0)+'M'} />
              )}
              {/* Loading/error indicator for the Yahoo portion only */}
              {fundsLoading && mktCap != null && (
                <div style={{ gridColumn: '1/-1', color: '#2a2a2a', fontSize: 8, paddingTop: 2 }}>loading ratios…</div>
              )}
              {fundsLoading && mktCap == null && (
                <div style={{ gridColumn: '1/-1', color: '#2a2a2a', fontSize: 10 }}>Loading…</div>
              )}
              {!fundsLoading && fundsError && mktCap == null && (
                <div style={{ gridColumn: '1/-1', color: '#3a3a3a', fontSize: 9 }}>Fundamental data unavailable</div>
              )}
              {!fundsLoading && fundsError && mktCap != null && (
                <div style={{ gridColumn: '1/-1', color: '#2a2a2a', fontSize: 8 }}>ratios unavailable</div>
              )}
            </div>
          </Section>
        )}

        {/* ── FINANCIALS ── */}
        {isStock && fundsData && (fundsData.totalRevenue || fundsData.ebitda || fundsData.profitMargins) && (
          <Section title="FINANCIALS">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
              {fundsData.totalRevenue != null && (
                <StatRow label="REVENUE"
                  value={fundsData.totalRevenue >= 1e9
                    ? '$'+(fundsData.totalRevenue/1e9).toFixed(1)+'B'
                    : '$'+(fundsData.totalRevenue/1e6).toFixed(0)+'M'} />
              )}
              {fundsData.revenueGrowth != null && (
                <StatRow label="REV GROWTH"
                  value={pct(fundsData.revenueGrowth)}
                  color={fundsData.revenueGrowth >= 0 ? GREEN : RED}
                />
              )}
              {fundsData.ebitda != null && (
                <StatRow label="EBITDA"
                  value={fundsData.ebitda >= 1e9
                    ? '$'+(fundsData.ebitda/1e9).toFixed(1)+'B'
                    : '$'+(fundsData.ebitda/1e6).toFixed(0)+'M'} />
              )}
              {fundsData.grossMargins    != null && <StatRow label="GROSS MGNS"  value={pct(fundsData.grossMargins)} />}
              {fundsData.operatingMargins != null && <StatRow label="OPER MGNS"  value={pct(fundsData.operatingMargins)} />}
              {fundsData.profitMargins   != null && (
                <StatRow label="NET MARGIN"
                  value={pct(fundsData.profitMargins)}
                  color={fundsData.profitMargins >= 0 ? GREEN : RED}
                />
              )}
              {fundsData.returnOnEquity  != null && (
                <StatRow label="ROE"
                  value={pct(fundsData.returnOnEquity)}
                  color={fundsData.returnOnEquity >= 0 ? GREEN : RED}
                />
              )}
              {fundsData.returnOnAssets  != null && (
                <StatRow label="ROA"
                  value={pct(fundsData.returnOnAssets)}
                  color={fundsData.returnOnAssets >= 0 ? GREEN : RED}
                />
              )}
              {fundsData.totalCash != null && (
                <StatRow label="CASH"
                  value={fundsData.totalCash >= 1e9
                    ? '$'+(fundsData.totalCash/1e9).toFixed(1)+'B'
                    : '$'+(fundsData.totalCash/1e6).toFixed(0)+'M'} />
              )}
              {fundsData.totalDebt != null && (
                <StatRow label="DEBT"
                  value={fundsData.totalDebt >= 1e9
                    ? '$'+(fundsData.totalDebt/1e9).toFixed(1)+'B'
                    : '$'+(fundsData.totalDebt/1e6).toFixed(0)+'M'}
                  color="#c07070"
                />
              )}
            </div>
          </Section>
        )}

        {/* ── PROFILE ── */}
        {isStock && (fundsData?.sector || fundsData?.industry) && (
          <Section title="PROFILE">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
              {fundsData.sector   && <StatRow label="SECTOR"    value={fundsData.sector} />}
              {fundsData.industry && <StatRow label="INDUSTRY"  value={fundsData.industry} />}
              {fundsData.employees != null && (
                <StatRow label="EMPLOYEES" value={fundsData.employees.toLocaleString()} />
              )}
            </div>
          </Section>
        )}
      </>
    );
  }

  // ── News sub-render ────────────────────────────────────────────────────
  function renderNews() {
    return (
      <Section title="NEWS">
        {newsLoading && <div style={{ color: '#2a2a2a', fontSize: 10, padding: '4px 0' }}>Loading…</div>}
        {!newsLoading && news.length === 0 && (
          <div style={{ color: '#2a2a2a', fontSize: 10, padding: '4px 0' }}>No recent news found.</div>
        )}
        {news.map((item, i) => {
          const url   = item.article_url || item.link || item.url;
          const title = item.title || 'Untitled';
          const src   = item.publisher?.name || item.source || '';
          const ago   = timeAgo(item.published_utc);
          return (
            <div
              key={i}
              onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
              style={{
                borderBottom: '1px solid #141414',
                padding: '9px 0',
                cursor: url ? 'pointer' : 'default',
              }}
            >
              <div style={{
                color: url ? '#c8c8c8' : '#888',
                fontSize: 11,
                lineHeight: 1.5,
                marginBottom: 5,
              }}>{title}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#3a3a3a', fontSize: 9, letterSpacing: 0.3 }}>{src}</span>
                <span style={{ color: '#2a2a2a', fontSize: 9 }}>{ago}</span>
              </div>
            </div>
          );
        })}
      </Section>
    );
  }

  // ── About sub-render ───────────────────────────────────────────────────
  function renderFundamentals() {
    if (!isStock) return <div style={{ color: '#555', fontSize: 10 }}>Fundamentals only for stocks</div>;
    if (fundsLoading) return <div style={{ color: '#555', fontSize: 10, padding: '12px 0' }}>LOADING FUNDAMENTALS...</div>;
    if (fundsError || !fundsData) return <div style={{ color: '#f44336', fontSize: 10, padding: '12px 0' }}>⚠ Fundamentals unavailable</div>;

    const d = fundsData;
    return (
      <>
        <Section title="PROFILE">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
            {d.name && <StatRow label="NAME" value={d.name} />}
            {d.currency && <StatRow label="CURRENCY" value={d.currency} />}
            {d.marketCap && <StatRow label="MARKET CAP" value={fmt(d.marketCap, 0)} />}
            {d.primaryExchange && <StatRow label="EXCHANGE" value={d.primaryExchange} />}
            {d.listDate && <StatRow label="LIST DATE" value={d.listDate} />}
          </div>
        </Section>
        {d.description && (
          <Section title="ABOUT">
            {d.homepageUrl && (
              <a href={d.homepageUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: ORANGE, fontSize: 9, display: 'block', marginBottom: 8, textDecoration: 'none' }}>
                {d.homepageUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
            <p style={{ color: '#888', fontSize: 10, lineHeight: 1.6, margin: 0 }}>
              {d.description}
            </p>
          </Section>
        )}
        {d.sicDescription && (
          <Section title="INDUSTRY">
            <p style={{ color: '#888', fontSize: 10, lineHeight: 1.6, margin: 0 }}>
              {d.sicDescription}
            </p>
          </Section>
        )}
      </>
    );
  }

  function renderAbout() {
    if (!desc) return null;
    const SHORT = 400;
    const truncated = !descExpanded && desc.length > SHORT;
    return (
      <Section title="ABOUT">
        {fundsData?.website && (
          <a href={fundsData.website} target="_blank" rel="noopener noreferrer"
            style={{ color: ORANGE, fontSize: 9, display: 'block', marginBottom: 8, textDecoration: 'none' }}>
            {fundsData.website.replace(/^https?:\/\//, '')}
          </a>
        )}
        <p style={{ color: '#888', fontSize: 10, lineHeight: 1.7, margin: 0 }}>
          {truncated ? desc.slice(0, SHORT) + '…' : desc}
        </p>
        {desc.length > SHORT && (
          <button
            onClick={() => setDescExpanded(e => !e)}
            style={{
              background: 'none', border: 'none', color: ORANGE,
              fontSize: 9, cursor: 'pointer', padding: '6px 0 0', letterSpacing: 0.3,
            }}
          >
            {descExpanded ? '▲ SHOW LESS' : '▼ SHOW MORE'}
          </button>
        )}
      </Section>
    );
  }

  // ── RENDER ──────────────────────────────────────────────────────────────
  const mobileTabs = ['STATS', 'FUND', 'NEWS', ...(desc ? ['ABOUT'] : [])];

  const deltaHint = deltaMode
    ? (deltaA === null ? '← tap A' : deltaB === null ? '← tap B' : 'tap to reset')
    : null;

  // ── Fetch fundamentals ──────────────────────────────────────────────────
  const fetchFundamentals = useCallback(async () => {
    if (!isStock || activeTab !== 'FUND') return;
    setFundsLoading(true);
    setFundsError(false);
    try {
      const res = await fetch(`${API}/api/fundamentals/${norm}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFundsData(data);
    } catch (e) {
      setFundsError(true);
      console.error('[InstrumentDetail] Fundamentals error:', e);
    } finally {
      setFundsLoading(false);
    }
  }, [norm, isStock, activeTab]);

  useEffect(() => {
    if (activeTab === 'FUND' && isStock) {
      fetchFundamentals();
    }
  }, [activeTab, isStock, fetchFundamentals]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        // Account for iOS notch / Dynamic Island — push content below status bar
        paddingTop: isMobile ? 'env(safe-area-inset-top)' : 0,
        paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : 0,
        background: 'rgba(0,0,0,0.97)',
        display: 'flex', flexDirection: 'column',
        fontFamily: '"Courier New", monospace', color: '#e0e0e0',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >

      {/* ── HEADER ──
          MOBILE: ✕ is placed FIRST so it is never clipped by overflow.
                  Compact single-row layout: [✕] [ticker+price] [spacer] [⟷] [↓CSV]
          DESKTOP: Full layout with all controls on the right.
      */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10,
        padding: isMobile ? '8px 10px' : '8px 16px',
        borderBottom: '1px solid #1a1a1a', background: '#080808',
        flexShrink: 0, flexWrap: 'nowrap', minHeight: 0,
        overflow: 'hidden',
      }}>

        {/* ── Close button — FIRST so it always visible on mobile ── */}
        <button
          onClick={onClose}
          title="Close"
          style={{
            width: isMobile ? 36 : 26, height: isMobile ? 36 : 26, flexShrink: 0,
            borderRadius: '50%', border: '1px solid #2a2a2a',
            background: '#111', color: '#999', cursor: 'pointer',
            fontSize: isMobile ? 16 : 14, lineHeight: '1', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >✕</button>

        {isMobile ? (
          /* ── MOBILE: compact inline ticker + price in one block ── */
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 'bold', color: ORANGE, flexShrink: 0 }}>{disp}</span>
              {livePrice != null && (
                <span style={{ fontSize: 15, color: '#fff', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {fmt(livePrice)}
                </span>
              )}
              {dayChgPct != null && (
                <span style={{ fontSize: 11, color: isPos ? GREEN : RED, flexShrink: 0 }}>
                  {isPos ? '+' : ''}{fmt(dayChgPct)}%
                </span>
              )}
            </div>
            {name !== disp && (
              <span style={{ fontSize: 9, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </span>
            )}
          </div>
        ) : (
          /* ── DESKTOP: separate ticker and price blocks ── */
          <>
            {/* Ticker + name */}
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 1 }}>
              <span style={{ fontSize: 19, fontWeight: 'bold', color: ORANGE, lineHeight: 1 }}>{disp}</span>
              {name !== disp && (
                <span style={{ fontSize: 9, color: '#444', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </span>
              )}
            </div>

            {/* Price + change */}
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 1 }}>
              {livePrice != null && (
                <span style={{ fontSize: 22, color: '#fff', fontWeight: 'bold', lineHeight: 1 }}>{fmt(livePrice)}</span>
              )}
              {dayChgPct != null && (
                <span style={{ fontSize: 12, color: isPos ? GREEN : RED, lineHeight: 1 }}>
                  {isPos ? '+' : ''}{fmt(dayChange)} ({isPos ? '+' : ''}{fmt(dayChgPct)}%)
                </span>
              )}
            </div>

            {/* Hover price (desktop only) */}
            {hovered && (
              <span style={{ fontSize: 11, color: '#444', marginLeft: 4, flexShrink: 0 }}>
                ● {hovered.label}: {fmt(hovered.close)}
              </span>
            )}
          </>
        )}

        <div style={{ flex: isMobile ? 0 : 1 }} />

        {/* Delta badge — desktop only (on mobile it's in the chart area) */}
        {!isMobile && deltaInfo && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '3px 8px', borderRadius: 3,
            background: '#0e0e0e',
            border: `1px solid ${deltaInfo.pct >= 0 ? GREEN : RED}`,
            flexShrink: 0,
          }}>
            <span style={{ color: deltaInfo.pct >= 0 ? GREEN : RED, fontSize: 12, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
              {deltaInfo.pct >= 0 ? '+' : ''}{fmt(deltaInfo.pct)}%
            </span>
            <span style={{ color: '#555', fontSize: 9, whiteSpace: 'nowrap' }}>
              {fmt(Math.abs(deltaInfo.delta))} {deltaInfo.days != null ? `· ${deltaInfo.days}d` : ''}
            </span>
          </div>
        )}

        {/* Delta hint */}
        {deltaHint && (
          <span style={{ fontSize: 9, color: ORANGE, flexShrink: 0 }}>{deltaHint}</span>
        )}

        {/* Measure button */}
        <button
          onClick={toggleDelta}
          title="Measure tool: tap A then B on the chart"
          style={{
            padding: isMobile ? '6px 10px' : '4px 10px',
            fontSize: 10, borderRadius: 3, cursor: 'pointer',
            border: `1px solid ${deltaMode ? ORANGE : '#252525'}`,
            background: deltaMode ? 'rgba(255,107,0,0.15)' : 'transparent',
            color: deltaMode ? ORANGE : '#444',
            whiteSpace: 'nowrap', flexShrink: 0,
            letterSpacing: 0.5, fontFamily: 'inherit',
          }}
        >⟷{isMobile ? '' : ' MEASURE'}</button>

        {/* Export button */}
        <button
          onClick={() => exportToCSV(bars, norm, range.label)}
          title="Export chart data to CSV"
          style={{
            padding: isMobile ? '6px 8px' : '4px 10px',
            fontSize: 10, borderRadius: 3, cursor: 'pointer',
            border: '1px solid #252525',
            background: 'transparent', color: '#444',
            whiteSpace: 'nowrap', flexShrink: 0,
            letterSpacing: 0.5, fontFamily: 'inherit',
          }}
        >{isMobile ? '↓' : '↓ EXPORT'}</button>

      </div>

      {/* ── BODY ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        minHeight: 0,
        overflow: 'hidden',
      }}>

        {/* LEFT: CHART PANEL */}
        <div style={{
          flex: isMobile ? '0 0 42vh' : 1,
          display: 'flex', flexDirection: 'column',
          padding: '8px 10px', minWidth: 0, minHeight: 0,
        }}>
          {/* Range selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, flexShrink: 0, flexWrap: 'wrap' }}>
            {RANGES.map((r, i) => (
              <button key={r.label}
                onClick={() => setRangeIdx(i)}
                style={{
                  padding: '3px 8px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
                  border: `1px solid ${i === rangeIdx ? ORANGE : '#1e1e1e'}`,
                  background: i === rangeIdx ? ORANGE : 'transparent',
                  color: i === rangeIdx ? '#fff' : '#3a3a3a',
                  fontFamily: 'inherit',
                }}
              >{r.label}</button>
            ))}
            {rangeChg != null && !loading && (
              <span style={{ fontSize: 10, color: rangeChg >= 0 ? GREEN : RED, marginLeft: 4 }}>
                {rangeChg >= 0 ? '+' : ''}{fmt(rangeChg)}%
              </span>
            )}
            {/* Mobile: show delta badge inline below range buttons */}
            {isMobile && deltaInfo && (
              <span style={{
                fontSize: 11, fontWeight: 'bold', marginLeft: 'auto', flexShrink: 0,
                color: deltaInfo.pct >= 0 ? GREEN : RED,
                border: `1px solid ${deltaInfo.pct >= 0 ? GREEN : RED}`,
                borderRadius: 3, padding: '2px 6px',
              }}>
                {deltaInfo.pct >= 0 ? '+' : ''}{fmt(deltaInfo.pct)}%
                {deltaInfo.days != null && <span style={{ color: '#555', fontSize: 9 }}> · {deltaInfo.days}d</span>}
              </span>
            )}
            {/* Mobile: delta hint */}
            {isMobile && deltaHint && (
              <span style={{ fontSize: 9, color: ORANGE }}>{deltaHint}</span>
            )}
          </div>

          {/* Chart area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {renderChart()}
          </div>
        </div>

        {/* RIGHT: SIDEBAR (desktop) */}
        {!isMobile && (
          <div style={{
            width: 320, background: '#050505',
            borderLeft: '1px solid #141414',
            padding: '14px 16px',
            overflowY: 'auto', fontSize: 11, flexShrink: 0,
          }}>
            {renderStats()}
            {renderNews()}
            {renderAbout()}
          </div>
        )}

        {/* BOTTOM: TABS (mobile) */}
        {isMobile && (
          <div style={{
            flex: 1,
            display: 'flex', flexDirection: 'column',
            borderTop: '1px solid #1a1a1a',
            minHeight: 0,
            overflow: 'hidden',
          }}>
            {/* Tab bar */}
            <div style={{
              display: 'flex', background: '#080808',
              borderBottom: '1px solid #181818', flexShrink: 0,
            }}>
              {mobileTabs.map(t => (
                <button key={t}
                  onClick={() => setActiveTab(t)}
                  style={{
                    flex: 1, padding: '10px 0', fontSize: 11,
                    background: 'transparent', border: 'none',
                    borderBottom: activeTab === t ? `2px solid ${ORANGE}` : '2px solid transparent',
                    color: activeTab === t ? ORANGE : '#444',
                    cursor: 'pointer', letterSpacing: 0.5, fontFamily: 'inherit',
                  }}
                >{t}</button>
              ))}
            </div>
            {/* Tab content */}
            <div style={{
              flex: 1, minHeight: 0,
              overflowY: 'auto', WebkitOverflowScrolling: 'touch',
              padding: '12px 14px', fontSize: 11,
              background: '#050505',
            }}>
              {activeTab === 'STATS' && renderStats()}
              {activeTab === 'FUND'  && renderFundamentals()}
              {activeTab === 'NEWS'  && renderNews()}
              {activeTab === 'ABOUT' && renderAbout()}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Shared sub-components ───────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        color: ORANGE, fontWeight: 'bold', fontSize: 9,
        letterSpacing: 1.8, marginBottom: 8,
        borderBottom: '1px solid #141414', paddingBottom: 5,
      }}>{title}</div>
      {children}
    </div>
  );
}

function StatRow({ label, value, color, big }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      alignItems: 'baseline', gap: 4, marginBottom: 5,
    }}>
      <span style={{ color: '#2e2e2e', fontSize: 9, letterSpacing: 0.4, flexShrink: 0, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{
        color: color || '#999', fontWeight: big ? 'bold' : 'normal',
        fontSize: big ? 13 : 11, textAlign: 'right',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  );
}
