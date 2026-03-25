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

// ── Custom SVG overlay: diagonal line A→B with delta badge ─────────────────
function DeltaLineOverlay({ xAxisMap, yAxisMap, bars, deltaA, deltaB, deltaInfo }) {
  if (!deltaInfo || deltaA === null || deltaB === null) return null;
  const [i1, i2] = [deltaA, deltaB].sort((a, b) => a - b);
  const barA = bars[i1], barB = bars[i2];
  if (!barA || !barB) return null;

  const xAxis = xAxisMap && xAxisMap[0];
  const yAxis = yAxisMap && yAxisMap[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;

  const bw = xAxis.scale.bandwidth ? xAxis.scale.bandwidth() / 2 : 0;
  const xA = xAxis.scale(barA.label) + bw;
  const xB = xAxis.scale(barB.label) + bw;
  const yA = yAxis.scale(barA.close);
  const yB = yAxis.scale(barB.close);

  if (isNaN(xA) || isNaN(xB) || isNaN(yA) || isNaN(yB)) return null;

  // Badge sits just above the midpoint of the line
  const midX = (xA + xB) / 2;
  const midY = (yA + yB) / 2 - 16;

  const color  = deltaInfo.pct >= 0 ? GREEN : RED;
  const pctStr = (deltaInfo.pct >= 0 ? '+' : '') + deltaInfo.pct.toFixed(2) + '%';
  const absStr = (deltaInfo.delta >= 0 ? '+' : '') + fmt(deltaInfo.delta);
  const line1W = pctStr.length * 6.8 + 14;
  const line2W = absStr.length * 6.0 + 14;
  const badgeW = Math.max(line1W, line2W);
  const badgeH = 32;

  return (
    <g>
      {/* Connecting line */}
      <line
        x1={xA} y1={yA} x2={xB} y2={yB}
        stroke={color} strokeWidth={1.5} strokeDasharray="6 3" opacity={0.9}
      />
      {/* Endpoint dots */}
      <circle cx={xA} cy={yA} r={5} fill={color} stroke="#000" strokeWidth={1.5} />
      <circle cx={xB} cy={yB} r={5} fill={color} stroke="#000" strokeWidth={1.5} />
      {/* Delta badge */}
      <rect
        x={midX - badgeW / 2} y={midY - badgeH / 2}
        width={badgeW} height={badgeH} rx={4}
        fill="#0a0a0a" stroke={color} strokeWidth={1}
      />
      <text
        x={midX} y={midY - 4}
        textAnchor="middle" fill={color}
        fontSize={11} fontFamily="'Courier New', monospace" fontWeight="bold"
      >{pctStr}</text>
      <text
        x={midX} y={midY + 11}
        textAnchor="middle" fill="#666"
        fontSize={9} fontFamily="'Courier New', monospace"
      >{absStr}</text>
    </g>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function InstrumentDetail({ ticker, onClose }) {
  const norm     = normalizeTicker(ticker);
  const disp     = displayTicker(norm);
  const isFX     = norm.startsWith('C:');
  const isCrypto = norm.startsWith('X:');
  const isMobile = window.innerWidth < 1024;

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
  const [news,      setNews]      = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('STATS');

  const range = RANGES[rangeIdx];

  // ── Fetch bars ────────────────────────────────────────────────────────
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
          t: b.t, label: fmtLabel(b.t, range.timespan),
          open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0,
        })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [norm, rangeIdx]);

  // ── Fetch snapshot ────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/snapshot/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.json())
      .then(d => setSnap(d?.ticker ?? d))
      .catch(() => {});
  }, [norm]);

  // ── Fetch reference info (stocks only) ───────────────────────────────
  useEffect(() => {
    if (isFX || isCrypto) return;
    fetch(`${API}/api/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.json())
      .then(d => setInfo(d?.results ?? d))
      .catch(() => {});
  }, [norm]);

  // ── Fetch fundamentals ────────────────────────────────────────────────
  useEffect(() => {
    if (!norm) return;
    setFundsData(null);
    fetch(API + '/api/fundamentals/' + encodeURIComponent(norm))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setFundsData(d); })
      .catch(() => {});
  }, [norm]);

  // ── Fetch ticker-specific news ────────────────────────────────────────
  useEffect(() => {
    setNewsLoading(true);
    setNews([]);
    // Strip Polygon prefix for Polygon news API (X:BTCUSD → BTCUSD, C:EURUSD → EURUSD)
    const newsTicker = norm.replace(/^[XCI]:/, '');
    fetch(`${API}/api/news?ticker=${encodeURIComponent(newsTicker)}&limit=12`)
      .then(r => r.json())
      .then(d => { setNews(d?.results || []); setNewsLoading(false); })
      .catch(() => setNewsLoading(false));
  }, [norm]);

  // ── Escape key + mobile back-button support ───────────────────────────
  const closedByPopRef = useRef(false);
  useEffect(() => {
    // Push a history entry so the mobile back button dismisses the overlay
    // instead of navigating away from the app
    history.pushState({ overlayDetail: true }, '');

    const handlePop = () => {
      closedByPopRef.current = true;
      onClose();
    };
    const handleKey = e => { if (e.key === 'Escape') onClose(); };

    window.addEventListener('popstate', handlePop);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('popstate', handlePop);
      window.removeEventListener('keydown', handleKey);
      // If closed by ✕ or backdrop (not by back button), pop our history entry
      if (!closedByPopRef.current && history.state?.overlayDetail) {
        history.back();
      }
    };
  }, [onClose]);

  // ── Derived values ────────────────────────────────────────────────────
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
  const desc       = info?.description;

  const chartMin   = bars.length ? Math.min(...bars.map(b => b.close)) * 0.998 : 0;
  const chartMax   = bars.length ? Math.max(...bars.map(b => b.close)) * 1.002 : 1;
  const rangeHigh  = bars.length ? Math.max(...bars.map(b => b.high)) : null;
  const rangeLow   = bars.length ? Math.min(...bars.map(b => b.low))  : null;
  const rangeOpen  = bars.length ? bars[0].open : null;
  const rangeClose = bars.length ? bars[bars.length - 1].close : null;
  const rangeChg   = (rangeOpen && rangeClose) ? ((rangeClose - rangeOpen) / rangeOpen) * 100 : null;

  // ── Delta tool ────────────────────────────────────────────────────────
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

  const toggleDelta = () => { setDeltaMode(m => !m); setDeltaA(null); setDeltaB(null); };

  // ── Sub-renders ───────────────────────────────────────────────────────

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
                  <stop offset="5%"  stopColor={isPos ? GREEN : RED} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={isPos ? GREEN : RED} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#161616" />
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
                  fillOpacity={0.05}
                  strokeOpacity={0}
                />
              )}

              {/* Vertical markers for A and B */}
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

              {/* Diagonal A→B connecting line with delta badge */}
              {deltaInfo && (
                <Customized component={(chartProps) => (
                  <DeltaLineOverlay
                    {...chartProps}
                    bars={bars}
                    deltaA={deltaA}
                    deltaB={deltaB}
                    deltaInfo={deltaInfo}
                  />
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
                tick={{ fill: '#2a2a2a', fontSize: 8 }}
                width={64}
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

  function renderStats() {
    return (
      <>
        <Section title="PRICE">
          <StatRow label="LAST"       value={fmt(livePrice)} color="#e8e8e8" />
          <StatRow label="CHANGE"
            value={dayChgPct != null ? `${isPos?'+':''}${fmt(dayChange)}  (${isPos?'+':''}${fmt(dayChgPct)}%)` : '--'}
            color={dayChgPct != null ? (isPos ? GREEN : RED) : '#555'}
          />
          <StatRow label="OPEN"       value={fmt(snap?.day?.o)} />
          <StatRow label="PREV CLOSE" value={fmt(prevClose)} />
          <StatRow label="DAY HIGH"   value={fmt(dayHigh)} />
          <StatRow label="DAY LOW"    value={fmt(dayLow)} />
          {snap?.day?.vw  != null && <StatRow label="VWAP"   value={fmt(snap.day.vw)} />}
          {isFX && snap?.lastQuote?.a != null && <StatRow label="ASK" value={fmt(snap.lastQuote.a, 5)} />}
          {isFX && snap?.lastQuote?.b != null && <StatRow label="BID" value={fmt(snap.lastQuote.b, 5)} />}
          {isFX && snap?.lastQuote?.a != null && snap?.lastQuote?.b != null && (
            <StatRow label="SPREAD" value={fmt(Math.abs(snap.lastQuote.a - snap.lastQuote.b), 5)} />
          )}
          <StatRow label="VOLUME"     value={volume != null ? fmt(volume, 0) : '--'} />
        </Section>

        <Section title={`${range.label} RANGE`}>
          <StatRow label="HIGH"   value={fmt(rangeHigh)} />
          <StatRow label="LOW"    value={fmt(rangeLow)} />
          <StatRow label="RETURN"
            value={rangeChg != null ? (rangeChg>=0?'+':'')+fmt(rangeChg)+'%' : '--'}
            color={rangeChg != null ? (rangeChg>=0 ? GREEN : RED) : '#555'}
          />
          {fundsData?.fiftyTwoWeekHigh != null && <StatRow label="52W HIGH" value={fmt(fundsData.fiftyTwoWeekHigh)} />}
          {fundsData?.fiftyTwoWeekLow  != null && <StatRow label="52W LOW"  value={fmt(fundsData.fiftyTwoWeekLow)} />}
        </Section>

        {!isFX && !isCrypto && (
          <Section title="FUNDAMENTALS">
            {fundsData == null
              ? <div style={{ color: '#2a2a2a', fontSize: 10 }}>Loading…</div>
              : <>
                  {fundsData.marketCap      != null && <StatRow label="MARKET CAP"
                    value={fundsData.marketCap >= 1e12 ? '$'+(fundsData.marketCap/1e12).toFixed(2)+'T'
                         : fundsData.marketCap >= 1e9  ? '$'+(fundsData.marketCap/1e9).toFixed(2)+'B'
                         :                               '$'+(fundsData.marketCap/1e6).toFixed(1)+'M'} />}
                  {fundsData.peRatio        != null && <StatRow label="P/E (TTM)"   value={fundsData.peRatio.toFixed(1)+'×'} />}
                  {fundsData.forwardPE      != null && <StatRow label="P/E (FWD)"   value={fundsData.forwardPE.toFixed(1)+'×'} />}
                  {fundsData.eps            != null && <StatRow label="EPS (TTM)"   value={'$'+fundsData.eps.toFixed(2)} />}
                  {fundsData.beta           != null && <StatRow label="BETA"        value={fundsData.beta.toFixed(2)} />}
                  {fundsData.dividendYield  != null && <StatRow label="DIV YIELD"   value={(fundsData.dividendYield*100).toFixed(2)+'%'} />}
                  {fundsData.returnOnEquity != null && <StatRow label="ROE"         value={(fundsData.returnOnEquity*100).toFixed(1)+'%'} />}
                  {fundsData.sharesOutstanding != null && <StatRow label="SHARES OUT"
                    value={fundsData.sharesOutstanding >= 1e9
                      ? (fundsData.sharesOutstanding/1e9).toFixed(2)+'B'
                      : (fundsData.sharesOutstanding/1e6).toFixed(0)+'M'} />}
                </>
            }
          </Section>
        )}

        {!isFX && !isCrypto && (fundsData?.sector || fundsData?.industry) && (
          <Section title="PROFILE">
            {fundsData.sector   && <StatRow label="SECTOR"   value={fundsData.sector} />}
            {fundsData.industry && <StatRow label="INDUSTRY" value={fundsData.industry} />}
          </Section>
        )}
      </>
    );
  }

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
                borderBottom: '1px solid #161616',
                padding: '8px 0',
                cursor: url ? 'pointer' : 'default',
              }}
            >
              <div style={{
                color: url ? '#c8c8c8' : '#888',
                fontSize: 11,
                lineHeight: 1.45,
                marginBottom: 4,
                textDecoration: 'none',
              }}>
                {title}
              </div>
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

  function renderAbout() {
    if (!desc) return null;
    return (
      <Section title="ABOUT">
        <p style={{ color: '#888', fontSize: 10, lineHeight: 1.65, margin: 0 }}>
          {desc.length > 700 ? desc.slice(0, 700) + '…' : desc}
        </p>
      </Section>
    );
  }

  // ── RENDER ──────────────────────────────────────────────────────────────
  const mobileTabs = ['STATS', 'NEWS', ...(desc ? ['ABOUT'] : [])];

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

      {/* ── HEADER ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: isMobile ? '8px 12px' : '8px 16px',
        borderBottom: '1px solid #1e1e1e', background: '#0c0c0c',
        flexShrink: 0, flexWrap: 'nowrap', minHeight: 0,
      }}>
        <span style={{ fontSize: isMobile ? 15 : 20, fontWeight: 'bold', color: ORANGE, flexShrink: 0 }}>
          {disp}
        </span>
        {!isMobile && name !== disp && (
          <span style={{ fontSize: 11, color: '#555', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
        )}
        {livePrice != null && (
          <span style={{ fontSize: isMobile ? 15 : 21, color: '#fff', marginLeft: 2, flexShrink: 0 }}>
            {fmt(livePrice)}
          </span>
        )}
        {dayChgPct != null && (
          <span style={{ fontSize: isMobile ? 11 : 13, color: isPos ? GREEN : RED, flexShrink: 0 }}>
            {isPos ? '+' : ''}{fmt(dayChange)}&nbsp;({isPos ? '+' : ''}{fmt(dayChgPct)}%)
          </span>
        )}
        {!isMobile && hovered && (
          <span style={{ fontSize: 11, color: '#444', marginLeft: 4 }}>
            ● {hovered.label}: {fmt(hovered.close)}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Delta result badge in header */}
        {deltaInfo && (
          <span style={{
            fontSize: isMobile ? 11 : 12,
            padding: '3px 8px', borderRadius: 3,
            background: '#101010',
            border: `1px solid ${deltaInfo.pct >= 0 ? GREEN : RED}`,
            color: deltaInfo.pct >= 0 ? GREEN : RED,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {deltaInfo.pct >= 0 ? '+' : ''}{fmt(deltaInfo.pct)}%
            &nbsp;({fmt(deltaInfo.delta)})
            {!isMobile && (
              <span style={{ color: '#333', marginLeft: 8, fontSize: 9 }}>
                {deltaInfo.a.label} → {deltaInfo.b.label}
              </span>
            )}
          </span>
        )}

        <button
          onClick={toggleDelta}
          style={{
            padding: isMobile ? '5px 10px' : '3px 10px',
            fontSize: 11, borderRadius: 3, cursor: 'pointer',
            border: `1px solid ${deltaMode ? ORANGE : '#2a2a2a'}`,
            background: deltaMode ? ORANGE : 'transparent',
            color: deltaMode ? '#fff' : '#555',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >⟷ {isMobile ? 'Δ' : 'Δ MEASURE'}</button>

        <button
          onClick={onClose}
          style={{
            width: isMobile ? 34 : 26, height: isMobile ? 34 : 26,
            borderRadius: '50%', border: '1px solid #2a2a2a',
            background: '#111', color: '#777', cursor: 'pointer',
            fontSize: 14, lineHeight: '1', flexShrink: 0,
          }}
        >✕</button>
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
          flex: 1, display: 'flex', flexDirection: 'column',
          padding: '8px 10px', minWidth: 0,
          height: isMobile ? '42vh' : '100%',
          flexShrink: isMobile ? 0 : 1,
        }}>
          {/* Range selector row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, flexShrink: 0 }}>
            {RANGES.map((r, i) => (
              <button key={r.label}
                onClick={() => setRangeIdx(i)}
                style={{
                  padding: '2px 8px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
                  border: `1px solid ${i === rangeIdx ? ORANGE : '#222'}`,
                  background: i === rangeIdx ? ORANGE : 'transparent',
                  color: i === rangeIdx ? '#fff' : '#444',
                }}
              >{r.label}</button>
            ))}
            {rangeChg != null && (
              <span style={{ fontSize: 10, color: rangeChg >= 0 ? GREEN : RED, marginLeft: 8 }}>
                {rangeChg >= 0 ? '+' : ''}{fmt(rangeChg)}%
              </span>
            )}
            <div style={{ flex: 1 }} />
            {deltaMode && (
              <span style={{ fontSize: 10, color: ORANGE }}>
                {deltaA === null ? '← click start' : deltaB === null ? '← click end' : 'click to reset'}
              </span>
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
            width: 300, background: '#060606',
            borderLeft: '1px solid #181818',
            padding: '12px 14px',
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
            flex: 1, display: 'flex', flexDirection: 'column',
            borderTop: '1px solid #1a1a1a', minHeight: 0,
          }}>
            {/* Tab bar */}
            <div style={{
              display: 'flex', background: '#0a0a0a',
              borderBottom: '1px solid #181818', flexShrink: 0,
            }}>
              {mobileTabs.map(t => (
                <button key={t}
                  onClick={() => setActiveTab(t)}
                  style={{
                    flex: 1, padding: '9px 0', fontSize: 10,
                    background: 'transparent', border: 'none',
                    borderBottom: activeTab === t ? `2px solid ${ORANGE}` : '2px solid transparent',
                    color: activeTab === t ? ORANGE : '#444',
                    cursor: 'pointer', letterSpacing: 0.5,
                  }}
                >{t}</button>
              ))}
            </div>
            {/* Tab content */}
            <div style={{
              flex: 1, overflowY: 'auto',
              padding: '10px 14px', fontSize: 11,
              background: '#060606',
            }}>
              {activeTab === 'STATS' && renderStats()}
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
    <div style={{ marginBottom: 18 }}>
      <div style={{
        color: ORANGE, fontWeight: 'bold', fontSize: 9,
        letterSpacing: 1.5, marginBottom: 8,
        borderBottom: '1px solid #181818', paddingBottom: 4,
      }}>{title}</div>
      {children}
    </div>
  );
}

function StatRow({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      alignItems: 'baseline', gap: 8, marginBottom: 6,
    }}>
      <span style={{ color: '#333', fontSize: 9, letterSpacing: 0.4, flexShrink: 0 }}>{label}</span>
      <span style={{
        color: color || '#aaa', fontWeight: 'bold',
        fontSize: 11, textAlign: 'right',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</span>
    </div>
  );
}
