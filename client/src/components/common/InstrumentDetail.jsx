// InstrumentDetail.jsx – Bloomberg GP-style full-screen instrument overlay
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../utils/api.js';
import AlertEditor from './AlertEditor';
import ShareModal from './ShareModal';
import PositionEditor from './PositionEditor';
import TradeModal from './TradeModal';
import InstrumentOptionsPanel from './InstrumentOptionsPanel';
import './InstrumentDetail.css';
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, ResponsiveContainer, Tooltip,
  ReferenceLine, CartesianGrid, ReferenceArea, Customized,
} from 'recharts';
import {
  computeIndicators, buildChartInsightPayload,
  IND_COLORS, INDICATOR_LIST,
} from '../../utils/chartIndicators';
import {
  formatPrice, currencyLabel, fxDirectionLabel, commodityContextLabel, assetClassBadge,
} from '../../utils/formatPrice';
import { useWatchlist } from '../../context/WatchlistContext';
import {
  ORANGE, GREEN, RED, RANGES,
  normalizeTicker, displayTicker, getFromDate, fmt, fmtLabel, timeAgo, pct, exportToCSV,
} from './InstrumentDetailHelpers';
import { DeltaLineOverlay, CandlestickOverlay } from './InstrumentDetailCharts';
import { Section, StatRow } from './InstrumentDetailSections';

// ── Main Component ──────────────────────────────────────────────────────────
// asPage=true: renders as a scrollable page (DETAIL tab on mobile), no fixed overlay
export default function InstrumentDetail({ ticker, onClose, asPage = false, onOpenChat }) {
  const norm     = normalizeTicker(ticker);
  const disp     = displayTicker(norm);
  const isFX     = norm.startsWith('C:');
  const isCrypto = norm.startsWith('X:');
  const isBrazil = norm.endsWith('.SA');
  const isBondTicker = /^(US|DE|GB|JP|BR)\d+Y$/i.test(norm);
  const isStock  = !isFX && !isCrypto && !isBondTicker;

  // Watchlist toggle
  const { isWatching, toggle: toggleWatchlist } = useWatchlist();
  const watched = isWatching(disp);

  // Use matchMedia for reliable CSS-aware mobile detection
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window.matchMedia === 'function') {
      return !window.matchMedia('(min-width: 1024px)').matches;
    }
    return window.innerWidth < 1024;
  });
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      const handler = () => setIsMobile(window.innerWidth < 1024);
      window.addEventListener('resize', handler);
      return () => window.removeEventListener('resize', handler);
    }
    const mql = window.matchMedia('(min-width: 1024px)');
    const handler = (e) => setIsMobile(!e.matches);
    setIsMobile(!mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
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
  const [showAlertEditor, setShowAlertEditor] = useState(false);
  const [showPositionEditor, setShowPositionEditor] = useState(false);
  const [showShareModal, setShowShareModal]   = useState(false);
  const [showGameTrade, setShowGameTrade]     = useState(false);
  const [copyToast, setCopyToast] = useState(false);

  // AI Fundamentals state
  const [aiFunds, setAiFunds]         = useState(null);
  const [aiFundsLoading, setAiFundsLoading] = useState(false);
  const [aiFundsError, setAiFundsError]     = useState(null);
  const aiFundsCacheRef = useRef({}); // symbol → data

  // Phase 6: Chart type, indicators, AI Chart Insight
  const [chartType, setChartType]     = useState('area'); // 'area' | 'candle'
  const [activeIndicators, setActiveIndicators] = useState(new Set());
  const [aiChartInsight, setAiChartInsight]         = useState(null);
  const [aiChartInsightLoading, setAiChartInsightLoading] = useState(false);
  const [aiChartInsightError, setAiChartInsightError]     = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false); // toggle for Analyze panel
  const aiChartInsightCacheRef = useRef({}); // "symbol:range:lastT" → data

  // Step 4.2: Multi-listing support
  const [otherListings, setOtherListings] = useState([]);
  const [instrumentCompanyId, setInstrumentCompanyId] = useState(null);

  const range = RANGES[rangeIdx];

  const isBond = isBondTicker || etfMeta?.assetClass === 'fixed_income';
  const isETF  = etfMeta?.assetClass === 'etf';

  // ── Fetch bars ─────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setBars([]);
    setDeltaA(null);
    setDeltaB(null);
    setDeltaMode(false);
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
      .then(d => {
        if (d && !d.error) {
          setEtfMeta(d);
          // Step 4.2: If this instrument has a companyId, fetch other listings
          if (d.companyId) {
            setInstrumentCompanyId(d.companyId);
            apiFetch(`/api/instruments/search?companyId=${encodeURIComponent(d.companyId)}&limit=20`)
              .then(r => r.json())
              .then(data => {
                // Filter out the current symbol
                const others = (data.results || []).filter(item => item.symbolKey !== disp);
                setOtherListings(others);
              })
              .catch(() => setOtherListings([]));
          }
        }
      })
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
  const FX_CCY_MAP = { USD:'US', EUR:'EU', GBP:'GB', JPY:'JP', BRL:'BR', CNY:'CN', MXN:'MX', AUD:'AU', CAD:'CA', CHF:'CH' };
  useEffect(() => {
    if (!isFX) return;
    setMacroData(null);
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

  // ── Fetch AI Fundamentals ───────────────────────────────────────────────
  useEffect(() => {
    // Check in-memory cache first
    if (aiFundsCacheRef.current[norm]) {
      setAiFunds(aiFundsCacheRef.current[norm]);
      setAiFundsLoading(false);
      setAiFundsError(null);
      return;
    }
    setAiFunds(null);
    setAiFundsError(null);
    setAiFundsLoading(true);

    apiFetch('/api/search/fundamentals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: norm }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`AI error (${r.status})`);
        return r.json();
      })
      .then(data => {
        aiFundsCacheRef.current[norm] = data;
        setAiFunds(data);
        setAiFundsLoading(false);
      })
      .catch(err => {
        setAiFundsError(err.message || 'AI fundamentals unavailable');
        setAiFundsLoading(false);
      });
  }, [norm]);

  // ── Focus management + Escape key + mobile back-button support ────────
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!asPage) {
      closeButtonRef.current?.focus();
    }
  }, [asPage]);

  const closedByPopRef = useRef(false);
  useEffect(() => {
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
  }, [asPage]);

  // ── Derived values ─────────────────────────────────────────────────────
  const livePrice = snap?.min?.c || snap?.day?.c || snap?.lastTrade?.p || snap?.prevDay?.c
                 || (bars.length ? bars[bars.length - 1].close : null);
  const prevClose  = snap?.prevDay?.c;
  const dayChange  = (livePrice && prevClose) ? livePrice - prevClose : null;
  const dayChgPct  = (dayChange && prevClose) ? (dayChange / prevClose) * 100 : null;
  const isPos      = (dayChgPct ?? 0) >= 0;
  const name       = bondData?.name || info?.name || fundsData?.longName || disp;

  // Currency-aware price display
  const instrumentCurrency = etfMeta?.currency || (isBrazil ? 'BRL' : 'USD');

  // Step 5.2: Handle GBX (London Stock Exchange pence)
  const isGBX = instrumentCurrency === 'GBX';
  const priceLiveFormatted = livePrice != null
    ? (isGBX ? livePrice / 100 : livePrice)
    : null;
  const displayCurrency = isGBX ? 'GBP' : instrumentCurrency;

  const displayPrice = isBond && livePrice != null
    ? fmt(livePrice, 3) + '%'
    : isFX && livePrice != null
      ? livePrice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
      : priceLiveFormatted != null
        ? formatPrice(priceLiveFormatted, displayCurrency)
        : null;

  // Step 5.1: Data freshness badge (from etfMeta.dataDelay)
  const dataDelay = etfMeta?.dataDelay; // 'realtime', '15min', '30min'

  // FX direction label (e.g. "1 USD = 5.18 BRL")
  const fxDirection = isFX ? fxDirectionLabel(
    norm.replace('C:', ''),
    livePrice,
    etfMeta?.baseCurrency,
    etfMeta?.quoteCurrency
  ) : null;

  // Commodity context label
  const commodityCtx = commodityContextLabel(disp, livePrice);
  const displayChange = isBond && dayChgPct != null
    ? `${isPos ? '+' : ''}${(dayChange * 100).toFixed(0)} bps`
    : dayChgPct != null ? `${isPos ? '+' : ''}${fmt(dayChgPct)}%` : null;
  const dayHigh    = snap?.day?.h;
  const dayLow     = snap?.day?.l;
  const volume     = snap?.day?.v;
  const mktCap     = fundsData?.marketCap ?? info?.market_cap ?? null;
  const desc       = info?.description || fundsData?.description || null;

  const chartMin   = bars.length ? Math.min(...bars.map(b => b.close)) * 0.997 : 0;
  const chartMax   = bars.length ? Math.max(...bars.map(b => b.close)) * 1.003 : 1;
  const rangeHigh  = bars.length ? Math.max(...bars.map(b => b.high))  : null;
  const rangeLow   = bars.length ? Math.min(...bars.map(b => b.low))   : null;
  const rangeOpen  = bars.length ? bars[0].open : null;
  const rangeClose = bars.length ? bars[bars.length - 1].close : null;
  const rangeChg   = (rangeOpen && rangeClose) ? ((rangeClose - rangeOpen) / rangeOpen) * 100 : null;

  // ── Technical Indicators (Phase 6 — now using shared computeIndicators) ──
  const indicatorData = useMemo(() => {
    return computeIndicators(bars, activeIndicators);
  }, [bars, activeIndicators]);

  const toggleIndicator = (key) => {
    setActiveIndicators(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── AI Chart Insight fetch (Phase 6 — toggle-aware, structured analysis) ──
  const fetchChartInsight = useCallback(() => {
    // Toggle behavior: if already showing, hide
    if (showAnalysis && (aiChartInsight || aiChartInsightError)) {
      setShowAnalysis(false);
      return;
    }
    if (bars.length < 5) return;
    const lastT = bars[bars.length - 1]?.t || bars[bars.length - 1]?.label || '';
    const cacheKey = `${norm}:${range.label}:${lastT}`;

    if (aiChartInsightCacheRef.current[cacheKey]) {
      setAiChartInsight(aiChartInsightCacheRef.current[cacheKey]);
      setShowAnalysis(true);
      return;
    }

    setAiChartInsightLoading(true);
    setAiChartInsightError(null);
    setAiChartInsight(null);
    setShowAnalysis(true);

    // Build a richer payload requesting fundamentals + chart analysis
    const payload = buildChartInsightPayload(norm, range.label, indicatorData.bars);

    // Fetch fundamentals summary (best-effort) + chart insight in parallel
    const chartP = apiFetch('/api/search/chart-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.ok ? r.json() : null).catch(() => null);

    const fundsP = apiFetch('/api/search/fundamentals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: norm }),
    }).then(r => r.ok ? r.json() : null).catch(() => null);

    const newsP = apiFetch('/api/search/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `Why is ${norm} stock moving today? Give 1-2 sentence summary of any relevant recent news or catalysts. If nothing notable, say "No significant catalysts identified."` }),
    }).then(r => r.ok ? r.json() : null).catch(() => null);

    Promise.all([fundsP, newsP, chartP])
      .then(([fundsData, newsData, chartData]) => {
        const result = {
          symbol: norm,
          range: range.label,
          fundamentals: fundsData?.analysis || fundsData?.summary || null,
          news: newsData?.summary || null,
          insight: chartData?.insight || null,
          generatedAt: new Date().toISOString(),
        };
        aiChartInsightCacheRef.current[cacheKey] = result;
        setAiChartInsight(result);
        setAiChartInsightLoading(false);
      })
      .catch(err => {
        setAiChartInsightError(err.message || 'Analysis unavailable');
        setAiChartInsightLoading(false);
      });
  }, [norm, range.label, bars, indicatorData.bars, showAnalysis, aiChartInsight, aiChartInsightError]);

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
    if (loading) return <div className="id-chart-msg">Loading...</div>;
    if (bars.length === 0) return <div className="id-chart-msg">No data for this range</div>;

    const aMin = deltaA !== null && deltaB !== null ? Math.min(deltaA, deltaB) : null;
    const aMax = deltaA !== null && deltaB !== null ? Math.max(deltaA, deltaB) : null;

    const chartBars = indicatorData.bars;
    const showCandle = chartType === 'candle';
    const hasRSI = activeIndicators.has('RSI14');
    const hasMACD = activeIndicators.has('MACD');

    // Compute Y domain that includes BB bands if active
    let yMin = chartMin, yMax = chartMax;
    if (activeIndicators.has('BB')) {
      const bbLows  = chartBars.map(b => b.bbLower).filter(v => v != null);
      const bbHighs = chartBars.map(b => b.bbUpper).filter(v => v != null);
      if (bbLows.length)  yMin = Math.min(yMin, Math.min(...bbLows) * 0.998);
      if (bbHighs.length) yMax = Math.max(yMax, Math.max(...bbHighs) * 1.002);
    }
    // For candlestick, include high/low wicks
    if (showCandle) {
      const allHighs = chartBars.map(b => b.high).filter(v => v != null);
      const allLows  = chartBars.map(b => b.low).filter(v => v != null);
      if (allHighs.length) yMax = Math.max(yMax, Math.max(...allHighs) * 1.002);
      if (allLows.length)  yMin = Math.min(yMin, Math.min(...allLows) * 0.998);
    }

    const commonTooltipStyle = {
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-strong)',
      fontSize: 11,
      borderRadius: 3,
    };

    return (
      <>
        {/* Price chart */}
        <div className={`id-chart-flex-main${(hasRSI || hasMACD) ? ' id-chart-flex-main--compressed' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartBars}
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
                <linearGradient id="idBBFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor={IND_COLORS.BB} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={IND_COLORS.BB} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--text-faint)', fontSize: 9 }}
                interval="preserveStartEnd"
                tickLine={false}
                axisLine={{ stroke: 'var(--border-default)' }}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fill: 'var(--text-faint)', fontSize: 9 }}
                width={64}
                tickFormatter={v => fmt(v, v > 999 ? 0 : 2)}
                axisLine={{ stroke: 'var(--border-default)' }}
              />
              <Tooltip
                contentStyle={commonTooltipStyle}
                formatter={(v, n) => [fmt(v), n]}
                labelStyle={{ color: 'var(--text-muted)', marginBottom: 4 }}
              />

              {aMin !== null && chartBars[aMin] && chartBars[aMax] && (
                <ReferenceArea
                  x1={chartBars[aMin].label}
                  x2={chartBars[aMax].label}
                  fill={deltaInfo?.pct >= 0 ? GREEN : RED}
                  fillOpacity={0.06}
                  strokeOpacity={0}
                />
              )}

              {deltaA !== null && chartBars[deltaA] && (
                <ReferenceLine x={chartBars[deltaA].label} stroke={ORANGE} strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: 'A', fill: ORANGE, fontSize: 10, position: 'top' }} />
              )}
              {deltaB !== null && chartBars[deltaB] && (
                <ReferenceLine x={chartBars[deltaB].label} stroke={ORANGE} strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: 'B', fill: ORANGE, fontSize: 10, position: 'top' }} />
              )}

              {/* Bollinger Bands fill + lines */}
              {activeIndicators.has('BB') && (
                <>
                  <Area type="monotone" dataKey="bbUpper" stroke="none" fill="url(#idBBFill)" dot={false} activeDot={false} name="BB Upper" />
                  <Area type="monotone" dataKey="bbLower" stroke="none" fill="transparent" dot={false} activeDot={false} name="BB Lower" />
                  <Line type="monotone" dataKey="bbUpper" stroke={IND_COLORS.BB} strokeWidth={1} dot={false} strokeDasharray="4 2" name="BB Upper" />
                  <Line type="monotone" dataKey="bbLower" stroke={IND_COLORS.BB} strokeWidth={1} dot={false} strokeDasharray="4 2" name="BB Lower" />
                  <Line type="monotone" dataKey="bbMiddle" stroke={IND_COLORS.BB} strokeWidth={0.8} dot={false} strokeOpacity={0.4} name="BB Mid" />
                </>
              )}

              {/* Price: Area or Candlestick */}
              {showCandle ? (
                <>
                  {/* Invisible area to keep Y-axis domain correct */}
                  <Area dataKey="close" stroke="none" fill="none" dot={false} activeDot={false} />
                  <Customized component={(props) => (
                    <CandlestickOverlay {...props} data={chartBars} />
                  )} />
                </>
              ) : (
                <Area
                  type="monotone" dataKey="close" name="Close"
                  stroke={isPos ? GREEN : RED} strokeWidth={1.5}
                  fill="url(#idGradFill)" dot={false}
                  activeDot={{ r: 3, fill: isPos ? GREEN : RED, strokeWidth: 0 }}
                />
              )}

              {/* SMA 20 overlay */}
              {activeIndicators.has('SMA20') && (
                <Line type="monotone" dataKey="sma20" stroke={IND_COLORS.SMA20} strokeWidth={1.2}
                  dot={false} name="SMA 20" connectNulls />
              )}

              {/* EMA 50 overlay */}
              {activeIndicators.has('EMA50') && (
                <Line type="monotone" dataKey="ema50" stroke={IND_COLORS.EMA50} strokeWidth={1.2}
                  dot={false} name="EMA 50" connectNulls />
              )}

              {deltaInfo && (
                <Customized component={(chartProps) => (
                  <DeltaLineOverlay {...chartProps} bars={chartBars} deltaA={deltaA} deltaB={deltaB} deltaInfo={deltaInfo} />
                )} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Volume chart */}
        <div className={`id-chart-flex-volume${(hasRSI || hasMACD) ? ' id-chart-flex-volume--compressed' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartBars} margin={{ top: 2, right: 6, bottom: 0, left: 6 }}>
              <XAxis dataKey="label" hide axisLine={false} />
              <YAxis
                tick={{ fill: 'var(--text-faint)', fontSize: 8 }} width={64}
                tickFormatter={v =>
                  v >= 1e9 ? (v/1e9).toFixed(1)+'B' :
                  v >= 1e6 ? (v/1e6).toFixed(0)+'M' :
                  v >= 1e3 ? (v/1e3).toFixed(0)+'K' : String(v)
                }
                axisLine={false}
              />
              <Tooltip
                contentStyle={commonTooltipStyle}
                formatter={v => [fmt(v, 0), 'Volume']}
                labelStyle={{ color: 'var(--text-muted)' }}
              />
              <Bar dataKey="volume" fill="#1a3352" opacity={0.85} radius={[1, 1, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* RSI 14 sub-chart */}
        {hasRSI && (
          <div className="id-chart-flex-sub">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartBars} margin={{ top: 2, right: 6, bottom: 0, left: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="label" hide axisLine={false} />
                <YAxis domain={[0, 100]} ticks={[30, 50, 70]} tick={{ fill: 'var(--text-faint)', fontSize: 8 }} width={64} axisLine={false} />
                <ReferenceLine y={70} stroke="var(--price-down)" strokeDasharray="3 3" strokeOpacity={0.5} />
                <ReferenceLine y={30} stroke="var(--price-up)" strokeDasharray="3 3" strokeOpacity={0.5} />
                <Tooltip contentStyle={commonTooltipStyle} formatter={v => [v != null ? v.toFixed(1) : '--', 'RSI']} labelStyle={{ color: 'var(--text-muted)' }} />
                <Line type="monotone" dataKey="rsi14" stroke={IND_COLORS.RSI14} strokeWidth={1.2} dot={false} name="RSI 14" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* MACD sub-chart */}
        {hasMACD && (
          <div className="id-chart-flex-sub">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartBars} margin={{ top: 2, right: 6, bottom: 0, left: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="label" hide axisLine={false} />
                <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 8 }} width={64} axisLine={false} />
                <ReferenceLine y={0} stroke="var(--border-default)" />
                <Tooltip contentStyle={commonTooltipStyle} formatter={(v, n) => [v != null ? v.toFixed(3) : '--', n]} labelStyle={{ color: 'var(--text-muted)' }} />
                <Bar dataKey="macdHist" name="Histogram" fill={IND_COLORS.MACD} opacity={0.35} radius={[1, 1, 0, 0]} />
                <Line type="monotone" dataKey="macdLine" stroke={IND_COLORS.MACD} strokeWidth={1.2} dot={false} name="MACD" connectNulls />
                <Line type="monotone" dataKey="macdSignal" stroke="#e91e63" strokeWidth={1} dot={false} name="Signal" connectNulls strokeDasharray="3 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </>
    );
  }

  // ── Bond Stats sub-render ──────────────────────────────────────────────
  function renderBondStats() {
    const bd = bondData;
    const yld = bd?.yield ?? livePrice;
    const yldChange = bd?.yieldChange ?? dayChange;
    const yldChangeBps = bd?.yieldChangeBps ?? (yldChange != null ? parseFloat((yldChange * 100).toFixed(1)) : null);
    const yldPos = (yldChange ?? 0) >= 0;
    const yieldColor = yldPos ? GREEN : RED;

    return (
      <>
        <Section title="YIELD">
          <div className="id-stat-grid">
            <StatRow label="YIELD" value={yld != null ? fmt(yld, 3) + '%' : '--'} color="#fff" big />
            <StatRow label="CHANGE"
              value={yldChange != null ? `${yldPos?'+':''}${fmt(yldChange, 3)}%` : '--'}
              color={yldChange != null ? yieldColor : undefined}
            />
            <StatRow label="CHG (BPS)"
              value={yldChangeBps != null ? `${yldChangeBps >= 0?'+':''}${yldChangeBps} bps` : '--'}
              color={yldChangeBps != null ? yieldColor : undefined}
            />
            {(bd?.dayOpen ?? snap?.day?.o) != null && <StatRow label="OPEN" value={fmt(bd?.dayOpen ?? snap?.day?.o, 3) + '%'} />}
            {(bd?.prevYield ?? prevClose) != null && <StatRow label="PREV CLOSE" value={fmt(bd?.prevYield ?? prevClose, 3) + '%'} />}
            {(bd?.dayHigh ?? dayHigh) != null && <StatRow label="DAY HIGH" value={fmt(bd?.dayHigh ?? dayHigh, 3) + '%'} />}
            {(bd?.dayLow ?? dayLow) != null && <StatRow label="DAY LOW" value={fmt(bd?.dayLow ?? dayLow, 3) + '%'} />}
          </div>
        </Section>

        <Section title={`${range.label} PERFORMANCE`}>
          <div className="id-stat-grid">
            <StatRow label="HIGH" value={rangeHigh != null ? fmt(rangeHigh, 3) + '%' : '--'} />
            <StatRow label="LOW" value={rangeLow != null ? fmt(rangeLow, 3) + '%' : '--'} />
            <StatRow label="RETURN"
              value={rangeChg != null ? (rangeChg>=0?'+':'')+fmt(rangeChg)+'%' : '--'}
              color={rangeChg != null ? (rangeChg>=0 ? GREEN : RED) : undefined}
            />
          </div>
        </Section>

        <Section title="BOND DETAILS">
          <div className="id-stat-grid">
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

        {bd?.price != null && (
          <Section title="PRICING">
            <div className="id-stat-grid">
              <StatRow label="PRICE" value={'$' + fmt(bd.price, 2)} color="#fff" big />
              <StatRow label="FACE VALUE" value={'$' + fmt(bd.faceValue, 0)} />
              <StatRow label="DISC/PREM"
                value={bd.discountPremium != null ? (bd.discountPremium >= 0 ? '+' : '') + fmt(bd.discountPremium, 2) + '%' : '--'}
                color={bd.discountPremium != null ? (bd.discountPremium >= 0 ? GREEN : RED) : undefined}
              />
            </div>
          </Section>
        )}

        <Section title="YIELD METRICS">
          <div className="id-stat-grid">
            {bd?.yieldToMaturity != null && <StatRow label="YTM" value={fmt(bd.yieldToMaturity, 3) + '%'} color={ORANGE} big />}
            {bd?.yieldToWorst != null && <StatRow label="YTW" value={fmt(bd.yieldToWorst, 3) + '%'} color={ORANGE} />}
            {bd?.currentYield != null && <StatRow label="CUR YIELD" value={fmt(bd.currentYield, 3) + '%'} />}
            {bd?.spreadToUS10Y != null && (
              <StatRow label="SPREAD (US10Y)"
                value={`${bd.spreadToUS10Y >= 0 ? '+' : ''}${bd.spreadToUS10Y} bps`}
                color={bd.spreadToUS10Y > 200 ? RED : bd.spreadToUS10Y > 100 ? '#c07070' : undefined}
              />
            )}
          </div>
        </Section>

        {(bd?.modifiedDuration != null || bd?.dv01 != null) && (
          <Section title="RISK METRICS">
            <div className="id-stat-grid">
              {bd.modifiedDuration != null && <StatRow label="MOD DURATION" value={fmt(bd.modifiedDuration, 2) + ' yrs'} />}
              {bd.dv01 != null && <StatRow label="DV01" value={'$' + fmt(bd.dv01, 4)} />}
              <StatRow label="TYPE" value={bd?.maturityYears <= 2 ? 'Short-term' : bd?.maturityYears <= 10 ? 'Medium-term' : 'Long-term'} />
              <StatRow label="CALLABLE" value="No" />
            </div>
          </Section>
        )}

        {bd?.brBond && (
          <Section title="TESOURO DIRETO">
            <div className="id-stat-grid">
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

        {bondLoading && !bd && <div className="id-loading">Loading bond data...</div>}
      </>
    );
  }

  // ── Bond Risk tab ────────────────────────────────────────────────────
  function renderBondRisk() {
    const bd = bondData;
    if (!bd && bondLoading) return <div className="id-loading">Loading...</div>;
    if (!bd) return <div className="id-loading">No risk data available.</div>;
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
          <div className="id-stat-grid">
            <StatRow label="MOD. DURATION" value={dur != null ? fmt(dur, 2) : '--'} color={ORANGE} />
            <StatRow label="CONVEXITY"     value={conv != null ? fmt(conv, 3) : '--'} />
            <StatRow label="DV01 (per $M)" value={bd.dv01 != null ? '$' + fmt(bd.dv01) : '--'} color={ORANGE} />
            <StatRow label="YIELD TO MAT"  value={bd.yieldToMaturity != null ? pct(bd.yieldToMaturity, 2).replace('+', '') : '--'} />
            {bd.yieldToWorst != null && <StatRow label="YIELD TO WORST" value={pct(bd.yieldToWorst, 2).replace('+', '')} />}
            {bd.spreadBps != null && bd.spreadBps !== 0 && <StatRow label="Z-SPREAD" value={(bd.spreadBps > 0 ? '+' : '') + bd.spreadBps + ' bps'} color={bd.spreadBps > 0 ? RED : GREEN} />}
          </div>
        </Section>
        <Section title="YIELD SHOCK SCENARIOS">
          <table className="id-table">
            <thead>
              <tr>
                <th className="text-left">SHOCK</th>
                <th className="text-right">PRICE Δ%</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map(({ bps: b, pctChg }) => (
                <tr key={b}>
                  <td style={{ color: b === 0 ? 'var(--text-faint)' : b < 0 ? GREEN : RED }}>
                    {b === 0 ? 'Unchanged' : (b > 0 ? '+' : '') + b + ' bps'}
                  </td>
                  <td style={{ color: b === 0 ? 'var(--text-faint)' : pctChg > 0 ? GREEN : RED, textAlign: 'right' }}>
                    {pctChg != null ? (pctChg >= 0 ? '+' : '') + pctChg.toFixed(2) + '%' : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="RATINGS">
          <div className="id-stat-grid">
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
    if (!bd && bondLoading) return <div className="id-loading">Loading...</div>;
    if (!bd || !bd.cashFlows?.length) return <div className="id-loading">No cash flow data available.</div>;
    const totalFlow = bd.cashFlows.reduce((s, cf) => s + cf.amount, 0);
    return (
      <Section title="PROJECTED CASH FLOWS">
        <div className="id-table-intro">
          Face value $1,000 · {bd.couponFrequency} · {bd.couponPct}% coupon
        </div>
        <table className="id-table">
          <thead>
            <tr>
              <th className="text-left">DATE</th>
              <th className="text-center">TYPE</th>
              <th className="text-right">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {bd.cashFlows.map((cf, i) => (
              <tr key={i}>
                <td className="id-macro-label">{cf.date}</td>
                <td style={{ color: cf.type === 'principal+coupon' ? ORANGE : 'var(--text-muted)', textAlign: 'center', fontSize: 'var(--font-sm)', letterSpacing: 0.3 }}>
                  {cf.type === 'principal+coupon' ? 'FINAL' : 'CPN'}
                </td>
                <td style={{ color: cf.type === 'principal+coupon' ? ORANGE : 'var(--text-secondary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  ${fmt(cf.amount, 2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="id-table-total-label">TOTAL</td>
              <td className="id-table-total-amount">
                ${fmt(totalFlow, 2)}
              </td>
            </tr>
          </tfoot>
        </table>
        {bd.stub && <div className="id-data-source">Projected · stub data</div>}
      </Section>
    );
  }

  // ── FX Macro Overlay tab ─────────────────────────────────────────────
  function renderFXMacro() {
    if (!macroData?.countries?.length) {
      return <div className="id-loading">Macro data not available for this pair.</div>;
    }
    const pctFmt = v => v != null ? (v * 100).toFixed(2) + '%' : '--';
    const labels = { policyRate: 'POLICY RATE', cpiYoY: 'CPI YoY', gdpGrowthYoY: 'GDP GROWTH', unemploymentRate: 'UNEMPLOYMENT', debtGDP: 'DEBT/GDP' };
    const indicators = ['policyRate', 'cpiYoY', 'gdpGrowthYoY', 'unemploymentRate', 'debtGDP'];
    const c0 = macroData.countries[0];
    const c1 = macroData.countries[1];
    return (
      <Section title="MACRO COMPARISON">
        {c0 && c1 ? (
          <table className="id-table">
            <thead>
              <tr>
                <th className="text-left"></th>
                <th className="id-macro-header-primary">{c0.name || c0.country}</th>
                <th className="text-right">{c1.name || c1.country}</th>
              </tr>
            </thead>
            <tbody>
              {indicators.map(ind => {
                const v0 = c0[ind], v1 = c1[ind];
                return (
                  <tr key={ind}>
                    <td className="id-macro-label">{labels[ind]}</td>
                    <td className="id-macro-value-primary">
                      {ind === 'debtGDP' ? (v0 != null ? (v0 * 100).toFixed(0) + '%' : '--') : pctFmt(v0)}
                    </td>
                    <td className="id-macro-value">
                      {ind === 'debtGDP' ? (v1 != null ? (v1 * 100).toFixed(0) + '%' : '--') : pctFmt(v1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="id-loading">Single-country pair — no comparison available.</div>
        )}
        <div className="id-data-source">Source: stub data (FRED / ECB / BCB)</div>
      </Section>
    );
  }

  // ── ETF Stats sub-render ──────────────────────────────────────────────
  function renderETFStats() {
    return (
      <>
        <Section title="PRICE">
          <div className="id-stat-grid">
            <StatRow label="LAST" value={fmt(livePrice)} color="#fff" big />
            <StatRow label="CHANGE"
              value={dayChgPct != null ? `${isPos?'+':''}${fmt(dayChange)}` : '--'}
              color={dayChgPct != null ? (isPos ? GREEN : RED) : undefined}
            />
            <StatRow label="CHG %"
              value={dayChgPct != null ? `${isPos?'+':''}${fmt(dayChgPct)}%` : '--'}
              color={dayChgPct != null ? (isPos ? GREEN : RED) : undefined}
            />
            <StatRow label="OPEN" value={fmt(snap?.day?.o)} />
            <StatRow label="PREV CLOSE" value={fmt(prevClose)} />
            <StatRow label="DAY HIGH" value={fmt(dayHigh)} />
            <StatRow label="DAY LOW" value={fmt(dayLow)} />
            {volume != null && <StatRow label="VOLUME" value={fmt(volume, 0)} />}
          </div>
        </Section>

        <Section title={`${range.label} PERFORMANCE`}>
          <div className="id-stat-grid">
            <StatRow label="HIGH" value={fmt(rangeHigh)} />
            <StatRow label="LOW" value={fmt(rangeLow)} />
            <StatRow label="RETURN"
              value={rangeChg != null ? (rangeChg>=0?'+':'')+fmt(rangeChg)+'%' : '--'}
              color={rangeChg != null ? (rangeChg>=0 ? GREEN : RED) : undefined}
            />
            {fundsData?.fiftyTwoWeekHigh != null && <StatRow label="52W HIGH" value={fmt(fundsData.fiftyTwoWeekHigh)} />}
            {fundsData?.fiftyTwoWeekLow  != null && <StatRow label="52W LOW"  value={fmt(fundsData.fiftyTwoWeekLow)} />}
          </div>
        </Section>

        {etfMeta?.fund && (
          <Section title="FUND">
            <div className="id-stat-grid">
              {etfMeta.fund.nav != null && <StatRow label="NAV" value={'$' + fmt(etfMeta.fund.nav)} />}
              {etfMeta.fund.aum != null && <StatRow label="AUM" value={fmt(etfMeta.fund.aum, 0)} />}
              {etfMeta.fund.expenseRatio != null && <StatRow label="EXP RATIO" value={(etfMeta.fund.expenseRatio * 100).toFixed(2)+'%'} />}
              {etfMeta.fund.category && <StatRow label="CATEGORY" value={etfMeta.fund.category} />}
              {etfMeta.fund.inceptionDate && <StatRow label="INCEPTION" value={etfMeta.fund.inceptionDate} />}
              {etfMeta.fund.exchange && <StatRow label="EXCHANGE" value={etfMeta.fund.exchange} />}
              {fundsData?.dividendYield != null && <StatRow label="DIV YIELD" value={(fundsData.dividendYield*100).toFixed(2)+'%'} color={GREEN} />}
              {fundsData?.beta != null && <StatRow label="BETA" value={fundsData.beta.toFixed(2)} />}
            </div>

            {etfMeta.fund.holdings?.length > 0 && (
              <div className="id-holdings-section">
                <div className="id-holdings-header">TOP HOLDINGS</div>
                {etfMeta.fund.holdings.map((h, i) => (
                  <div key={i} className="id-holding-row">
                    <span className="id-holding-symbol">{h.symbol}</span>
                    <span className="id-holding-name">{h.name}</span>
                    <span className="id-holding-weight">{(h.weight * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {mktCap != null && (
          <Section title="VALUATION">
            <div className="id-stat-grid">
              <StatRow label="MKT CAP" value={fmt(mktCap, 0)} />
              {fundsData?.peRatio != null && <StatRow label="P/E" value={fundsData.peRatio.toFixed(1)+'x'} />}
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
        <Section title="PRICE">
          <div className="id-stat-grid">
            <StatRow label="LAST" value={fmt(livePrice)} color="#fff" big />
            <StatRow label="CHANGE"
              value={dayChgPct != null ? `${isPos?'+':''}${fmt(dayChange)}` : '--'}
              color={dayChgPct != null ? (isPos ? GREEN : RED) : undefined}
            />
            <StatRow label="CHG %"
              value={dayChgPct != null ? `${isPos?'+':''}${fmt(dayChgPct)}%` : '--'}
              color={dayChgPct != null ? (isPos ? GREEN : RED) : undefined}
            />
            <StatRow label="OPEN" value={fmt(snap?.day?.o)} />
            <StatRow label="PREV CLOSE" value={fmt(prevClose)} />
            <StatRow label="DAY HIGH" value={fmt(dayHigh)} />
            <StatRow label="DAY LOW" value={fmt(dayLow)} />
            {snap?.day?.vw != null && <StatRow label="VWAP" value={fmt(snap.day.vw)} />}
            <StatRow label="VOLUME" value={volume != null ? fmt(volume, 0) : '--'} />
            {isFX && snap?.lastQuote?.a != null && <StatRow label="ASK" value={fmt(snap.lastQuote.a, 5)} />}
            {isFX && snap?.lastQuote?.b != null && <StatRow label="BID" value={fmt(snap.lastQuote.b, 5)} />}
            {isFX && snap?.lastQuote?.a != null && snap?.lastQuote?.b != null && (
              <StatRow label="SPREAD" value={fmt(Math.abs(snap.lastQuote.a - snap.lastQuote.b), 5)} />
            )}
          </div>
        </Section>

        {etfMeta?.contractNote && (
          <Section title="CONTRACT INFO">
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, padding: '4px 0' }}>
              {etfMeta.contractNote}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>
              Front-month futures roll near expiry. Price reflects the nearest active contract.
            </div>
          </Section>
        )}

        <Section title={`${range.label} PERFORMANCE`}>
          <div className="id-stat-grid">
            <StatRow label="HIGH" value={fmt(rangeHigh)} />
            <StatRow label="LOW" value={fmt(rangeLow)} />
            <StatRow label="RETURN"
              value={rangeChg != null ? (rangeChg>=0?'+':'')+fmt(rangeChg)+'%' : '--'}
              color={rangeChg != null ? (rangeChg>=0 ? GREEN : RED) : undefined}
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

        {etfMeta?.fund && (
          <Section title="FUND">
            <div className="id-stat-grid">
              {etfMeta.fund.nav != null && <StatRow label="NAV" value={fmt(etfMeta.fund.nav)} />}
              {etfMeta.fund.aum != null && <StatRow label="AUM" value={fmt(etfMeta.fund.aum, 0)} />}
              {etfMeta.fund.expenseRatio != null && <StatRow label="EXP RATIO" value={(etfMeta.fund.expenseRatio * 100).toFixed(2)+'%'} />}
              {etfMeta.fund.category && <StatRow label="CATEGORY" value={etfMeta.fund.category} />}
              {etfMeta.fund.inceptionDate && <StatRow label="INCEPTION" value={etfMeta.fund.inceptionDate} />}
              {etfMeta.fund.exchange && <StatRow label="EXCHANGE" value={etfMeta.fund.exchange} />}
            </div>
            {etfMeta.fund.holdings?.length > 0 && (
              <div className="id-holdings-section">
                <div className="id-holdings-header">TOP HOLDINGS</div>
                {etfMeta.fund.holdings.map((h, i) => (
                  <div key={i} className="id-holding-row">
                    <span className="id-holding-symbol" style={{ width: 40 }}>{h.symbol}</span>
                    <span className="id-holding-name">{h.name}</span>
                    <span className="id-holding-weight">{(h.weight * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {isStock && (
          <Section title="VALUATION">
            <div className="id-stat-grid">
              {mktCap != null && <StatRow label="MKT CAP" value={fmt(mktCap, 0)} />}
              {fundsData?.enterpriseValue != null && <StatRow label="EV" value={fmt(fundsData.enterpriseValue, 0)} />}
              {fundsData?.peRatio    != null && <StatRow label="P/E (TTM)"  value={fundsData.peRatio.toFixed(1)+'x'} />}
              {fundsData?.forwardPE  != null && <StatRow label="P/E (FWD)"  value={fundsData.forwardPE.toFixed(1)+'x'} />}
              {fundsData?.pegRatio   != null && <StatRow label="PEG"        value={fundsData.pegRatio.toFixed(2)+'x'} />}
              {fundsData?.priceToBook != null && <StatRow label="P/B"       value={fundsData.priceToBook.toFixed(2)+'x'} />}
              {fundsData?.priceToSales != null && <StatRow label="P/S"      value={fundsData.priceToSales.toFixed(2)+'x'} />}
              {fundsData?.eps        != null && <StatRow label="EPS (TTM)"  value={'$'+fundsData.eps.toFixed(2)} />}
              {fundsData?.forwardEps != null && <StatRow label="EPS (FWD)"  value={'$'+fundsData.forwardEps.toFixed(2)} />}
              {fundsData?.earningsDate && <StatRow label="EARNINGS" value={fundsData.earningsDate} color={ORANGE} />}
              {fundsData?.beta       != null && <StatRow label="BETA"       value={fundsData.beta.toFixed(2)} />}
              {fundsData?.dividendYield != null && <StatRow label="DIV YIELD" value={(fundsData.dividendYield*100).toFixed(2)+'%'} color={GREEN} />}
              {fundsData?.shortPercentFloat != null && (
                <StatRow label="SHORT %"
                  value={(fundsData.shortPercentFloat*100).toFixed(1)+'%'}
                  color={fundsData.shortPercentFloat > 0.1 ? RED : undefined}
                />
              )}
              {fundsData?.sharesOutstanding != null && <StatRow label="SHARES" value={fmt(fundsData.sharesOutstanding, 0)} />}
              {fundsLoading && mktCap != null && (
                <div className="id-grid-msg id-grid-msg--pt">loading ratios...</div>
              )}
              {fundsLoading && mktCap == null && (
                <div className="id-grid-msg id-grid-msg--lg">Loading...</div>
              )}
              {!fundsLoading && fundsError && mktCap == null && (
                <div className="id-grid-msg">Fundamental data unavailable</div>
              )}
              {!fundsLoading && fundsError && mktCap != null && (
                <div className="id-grid-msg">ratios unavailable</div>
              )}
            </div>
          </Section>
        )}

        {isStock && fundsData && (fundsData.totalRevenue || fundsData.ebitda || fundsData.profitMargins) && (
          <Section title="FINANCIALS">
            <div className="id-stat-grid">
              {fundsData.totalRevenue != null && <StatRow label="REVENUE" value={fmt(fundsData.totalRevenue, 0)} />}
              {fundsData.revenueGrowth != null && <StatRow label="REV GROWTH" value={pct(fundsData.revenueGrowth)} color={fundsData.revenueGrowth >= 0 ? GREEN : RED} />}
              {fundsData.ebitda != null && <StatRow label="EBITDA" value={fmt(fundsData.ebitda, 0)} />}
              {fundsData.grossMargins    != null && <StatRow label="GROSS MGNS"  value={pct(fundsData.grossMargins)} />}
              {fundsData.operatingMargins != null && <StatRow label="OPER MGNS"  value={pct(fundsData.operatingMargins)} />}
              {fundsData.profitMargins   != null && <StatRow label="NET MARGIN" value={pct(fundsData.profitMargins)} color={fundsData.profitMargins >= 0 ? GREEN : RED} />}
              {fundsData.returnOnEquity  != null && <StatRow label="ROE" value={pct(fundsData.returnOnEquity)} color={fundsData.returnOnEquity >= 0 ? GREEN : RED} />}
              {fundsData.returnOnAssets  != null && <StatRow label="ROA" value={pct(fundsData.returnOnAssets)} color={fundsData.returnOnAssets >= 0 ? GREEN : RED} />}
              {fundsData.totalCash != null && <StatRow label="CASH" value={fmt(fundsData.totalCash, 0)} />}
              {fundsData.totalDebt != null && <StatRow label="DEBT" value={fmt(fundsData.totalDebt, 0)} color="#c07070" />}
            </div>
          </Section>
        )}

        {isStock && (fundsData?.sector || fundsData?.industry) && (
          <Section title="PROFILE">
            <div className="id-stat-grid">
              {fundsData.sector   && <StatRow label="SECTOR"    value={fundsData.sector} />}
              {fundsData.industry && <StatRow label="INDUSTRY"  value={fundsData.industry} />}
              {fundsData.employees != null && <StatRow label="EMPLOYEES" value={fundsData.employees.toLocaleString()} />}
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
        {newsLoading && <div className="id-loading">Loading...</div>}
        {!newsLoading && news.length === 0 && (
          <div className="id-loading">No recent news found.</div>
        )}
        {news.map((item, i) => {
          const url   = item.article_url || item.link || item.url;
          const title = item.title || 'Untitled';
          const src   = item.publisher?.name || item.source || '';
          const ago   = timeAgo(item.published_utc);
          return (
            <div
              key={i}
              className="id-news-item"
              onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
              style={{ cursor: url ? 'pointer' : 'default' }}
            >
              <div className={`id-news-title${url ? '' : ' id-news-title--nolink'}`}>{title}</div>
              <div className="id-news-meta">
                <span className="id-news-source">{src}</span>
                <span className="id-news-time">{ago}</span>
              </div>
            </div>
          );
        })}
      </Section>
    );
  }

  // ── About sub-render ───────────────────────────────────────────────────
  function renderFundamentals() {
    if (!isStock) return <div className="id-info-msg">Fundamentals only for stocks</div>;
    if (fundsLoading) return <div className="id-loading">LOADING FUNDAMENTALS...</div>;
    if (fundsError || !fundsData) return <div className="id-error-msg">Fundamentals unavailable</div>;

    const d = fundsData;

    const fundItems = [
      { label: 'Name', value: d.name },
      { label: 'Currency', value: d.currency },
      { label: 'Market Cap', value: d.marketCap ? fmt(d.marketCap, 0) : null },
      { label: 'Exchange', value: d.primaryExchange },
      { label: 'List Date', value: d.listDate },
      { label: 'Sector', value: d.sector },
      { label: 'Industry', value: d.industry },
      { label: 'Employees', value: d.employees != null ? d.employees.toLocaleString() : null },
    ].filter(item => item.value);

    return (
      <div className="id-fundamentals">
        <Section title="PROFILE">
          <div className="id-fund-grid">
            {fundItems.map(item => (
              <div className="id-fund-item" key={item.label}>
                <span className="id-fund-label">{item.label}</span>
                <span className="id-fund-value">{item.value}</span>
              </div>
            ))}
          </div>
        </Section>
        {d.description && (
          <Section title="ABOUT">
            {d.homepageUrl && (
              <a href={d.homepageUrl} target="_blank" rel="noopener noreferrer" className="id-about-link">
                {d.homepageUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
            <p className="id-about-text">{d.description}</p>
          </Section>
        )}
        {d.sicDescription && (
          <Section title="INDUSTRY">
            <p className="id-about-text">{d.sicDescription}</p>
          </Section>
        )}
      </div>
    );
  }

  function renderAbout() {
    if (!desc) return null;
    const SHORT = 400;
    const truncated = !descExpanded && desc.length > SHORT;
    return (
      <Section title="ABOUT">
        {fundsData?.website && (
          <a href={fundsData.website} target="_blank" rel="noopener noreferrer" className="id-about-link">
            {fundsData.website.replace(/^https?:\/\//, '')}
          </a>
        )}
        <p className="id-about-text">
          {truncated ? desc.slice(0, SHORT) + '...' : desc}
        </p>
        {desc.length > SHORT && (
          <button onClick={() => setDescExpanded(e => !e)} className="id-about-toggle">
            {descExpanded ? '▲ SHOW LESS' : '▼ SHOW MORE'}
          </button>
        )}
      </Section>
    );
  }

  // ── AI Fundamentals sub-render ──────────────────────────────────────────
  function renderAIFundamentals() {
    if (aiFundsLoading) {
      return (
        <div className="id-ai-section">
          <div className="id-ai-header">
            <span className="id-ai-label">AI FUNDAMENTALS</span>
            <span className="id-ai-badge">LOADING</span>
          </div>
          <div className="id-ai-shimmer">
            <div className="id-ai-shimmer-line" style={{ width: '90%' }} />
            <div className="id-ai-shimmer-line" style={{ width: '75%' }} />
            <div className="id-ai-shimmer-line" style={{ width: '85%' }} />
            <div className="id-ai-shimmer-line" style={{ width: '60%' }} />
          </div>
        </div>
      );
    }

    if (aiFundsError) {
      return (
        <div className="id-ai-section">
          <div className="id-ai-header">
            <span className="id-ai-label">AI FUNDAMENTALS</span>
          </div>
          <div className="id-ai-error">
            AI summary is temporarily unavailable. Fundamentals and valuation tables above are still live.
          </div>
        </div>
      );
    }

    if (!aiFunds) return null;

    return (
      <div className="id-ai-section">
        <div className="id-ai-header">
          <span className="id-ai-label">AI FUNDAMENTALS</span>
          <span className="id-ai-badge">AI-GENERATED</span>
        </div>

        {aiFunds.summary && (
          <p className="id-ai-summary">{aiFunds.summary}</p>
        )}

        {aiFunds.businessModel && (
          <div className="id-ai-block">
            <div className="id-ai-block-title">BUSINESS MODEL</div>
            <p className="id-ai-text">{aiFunds.businessModel}</p>
          </div>
        )}

        {aiFunds.segments?.length > 0 && (
          <div className="id-ai-block">
            <div className="id-ai-block-title">KEY SEGMENTS</div>
            <ul className="id-ai-list">
              {aiFunds.segments.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}

        {aiFunds.financialHighlights?.length > 0 && (
          <div className="id-ai-block">
            <div className="id-ai-block-title">FINANCIAL HIGHLIGHTS</div>
            <ul className="id-ai-list">
              {aiFunds.financialHighlights.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </div>
        )}

        {aiFunds.valuationSnapshot?.length > 0 && (
          <div className="id-ai-block">
            <div className="id-ai-block-title">VALUATION SNAPSHOT</div>
            <ul className="id-ai-list">
              {aiFunds.valuationSnapshot.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          </div>
        )}

        {aiFunds.riskFactors?.length > 0 && (
          <div className="id-ai-block">
            <div className="id-ai-block-title">KEY RISKS / DRIVERS</div>
            <ul className="id-ai-list id-ai-list--risks">
              {aiFunds.riskFactors.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // ── Fetch fundamentals (tab-triggered) ──────────────────────────────────
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

  // ── RENDER ──────────────────────────────────────────────────────────────
  const mobileTabs = isBond
    ? ['STATS', 'RISK', 'CASH FLOWS', ...(desc ? ['ABOUT'] : [])]
    : isFX
    ? ['STATS', 'MACRO', 'NEWS', ...(desc ? ['ABOUT'] : [])]
    : ['STATS', 'FUND', 'AI', 'OPTIONS', 'NEWS', ...(desc ? ['ABOUT'] : [])];

  const deltaHint = deltaMode
    ? (deltaA === null ? '← tap A' : deltaB === null ? '← tap B' : 'tap to reset')
    : null;


  // ── Hero derived values ───────────────────────────────────────────────
  const heroOpen    = snap?.day?.o ?? (bars.length ? bars[0].open : null);
  const heroHigh    = dayHigh ?? (bars.length ? Math.max(...bars.map(b => b.high)) : null);
  const heroLow     = dayLow ?? (bars.length ? Math.min(...bars.map(b => b.low)) : null);
  const heroVol     = volume;
  const heroMktCap  = mktCap;
  const changeValue = dayChange;
  const changeDirection = dayChgPct == null ? 'flat' : dayChgPct >= 0 ? 'up' : 'down';
  const changeArrow = changeDirection === 'up' ? String.fromCharCode(9650) : changeDirection === 'down' ? String.fromCharCode(9660) : '';
  const formattedChange = dayChange != null ? fmt(Math.abs(dayChange)) : '--';
  const formattedChangePct = dayChgPct != null ? Math.abs(dayChgPct).toFixed(2) + '%' : '';
  const formattedPrice = displayPrice ?? '--';

  // ── Determine exchange / asset class for badge ────────────────────────
  const heroExchange   = info?.primary_exchange || etfMeta?.exchange || (isFX ? 'FX' : isCrypto ? 'CRYPTO' : isBondTicker ? 'BOND' : '');
  const heroAssetClass = etfMeta?.assetClass || (isFX ? 'forex' : isCrypto ? 'crypto' : isBondTicker ? 'fixed_income' : isStock ? 'equity' : '');

  // ── navigator.share() + clipboard fallback ────────────────────────────
  const handleShare = async () => {
    const changeSign = changeValue >= 0 ? '+' : '';
    const shareText = [disp + ' \u2014 ' + formattedPrice, changeSign + formattedChange + ' (' + changeSign + formattedChangePct + ')', name, '', 'via Senger Market Terminal'].join('\n');
    if (navigator.share) {
      try { await navigator.share({ title: disp + ' \u2014 ' + formattedPrice, text: shareText }); }
      catch (err) { if (err.name !== 'AbortError') fallbackCopyToClipboard(shareText); }
    } else { fallbackCopyToClipboard(shareText); }
  };
  const fallbackCopyToClipboard = (text) => {
    navigator.clipboard?.writeText(text);
    setCopyToast(true);
    setTimeout(() => setCopyToast(false), 2000);
  };

  const openPositionEditor = useCallback(() => { setShowPositionEditor(true); }, []);
  const openAlertCreator   = useCallback(() => { setShowAlertEditor(true); }, []);
  const sendToChat = useCallback(() => {
    if (typeof onOpenChat === 'function') onOpenChat(norm);
  }, [onOpenChat, norm]);

  // Step 4.2: Switch to another listing
  const onSwitchListing = useCallback((symbolKey) => {
    onOpenDetail?.(symbolKey);
  }, [onOpenDetail]);

  return (
    <div
      className={asPage ? 'id-page' : 'id-overlay'}
      onMouseDown={asPage ? undefined : (e => { if (e.target === e.currentTarget) onClose(); })}
    >
      {/* ── HERO PRICE BLOCK (hidden on mobile asPage to save space) ── */}
      <div className={`id-hero${asPage && isMobile ? ' id-hero--hidden' : ''}`}>
        <div className="id-hero-meta">
          <div>
            <div className="id-hero-ticker">{disp}</div>
            <div className="id-hero-name">{name}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <div className="id-hero-badge">{heroExchange}{heroExchange && heroAssetClass ? ' \u00b7 ' : ''}{heroAssetClass}</div>
            {/* Desktop action buttons */}
            <div className="id-hero-actions">
              <button className="id-hero-action-btn" onClick={() => toggleWatchlist(disp)}>{watched ? '\u2605' : '\u2606'} Watch</button>
              <button className="id-hero-action-btn" onClick={openPositionEditor}>+ Portfolio</button>
              <button className="id-hero-action-btn" onClick={openAlertCreator}>{String.fromCharCode(128276)} Alert</button>
              <button className="id-hero-action-btn" onClick={() => setShowGameTrade(true)} style={{ minHeight: 44 }}>Game Trade</button>
              {onOpenChat && <button className="id-hero-action-btn" onClick={sendToChat}>{String.fromCharCode(128172)} Chat</button>}
              <button className="id-hero-action-btn" onClick={handleShare}>{String.fromCharCode(8599)} Share</button>
            </div>
          </div>
        </div>
        <div className="id-hero-price-row">
          <span className="id-hero-price">{formattedPrice}</span>
          {!isBond && !isFX && <span className="id-hero-ccy">{currencyLabel(displayCurrency)}</span>}
          <span className={`id-hero-change ${changeDirection}`}>{changeArrow} {formattedChange} {formattedChangePct}</span>
          {/* Step 5.1: Data delay badge */}
          {dataDelay && dataDelay !== 'realtime' && (
            <span className={`id-delay-badge ${dataDelay === '15min' ? 'id-delay-badge--delayed' : 'id-delay-badge--slow'}`}>
              [{dataDelay === '15min' ? '15-min' : '30-min'} delay]
            </span>
          )}
        </div>
        {/* Step 4.2: Listing switcher */}
        {otherListings.length > 0 && (
          <div className="id-listing-switcher">
            <span className="id-listing-current">{heroExchange} · {displayCurrency}</span>
            {otherListings.map(l => (
              <button
                key={l.symbolKey}
                className="id-listing-alt"
                onClick={() => onSwitchListing(l.symbolKey)}
              >
                {l.exchange} · {l.currency || 'N/A'}
              </button>
            ))}
          </div>
        )}
        {/* FX direction sub-line */}
        {fxDirection && <div className="id-hero-context">{fxDirection}</div>}
        {/* Step 5.2: GBX note */}
        {isGBX && (
          <div className="id-hero-context">
            £{fmt(priceLiveFormatted, 2)} (LSE price in pence)
          </div>
        )}
        {/* Commodity ETF proxy context */}
        {commodityCtx && <div className="id-hero-context" title={commodityCtx.note}>{commodityCtx.label}</div>}
        {/* Futures contract context */}
        {etfMeta?.isFutures && (
          <div className="id-hero-context">
            {etfMeta.underlyingName} · {etfMeta.exchange} front-month · per {etfMeta.underlyingUnit}
          </div>
        )}
        <div className="id-hero-stats">
          {heroOpen != null && <span className="id-hero-stat">Open <span>{fmt(heroOpen)}</span></span>}
          {heroHigh != null && <span className="id-hero-stat">High <span>{fmt(heroHigh)}</span></span>}
          {heroLow != null && <span className="id-hero-stat">Low <span>{fmt(heroLow)}</span></span>}
          {heroVol != null && <span className="id-hero-stat">Vol <span>{fmt(heroVol, 0)}</span></span>}
          {heroMktCap != null && <span className="id-hero-stat">MCap <span>{fmt(heroMktCap, 0)}</span></span>}
        </div>
      </div>

      {/* ── HEADER ── */}
      <div className={`id-header${isMobile ? ' id-header--mobile' : ''}`}>

        {/* Close button */}
        <button
          ref={closeButtonRef}
          onClick={onClose}
          title="Close (Esc)"
          className={`id-close${isMobile ? ' id-close--mobile' : ''}`}
        >✕</button>

        {isMobile ? (
          <div className="id-header-col id-header-col--flex">
            <div className="id-header-row">
              <span className="id-ticker id-ticker--mobile">{disp}</span>
              {livePrice != null && (
                <span className="id-price id-price--mobile tabular">
                  {displayPrice}
                </span>
              )}
              {displayChange != null && (
                <span className={`id-change id-change--mobile ${isPos ? 'id-change--up' : 'id-change--down'}`}>
                  {displayChange}
                </span>
              )}
            </div>
            {name !== disp && (
              <span className="id-name" style={{ maxWidth: 'none' }}>{name}</span>

            )}
          </div>
        ) : (
          <>
            <div className="id-header-col">
              <span className="id-ticker">{disp}</span>
              {name !== disp && <span className="id-name">{name}</span>}
            </div>

            <div className="id-header-col">
              {livePrice != null && <span className="id-price">{displayPrice}</span>}
              {displayChange != null && (
                <span className={`id-change ${isPos ? 'id-change--up' : 'id-change--down'}`}>
                  {isBond
                    ? displayChange
                    : `${isPos ? '+' : ''}${fmt(dayChange)} (${isPos ? '+' : ''}${fmt(dayChgPct)}%)`
                  }
                </span>
              )}
            </div>

            {hovered && (
              <span className="id-hover-price">
                ● {hovered.label}: {fmt(hovered.close)}
              </span>
            )}
          </>
        )}

        <div className={`id-header-spacer${isMobile ? ' id-header-spacer--mobile' : ''}`} />

        {/* Delta badge — desktop only */}
        {!isMobile && deltaInfo && (
          <div className="id-delta-badge" style={{ border: `1px solid ${deltaInfo.pct >= 0 ? GREEN : RED}` }}>
            <span className="id-delta-pct" style={{ color: deltaInfo.pct >= 0 ? GREEN : RED }}>
              {deltaInfo.pct >= 0 ? '+' : ''}{fmt(deltaInfo.pct)}%
            </span>
            <span className="id-delta-abs">
              {fmt(Math.abs(deltaInfo.delta))} {deltaInfo.days != null ? `· ${deltaInfo.days}d` : ''}
            </span>
          </div>
        )}

        {deltaHint && <span className="id-delta-hint">{deltaHint}</span>}

        {/* Alert button */}
        <button
          onClick={() => setShowAlertEditor(true)}
          title="Create price alert"
          className={`id-action-btn${isMobile ? ' id-action-btn--mobile' : ''}`}
        >{isMobile ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> ALERT</>}</button>

        {/* Measure button */}
        <button
          onClick={toggleDelta}
          title="Measure tool: tap A then B on the chart"
          className={`id-action-btn${isMobile ? ' id-action-btn--mobile' : ''}${deltaMode ? ' id-action-btn--active' : ''}`}
        >⟷{isMobile ? '' : ' MEASURE'}</button>

        {/* Export button */}
        <button
          onClick={() => exportToCSV(bars, norm, range.label)}
          title="Export chart data to CSV"
          className={`id-action-btn${isMobile ? ' id-action-btn--mobile' : ''}`}
        >{isMobile ? '↓' : '↓ EXPORT'}</button>

        {/* Share button */}
        <button
          onClick={() => setShowShareModal(true)}
          title="Share ticker card"
          className={`id-action-btn${isMobile ? ' id-action-btn--mobile' : ''}`}
        >{isMobile ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> SHARE</>}</button>

        {/* Pop-out button — desktop only */}
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
            className="id-action-btn"
          >⊞ POP OUT</button>
        )}

      </div>

      {/* ── BODY ── */}
      <div className={`id-body${isMobile ? ' id-body--mobile' : ''}`}>

        {/* LEFT: CHART PANEL */}
        <div className={`id-chart-area${isMobile ? ' id-chart-area--mobile' : ''}`}>
          {/* Range selector + Chart type toggle */}
          <div className="id-range-row">
            {RANGES.map((r, i) => (
              <button key={r.label}
                onClick={() => setRangeIdx(i)}
                className={`id-range-btn${i === rangeIdx ? ' id-range-btn--active' : ''}`}
              >{r.label}</button>
            ))}
            {rangeChg != null && !loading && (
              <span className="id-range-chg" style={{ color: rangeChg >= 0 ? GREEN : RED }}>
                {rangeChg >= 0 ? '+' : ''}{fmt(rangeChg)}%
              </span>
            )}

            {/* AREA / CANDLE toggle */}
            <div className="id-chart-type-toggle">
              <button
                className={`id-ct-btn${chartType === 'area' ? ' id-ct-btn--active' : ''}`}
                onClick={() => setChartType('area')}
              >AREA</button>
              <button
                className={`id-ct-btn${chartType === 'candle' ? ' id-ct-btn--active' : ''}`}
                onClick={() => setChartType('candle')}
              >CANDLE</button>
            </div>

            {/* Mobile: show delta badge inline */}
            {isMobile && deltaInfo && (
              <span className="id-delta-badge--mobile"
                style={{ color: deltaInfo.pct >= 0 ? GREEN : RED, border: `1px solid ${deltaInfo.pct >= 0 ? GREEN : RED}` }}>
                {deltaInfo.pct >= 0 ? '+' : ''}{fmt(deltaInfo.pct)}%
                {deltaInfo.days != null && <span className="id-delta-days"> · {deltaInfo.days}d</span>}
              </span>
            )}
            {isMobile && deltaHint && <span className="id-delta-hint">{deltaHint}</span>}
          </div>

          {/* Indicator toggle bar */}
          <div className="id-indicator-bar">
            {INDICATOR_LIST.map(ind => (
              <button key={ind.key}
                className={`id-ind-btn${activeIndicators.has(ind.key) ? ' id-ind-btn--active' : ''}`}
                style={activeIndicators.has(ind.key) ? { borderColor: IND_COLORS[ind.key], color: IND_COLORS[ind.key] } : undefined}
                onClick={() => toggleIndicator(ind.key)}
              >{ind.label}</button>
            ))}
            <button
              className={`id-ind-btn id-ind-btn--analyze${aiChartInsightLoading ? ' id-ind-btn--loading' : ''}${showAnalysis && (aiChartInsight || aiChartInsightError) ? ' id-ind-btn--active' : ''}`}
              onClick={fetchChartInsight}
              disabled={aiChartInsightLoading || bars.length < 5}
            >{aiChartInsightLoading ? 'ANALYZING...' : showAnalysis && aiChartInsight ? 'HIDE' : 'ANALYZE'}</button>
          </div>

          {/* AI Analysis panel — structured: Fundamentals → News → Chart */}
          {showAnalysis && (aiChartInsight || aiChartInsightError || aiChartInsightLoading) && (
            <div className="id-chart-insight">
              {aiChartInsightError ? (
                <span className="id-chart-insight-error">{aiChartInsightError}</span>
              ) : aiChartInsightLoading ? (
                <span className="id-chart-insight-text" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Loading analysis...</span>
              ) : (
                <>
                  {/* 1. Fundamentals (always first) */}
                  {aiChartInsight.fundamentals && (
                    <div className="id-analysis-section">
                      <span className="id-chart-insight-badge">FUNDAMENTALS</span>
                      <span className="id-chart-insight-text">{aiChartInsight.fundamentals}</span>
                    </div>
                  )}
                  {/* 2. News / Catalysts (if relevant) */}
                  {aiChartInsight.news && !aiChartInsight.news.toLowerCase().includes('no significant catalysts') && (
                    <div className="id-analysis-section">
                      <span className="id-chart-insight-badge" style={{ background: 'rgba(76,175,80,0.08)', color: '#4caf50', borderColor: 'rgba(76,175,80,0.15)' }}>WHY IT MAY BE MOVING</span>
                      <span className="id-chart-insight-text">{aiChartInsight.news}</span>
                    </div>
                  )}
                  {/* 3. Chart / Technical analysis (always last) */}
                  {aiChartInsight.insight && (
                    <div className="id-analysis-section">
                      <span className="id-chart-insight-badge" style={{ background: 'rgba(33,150,243,0.08)', color: '#2196f3', borderColor: 'rgba(33,150,243,0.15)' }}>CHART ANALYSIS</span>
                      <span className="id-chart-insight-text">{aiChartInsight.insight}</span>
                    </div>
                  )}
                  {/* Fallback if none populated */}
                  {!aiChartInsight.fundamentals && !aiChartInsight.insight && (
                    <span className="id-chart-insight-text" style={{ color: 'var(--text-muted)' }}>Analysis data unavailable</span>
                  )}
                </>
              )}
            </div>
          )}

          {/* Chart area */}
          <div className="id-chart-container">
            {renderChart()}
          </div>
        </div>

        {/* RIGHT: SIDEBAR (desktop) */}
        {!isMobile && (() => {
          const bondDesktopTabs = ['STATS', 'RISK', 'CASH FLOWS'];
          const fxDesktopTabs   = ['STATS', 'MACRO', 'NEWS'];
          const hasTabs = isBond || isFX;
          const tabList = isBond ? bondDesktopTabs : isFX ? fxDesktopTabs : [];

  return (
            <div className="id-sidebar">
              {hasTabs && (
                <div className="id-tab-bar">
                  {tabList.map(t => (
                    <button key={t}
                      onClick={() => setDesktopTab(t)}
                      className={`id-tab${desktopTab === t ? ' id-tab--active' : ''}`}
                    >{t}</button>
                  ))}
                </div>
              )}
              <div className="id-sidebar-content">
                {isBond && desktopTab === 'STATS'      && renderBondStats()}
                {isBond && desktopTab === 'RISK'       && renderBondRisk()}
                {isBond && desktopTab === 'CASH FLOWS' && renderCashFlows()}
                {isFX && desktopTab === 'STATS' && renderStats()}
                {isFX && desktopTab === 'MACRO' && renderFXMacro()}
                {isFX && desktopTab === 'NEWS'  && renderNews()}
                {!isBond && !isFX && (isETF ? renderETFStats() : renderStats())}
                {!isBond && !isFX && renderAIFundamentals()}
                {!isBond && !isFX && (
                  <InstrumentOptionsPanel
                    symbol={norm}
                    spot={livePrice}
                    isMobile={false}
                  />
                )}
                {!isBond && !isFX && renderNews()}
                {!isBond && !isFX && renderAbout()}
                {(isBond || isFX) && desktopTab === 'STATS' && renderAbout()}
              </div>
            </div>
          );
        })()}

        {/* BOTTOM: TABS (mobile) */}
        {isMobile && (
          <div className="id-mobile-tabs">
            <div className="id-tab-bar">
              {mobileTabs.map(t => (
                <button key={t}
                  onClick={() => setActiveTab(t)}
                  className={`id-tab id-tab--mobile${activeTab === t ? ' id-tab--active' : ''}`}
                >{t}</button>
              ))}
            </div>
            <div className="id-mobile-tab-content">
              {activeTab === 'STATS'      && (isBond ? renderBondStats() : isFX ? renderStats() : isETF ? renderETFStats() : renderStats())}
              {activeTab === 'RISK'       && renderBondRisk()}
              {activeTab === 'CASH FLOWS' && renderCashFlows()}
              {activeTab === 'MACRO'      && renderFXMacro()}
              {activeTab === 'FUND'       && renderFundamentals()}
              {activeTab === 'AI'         && renderAIFundamentals()}
              {activeTab === 'OPTIONS'    && (
                <InstrumentOptionsPanel
                  symbol={norm}
                  spot={livePrice}
                  isMobile={true}
                />
              )}
              {activeTab === 'NEWS'       && renderNews()}
              {activeTab === 'ABOUT'      && renderAbout()}
            </div>
          </div>
        )}

      </div>

      {/* ── STICKY BOTTOM ACTION BAR (mobile only) ── */}
      <div className="id-action-bar">
        <button className="id-action-btn-bar" onClick={() => toggleWatchlist(disp)}>{watched ? '\u2605' : '\u2606'} Watch</button>
        <button className="id-action-btn-bar id-action-btn-bar--primary" onClick={openPositionEditor}>+ Portfolio</button>
        <button className="id-action-btn-bar" onClick={openAlertCreator}>{String.fromCharCode(128276)} Alert</button>
        <button className="id-action-btn-bar" onClick={() => setShowGameTrade(true)} style={{ minHeight: 44 }}>Game Trade</button>
        {onOpenChat && <button className="id-action-btn-bar" onClick={sendToChat}>{String.fromCharCode(128172)} Chat</button>}
        <button className="id-action-btn-bar" onClick={handleShare}>{String.fromCharCode(8599)} Share</button>
      </div>

      {/* Alert editor modal — portaled to body to escape scroll container on mobile */}
      {showAlertEditor && createPortal(
        <AlertEditor
          alert={null}
          defaultSymbol={norm}
          defaultPrice={livePrice}
          onClose={() => setShowAlertEditor(false)}
          mobile={isMobile}
        />,
        document.body
      )}

      {/* Position editor modal — portaled to body */}
      {showPositionEditor && createPortal(
        <PositionEditor
          position={null}
          defaultSymbol={norm}
          onClose={() => setShowPositionEditor(false)}
          mobile={isMobile}
        />,
        document.body
      )}

      {/* Share ticker card modal */}
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        cardType="ticker"
        cardData={{ symbol: norm, price: livePrice, changePct: dayChgPct, name }}
      />

      {/* Game trade modal */}
      {showGameTrade && (
        <TradeModal
          isOpen={showGameTrade}
          onClose={() => setShowGameTrade(false)}
          defaultSymbol={norm}
        />
      )}

      {/* Link copied toast */}
      {copyToast && (
        <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', border: '1px solid var(--accent)', color: '#fff', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, zIndex: 99999, animation: 'fadeInUp 200ms ease-out' }}>
          Link copied!
        </div>
      )}
    </div>
  );
}
