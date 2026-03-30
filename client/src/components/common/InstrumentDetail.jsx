// InstrumentDetail.jsx – Bloomberg GP-style full-screen instrument overlay
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../utils/api.js';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, Tooltip,
  ReferenceLine, CartesianGrid, ReferenceArea, Customized,
} from 'recharts';

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
// asPage=true: renders as a scrollable page (DETAIL tab on mobile), no fixed overlay
export default function InstrumentDetail({ ticker, onClose, asPage = false }) {
  const norm     = normalizeTicker(ticker);
  const disp     = displayTicker(norm);
  const isFX     = norm.startsWith('C:');
  const isCrypto = norm.startsWith('X:');
  const isBrazil = norm.endsWith('.SA');
  // Bond detection: match known bond tickers (US2Y, US5Y, US10Y, US30Y, DE10Y, BR10Y, GB10Y, JP10Y)
  const isBondTicker = /^(US|DE|GB|JP|BR)\d+Y$/i.test(norm);
  const isStock  = !isFX && !isCrypto && !isBondTicker;

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
  const [etfMeta,      setEtfMeta]      = useState(null);
  const [bondData,     setBondData]     = useState(null);
  const [bondLoading,  setBondLoading]  = useState(false);
  const [desktopTab,   setDesktopTab]   = useState('STATS');
  const [macroData,    setMacroData]    = useState(null);

  const range = RANGES[rangeIdx];

  // Definitive bond flag: either pattern-matched or registry-confirmed
  const isBond = isBondTicker || etfMeta?.assetClass === 'fixed_income';
  const isETF  = etfMeta?.assetClass === 'etf';

  // ── Fetch bars ─────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setBars([]);
    setDeltaA(null);
    setDeltaB(null);
    setDeltaMode(false); // reset measure tool on range change
    const from = getFromDate(range);
    const to   = new Date().toISOString().split('T')[0];
    apiFetch(
      `/api/chart/${encodeURIComponent(norm)}` +
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
    apiFetch(`/api/snapshot/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.json())
      .then(d => setSnap(d?.ticker ?? d))
      .catch(() => {});
  }, [norm]);

  // ── Fetch reference info (stocks only) ────────────────────────────────
  useEffect(() => {
    if (isFX || isCrypto) return;
    apiFetch(`/api/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.json())
      .then(d => setInfo(d?.results ?? d))
      .catch(() => {});
  }, [norm]);

  // ── Fetch fundamentals ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isStock || isBondTicker) return;
    setFundsData(null);
    setFundsError(false);
    setFundsLoading(true);
    apiFetch('/api/fundamentals/' + encodeURIComponent(norm))
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(d => {
        if (d && !d.error) setFundsData(d);
        else setFundsError(true);
        setFundsLoading(false);
      })
      .catch(() => { setFundsError(true); setFundsLoading(false); });
  }, [norm]);

  // ── Fetch instrument registry metadata (ETF/fund enrichment) ─────────
  useEffect(() => {
    setEtfMeta(null);
    apiFetch(`/api/instruments/${encodeURIComponent(disp)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setEtfMeta(d); })
      .catch(() => {});
  }, [disp]);

  // ── Fetch bond-specific data ──────────────────────────────────────────
  useEffect(() => {
    if (!isBondTicker) return;
    setBondLoading(true);
    setBondData(null);
    apiFetch(`/api/debt/bond/${encodeURIComponent(norm)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setBondData(d); setBondLoading(false); })
      .catch(() => setBondLoading(false));
  }, [norm, isBondTicker]);

  // ── Fetch macro data for FX pairs ─────────────────────────────────────
  // Currency → ISO country code for macro API
  const FX_CCY_MAP = { USD:'US', EUR:'EU', GBP:'GB', JPY:'JP', BRL:'BR', CNY:'CN', MXN:'MX', AUD:'AU', CAD:'CA', CHF:'CH' };
  useEffect(() => {
    if (!isFX) return;
    setMacroData(null);
    // norm for FX looks like "C:EURUSD" — extract the two 3-letter codes
    const raw = norm.replace(/^C:/, '');
    const base = raw.slice(0, 3);
    const quote = raw.slice(3);
    const baseCty  = FX_CCY_MAP[base];
    const quoteCty = FX_CCY_MAP[quote];
    const countries = [baseCty, quoteCty].filter(Boolean);
    if (countries.length === 0) return;
    apiFetch(`/api/macro/compare?countries=${countries.join(',')}&indicators=policyRate,cpiYoY,gdpGrowthYoY,unemploymentRate,debtGDP`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.countries) setMacroData(d); })
      .catch(() => {});
  }, [norm, isFX]);

  // ── Fetch ticker-specific news ─────────────────────────────────────────
  useEffect(() => {
    setNewsLoading(true);
    setNews([]);
    const newsTicker = norm.replace(/^[XCI]:/, '');
    apiFetch(`/api/news?ticker=${encodeURIComponent(newsTicker)}&limit=12`)
      .then(r => r.json())
      .then(d => { setNews(d?.results || []); setNewsLoading(false); })
      .catch(() => setNewsLoading(false));
  }, [norm]);

  // ── Escape key + mobile back-button support ────────────────────────────
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const closedByPopRef = useRef(false);
  useEffect(() => {
    // In page mode (DETAIL tab on mobile), skip history.pushState — the tab bar
    // handles navigation and pushState would break the back button behaviour.
    if (asPage) {
      const handleKey = e => { if (e.key === 'Escape') onCloseRef.current(); };
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }

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
  }, [asPage]); // asPage is stable (set at mount, not changed)

  // ── Derived values ─────────────────────────────────────────────────────
  const livePrice = snap?.min?.c || snap?.day?.c || snap?.lastTrade?.p || snap?.prevDay?.c
                 || (bars.length ? bars[bars.length - 1].close : null);
  const prevClose  = snap?.prevDay?.c;
  const dayChange  = (livePrice && prevClose) ? livePrice - prevClose : null;
  const dayChgPct  = (dayChange && prevClose) ? (dayChange / prevClose) * 100 : null;
  const isPos      = (dayChgPct ?? 0) >= 0;
  const name       = bondData?.name || info?.name || fundsData?.longName || disp;

  // For bonds, display yield% instead of dollar price
  const displayPrice = isBond && livePrice != null ? fmt(livePrice, 3) + '%' : livePrice != null ? fmt(livePrice) : null;
  const displayChange = isBond && dayChgPct != null
    ? `${isPos ? '+' : ''}${(dayChange * 100).toFixed(0)} bps`
    : dayChgPct != null ? `${isPos ? '+' : ''}${fmt(dayChgPct)}%` : null;
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

  // ── Bond Stats sub-render ──────────────────────────────────────────────
  function renderBondStats() {
    const bd = bondData;
    const yld = bd?.yield ?? livePrice; // for bonds, "price" in Yahoo is actually the yield
    const yldChange = bd?.yieldChange ?? dayChange;
    const yldChangeBps = bd?.yieldChangeBps ?? (yldChange != null ? parseFloat((yldChange * 100).toFixed(1)) : null);
    const yldPos = (yldChange ?? 0) >= 0;
    // Note: for bonds, yield UP = price DOWN (inverse), so color logic is inverted
    const priceColor = yldPos ? RED : GREEN;
    const yieldColor = yldPos ? GREEN : RED; // higher yield can be good or bad depending on perspective

    return (
      <>
        {/* ── YIELD ── */}
        <Section title="YIELD">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
            <StatRow label="YIELD" value={yld != null ? fmt(yld, 3) + '%' : '--'} color="#fff" big />
            <StatRow label="CHANGE"
              value={yldChange != null ? `${yldPos?'+':''}${fmt(yldChange, 3)}%` : '--'}
              color={yldChange != null ? yieldColor : '#555'}
            />
            <StatRow label="CHG (BPS)"
              value={yldChangeBps != null ? `${yldChangeBps >= 0?'+':''}${yldChangeBps} bps` : '--'}
              color={yldChangeBps != null ? yieldColor : '#555'}
            />
            {(bd?.dayOpen ?? snap?.day?.o) != null && <StatRow label="OPEN" value={fmt(bd?.dayOpen ?? snap?.day?.o, 3) + '%'} />}
            {(bd?.prevYield ?? prevClose) != null && <StatRow label="PREV CLOSE" value={fmt(bd?.prevYield ?? prevClose, 3) + '%'} />}
            {(bd?.dayHigh ?? dayHigh) != null && <StatRow label="DAY HIGH" value={fmt(bd?.dayHigh ?? dayHigh, 3) + '%'} />}
            {(bd?.dayLow ?? dayLow) != null && <StatRow label="DAY LOW" value={fmt(bd?.dayLow ?? dayLow, 3) + '%'} />}
          </div>
        </Section>

        {/* ── RANGE ── */}
        <Section title={`${range.label} PERFORMANCE`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
            <StatRow label="HIGH" value={rangeHigh != null ? fmt(rangeHigh, 3) + '%' : '--'} />
            <StatRow label="LOW" value={rangeLow != null ? fmt(rangeLow, 3) + '%' : '--'} />
            <StatRow label="RETURN"
              value={rangeChg != null ? (rangeChg>=0?'+':'')+fmt(rangeChg)+'%' : '--'}
              color={rangeChg != null ? (rangeChg>=0 ? GREEN : RED) : '#555'}
            />
          </div>
        </Section>

        {/* ── BOND DETAILS ── */}
        <Section title="BOND DETAILS">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
            {bd?.name && <StatRow label="NAME" value={bd.name} />}
            {bd?.country && <StatRow label="COUNTRY" value={bd.country} />}
            {bd?.currency && <StatRow label="CURRENCY" value={bd.currency} />}
            {bd?.tenor && <StatRow label="TENOR" value={bd.tenor} color={ORANGE} />}
            {bd?.maturityYears != null && <StatRow label="MATURITY" value={bd.maturityYears + ' years'} />}
            {bd?.maturityDate && <StatRow label="MAT DATE" value={bd.maturityDate} />}
            {bd?.faceValue != null && <StatRow label="FACE VALUE" value={'$' + fmt(bd.faceValue, 0)} />}
            {bd?.couponFreq && <StatRow label="COUPON FREQ" value={bd.couponFreq} />}
            {bd?.estimatedCoupon != null && <StatRow label="EST COUPON" value={fmt(bd.estimatedCoupon, 2) + '%'} />}
          </div>
        </Section>

        {/* ── PRICING ── */}
        {bd?.price != null && (
          <Section title="PRICING">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
              <StatRow label="PRICE" value={'$' + fmt(bd.price, 2)} color="#fff" big />
              <StatRow label="FACE VALUE" value={'$' + fmt(bd.faceValue, 0)} />
              <StatRow label="DISC/PREM"
                value={bd.discountPremium != null ? (bd.discountPremium >= 0 ? '+' : '') + fmt(bd.discountPremium, 2) + '%' : '--'}
                color={bd.discountPremium != null ? (bd.discountPremium >= 0 ? GREEN : RED) : '#555'}
              />
            </div>
          </Section>
        )}

        {/* ── YIELD METRICS ── */}
        <Section title="YIELD METRICS">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
            {bd?.yieldToMaturity != null && <StatRow label="YTM" value={fmt(bd.yieldToMaturity, 3) + '%'} color={ORANGE} big />}
            {bd?.yieldToWorst != null && <StatRow label="YTW" value={fmt(bd.yieldToWorst, 3) + '%'} color={ORANGE} />}
            {bd?.currentYield != null && <StatRow label="CUR YIELD" value={fmt(bd.currentYield, 3) + '%'} />}
            {bd?.spreadToUS10Y != null && (
              <StatRow label="SPREAD (US10Y)"
                value={`${bd.spreadToUS10Y >= 0 ? '+' : ''}${bd.spreadToUS10Y} bps`}
                color={bd.spreadToUS10Y > 200 ? RED : bd.spreadToUS10Y > 100 ? '#c07070' : '#aaa'}
              />
            )}
          </div>
        </Section>

        {/* ── RISK METRICS ── */}
        {(bd?.modifiedDuration != null || bd?.dv01 != null) && (
          <Section title="RISK METRICS">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
              {bd.modifiedDuration != null && <StatRow label="MOD DURATION" value={fmt(bd.modifiedDuration, 2) + ' yrs'} />}
              {bd.dv01 != null && <StatRow label="DV01" value={'$' + fmt(bd.dv01, 4)} />}
              <StatRow label="TYPE" value={bd?.maturityYears <= 2 ? 'Short-term' : bd?.maturityYears <= 10 ? 'Medium-term' : 'Long-term'} />
              <StatRow label="CALLABLE" value="No" color="#aaa" />
            </div>
          </Section>
        )}

        {/* ── BRAZIL BOND DETAILS ── */}
        {bd?.brBond && (
          <Section title="TESOURO DIRETO">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
              <StatRow label="BOND" value={bd.brBond.name} />
              <StatRow label="MATURITY" value={bd.brBond.maturityDate} />
              <StatRow label="YEARS LEFT" value={fmt(bd.brBond.yearsToMaturity, 1)} />
              {bd.brBond.unitPrice != null && <StatRow label="UNIT PRICE" value={'R$' + fmt(bd.brBond.unitPrice, 2)} />}
              {bd.brBond.redemptionPrice != null && <StatRow label="REDEMPTION" value={'R$' + fmt(bd.brBond.redemptionPrice, 2)} />}
              {bd.brBond.minInvestment != null && <StatRow label="MIN INVEST" value={'R$' + fmt(bd.brBond.minInvestment, 2)} />}
              <StatRow label="YIELD" value={fmt(bd.brBond.yield, 2) + '%'} color={ORANGE} />
            </div>
          </Section>
        )}

        {bondLoading && !bd && (
          <div style={{ color: '#2a2a2a', fontSize: 10, padding: '12px 0' }}>Loading bond data…</div>
        )}
      </>
    );
  }

  // ── Bond Risk tab ────────────────────────────────────────────────────
  function renderBondRisk() {
    const bd = bondData;
    if (!bd && bondLoading) return <div style={{ color: '#555', fontSize: 10, padding: '12px 0' }}>Loading…</div>;
    if (!bd) return <div style={{ color: '#333', fontSize: 10, padding: '12px 0' }}>No risk data available.</div>;
    // Compute price sensitivity scenarios (approximate: ΔP ≈ -D×Δy + 0.5×C×Δy²)
    const dur = bd.duration;
    const conv = bd.convexity;
    const bps = [-100, -50, -25, 0, 25, 50, 100];
    const scenarios = bps.map(b => {
      const dy = b / 10000;
      const pctChg = dur != null ? (-dur * dy + 0.5 * (conv ?? 0) * dy * dy) * 100 : null;
      return { bps: b, pctChg };
    });
    return (
      <>
        <Section title="INTEREST RATE RISK">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
            <StatRow label="MOD. DURATION" value={dur != null ? fmt(dur, 2) : '--'} color={ORANGE} />
            <StatRow label="CONVEXITY"     value={conv != null ? fmt(conv, 3) : '--'} />
            <StatRow label="DV01 (per $M)" value={bd.dv01 != null ? '$' + fmt(bd.dv01) : '--'} color={ORANGE} />
            <StatRow label="YIELD TO MAT"  value={bd.yieldToMaturity != null ? pct(bd.yieldToMaturity, 2).replace('+', '') : '--'} />
            {bd.yieldToWorst != null && <StatRow label="YIELD TO WORST" value={pct(bd.yieldToWorst, 2).replace('+', '')} />}
            {bd.spreadBps != null && bd.spreadBps !== 0 && <StatRow label="Z-SPREAD" value={(bd.spreadBps > 0 ? '+' : '') + bd.spreadBps + ' bps'} color={bd.spreadBps > 0 ? RED : GREEN} />}
          </div>
        </Section>
        <Section title="YIELD SHOCK SCENARIOS">
          <div style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ color: '#333', fontSize: 9, textAlign: 'left',  paddingBottom: 4, letterSpacing: 0.5, fontWeight: 600 }}>SHOCK</th>
                  <th style={{ color: '#333', fontSize: 9, textAlign: 'right', paddingBottom: 4, letterSpacing: 0.5, fontWeight: 600 }}>PRICE Δ%</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map(({ bps: b, pctChg }) => (
                  <tr key={b} style={{ borderTop: '1px solid #111' }}>
                    <td style={{ color: b === 0 ? '#444' : b < 0 ? GREEN : RED, padding: '4px 0', fontSize: 10 }}>
                      {b === 0 ? 'Unchanged' : (b > 0 ? '+' : '') + b + ' bps'}
                    </td>
                    <td style={{ color: b === 0 ? '#444' : pctChg > 0 ? GREEN : RED, textAlign: 'right', padding: '4px 0', fontSize: 10 }}>
                      {pctChg != null ? (pctChg >= 0 ? '+' : '') + pctChg.toFixed(2) + '%' : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="RATINGS">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
            {bd.ratingMoodys && <StatRow label="MOODY'S" value={bd.ratingMoodys} color={ORANGE} />}
            {bd.ratingSP      && <StatRow label="S&P"     value={bd.ratingSP}     color={ORANGE} />}
            {bd.ratingFitch   && <StatRow label="FITCH"   value={bd.ratingFitch}  color={ORANGE} />}
          </div>
        </Section>
      </>
    );
  }

  // ── Bond Cash Flows tab ──────────────────────────────────────────────
  function renderCashFlows() {
    const bd = bondData;
    if (!bd && bondLoading) return <div style={{ color: '#555', fontSize: 10, padding: '12px 0' }}>Loading…</div>;
    if (!bd || !bd.cashFlows?.length) return <div style={{ color: '#333', fontSize: 10, padding: '12px 0' }}>No cash flow data available.</div>;
    const totalFlow = bd.cashFlows.reduce((s, cf) => s + cf.amount, 0);
    return (
      <Section title="PROJECTED CASH FLOWS">
        <div style={{ marginBottom: 8, fontSize: 9, color: '#444' }}>
          Face value $1,000 · {bd.couponFrequency} · {bd.couponPct}% coupon
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead>
            <tr>
              <th style={{ color: '#333', fontSize: 9, textAlign: 'left',  paddingBottom: 4, letterSpacing: 0.5 }}>DATE</th>
              <th style={{ color: '#333', fontSize: 9, textAlign: 'center',paddingBottom: 4, letterSpacing: 0.5 }}>TYPE</th>
              <th style={{ color: '#333', fontSize: 9, textAlign: 'right', paddingBottom: 4, letterSpacing: 0.5 }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {bd.cashFlows.map((cf, i) => (
              <tr key={i} style={{ borderTop: '1px solid #111' }}>
                <td style={{ color: '#888', padding: '3px 0', fontSize: 9 }}>{cf.date}</td>
                <td style={{ color: cf.type === 'principal+coupon' ? ORANGE : '#555', textAlign: 'center', padding: '3px 0', fontSize: 8, letterSpacing: 0.3 }}>
                  {cf.type === 'principal+coupon' ? 'FINAL' : 'CPN'}
                </td>
                <td style={{ color: cf.type === 'principal+coupon' ? ORANGE : '#999', textAlign: 'right', padding: '3px 0', fontVariantNumeric: 'tabular-nums' }}>
                  ${fmt(cf.amount, 2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid #2a2a2a' }}>
              <td colSpan={2} style={{ color: '#444', fontSize: 9, padding: '4px 0', letterSpacing: 0.5 }}>TOTAL</td>
              <td style={{ color: ORANGE, fontSize: 10, textAlign: 'right', padding: '4px 0', fontVariantNumeric: 'tabular-nums', fontWeight: 'bold' }}>
                ${fmt(totalFlow, 2)}
              </td>
            </tr>
          </tfoot>
        </table>
        {bd.stub && <div style={{ color: '#1a1a1a', fontSize: 8, marginTop: 8 }}>Projected · stub data</div>}
      </Section>
    );
  }

  // ── FX Macro Overlay tab ─────────────────────────────────────────────
  function renderFXMacro() {
    if (!macroData?.countries?.length) {
      return <div style={{ color: '#333', fontSize: 10, padding: '12px 0' }}>Macro data not available for this pair.</div>;
    }
    const pctFmt = v => v != null ? (v * 100).toFixed(2) + '%' : '--';
    const labels = { policyRate: 'POLICY RATE', cpiYoY: 'CPI YoY', gdpGrowthYoY: 'GDP GROWTH', unemploymentRate: 'UNEMPLOYMENT', debtGDP: 'DEBT/GDP' };
    const indicators = ['policyRate', 'cpiYoY', 'gdpGrowthYoY', 'unemploymentRate', 'debtGDP'];
    const c0 = macroData.countries[0];
    const c1 = macroData.countries[1];
    return (
      <Section title="MACRO COMPARISON">
        {c0 && c1 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ color: '#333', fontSize: 8, textAlign: 'left',  paddingBottom: 6, letterSpacing: 0.5 }}></th>
                <th style={{ color: ORANGE, fontSize: 9, textAlign: 'right', paddingBottom: 6, letterSpacing: 0.5 }}>{c0.name || c0.country}</th>
                <th style={{ color: '#888', fontSize: 9, textAlign: 'right', paddingBottom: 6, letterSpacing: 0.5 }}>{c1.name || c1.country}</th>
              </tr>
            </thead>
            <tbody>
              {indicators.map(ind => {
                const v0 = c0[ind], v1 = c1[ind];
                return (
                  <tr key={ind} style={{ borderTop: '1px solid #111' }}>
                    <td style={{ color: '#333', fontSize: 8, padding: '4px 0', letterSpacing: 0.4 }}>{labels[ind]}</td>
                    <td style={{ color: ORANGE, textAlign: 'right', padding: '4px 0', fontVariantNumeric: 'tabular-nums' }}>
                      {ind === 'debtGDP' ? (v0 != null ? (v0 * 100).toFixed(0) + '%' : '--') : pctFmt(v0)}
                    </td>
                    <td style={{ color: '#999', textAlign: 'right', padding: '4px 0', fontVariantNumeric: 'tabular-nums' }}>
                      {ind === 'debtGDP' ? (v1 != null ? (v1 * 100).toFixed(0) + '%' : '--') : pctFmt(v1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ color: '#333', fontSize: 10 }}>Single-country pair — no comparison available.</div>
        )}
        <div style={{ color: '#1a1a1a', fontSize: 8, marginTop: 8 }}>Source: stub data (FRED / ECB / BCB)</div>
      </Section>
    );
  }

  // ── ETF Stats sub-render ──────────────────────────────────────────────
  function renderETFStats() {
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
            {volume != null && <StatRow label="VOLUME" value={fmt(volume, 0)} />}
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
          </div>
        </Section>

        {/* ── FUND INFO ── */}
        {etfMeta?.fund && (
          <Section title="FUND">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
              {etfMeta.fund.nav != null && <StatRow label="NAV" value={'$' + fmt(etfMeta.fund.nav)} />}
              {etfMeta.fund.aum != null && (
                <StatRow label="AUM"
                  value={etfMeta.fund.aum >= 1e12 ? '$'+(etfMeta.fund.aum/1e12).toFixed(1)+'T'
                       : etfMeta.fund.aum >= 1e9  ? '$'+(etfMeta.fund.aum/1e9).toFixed(1)+'B'
                       :                            '$'+(etfMeta.fund.aum/1e6).toFixed(0)+'M'} />
              )}
              {etfMeta.fund.expenseRatio != null && (
                <StatRow label="EXP RATIO" value={(etfMeta.fund.expenseRatio * 100).toFixed(2)+'%'} />
              )}
              {etfMeta.fund.category     && <StatRow label="CATEGORY"  value={etfMeta.fund.category} />}
              {etfMeta.fund.inceptionDate && <StatRow label="INCEPTION" value={etfMeta.fund.inceptionDate} />}
              {etfMeta.fund.exchange     && <StatRow label="EXCHANGE"   value={etfMeta.fund.exchange} />}
              {fundsData?.dividendYield != null && (
                <StatRow label="DIV YIELD" value={(fundsData.dividendYield*100).toFixed(2)+'%'} color={GREEN} />
              )}
              {fundsData?.beta != null && <StatRow label="BETA" value={fundsData.beta.toFixed(2)} />}
            </div>

            {/* TOP HOLDINGS */}
            {etfMeta.fund.holdings?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ color: '#333', fontSize: 9, letterSpacing: 1, marginBottom: 6 }}>TOP HOLDINGS</div>
                {etfMeta.fund.holdings.map((h, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid #111' }}>
                    <span style={{ color: ORANGE, fontSize: 9, flexShrink: 0, width: 50 }}>{h.symbol}</span>
                    <span style={{ color: '#555', fontSize: 9, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 4px' }}>{h.name}</span>
                    <span style={{ color: '#888', fontSize: 9, flexShrink: 0 }}>{(h.weight * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── VALUATION (ETF-specific) ── */}
        {mktCap != null && (
          <Section title="VALUATION">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
              <StatRow label="MKT CAP"
                value={mktCap >= 1e12 ? '$'+(mktCap/1e12).toFixed(2)+'T'
                     : mktCap >= 1e9  ? '$'+(mktCap/1e9).toFixed(2)+'B'
                     :                  '$'+(mktCap/1e6).toFixed(1)+'M'} />
              {fundsData?.peRatio != null && <StatRow label="P/E" value={fundsData.peRatio.toFixed(1)+'×'} />}
            </div>
          </Section>
        )}
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

        {/* ── ETF / FUND ── */}
        {etfMeta?.fund && (
          <Section title="FUND">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
              {etfMeta.fund.nav != null && <StatRow label="NAV" value={fmt(etfMeta.fund.nav)} />}
              {etfMeta.fund.aum != null && (
                <StatRow label="AUM"
                  value={etfMeta.fund.aum >= 1e12 ? '$'+(etfMeta.fund.aum/1e12).toFixed(1)+'T'
                       : etfMeta.fund.aum >= 1e9  ? '$'+(etfMeta.fund.aum/1e9).toFixed(1)+'B'
                       :                            '$'+(etfMeta.fund.aum/1e6).toFixed(0)+'M'} />
              )}
              {etfMeta.fund.expenseRatio != null && (
                <StatRow label="EXP RATIO" value={(etfMeta.fund.expenseRatio * 100).toFixed(2)+'%'} />
              )}
              {etfMeta.fund.category     && <StatRow label="CATEGORY"  value={etfMeta.fund.category} />}
              {etfMeta.fund.inceptionDate && <StatRow label="INCEPTION" value={etfMeta.fund.inceptionDate} />}
              {etfMeta.fund.exchange     && <StatRow label="EXCHANGE"   value={etfMeta.fund.exchange} />}
            </div>
            {etfMeta.fund.holdings?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ color: '#333', fontSize: 9, letterSpacing: 1, marginBottom: 6 }}>TOP HOLDINGS</div>
                {etfMeta.fund.holdings.map((h, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid #111' }}>
                    <span style={{ color: ORANGE, fontSize: 9, flexShrink: 0, width: 40 }}>{h.symbol}</span>
                    <span style={{ color: '#555', fontSize: 9, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 4px' }}>{h.name}</span>
                    <span style={{ color: '#888', fontSize: 9, flexShrink: 0 }}>{(h.weight * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

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
  const mobileTabs = isBond
    ? ['STATS', 'RISK', 'CASH FLOWS', ...(desc ? ['ABOUT'] : [])]
    : isFX
    ? ['STATS', 'MACRO', 'NEWS', ...(desc ? ['ABOUT'] : [])]
    : ['STATS', 'FUND', 'NEWS', ...(desc ? ['ABOUT'] : [])];

  const deltaHint = deltaMode
    ? (deltaA === null ? '← tap A' : deltaB === null ? '← tap B' : 'tap to reset')
    : null;

  // ── Fetch fundamentals ──────────────────────────────────────────────────
  const fetchFundamentals = useCallback(async () => {
    if (!isStock || activeTab !== 'FUND') return;
    setFundsLoading(true);
    setFundsError(false);
    try {
      const res = await apiFetch(`/api/fundamentals/${norm}`);
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
      style={asPage ? {
        // Page mode (mobile DETAIL tab): normal flow, fills parent scroll container
        display: 'flex', flexDirection: 'column', minHeight: '100%',
        background: '#080808',
        fontFamily: '"Courier New", monospace', color: '#e0e0e0',
      } : {
        // Overlay mode (desktop / desktop right-click): fixed fullscreen
        position: 'fixed', inset: 0, zIndex: 9999,
        paddingTop: isMobile ? 'env(safe-area-inset-top)' : 0,
        paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : 0,
        background: 'rgba(0,0,0,0.97)',
        display: 'flex', flexDirection: 'column',
        fontFamily: '"Courier New", monospace', color: '#e0e0e0',
      }}
      onMouseDown={asPage ? undefined : (e => { if (e.target === e.currentTarget) onClose(); })}
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
                  {displayPrice}
                </span>
              )}
              {displayChange != null && (
                <span style={{ fontSize: 11, color: isPos ? GREEN : RED, flexShrink: 0 }}>
                  {displayChange}
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
                <span style={{ fontSize: 22, color: '#fff', fontWeight: 'bold', lineHeight: 1 }}>{displayPrice}</span>
              )}
              {displayChange != null && (
                <span style={{ fontSize: 12, color: isPos ? GREEN : RED, lineHeight: 1 }}>
                  {isBond
                    ? displayChange
                    : `${isPos ? '+' : ''}${fmt(dayChange)} (${isPos ? '+' : ''}${fmt(dayChgPct)}%)`
                  }
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

        {/* Pop-out button — desktop only, not shown when already in pop-out page */}
        {!isMobile && !asPage && (
          <button
            onClick={() => {
              const sym = encodeURIComponent(norm);
              window.open(
                `${window.location.origin}/#/detail/${sym}`,
                '_blank',
                'width=1100,height=700,noopener,noreferrer'
              );
            }}
            title="Open in separate window"
            style={{
              padding: '4px 10px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
              border: '1px solid #252525', background: 'transparent', color: '#444',
              whiteSpace: 'nowrap', flexShrink: 0, letterSpacing: 0.5, fontFamily: 'inherit',
            }}
          >⊞ POP OUT</button>
        )}

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
        {!isMobile && (() => {
          // Tabbed desktop sidebar for bonds and FX; plain sidebar for equities/ETFs
          const bondDesktopTabs = ['STATS', 'RISK', 'CASH FLOWS'];
          const fxDesktopTabs   = ['STATS', 'MACRO', 'NEWS'];
          const hasTabs = isBond || isFX;
          const tabList = isBond ? bondDesktopTabs : isFX ? fxDesktopTabs : [];
          return (
            <div style={{
              width: 320, background: '#050505',
              borderLeft: '1px solid #141414',
              display: 'flex', flexDirection: 'column',
              overflowY: 'hidden', fontSize: 11, flexShrink: 0,
            }}>
              {/* Tab bar (bond + FX only) */}
              {hasTabs && (
                <div style={{ display: 'flex', borderBottom: '1px solid #181818', flexShrink: 0 }}>
                  {tabList.map(t => (
                    <button key={t}
                      onClick={() => setDesktopTab(t)}
                      style={{
                        flex: 1, padding: '7px 4px', fontSize: 9,
                        background: 'transparent', border: 'none',
                        borderBottom: desktopTab === t ? `2px solid ${ORANGE}` : '2px solid transparent',
                        color: desktopTab === t ? ORANGE : '#333',
                        cursor: 'pointer', letterSpacing: 0.5, fontFamily: 'inherit', whiteSpace: 'nowrap',
                      }}
                    >{t}</button>
                  ))}
                </div>
              )}
              {/* Sidebar content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
                {/* Bonds */}
                {isBond && desktopTab === 'STATS'      && renderBondStats()}
                {isBond && desktopTab === 'RISK'       && renderBondRisk()}
                {isBond && desktopTab === 'CASH FLOWS' && renderCashFlows()}
                {/* FX */}
                {isFX && desktopTab === 'STATS' && renderStats()}
                {isFX && desktopTab === 'MACRO' && renderFXMacro()}
                {isFX && desktopTab === 'NEWS'  && renderNews()}
                {/* Equities / ETF / other (no tabs) */}
                {!isBond && !isFX && (isETF ? renderETFStats() : renderStats())}
                {!isBond && !isFX && renderNews()}
                {!isBond && !isFX && renderAbout()}
                {/* About always accessible under STATS */}
                {(isBond || isFX) && desktopTab === 'STATS' && renderAbout()}
              </div>
            </div>
          );
        })()}

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
              {activeTab === 'STATS'      && (isBond ? renderBondStats() : isFX ? renderStats() : isETF ? renderETFStats() : renderStats())}
              {activeTab === 'RISK'       && renderBondRisk()}
              {activeTab === 'CASH FLOWS' && renderCashFlows()}
              {activeTab === 'MACRO'      && renderFXMacro()}
              {activeTab === 'FUND'       && renderFundamentals()}
              {activeTab === 'NEWS'       && renderNews()}
              {activeTab === 'ABOUT'      && renderAbout()}
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
