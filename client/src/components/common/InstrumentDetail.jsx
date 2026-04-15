// InstrumentDetail.jsx – Bloomberg GP-style full-screen instrument overlay
import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useOpenDetail, useSectorContext } from '../../context/OpenDetailContext';
import { useScreenContext } from '../../context/ScreenContext';
import { useInstrumentData } from '../../hooks/useInstrumentData';
import AlertEditor from './AlertEditor';
import ShareModal from './ShareModal';
import PositionEditor from './PositionEditor';
import InstrumentOptionsPanel from './InstrumentOptionsPanel';
import { useTickerPrice } from '../../context/PriceContext';
import { sanitizeTicker } from '../../utils/ticker';
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
import { useInstrumentSearch } from '../../hooks/useInstrumentSearch';
import { useAlerts } from '../../context/AlertsContext';
import { useToast } from '../../context/ToastContext';
import { apiFetch } from '../../utils/api';
import {
  ORANGE, GREEN, RED, RANGES,
  fmt, fmtLabel, timeAgo, pct, exportToCSV, getFromDate, displayTicker,
} from './InstrumentDetailHelpers';
import { DeltaLineOverlay, CandlestickOverlay } from './InstrumentDetailCharts';
import { Section, StatRow } from './InstrumentDetailSections';
import { useAIInsight } from '../../hooks/useAIInsight';
import { getExchangeName } from '../../config/exchangeNames';
import {
  detectExchangeGroup, getProviderRouting, getDataTypeCoverage, getCoverageDisplay, COVERAGE,
} from '../../config/providerMatrix';

// ── NO_DATA exchanges — now driven by providerMatrix ──
const NO_DATA_EXCHANGES = new Set([]);

// ── Name overrides for display ──
const RELATED_NAMES = {
  LMT:'Lockheed', RTX:'Raytheon', BA:'Boeing', NOC:'Northrop', GD:'Gen Dynamics', BAESY:'BAE', PLTR:'Palantir', RKLB:'Rocket Lab', KTOS:'Kratos',
  NVDA:'NVIDIA', MSFT:'Microsoft', AAPL:'Apple', GOOGL:'Alphabet', META:'Meta', AMZN:'Amazon', TSM:'TSMC', AMD:'AMD', AVGO:'Broadcom',
  XOM:'Exxon', CVX:'Chevron', SHEL:'Shell', COP:'Conoco', SLB:'Schlumberger', NEE:'NextEra', ENPH:'Enphase', FSLR:'First Solar',
  EWZ:'Brazil ETF', MELI:'MercadoLibre', NU:'Nu Holdings', VALE:'Vale ADR',
  TLT:'20Y Treasury', IEF:'7-10Y Treasury', SHY:'1-3Y Treasury', AGG:'US Agg Bond', HYG:'High Yield', LQD:'IG Corporate', EMB:'EM Bonds', TIP:'TIPS',
  SPY:'S&P 500', QQQ:'Nasdaq 100', DIA:'Dow Jones', IWM:'Russell 2000', GLD:'Gold', USO:'Oil',
  MSTR:'MicroStrategy', COIN:'Coinbase', IBIT:'iShares BTC',
  BABA:'Alibaba', TM:'Toyota', SONY:'Sony', HDB:'HDFC Bank', INFY:'Infosys', TCEHY:'Tencent',
  SAP:'SAP', AZN:'AstraZeneca', NVO:'Novo Nordisk', LVMUY:'LVMH', HSBC:'HSBC', TTE:'TotalEnergies',
  WMT:'Walmart', COST:'Costco', TGT:'Target', HD:'Home Depot', NKE:'Nike', SBUX:'Starbucks',
};

// ── Related Ticker Chip (mini component for "Also In" section) ──
const RelatedTickerChip = memo(function RelatedTickerChip({ ticker, onOpen, sectorContext }) {
  const priceData = useTickerPrice(ticker);
  const displayTk = sanitizeTicker(ticker || '').replace('.SA', '').replace('=F', '');
  const name = RELATED_NAMES[ticker] || RELATED_NAMES[displayTk] || displayTk;
  const price = priceData?.price;
  const changePct = priceData?.changePct;
  const isUp = changePct != null ? changePct >= 0 : true;

  return (
    <div
      className="id-related-chip"
      onClick={() => onOpen(ticker, sectorContext)}
      onTouchEnd={(e) => { e.preventDefault(); onOpen(ticker, sectorContext); }}
    >
      <span className="id-related-chip-ticker">{displayTk}</span>
      <span className="id-related-chip-name">{name}</span>
      {price != null && (
        <span className="id-related-chip-price">
          {price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )}
      {changePct != null && (
        <span className={`id-related-chip-chg ${isUp ? 'up' : 'down'}`}>
          {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
        </span>
      )}
    </div>
  );
});

// ── Main Component ──────────────────────────────────────────────────────────
// asPage=true: renders as a scrollable page (DETAIL tab on mobile), no fixed overlay
export default function InstrumentDetail({ ticker, onClose, asPage = false, onOpenChat }) {
  // Crash-hardening: safe callbacks that never throw if caller forgets to pass them
  const handleClose = typeof onClose === 'function' ? onClose : () => {};
  const handleOpenChat = typeof onOpenChat === 'function' ? onOpenChat : null;
  const openDetail = useOpenDetail();
  const sectorContext = useSectorContext();
  const { updateSelectedTicker } = useScreenContext();

  // Use the mobile detection hook
  const isMobile = useIsMobile();

  // Use the instrument data hook
  const instrumentData = useInstrumentData(ticker);
  const {
    norm, disp, isFX, isCrypto, isBrazil, isBondTicker, isStock, isBond, isETF,
    rangeIdx, setRangeIdx, bars, loading, range,
    snap, info,
    fundsData, fundsLoading, fundsError, refetchFundamentals,
    etfMeta, otherListings, instrumentCompanyId,
    bondData, bondLoading,
    macroData,
    news, newsLoading,
    aiFunds, aiFundsLoading, aiFundsError,
    insiderData, insiderLoading,
    dividendData, dividendLoading,
    splitsData, polyFinancials,
    logoUrl,
    tdProfile, tdStatistics, tdFinancials, tdFinancialsLoading,
    tdHolders, tdHoldersLoading, tdExecutives, tdEarnings,
  } = instrumentData;

  // ── NO DATA detection and AI fallback (S4.5.A) ──
  const detectedExchange = info?.primary_exchange || etfMeta?.exchange || '';
  const isNoDataExchange = NO_DATA_EXCHANGES.has(detectedExchange.toUpperCase());
  const hasNoCoverage = isNoDataExchange && !isFX && !isCrypto && !loading && bars.length === 0;

  const aiOverviewContext = useMemo(() => {
    if (!hasNoCoverage) return null;
    const name = info?.name || norm || disp;
    return {
      query: `Provide a current overview of ${name} (${disp}) including recent price, market cap, key metrics, and latest news.`,
    };
  }, [hasNoCoverage, info?.name, norm, disp]);

  const { insight: aiOverview, loading: aiOverviewLoading, refresh: fetchAiOverview } = useAIInsight({
    type: 'general',
    context: aiOverviewContext,
    cacheKey: hasNoCoverage ? `no-data-overview:${norm}` : null,
    autoFetch: hasNoCoverage,
  });

  // Watchlist toggle
  const { isWatching, toggle: toggleWatchlist } = useWatchlist();
  const watched = isWatching(disp);

  // UI interaction states (kept local, not data-fetching)
  const [deltaMode,    setDeltaMode]    = useState(false);
  const [deltaA,       setDeltaA]       = useState(null);
  const [deltaB,       setDeltaB]       = useState(null);
  const [hovered,      setHovered]      = useState(null);
  const [activeTab,    setActiveTab]    = useState('STATS');
  const [descExpanded, setDescExpanded] = useState(false);
  const [desktopTab,   setDesktopTab]   = useState('STATS');
  const [showAlertEditor, setShowAlertEditor] = useState(false);
  const [showPositionEditor, setShowPositionEditor] = useState(false);
  const [showShareModal, setShowShareModal]   = useState(false);
  const [copyToast, setCopyToast] = useState(false);

  // Chart type, indicators, AI Chart Insight
  const [chartType, setChartType]     = useState('area'); // 'area' | 'candle'
  const [activeIndicators, setActiveIndicators] = useState(new Set());
  const [aiChartInsight, setAiChartInsight]         = useState(null);
  const [aiChartInsightLoading, setAiChartInsightLoading] = useState(false);
  const [aiChartInsightError, setAiChartInsightError]     = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false); // toggle for Analyze panel
  const aiChartInsightCacheRef = useRef({}); // "symbol:range:lastT" → data

  // ── Phase 4.8: Multi-Ticker Comparison Mode ──
  const [comparisonTickers, setComparisonTickers] = useState([]);
  const [showComparisonSearch, setShowComparisonSearch] = useState(false);
  const [comparisonData, setComparisonData] = useState({}); // symbol → bars
  const comparisonSearchHook = useInstrumentSearch({ enablePolygon: false });

  // ── Phase 4.9: Custom Date Range Picker ──
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customRangeFrom, setCustomRangeFrom] = useState('');
  const [customRangeTo, setCustomRangeTo] = useState('');
  const [customRangeLoading, setCustomRangeLoading] = useState(false);
  const [customRangeBars, setCustomRangeBars] = useState(null); // null = use default bars from hook

  // ── Phase 4.11: Inline Price Alert ──
  const [showInlineAlert, setShowInlineAlert] = useState(false);
  const [inlineAlertPrice, setInlineAlertPrice] = useState('');
  const [inlineAlertDirection, setInlineAlertDirection] = useState('above');
  const { addAlert } = useAlerts();
  const { showToast } = useToast();

  // ── Phase 6: AI Chat Quick Ask ──
  const [quickAskInput, setQuickAskInput] = useState('');

  // ── Clear delta state when range changes ───────────────────────────────
  useEffect(() => {
    setDeltaA(null);
    setDeltaB(null);
    setDeltaMode(false);
  }, [rangeIdx]);

  // ── Phase 6: Update screen context with selected ticker ──
  useEffect(() => {
    updateSelectedTicker(disp);
  }, [disp, updateSelectedTicker]);

  // ── Phase 6: Handle quick ask to AI chat ──
  const handleQuickAsk = useCallback(() => {
    if (!quickAskInput.trim() || !handleOpenChat) return;
    // Call onOpenChat with the ticker and question
    handleOpenChat({ ticker: disp, question: quickAskInput });
    setQuickAskInput('');
  }, [quickAskInput, disp, handleOpenChat]);

  // ── Clear comparison data when modal closes ────────────────────────────────
  useEffect(() => {
    return () => {
      setComparisonTickers([]);
      setComparisonData({});
      setShowComparisonSearch(false);
    };
  }, []);

  // ── Refetch fundamentals when FUND tab is active ────────────────────────
  useEffect(() => {
    if (activeTab === 'FUND' && isStock) {
      refetchFundamentals();
    }
  }, [activeTab, isStock, refetchFundamentals]);

  // ── Derived values (must be before effects that reference them) ──────────
  const livePrice = snap?.min?.c || snap?.day?.c || snap?.lastTrade?.p || snap?.prevDay?.c
                 || (bars.length ? bars[bars.length - 1].close : null);

  // ── Initialize inline alert price when livePrice is available ────────────
  useEffect(() => {
    if (livePrice != null && !inlineAlertPrice) {
      setInlineAlertPrice((livePrice * 1.05).toFixed(2));
    }
  }, [livePrice, inlineAlertPrice]);

  // ── Focus management + Escape key + mobile back-button support ────────
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(handleClose);
  useEffect(() => { onCloseRef.current = handleClose; }, [handleClose]);

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

  // ── Use custom range bars if available, otherwise use default bars ──
  const displayBars = customRangeBars || bars;

  const chartMin   = displayBars.length ? Math.min(...displayBars.map(b => b.close)) * 0.997 : 0;
  const chartMax   = displayBars.length ? Math.max(...displayBars.map(b => b.close)) * 1.003 : 1;
  const rangeHigh  = displayBars.length ? Math.max(...displayBars.map(b => b.high))  : null;
  const rangeLow   = displayBars.length ? Math.min(...displayBars.map(b => b.low))   : null;
  const rangeOpen  = displayBars.length ? displayBars[0].open : null;
  const rangeClose = displayBars.length ? displayBars[displayBars.length - 1].close : null;
  const rangeChg   = (rangeOpen && rangeClose) ? ((rangeClose - rangeOpen) / rangeOpen) * 100 : null;

  // ── Technical Indicators (Phase 6 — now using shared computeIndicators) ──
  const indicatorData = useMemo(() => {
    return computeIndicators(displayBars, activeIndicators);
  }, [displayBars, activeIndicators]);

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

  // ── Phase 4.8: Multi-Ticker Comparison Mode ────────────────────────────────
  const COMPARISON_COLORS = {
    compare1: '#00bcd4',
    compare2: '#4caf50',
    compare3: '#ff9800',
    compare4: '#a855f7',
  };

  const addComparisonTicker = useCallback(async (result) => {
    if (comparisonTickers.length >= 4) {
      showToast('Max 4 comparison tickers', 'warning');
      return;
    }
    const sym = result?.symbolKey || result?.symbol || result;
    if (!sym || comparisonTickers.includes(sym) || sym === norm) {
      if (sym === norm) showToast('Cannot compare with itself', 'warning');
      return;
    }

    try {
      // Fetch OHLCV data for the comparison ticker using same range via /api/chart/:ticker
      const from = getFromDate(range);
      const to = new Date().toISOString().split('T')[0];
      const res = await apiFetch(
        `/api/chart/${encodeURIComponent(sym)}?multiplier=${range.multiplier}&timespan=${range.timespan}&from=${from}&to=${to}`
      );
      if (!res.ok) throw new Error('Failed to fetch comparison data');
      const data = await res.json();
      const rawBars = Array.isArray(data.results) ? data.results : [];
      if (rawBars.length === 0) throw new Error('No chart data available');

      // Normalize bar format to match main chart bars
      const newBars = rawBars.map(b => ({
        t: b.t, label: fmtLabel(b.t, range.timespan),
        open: b.o ?? b.open, high: b.h ?? b.high, low: b.l ?? b.low,
        close: b.c ?? b.close, volume: b.v ?? b.volume ?? 0,
      }));

      setComparisonTickers(prev => [...prev, sym]);
      setComparisonData(prev => ({ ...prev, [sym]: newBars }));
      setShowComparisonSearch(false);
      comparisonSearchHook.clearSearch();
      showToast(`${sym} added to comparison`, 'success');
    } catch (err) {
      showToast(`No chart data for ${sym}`, 'error');
    }
  }, [comparisonTickers, norm, range, showToast, comparisonSearchHook]);

  const removeComparisonTicker = useCallback((sym) => {
    setComparisonTickers(prev => prev.filter(t => t !== sym));
    setComparisonData(prev => {
      const next = { ...prev };
      delete next[sym];
      return next;
    });
  }, []);

  // Rebase data to base-100 index (Bloomberg-style: start = 100)
  const rebaseData = useCallback((inputBars) => {
    if (!inputBars || inputBars.length === 0) return [];
    const firstPrice = inputBars[0]?.close;
    if (!firstPrice) return inputBars;
    return inputBars.map(bar => ({
      ...bar,
      close: (bar.close / firstPrice) * 100,
    }));
  }, []);

  // ── Phase 4.9: Custom Date Range Picker ────────────────────────────────────
  const applyCustomRange = useCallback(async () => {
    if (!customRangeFrom || !customRangeTo) {
      showToast('Please select both dates', 'warning');
      return;
    }
    const fromDate = new Date(customRangeFrom);
    const toDate = new Date(customRangeTo);
    if (fromDate >= toDate) {
      showToast('FROM date must be before TO date', 'warning');
      return;
    }

    try {
      setCustomRangeLoading(true);
      // Use the same /api/chart/:ticker endpoint with date strings
      const fromStr = customRangeFrom; // already YYYY-MM-DD
      const toStr = customRangeTo;
      const res = await apiFetch(
        `/api/chart/${encodeURIComponent(norm)}?multiplier=1&timespan=day&from=${fromStr}&to=${toStr}`
      );
      if (!res.ok) throw new Error('Failed to fetch custom range');
      const data = await res.json();
      const rawBars = Array.isArray(data.results) ? data.results : [];
      const fetchedBars = rawBars.map(bar => ({
        t: bar.t,
        label: fmtLabel(bar.t, 'day'),
        date: bar.t ? new Date(bar.t).toISOString().slice(0, 10) : '',
        open: parseFloat(bar.o ?? bar.open ?? 0),
        high: parseFloat(bar.h ?? bar.high ?? 0),
        low: parseFloat(bar.l ?? bar.low ?? 0),
        close: parseFloat(bar.c ?? bar.close ?? 0),
        volume: parseFloat(bar.v ?? bar.volume ?? 0),
      })).filter(b => b.close > 0);

      if (fetchedBars.length > 0) {
        setCustomRangeBars(fetchedBars);
        showToast(`Custom range: ${fetchedBars.length} bars loaded`, 'success');
      } else {
        showToast('No data found for selected range', 'warning');
      }
      setShowCustomRange(false);
    } catch (err) {
      showToast('Failed to load custom range', 'error');
    } finally {
      setCustomRangeLoading(false);
    }
  }, [customRangeFrom, customRangeTo, norm, showToast]);

  // ── Helper: Set preset date ranges ──
  const applyPresetRange = useCallback((preset) => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    let fromDateStr = todayStr;

    if (preset === 'YTD') {
      fromDateStr = `${year}-01-01`;
    } else if (preset === '1Y') {
      const oneYearAgo = new Date(today);
      oneYearAgo.setFullYear(year - 1);
      fromDateStr = `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, '0')}-${String(oneYearAgo.getDate()).padStart(2, '0')}`;
    } else if (preset === '3Y') {
      const threeYearsAgo = new Date(today);
      threeYearsAgo.setFullYear(year - 3);
      fromDateStr = `${threeYearsAgo.getFullYear()}-${String(threeYearsAgo.getMonth() + 1).padStart(2, '0')}-${String(threeYearsAgo.getDate()).padStart(2, '0')}`;
    } else if (preset === '5Y') {
      const fiveYearsAgo = new Date(today);
      fiveYearsAgo.setFullYear(year - 5);
      fromDateStr = `${fiveYearsAgo.getFullYear()}-${String(fiveYearsAgo.getMonth() + 1).padStart(2, '0')}-${String(fiveYearsAgo.getDate()).padStart(2, '0')}`;
    } else if (preset === 'MAX') {
      fromDateStr = '1990-01-01'; // Reasonable max range
    }

    setCustomRangeFrom(fromDateStr);
    setCustomRangeTo(todayStr);
  }, []);

  // ── Phase 4.11: Inline Price Alert ────────────────────────────────────────
  const createInlineAlert = useCallback(async () => {
    const price = parseFloat(inlineAlertPrice);
    if (!price || isNaN(price)) {
      showToast('Invalid price', 'warning');
      return;
    }

    try {
      await addAlert({
        symbol: norm,
        type: inlineAlertDirection === 'above' ? 'price_above' : 'price_below',
        parameters: { targetPrice: price },
        note: `Alert at ${fmt(price)}`,
      });
      showToast(`Alert set at ${fmt(price)}`, 'success');
      setShowInlineAlert(false);
    } catch (err) {
      showToast('Failed to create alert', 'error');
    }
  }, [norm, inlineAlertPrice, inlineAlertDirection, addAlert, showToast]);

  // ── Chart sub-render ───────────────────────────────────────────────────
  function renderChart() {
    if (loading) return <div className="id-chart-msg"><div className="id-skeleton"><div className="id-skeleton-bar--lg" style={{ width: '100%' }} /></div></div>;

    // ── AI Overview fallback for NO DATA instruments (S4.5.A) ──
    if (hasNoCoverage) {
      const exchangeLabel = getExchangeName(detectedExchange);
      return (
        <div className="id-ai-overview-fallback" style={{ padding: '16px' }}>
          <div className="id-degraded-banner" style={{
            borderRadius: 6,
            marginBottom: 12,
          }}>
            This instrument is on {exchangeLabel}. Live data is not available. Showing AI-generated overview.
          </div>
          {aiOverviewLoading && (
            <div style={{ color: '#888', padding: '20px 0' }}>
              <span style={{ animation: 'pulse 1.5s infinite' }}>Generating AI overview...</span>
            </div>
          )}
          {aiOverview?.body && (
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: 14 }}>
              {aiOverview.body}
            </div>
          )}
          {!aiOverviewLoading && !aiOverview && (
            <button
              onClick={fetchAiOverview}
              className="id-action-btn"
              style={{ borderRadius: 6 }}
            >
              Generate AI Overview
            </button>
          )}
        </div>
      );
    }

    if (displayBars.length === 0) {
      const grp = detectExchangeGroup(norm);
      const routing = getProviderRouting(norm);
      const chartProviders = routing.providers.chart;
      const msg = chartProviders.length === 0
        ? 'Chart data not available for this instrument type'
        : `Historical chart data unavailable — ${routing.groupInfo.label}`;
      return <div className="id-chart-msg" style={{ color: '#ff9800' }}>{msg}</div>;
    }

    const aMin = deltaA !== null && deltaB !== null ? Math.min(deltaA, deltaB) : null;
    const aMax = deltaA !== null && deltaB !== null ? Math.max(deltaA, deltaB) : null;

    let chartBars = indicatorData.bars;
    const isComparisonMode = comparisonTickers.length > 0;

    // ── Phase 4.8: Merge comparison data if in comparison mode ──
    if (isComparisonMode) {
      try {
        // Rebase main ticker to base-100
        const mainBars = rebaseData(chartBars);

        // Merge all comparison data (aligned by label/date)
        let mergedBars = mainBars.map(b => ({ ...b }));
        for (const compTicker of comparisonTickers) {
          const compBars = comparisonData[compTicker];
          if (!compBars || !compBars.length) continue;
          const rebasedCompBars = rebaseData(compBars);

          for (let i = 0; i < Math.min(mergedBars.length, rebasedCompBars.length); i++) {
            const val = rebasedCompBars[i]?.close;
            if (val != null && !isNaN(val)) {
              mergedBars[i][`comp_${compTicker}`] = val;
            }
          }
        }
        chartBars = mergedBars;
      } catch (err) {
        console.error('[InstrumentDetail] Comparison merge error:', err);
        // Fall back to non-comparison view
        chartBars = indicatorData.bars;
      }
    } else {
      chartBars = indicatorData.bars;
    }

    const showCandle = chartType === 'candle' && !isComparisonMode; // Disable candle in comparison mode
    const hasRSI = activeIndicators.has('RSI14');
    const hasMACD = activeIndicators.has('MACD');

    // Compute Y domain that includes BB bands if active
    let yMin = isComparisonMode ? 80 : chartMin, yMax = isComparisonMode ? 120 : chartMax;
    if (isComparisonMode) {
      // Include all comparison series in domain
      const allValues = [];
      for (const bar of chartBars) {
        if (bar.close != null) allValues.push(bar.close);
        for (const compTicker of comparisonTickers) {
          const val = bar[`comp_${compTicker}`];
          if (val != null) allValues.push(val);
        }
      }
      if (allValues.length) {
        const min = Math.min(...allValues);
        const max = Math.max(...allValues);
        const pad = (max - min) * 0.08 || 5;
        yMin = min - pad;
        yMax = max + pad;
      }
    }
    if (activeIndicators.has('BB') && !isComparisonMode) {
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
                yAxisId="right"
                position="right"
                domain={[yMin, yMax]}
                tick={{ fill: 'var(--text-faint)', fontSize: 9 }}
                width={64}
                tickFormatter={isComparisonMode ? (v => v != null && !isNaN(v) ? v.toFixed(1) : '') : (v => fmt(v, v > 999 ? 0 : 2))}
                axisLine={{ stroke: 'var(--border-default)' }}
              />
              <Tooltip
                contentStyle={commonTooltipStyle}
                formatter={isComparisonMode
                  ? ((v, name) => {
                      if (v == null || isNaN(v)) return ['—', name];
                      const pctFromBase = v - 100;
                      return [`${v.toFixed(2)} (${pctFromBase >= 0 ? '+' : ''}${pctFromBase.toFixed(2)}%)`, name];
                    })
                  : ((v, n) => [fmt(v), n])}
                labelStyle={{ color: 'var(--text-muted)', marginBottom: 4 }}
              />

              {aMin !== null && chartBars[aMin] && chartBars[aMax] && (
                <ReferenceArea
                  x1={chartBars[aMin].label}
                  x2={chartBars[aMax].label}
                  yAxisId="right"
                  fill={deltaInfo?.pct >= 0 ? GREEN : RED}
                  fillOpacity={0.06}
                  strokeOpacity={0}
                />
              )}

              {deltaA !== null && chartBars[deltaA] && (
                <ReferenceLine x={chartBars[deltaA].label} yAxisId="right" stroke={ORANGE} strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: 'A', fill: ORANGE, fontSize: 10, position: 'top' }} />
              )}
              {deltaB !== null && chartBars[deltaB] && (
                <ReferenceLine x={chartBars[deltaB].label} yAxisId="right" stroke={ORANGE} strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: 'B', fill: ORANGE, fontSize: 10, position: 'top' }} />
              )}

              {/* Phase 4.10: Earnings Event Markers */}
              {isStock && !isFX && tdEarnings && tdEarnings.length > 0 && (() => {
                // Map earnings dates to chart bar labels
                const earningsMarkers = [];
                for (const earning of tdEarnings) {
                  const earningDate = new Date(earning.date);
                  const matchingBar = chartBars.find(bar => {
                    if (!bar.label || !bar.t) return false;
                    const barDate = new Date(bar.t * 1000); // convert from seconds
                    return barDate.toDateString() === earningDate.toDateString();
                  });
                  if (matchingBar) {
                    earningsMarkers.push({
                      date: earning.date,
                      label: matchingBar.label,
                      epsActual: earning.eps,
                      epsEstimate: earning.estimatedEPS,
                      quarter: earning.quarter,
                    });
                  }
                }
                return earningsMarkers.map((marker, idx) => (
                  <ReferenceLine
                    key={`earnings-${idx}`}
                    x={marker.label}
                    yAxisId="right"
                    stroke="none"
                    label={{
                      value: 'E',
                      fill: '#ff9800',
                      fontSize: 8,
                      position: 'bottom',
                      offset: 5,
                    }}
                  />
                ));
              })()}

              {/* Bollinger Bands fill + lines */}
              {activeIndicators.has('BB') && (
                <>
                  <Area type="monotone" dataKey="bbUpper" yAxisId="right" stroke="none" fill="url(#idBBFill)" dot={false} activeDot={false} name="BB Upper" />
                  <Area type="monotone" dataKey="bbLower" yAxisId="right" stroke="none" fill="transparent" dot={false} activeDot={false} name="BB Lower" />
                  <Line type="monotone" dataKey="bbUpper" yAxisId="right" stroke={IND_COLORS.BB} strokeWidth={1} dot={false} strokeDasharray="4 2" name="BB Upper" />
                  <Line type="monotone" dataKey="bbLower" yAxisId="right" stroke={IND_COLORS.BB} strokeWidth={1} dot={false} strokeDasharray="4 2" name="BB Lower" />
                  <Line type="monotone" dataKey="bbMiddle" yAxisId="right" stroke={IND_COLORS.BB} strokeWidth={0.8} dot={false} strokeOpacity={0.4} name="BB Mid" />
                </>
              )}

              {/* Price: Area, Line (comparison mode), or Candlestick */}
              {showCandle ? (
                <>
                  <Area dataKey="close" yAxisId="right" stroke="none" fill="none" dot={false} activeDot={false} />
                  <Customized component={(props) => (
                    <CandlestickOverlay {...props} data={chartBars} />
                  )} />
                </>
              ) : isComparisonMode ? (
                <Line
                  type="monotone" dataKey="close" yAxisId="right" name={displayTicker(norm)}
                  stroke="#fff" strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3, fill: '#fff', strokeWidth: 0 }}
                />
              ) : (
                <Area
                  type="monotone" dataKey="close" yAxisId="right" name="Close"
                  stroke={isPos ? GREEN : RED} strokeWidth={1.5}
                  fill="url(#idGradFill)" dot={false}
                  activeDot={{ r: 3, fill: isPos ? GREEN : RED, strokeWidth: 0 }}
                />
              )}

              {/* SMA 20 overlay */}
              {activeIndicators.has('SMA20') && (
                <Line type="monotone" dataKey="sma20" yAxisId="right" stroke={IND_COLORS.SMA20} strokeWidth={1.2}
                  dot={false} name="SMA 20" connectNulls />
              )}

              {/* EMA 50 overlay */}
              {activeIndicators.has('EMA50') && (
                <Line type="monotone" dataKey="ema50" yAxisId="right" stroke={IND_COLORS.EMA50} strokeWidth={1.2}
                  dot={false} name="EMA 50" connectNulls />
              )}

              {/* Phase 4.8: Comparison Tickers */}
              {isComparisonMode && (
                <ReferenceLine y={100} yAxisId="right" stroke="#555" strokeDasharray="6 3" strokeWidth={1} />
              )}
              {isComparisonMode && comparisonTickers.map((compTicker, idx) => (
                <Line key={compTicker}
                  type="monotone" dataKey={`comp_${compTicker}`}
                  yAxisId="right"
                  stroke={Object.values(COMPARISON_COLORS)[idx]}
                  strokeWidth={1.5}
                  dot={false} name={compTicker}
                  connectNulls
                />
              ))}

              {deltaInfo && (
                <Customized component={(chartProps) => (
                  <DeltaLineOverlay {...chartProps} bars={chartBars} deltaA={deltaA} deltaB={deltaB} deltaInfo={deltaInfo} />
                )} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Comparison stats table (Bloomberg COMP style) */}
        {isComparisonMode && (() => { try {
          const mainFirst = indicatorData.bars[0]?.close;
          const mainLast  = indicatorData.bars[indicatorData.bars.length - 1]?.close;
          const dayCount  = indicatorData.bars.length > 1 && indicatorData.bars[0]?.t && indicatorData.bars[indicatorData.bars.length - 1]?.t
            ? Math.max(1, Math.round((indicatorData.bars[indicatorData.bars.length - 1].t - indicatorData.bars[0].t) / 86400000))
            : range.days;
          const years = dayCount / 365.25;

          const buildRow = (label, color, firstP, lastP) => {
            if (!firstP || !lastP) return null;
            const pctChange = ((lastP - firstP) / firstP) * 100;
            const annEq = years > 0 ? (Math.pow(lastP / firstP, 1 / years) - 1) * 100 : pctChange;
            return { label, color, pctChange, annEq };
          };

          const mainRow = buildRow(displayTicker(norm), '#fff', mainFirst, mainLast);
          const compRows = comparisonTickers.map((ct, idx) => {
            const cb = comparisonData[ct] || [];
            const f = cb[0]?.close, l = cb[cb.length - 1]?.close;
            return buildRow(ct.startsWith('C:') ? ct.slice(2,5)+'/'+ct.slice(5) : ct.replace('.SA',''), Object.values(COMPARISON_COLORS)[idx], f, l);
          }).filter(Boolean);

          const allRows = [mainRow, ...compRows].filter(Boolean);
          if (!allRows.length) return null;

          // Difference = main pctChange - each comp pctChange
          return (
            <div className="id-comp-stats">
              <table className="id-comp-stats-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Security</th>
                    <th>Price Change</th>
                    <th>Difference</th>
                    <th>Annual Eq</th>
                  </tr>
                </thead>
                <tbody>
                  {allRows.map((row, i) => {
                    const diff = i === 0 ? null : row.pctChange - allRows[0].pctChange;
                    return (
                      <tr key={row.label}>
                        <td style={{ textAlign: 'left' }}>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, backgroundColor: row.color, marginRight: 6, verticalAlign: 'middle' }} />
                          {row.label}
                        </td>
                        <td style={{ color: row.pctChange >= 0 ? GREEN : RED }}>
                          {row.pctChange >= 0 ? '+' : ''}{row.pctChange.toFixed(2)}%
                        </td>
                        <td style={{ color: diff == null ? '#666' : diff >= 0 ? GREEN : RED }}>
                          {diff == null ? '—' : `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`}
                        </td>
                        <td style={{ color: row.annEq >= 0 ? GREEN : RED }}>
                          {row.annEq >= 0 ? '+' : ''}{row.annEq.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        } catch (err) { console.error('[CompStats]', err); return null; } })()}

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
              <Bar dataKey="volume" fill="var(--bg-active, #1a3352)" opacity={0.85} radius={[1, 1, 0, 0]} />
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

        {bondLoading && !bd && <div className="id-skeleton"><div className="id-skeleton-bar" style={{ width: '75%' }} /><div className="id-skeleton-bar" style={{ width: '60%' }} /></div>}
      </>
    );
  }

  // ── Bond Risk tab ────────────────────────────────────────────────────
  function renderBondRisk() {
    const bd = bondData;
    if (!bd && bondLoading) return <div className="id-skeleton"><div className="id-skeleton-bar" style={{ width: '80%' }} /><div className="id-skeleton-bar" style={{ width: '65%' }} /></div>;
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
    if (!bd && bondLoading) return <div className="id-skeleton"><div className="id-skeleton-bar" style={{ width: '80%' }} /><div className="id-skeleton-bar" style={{ width: '65%' }} /></div>;
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
            {(fundsData?.fiftyTwoWeekHigh ?? tdStatistics?.['52_week_high']) != null && <StatRow label="52W HIGH" value={fmt(fundsData?.fiftyTwoWeekHigh ?? tdStatistics?.['52_week_high'])} />}
            {(fundsData?.fiftyTwoWeekLow ?? tdStatistics?.['52_week_low']) != null && <StatRow label="52W LOW" value={fmt(fundsData?.fiftyTwoWeekLow ?? tdStatistics?.['52_week_low'])} />}
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
            {(fundsData?.fiftyTwoWeekHigh ?? tdStatistics?.['52_week_high']) != null && <StatRow label="52W HIGH" value={fmt(fundsData?.fiftyTwoWeekHigh ?? tdStatistics?.['52_week_high'])} />}
            {(fundsData?.fiftyTwoWeekLow ?? tdStatistics?.['52_week_low']) != null && <StatRow label="52W LOW" value={fmt(fundsData?.fiftyTwoWeekLow ?? tdStatistics?.['52_week_low'])} />}
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
              {(mktCap ?? tdStatistics?.market_capitalization) != null && <StatRow label="MKT CAP" value={fmt(mktCap ?? tdStatistics?.market_capitalization, 0)} />}
              {fundsData?.enterpriseValue != null && <StatRow label="EV" value={fmt(fundsData.enterpriseValue, 0)} />}
              {(fundsData?.peRatio ?? tdStatistics?.pe_ratio) != null && <StatRow label="P/E (TTM)" value={parseFloat(fundsData?.peRatio ?? tdStatistics?.pe_ratio).toFixed(1)+'x'} />}
              {fundsData?.forwardPE  != null && <StatRow label="P/E (FWD)"  value={fundsData.forwardPE.toFixed(1)+'x'} />}
              {fundsData?.pegRatio   != null && <StatRow label="PEG"        value={fundsData.pegRatio.toFixed(2)+'x'} />}
              {fundsData?.priceToBook != null && <StatRow label="P/B"       value={fundsData.priceToBook.toFixed(2)+'x'} />}
              {fundsData?.priceToSales != null && <StatRow label="P/S"      value={fundsData.priceToSales.toFixed(2)+'x'} />}
              {(fundsData?.eps ?? tdStatistics?.eps) != null && <StatRow label="EPS (TTM)" value={'$'+parseFloat(fundsData?.eps ?? tdStatistics?.eps).toFixed(2)} />}
              {fundsData?.forwardEps != null && <StatRow label="EPS (FWD)"  value={'$'+fundsData.forwardEps.toFixed(2)} />}
              {fundsData?.earningsDate && <StatRow label="EARNINGS" value={fundsData.earningsDate} color={ORANGE} />}
              {(fundsData?.beta ?? tdStatistics?.beta) != null && <StatRow label="BETA" value={parseFloat(fundsData?.beta ?? tdStatistics?.beta).toFixed(2)} />}
              {(fundsData?.dividendYield ?? tdStatistics?.dividend_yield) != null && <StatRow label="DIV YIELD" value={(parseFloat(fundsData?.dividendYield ?? tdStatistics?.dividend_yield)*100).toFixed(2)+'%'} color={GREEN} />}
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
                <div className="id-skeleton" style={{ padding: '8px 12px' }}><div className="id-skeleton-bar" style={{ width: '90%' }} /><div className="id-skeleton-bar" style={{ width: '70%' }} /><div className="id-skeleton-bar" style={{ width: '80%' }} /></div>
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
        {newsLoading && <div className="id-skeleton"><div className="id-skeleton-bar" style={{ width: '90%' }} /><div className="id-skeleton-bar" style={{ width: '75%' }} /><div className="id-skeleton-bar" style={{ width: '60%' }} /></div>}
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
    if (fundsLoading && !tdProfile) return <div className="id-skeleton"><div className="id-skeleton-bar" style={{ width: '90%' }} /><div className="id-skeleton-bar" style={{ width: '75%' }} /><div className="id-skeleton-bar" style={{ width: '85%' }} /><div className="id-skeleton-bar" style={{ width: '60%' }} /><div className="id-skeleton-bar" style={{ width: '70%' }} /></div>;

    // Merge: fundsData (Polygon/Finnhub) + tdProfile (Twelve Data) + tdStatistics
    const d = fundsData || {};
    const tp = tdProfile || {};
    const ts = tdStatistics || {};

    const hasSomething = fundsData || tdProfile || tdStatistics;
    if (!hasSomething) return <div className="id-error-msg">Fundamentals unavailable</div>;

    const fundItems = [
      { label: 'Name', value: d.name || tp.name },
      { label: 'Currency', value: d.currency || tp.currency },
      { label: 'Market Cap', value: (d.marketCap || ts.market_capitalization) ? fmt(d.marketCap || ts.market_capitalization, 0) : null },
      { label: 'Exchange', value: d.primaryExchange || tp.exchange },
      { label: 'List Date', value: d.listDate },
      { label: 'Sector', value: d.sector || tp.sector },
      { label: 'Industry', value: d.industry || tp.industry },
      { label: 'Employees', value: (d.employees || tp.employees) != null ? Number(d.employees || tp.employees).toLocaleString() : null },
      { label: 'CEO', value: tp.ceo },
      { label: 'Country', value: tp.country },
      { label: 'Type', value: tp.type },
    ].filter(item => item.value);

    const aboutText = d.description || tp.description;
    const webUrl = d.homepageUrl || tp.website;

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

        {/* Key Executives from Twelve Data */}
        {Array.isArray(tdExecutives) && tdExecutives.length > 0 && (
          <Section title="KEY EXECUTIVES">
            <table className="id-stat-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Title</th>
                </tr>
              </thead>
              <tbody>
                {tdExecutives.slice(0, 8).map((ex, i) => (
                  <tr key={i}>
                    <td className="val-primary">{ex.name}</td>
                    <td className="val-muted cell-truncate">{ex.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Institutional & Fund Holders from Twelve Data */}
        {tdHolders && (
          <>
            {Array.isArray(tdHolders.institutional) && tdHolders.institutional.length > 0 && (
              <Section title="TOP INSTITUTIONAL HOLDERS">
                <table className="id-stat-table">
                  <thead>
                    <tr>
                      <th>Holder</th>
                      <th className="text-right">Shares</th>
                      <th className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tdHolders.institutional.slice(0, 10).map((h, i) => (
                      <tr key={i}>
                        <td className="val-primary cell-truncate">
                          {h.entity_name || h.name}
                        </td>
                        <td className="val-mono">
                          {h.shares != null ? Number(h.shares).toLocaleString() : '—'}
                        </td>
                        <td className="val-mono val-info">
                          {h.value != null ? '$' + (h.value >= 1e9 ? (h.value/1e9).toFixed(1) + 'B' : h.value >= 1e6 ? (h.value/1e6).toFixed(0) + 'M' : Number(h.value).toLocaleString()) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            )}
            {Array.isArray(tdHolders.fund) && tdHolders.fund.length > 0 && (
              <Section title="TOP FUND HOLDERS">
                <table className="id-stat-table">
                  <thead>
                    <tr>
                      <th>Fund</th>
                      <th className="text-right">Shares</th>
                      <th className="text-right">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tdHolders.fund.slice(0, 10).map((h, i) => (
                      <tr key={i}>
                        <td className="val-primary cell-truncate">
                          {h.entity_name || h.name}
                        </td>
                        <td className="val-mono">
                          {h.shares != null ? Number(h.shares).toLocaleString() : '—'}
                        </td>
                        <td className="val-mono val-purple">
                          {h.weight != null ? (parseFloat(h.weight) * 100).toFixed(2) + '%' : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            )}
          </>
        )}

        {/* Earnings History from Twelve Data */}
        {tdEarnings && (Array.isArray(tdEarnings) ? tdEarnings : tdEarnings.earnings ? tdEarnings.earnings : []).length > 0 && (
          <Section title="EARNINGS HISTORY">
            <table className="id-stat-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="text-right">EPS Est.</th>
                  <th className="text-right">EPS Act.</th>
                  <th className="text-right">Surprise</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(tdEarnings) ? tdEarnings : tdEarnings.earnings || []).slice(0, 8).map((e, i) => {
                  const est = parseFloat(e.eps_estimate);
                  const act = parseFloat(e.eps_actual);
                  const surprise = (!isNaN(est) && !isNaN(act) && est !== 0) ? ((act - est) / Math.abs(est) * 100) : null;
                  return (
                    <tr key={i}>
                      <td className="val-muted">{e.date || e.report_date || '—'}</td>
                      <td className="val-mono">
                        {!isNaN(est) ? '$' + est.toFixed(2) : '—'}
                      </td>
                      <td className="val-mono val-bold">
                        {!isNaN(act) ? '$' + act.toFixed(2) : '—'}
                      </td>
                      <td className={`val-mono ${surprise != null ? (surprise >= 0 ? 'val-up' : 'val-down') : ''}`}>
                        {surprise != null ? (surprise >= 0 ? '+' : '') + surprise.toFixed(1) + '%' : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        )}

        {aboutText && (
          <Section title="ABOUT">
            {webUrl && (
              <a href={webUrl} target="_blank" rel="noopener noreferrer" className="id-about-link">
                {webUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
            <p className="id-about-text">{aboutText}</p>
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

  // ── Related Tickers sub-render (from same sector) ──────────────────────────
  const SECTOR_TICKER_MAP = useMemo(() => ({
    'Defence & Aerospace': ['LMT', 'RTX', 'BA', 'NOC', 'GD', 'BAESY', 'PLTR', 'RKLB', 'KTOS'],
    'Technology & AI': ['NVDA', 'MSFT', 'AAPL', 'GOOGL', 'META', 'AMZN', 'TSM', 'AMD', 'AVGO'],
    'Energy & Commodities': ['XOM', 'CVX', 'SHEL', 'COP', 'SLB', 'NEE', 'ENPH', 'FSLR'],
    'Brazil & EM': ['EWZ', 'MELI', 'NU', 'VALE', 'PETR4.SA', 'VALE3.SA', 'ITUB4.SA'],
    'Fixed Income': ['TLT', 'IEF', 'SHY', 'AGG', 'HYG', 'LQD', 'EMB', 'TIP'],
    'Global Macro': ['SPY', 'QQQ', 'DIA', 'IWM', 'GLD', 'USO', 'VIX'],
    'FX & Crypto': ['X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'MSTR', 'COIN'],
    'Crypto': ['X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'MSTR', 'COIN', 'IBIT'],
    'Asian Markets': ['BABA', 'TM', 'SONY', 'HDB', 'TSM', 'INFY', 'TCEHY'],
    'European Markets': ['SAP', 'AZN', 'NVO', 'SHEL', 'LVMUY', 'HSBC', 'TTE'],
    'Global Retail': ['AMZN', 'WMT', 'COST', 'TGT', 'HD', 'NKE', 'SBUX'],
  }), []);

  function renderRelatedTickers() {
    if (!sectorContext) return null;

    const sectorTickers = SECTOR_TICKER_MAP[sectorContext] || [];
    // Filter out current ticker
    const related = sectorTickers.filter(t => t !== norm && t !== disp).slice(0, 8);
    if (related.length === 0) return null;

    return (
      <Section title={`ALSO IN ${sectorContext.toUpperCase()}`}>
        <div className="id-related-strip">
          {related.map(ticker => (
            <RelatedTickerChip key={ticker} ticker={ticker} onOpen={openDetail} sectorContext={sectorContext} />
          ))}
        </div>
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
          <div style={{ fontSize: '0.75rem', color: 'var(--color-insight-unavailable)', padding: '8px 0' }}>
            AI insight unavailable
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

        {/* Quick Ask AI Chat Input */}
        {handleOpenChat && (
          <div className="id-ai-quick-ask">
            <input
              type="text"
              className="id-ai-quick-ask-input"
              placeholder={`Ask anything about ${disp}...`}
              value={quickAskInput}
              onChange={(e) => setQuickAskInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleQuickAsk();
                }
              }}
              maxLength={500}
            />
            <button
              className="id-ai-quick-ask-btn"
              onClick={handleQuickAsk}
              disabled={!quickAskInput.trim()}
              title="Open AI chat with your question"
            >
              {'\u2191'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── S4 Wave 3: Render Insider tab (transactions + dividends + splits) ────
  function renderInsider() {
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
    const fmtAmt = (n) => n == null ? '—' : '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

    const insiders = Array.isArray(insiderData) ? insiderData : [];
    const dividends = Array.isArray(dividendData) ? dividendData : [];
    const splits = Array.isArray(splitsData) ? splitsData : [];

    return (
      <div className="id-section-group">
        {/* Insider Transactions */}
        <div className="id-section-title id-section-title--purple">INSIDER TRANSACTIONS</div>
        {insiderLoading && <div className="id-skeleton"><div className="id-skeleton-bar" style={{ width: '85%' }} /><div className="id-skeleton-bar" style={{ width: '70%' }} /><div className="id-skeleton-bar" style={{ width: '55%' }} /></div>}
        {!insiderLoading && insiders.length === 0 && (
          <div className="id-section-title--no-data">No insider data available</div>
        )}
        {insiders.length > 0 && (
          <table className="id-stat-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Insider</th>
                <th>Type</th>
                <th className="text-right">Shares</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {insiders.slice(0, 15).map((tx, i) => {
                const isBuy = (tx.type || tx.transactionType || '').toLowerCase().includes('buy') ||
                              (tx.type || tx.transactionType || '').toLowerCase().includes('purchase');
                return (
                  <tr key={i}>
                    <td className="val-muted">{fmtDate(tx.date || tx.filingDate)}</td>
                    <td className="cell-truncate">
                      {tx.name || tx.ownerName || tx.insider || '—'}
                    </td>
                    <td className={`val-bold ${isBuy ? 'val-up' : 'val-down'}`}>
                      {(tx.type || tx.transactionType || '—').toUpperCase()}
                    </td>
                    <td className="val-mono">
                      {tx.shares != null ? Math.abs(tx.shares).toLocaleString() : '—'}
                    </td>
                    <td className={`val-mono ${isBuy ? 'val-up' : 'val-down'}`}>
                      {fmtAmt(tx.value || tx.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Dividends */}
        {dividends.length > 0 && (
          <>
            <div className="id-section-title id-section-title--up" style={{ marginTop: 12 }}>DIVIDEND HISTORY</div>
            <table className="id-stat-table">
              <thead>
                <tr>
                  <th>Ex Date</th>
                  <th className="text-right">Amount</th>
                  <th>Frequency</th>
                  <th>Pay Date</th>
                </tr>
              </thead>
              <tbody>
                {dividends.slice(0, 8).map((d, i) => (
                  <tr key={i}>
                    <td className="val-muted">{fmtDate(d.ex_dividend_date)}</td>
                    <td className="val-mono val-up">
                      ${d.cash_amount?.toFixed(4) ?? '—'}
                    </td>
                    <td>{d.frequency ?? '—'}</td>
                    <td className="val-muted">{fmtDate(d.pay_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Splits */}
        {splits.length > 0 && (
          <>
            <div className="id-section-title id-section-title--warn" style={{ marginTop: 12 }}>STOCK SPLITS</div>
            {splits.map((s, i) => (
              <div key={i} className="id-section-title--no-data" style={{ color: 'var(--text-secondary)' }}>
                <span className="val-muted">{fmtDate(s.execution_date)}</span>
                {' '}{s.split_from}:{s.split_to}
              </div>
            ))}
          </>
        )}

        {/* Polygon Financials summary */}
        {Array.isArray(polyFinancials) && polyFinancials.length > 0 && (
          <>
            <div className="id-section-title id-section-title--info" style={{ marginTop: 12 }}>ANNUAL FINANCIALS (POLYGON)</div>
            <table className="id-stat-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Net Inc.</th>
                  <th className="text-right">EPS</th>
                </tr>
              </thead>
              <tbody>
                {polyFinancials.slice(0, 4).map((f, i) => {
                  const inc = f.financials?.income_statement;
                  const rev = inc?.revenues?.value;
                  const net = inc?.net_income_loss?.value;
                  const eps = inc?.basic_earnings_per_share?.value ?? inc?.diluted_earnings_per_share?.value;
                  const fmtB = (n) => n == null ? '—' : (n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(0)}M` : `$${n.toFixed(0)}`);
                  return (
                    <tr key={i}>
                      <td className="val-muted">{f.fiscal_year || f.fiscal_period || '—'}</td>
                      <td className="val-mono">{fmtB(rev)}</td>
                      <td className={`val-mono ${net != null && net >= 0 ? 'val-up' : 'val-down'}`}>
                        {fmtB(net)}
                      </td>
                      <td className="val-mono">
                        {eps != null ? `$${eps.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
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

  // ── S5: Render Financial Statements (Income, Balance Sheet, Cash Flow) ──
  function renderFinancials() {
    if (!isStock) return <div className="id-info-msg">Financials only for stocks</div>;
    if (tdFinancialsLoading) return <div className="id-skeleton"><div className="id-skeleton-bar" style={{ width: '95%' }} /><div className="id-skeleton-bar" style={{ width: '80%' }} /><div className="id-skeleton-bar" style={{ width: '70%' }} /><div className="id-skeleton-bar" style={{ width: '85%' }} /></div>;
    if (!tdFinancials) return <div className="id-error-msg">Financial statements unavailable</div>;

    const fmtB = (n) => {
      if (n == null || isNaN(n)) return '—';
      const v = parseFloat(n);
      if (Math.abs(v) >= 1e12) return '$' + (v/1e12).toFixed(1) + 'T';
      if (Math.abs(v) >= 1e9)  return '$' + (v/1e9).toFixed(1) + 'B';
      if (Math.abs(v) >= 1e6)  return '$' + (v/1e6).toFixed(0) + 'M';
      if (Math.abs(v) >= 1e3)  return '$' + (v/1e3).toFixed(0) + 'K';
      return '$' + v.toFixed(0);
    };

    const colorClassMap = { '#4fc3f7': 'val-info', '#ce93d8': 'val-purple', '#66bb6a': 'val-up' };
    const renderFinTable = (title, color, data, rows) => {
      if (!data || !Array.isArray(data) || data.length === 0) return null;
      const periods = data.slice(0, 4);
      const labelClass = colorClassMap[color] || 'val-accent';
      return (
        <Section title={title}>
          <table className="id-stat-table">
            <thead>
              <tr>
                <th>Metric</th>
                {periods.map((p, i) => (
                  <th key={i} className="text-right">{p.fiscal_date || p.period || `Y${i+1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, key }) => (
                <tr key={key}>
                  <td className={labelClass} style={{ fontSize: 9 }}>{label}</td>
                  {periods.map((p, i) => {
                    const val = p[key];
                    const num = parseFloat(val);
                    return (
                      <td key={i} className={`val-mono ${!isNaN(num) && num < 0 ? 'val-down' : 'val-primary'}`}>
                        {fmtB(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      );
    };

    const incRows = [
      { label: 'Revenue', key: 'sales' },
      { label: 'Gross Profit', key: 'gross_profit' },
      { label: 'Operating Inc.', key: 'operating_income' },
      { label: 'Net Income', key: 'net_income' },
      { label: 'EBITDA', key: 'ebitda' },
      { label: 'EPS', key: 'eps' },
      { label: 'EPS Diluted', key: 'eps_diluted' },
    ];

    const bsRows = [
      { label: 'Total Assets', key: 'assets' },
      { label: 'Total Liabilities', key: 'liabilities' },
      { label: 'Equity', key: 'shareholders_equity' },
      { label: 'Cash & Equiv.', key: 'cash_and_equivalents' },
      { label: 'Total Debt', key: 'total_debt' },
      { label: 'Net Debt', key: 'net_debt' },
    ];

    const cfRows = [
      { label: 'Operating CF', key: 'operating_cashflow' },
      { label: 'Investing CF', key: 'investing_cashflow' },
      { label: 'Financing CF', key: 'financing_cashflow' },
      { label: 'Free Cash Flow', key: 'free_cashflow' },
      { label: 'CapEx', key: 'capital_expenditure' },
    ];

    return (
      <div className="id-section-group">
        {renderFinTable('INCOME STATEMENT', '#4fc3f7', tdFinancials.income_statement, incRows)}
        {renderFinTable('BALANCE SHEET', '#ce93d8', tdFinancials.balance_sheet, bsRows)}
        {renderFinTable('CASH FLOW', '#66bb6a', tdFinancials.cash_flow, cfRows)}
        {!tdFinancials.income_statement && !tdFinancials.balance_sheet && !tdFinancials.cash_flow && (
          <div className="id-error-msg">No financial statement data available for this ticker</div>
        )}
      </div>
    );
  }

  // ── RENDER ──────────────────────────────────────────────────────────────
  const mobileTabs = isBond
    ? ['STATS', 'RISK', 'CASH FLOWS', ...(desc ? ['ABOUT'] : [])]
    : isFX
    ? ['STATS', 'MACRO', 'NEWS', ...(desc ? ['ABOUT'] : [])]
    : ['STATS', 'FUND', 'AI', 'FIN', 'OPTIONS', 'INSIDER', 'NEWS', ...(desc ? ['ABOUT'] : [])];

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
    const shareText = [disp + ' \u2014 ' + formattedPrice, changeSign + formattedChange + ' (' + changeSign + formattedChangePct + ')', name, '', 'via Particle'].join('\n');
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
    if (handleOpenChat) handleOpenChat(norm);
  }, [handleOpenChat, norm]);

  // Step 4.2: Switch to another listing via context
  const onSwitchListing = useCallback((symbolKey) => {
    openDetail(symbolKey);
  }, [openDetail]);

  // ── DATA COVERAGE HEADER — matrix-driven ─────────────────────────────────
  const coverageInfo = useMemo(() => {
    const exchange = info?.primary_exchange || etfMeta?.exchange || '';
    return getDataTypeCoverage(norm, exchange, {
      hasLiveQuote: !!snap?.min?.c,
      hasSnapshot:  !!snap,
      hasBars:      bars.length > 0,
      chartLoading: loading,
      hasFundamentals: !!(fundsData || tdStatistics || tdProfile),
      fundsLoading: fundsLoading || tdFinancialsLoading,
      hasAI:        !!aiFunds,
      aiLoading:    aiFundsLoading,
      aiError:      !!aiFundsError,
    });
  }, [norm, info, etfMeta, snap, bars, loading, fundsData, tdStatistics, tdProfile,
      fundsLoading, tdFinancialsLoading, aiFunds, aiFundsLoading, aiFundsError]);

  // Legacy degraded detection (still used for amber warning)
  const degradedSources = useMemo(() => {
    if (loading) return [];
    const failed = [];
    if (bars.length === 0 && !loading) failed.push('chart');
    if (fundsError) failed.push('fundamentals');
    if (aiFundsError) failed.push('AI analysis');
    if (isStock && !snap && !info) failed.push('quote');
    return failed;
  }, [loading, bars, fundsError, aiFundsError, isStock, snap, info]);
  const isDegraded = degradedSources.length >= 2;

  return (
    <div
      className={asPage ? 'id-page' : 'id-overlay'}
      onMouseDown={asPage ? undefined : (e => { if (e.target === e.currentTarget) handleClose(); })}
    >
      {/* ── HERO PRICE BLOCK (hidden on mobile asPage to save space) ── */}
      <div className={`id-hero${asPage && isMobile ? ' id-hero--hidden' : ''}`}>
        <div className="id-hero-meta">
          <div>
            <div className="id-hero-ticker" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {logoUrl && <img src={logoUrl} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'contain', background: 'var(--bg-elevated)' }} onError={e => { e.target.style.display = 'none'; }} />}
              {disp}
            </div>
            <div className="id-hero-name">{name}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <div className="id-hero-badge">{heroExchange}{heroExchange && heroAssetClass ? ' \u00b7 ' : ''}{heroAssetClass}</div>
            {/* Desktop action buttons */}
            <div className="id-hero-actions">
              <button className="id-hero-action-btn" onClick={() => toggleWatchlist(disp)} aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}>{watched ? '\u2605' : '\u2606'} Watch</button>
              <button className="id-hero-action-btn" onClick={openPositionEditor} aria-label="Add to portfolio">+ Portfolio</button>
              <button className="id-hero-action-btn" onClick={openAlertCreator} aria-label="Create price alert">{String.fromCharCode(128276)} Alert</button>
              {handleOpenChat && <button className="id-hero-action-btn" onClick={sendToChat} aria-label="Send to chat">{String.fromCharCode(128172)} Chat</button>}
              <button className="id-hero-action-btn" onClick={handleShare} aria-label="Share ticker information">{String.fromCharCode(8599)} Share</button>
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

      {/* ── DATA COVERAGE HEADER ── */}
      <div className="id-coverage-bar">
        {[
          { key: 'QUOTE', ...coverageInfo.quote },
          { key: 'CHART', ...coverageInfo.chart },
          { key: 'FUNDAMENTALS', ...coverageInfo.fundamentals },
          { key: 'AI', ...coverageInfo.ai },
        ].map(b => (
          <span key={b.key} className="id-coverage-badge" style={{ background: b.bg, color: b.color, borderColor: `${b.color}33` }}>
            {b.key}: {b.label}
          </span>
        ))}
      </div>
      {/* ── ADR indicator banner ── */}
      {(() => {
        const nameLC = (name || '').toLowerCase();
        const exchUp = (heroExchange || '').toUpperCase();
        const grp = detectExchangeGroup(norm, heroExchange);
        const isADR = (nameLC.includes('adr') || nameLC.includes('depositary')) ||
          (!norm.includes('.') && ['NYSE','NASDAQ','OTC'].some(e => exchUp.includes(e)) &&
           !['US','ETF','FX','CRYPTO'].includes(grp));
        if (!isADR) return null;
        return (
          <div className="id-adr-banner">
            <strong>ADR</strong>
            <span>US-listed depositary receipt — quote data via US providers, local exchange data may differ</span>
          </div>
        );
      })()}
      {/* ── Degraded data banner (amber warning when 2+ sources fail) ── */}
      {isDegraded && (
        <div className="id-degraded-banner">
          <span className="icon">&#9888;</span>
          <span>Partial coverage — {degradedSources.join(', ')} unavailable for this instrument</span>
        </div>
      )}

      {/* ── HEADER ── */}
      <div className={`id-header${isMobile ? ' id-header--mobile' : ''}`}>

        {/* Close button */}
        <button
          ref={closeButtonRef}
          onClick={handleClose}
          title="Close (Esc)"
          className={`id-close${isMobile ? ' id-close--mobile' : ''}`}
          aria-label="Close detail view"
        ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>

        {/* Breadcrumb navigation for sector context */}
        {sectorContext && (
          <div className="id-breadcrumb">
            <button
              className="id-breadcrumb-link"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('particle:navigate-screen', {
                  detail: { screenId: sectorContext.toLowerCase().replace(/\s+/g, '-') }
                }));
                handleClose();
              }}
              title="Back to sector"
            >
              {sectorContext}
            </button>
            <span className="id-breadcrumb-sep">›</span>
            <span className="id-breadcrumb-current">{disp}</span>
          </div>
        )}

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
                <span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:'currentColor',marginRight:'4px',verticalAlign:'middle'}}/> {hovered.label}: {fmt(hovered.close)}
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

      {/* ── KEY METRICS STRIP (stocks only) ── */}
      {isStock && !isBond && !isFX && (
        <div className="id-metrics-strip">
          {(() => {
            const ts = tdStatistics || {};
            const fd = fundsData || {};
            const metricsItems = [
              { label: 'MKT CAP', value: (() => { const v = parseFloat(fd.marketCap || ts.market_capitalization); if (!v || isNaN(v)) return null; if (v >= 1e12) return '$' + (v/1e12).toFixed(1) + 'T'; if (v >= 1e9) return '$' + (v/1e9).toFixed(0) + 'B'; if (v >= 1e6) return '$' + (v/1e6).toFixed(0) + 'M'; return '$' + v.toFixed(0); })() },
              { label: 'P/E', value: (fd.peRatio ?? ts.pe_ratio) != null ? parseFloat(fd.peRatio ?? ts.pe_ratio).toFixed(1) + 'x' : null },
              { label: 'EPS', value: (fd.eps ?? ts.eps) != null ? '$' + parseFloat(fd.eps ?? ts.eps).toFixed(2) : null },
              { label: 'BETA', value: (fd.beta ?? ts.beta) != null ? parseFloat(fd.beta ?? ts.beta).toFixed(2) : null },
              { label: 'DIV', value: (fd.dividendYield ?? ts.dividend_yield) != null ? (parseFloat(fd.dividendYield ?? ts.dividend_yield) * 100).toFixed(2) + '%' : null, color: 'var(--semantic-up)' },
              { label: 'VOL', value: volume != null ? (volume >= 1e6 ? (volume/1e6).toFixed(1) + 'M' : volume >= 1e3 ? (volume/1e3).toFixed(0) + 'K' : volume.toFixed(0)) : null },
              { label: '52W H', value: (fd.fiftyTwoWeekHigh ?? ts['52_week_high']) != null ? fmt(fd.fiftyTwoWeekHigh ?? ts['52_week_high']) : null },
              { label: '52W L', value: (fd.fiftyTwoWeekLow ?? ts['52_week_low']) != null ? fmt(fd.fiftyTwoWeekLow ?? ts['52_week_low']) : null },
            ];
            const allMetrics = [
              { label: 'MKT CAP', value: (() => { const v = parseFloat(fd.marketCap || ts.market_capitalization); if (!v || isNaN(v)) return null; if (v >= 1e12) return '$' + (v/1e12).toFixed(1) + 'T'; if (v >= 1e9) return '$' + (v/1e9).toFixed(0) + 'B'; if (v >= 1e6) return '$' + (v/1e6).toFixed(0) + 'M'; return '$' + v.toFixed(0); })() },
              { label: 'P/E', value: (fd.peRatio ?? ts.pe_ratio) != null ? parseFloat(fd.peRatio ?? ts.pe_ratio).toFixed(1) + 'x' : null },
              { label: 'EPS', value: (fd.eps ?? ts.eps) != null ? '$' + parseFloat(fd.eps ?? ts.eps).toFixed(2) : null },
              { label: 'BETA', value: (fd.beta ?? ts.beta) != null ? parseFloat(fd.beta ?? ts.beta).toFixed(2) : null },
              { label: 'DIV', value: (fd.dividendYield ?? ts.dividend_yield) != null ? (parseFloat(fd.dividendYield ?? ts.dividend_yield) * 100).toFixed(2) + '%' : null, color: 'var(--semantic-up)' },
            ];
            if (allMetrics.length === 0) return null;
            return allMetrics.map(m => (
              <div key={m.label} className="id-metric-chip">
                <span className="id-metric-label">{m.label}</span>
                <span className="id-metric-value" style={m.color ? { color: m.color } : { color: m.value == null ? 'var(--text-faint)' : undefined }}>
                  {m.value ?? '—'}
                </span>
              </div>
            ));
          })()}
        </div>
      )}

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

            {/* Phase 4.8: Comparison button */}
            <button
              className={`id-range-btn id-range-btn--compare${comparisonTickers.length > 0 ? ' id-range-btn--active' : ''}`}
              onClick={() => setShowComparisonSearch(!showComparisonSearch)}
              title="Add comparison tickers"
            >+ Compare ({comparisonTickers.length}/4)</button>

            {/* Phase 4.9: Custom range button */}
            <button
              className={`id-range-btn id-range-btn--custom${showCustomRange ? ' id-range-btn--active' : ''}`}
              onClick={() => setShowCustomRange(!showCustomRange)}
              title="Select custom date range"
            >Custom ▾</button>

            {/* Phase 4.11: Set Alert button */}
            <button
              className={`id-range-btn id-range-btn--alert${showInlineAlert ? ' id-range-btn--active' : ''}`}
              onClick={() => setShowInlineAlert(!showInlineAlert)}
              title="Create price alert"
            >🔔 Set Alert ▾</button>

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

          {/* Phase 4.8: Comparison Search Panel */}
          {showComparisonSearch && (
            <div className="id-comparison-panel">
              <div className="id-comparison-header">
                <span>Add Comparison Tickers (Max 4)</span>
                <button onClick={() => setShowComparisonSearch(false)} style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', fontSize: 16 }} aria-label="Close comparison search"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
              </div>
              <input
                type="text"
                placeholder="Search ticker..."
                value={comparisonSearchHook.query}
                onChange={(e) => comparisonSearchHook.setQuery(e.target.value)}
                className="id-comparison-search-input"
              />
              {comparisonSearchHook.results.length > 0 && (
                <div className="id-comparison-results">
                  {comparisonSearchHook.results
                    .filter(r => r.symbolKey || r.symbol)
                    .slice(0, 8)
                    .map(result => {
                      const sym = result.symbolKey || result.symbol;
                      const badge = result.assetClass === 'etf' ? 'ETF'
                        : result.assetClass === 'forex' ? 'FX'
                        : result.assetClass === 'crypto' ? 'CRYPTO'
                        : result.assetClass === 'commodity' ? 'CMDTY'
                        : result.assetClass === 'fixed_income' ? 'BOND'
                        : result.isFutures ? 'FUTURES'
                        : '';
                      const exchange = result.exchange || result._exchangeGroup || '';
                      return (
                        <div key={sym} className="id-comparison-result-item"
                          onClick={() => addComparisonTicker(result)}>
                          <span className="id-comparison-result-symbol">{sym}</span>
                          {badge && <span className="id-comparison-result-badge">{badge}</span>}
                          <span className="id-comparison-result-name">{result.name}</span>
                          {exchange && <span className="id-comparison-result-exchange">{exchange}</span>}
                        </div>
                      );
                    })}
                </div>
              )}
              {comparisonTickers.length > 0 && (
                <div className="id-comparison-pills">
                  {comparisonTickers.map((ticker, idx) => (
                    <div key={ticker} className="id-comparison-pill" style={{ borderLeftColor: Object.values(COMPARISON_COLORS)[idx] }}>
                      <span>{ticker}</span>
                      <button onClick={() => removeComparisonTicker(ticker)} style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', marginLeft: '4px' }} aria-label={`Remove ${ticker} from comparison`}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Phase 4.9: Custom Date Range Panel */}
          {showCustomRange && (
            <div className="id-custom-range-panel">
              <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #444', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#fff' }}>CUSTOM DATE RANGE</h4>
                <button onClick={() => setShowCustomRange(false)} style={{ background: 'none', border: 'none', color: '#888', fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }} title="Close">&times;</button>
              </div>

              {/* Preset buttons */}
              <div style={{ marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                {['YTD', '1Y', '3Y', '5Y', 'MAX'].map(preset => (
                  <button
                    key={preset}
                    onClick={() => applyPresetRange(preset)}
                    style={{
                      padding: '6px 8px',
                      fontSize: 11,
                      fontWeight: 500,
                      backgroundColor: '#333',
                      color: '#aaa',
                      border: '1px solid #555',
                      borderRadius: 4,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.backgroundColor = '#444';
                      e.target.style.color = ORANGE;
                      e.target.style.borderColor = ORANGE;
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.backgroundColor = '#333';
                      e.target.style.color = '#aaa';
                      e.target.style.borderColor = '#555';
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 500, color: '#aaa' }}>FROM DATE</label>
                <input
                  type="date"
                  value={customRangeFrom}
                  onChange={(e) => setCustomRangeFrom(e.target.value)}
                  className="id-date-input"
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 500, color: '#aaa' }}>TO DATE</label>
                <input
                  type="date"
                  value={customRangeTo}
                  onChange={(e) => setCustomRangeTo(e.target.value)}
                  className="id-date-input"
                />
              </div>
              <button
                onClick={applyCustomRange}
                disabled={customRangeLoading}
                className="id-range-btn"
                style={{
                  width: '100%',
                  marginBottom: 8,
                  padding: '10px 12px',
                  backgroundColor: ORANGE,
                  color: '#1a1a1a',
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 4,
                  cursor: customRangeLoading ? 'not-allowed' : 'pointer',
                  opacity: customRangeLoading ? 0.6 : 1,
                  transition: 'opacity 0.2s',
                }}
              >{customRangeLoading ? 'Loading...' : 'Apply'}</button>
            </div>
          )}

          {/* Phase 4.11: Inline Price Alert Panel */}
          {showInlineAlert && (
            <div className="id-inline-alert-panel">
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>TARGET PRICE</label>
                <input
                  type="number"
                  value={inlineAlertPrice}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setInlineAlertPrice(e.target.value);
                    if (livePrice && !isNaN(val)) {
                      setInlineAlertDirection(val > livePrice ? 'above' : 'below');
                    }
                  }}
                  className="id-price-input"
                  step="0.01"
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>DIRECTION</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setInlineAlertDirection('above')}
                    className={`id-toggle-btn${inlineAlertDirection === 'above' ? ' id-toggle-btn--active' : ''}`}
                    style={{ flex: 1 }}
                  >Price Above</button>
                  <button
                    onClick={() => setInlineAlertDirection('below')}
                    className={`id-toggle-btn${inlineAlertDirection === 'below' ? ' id-toggle-btn--active' : ''}`}
                    style={{ flex: 1 }}
                  >Price Below</button>
                </div>
              </div>
              <button
                onClick={createInlineAlert}
                className="id-range-btn"
                style={{ width: '100%', background: 'var(--accent)' }}
              >Create Alert</button>
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
                <div className="id-tab-bar" role="tablist">
                  {tabList.map(t => (
                    <button key={t}
                      onClick={() => setDesktopTab(t)}
                      className={`id-tab${desktopTab === t ? ' id-tab--active' : ''}`}
                      role="tab"
                      aria-selected={desktopTab === t}
                      aria-label={`${t} tab`}
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
                {!isBond && !isFX && renderFinancials()}
                {!isBond && !isFX && renderInsider()}
                {!isBond && !isFX && renderNews()}
                {!isBond && !isFX && renderRelatedTickers()}
                {!isBond && !isFX && renderAbout()}
                {(isBond || isFX) && desktopTab === 'STATS' && renderAbout()}
              </div>
            </div>
          );
        })()}

        {/* BOTTOM: TABS (mobile) — Phase 4: scrollable pill strip */}
        {isMobile && (
          <div className="id-mobile-tabs">
            <div className="id-mobile-tab-scroll-wrap">
              <div className="id-tab-bar" role="tablist">
                {mobileTabs.map(t => (
                  <button key={t}
                    onClick={() => setActiveTab(t)}
                    className={`id-tab id-tab--mobile${activeTab === t ? ' id-tab--active' : ''}`}
                    role="tab"
                    aria-selected={activeTab === t}
                    aria-label={`${t} tab`}
                  >{t}</button>
                ))}
              </div>
            </div>
            <div className="id-mobile-tab-content">
              {activeTab === 'STATS'      && (isBond ? renderBondStats() : isFX ? renderStats() : isETF ? renderETFStats() : renderStats())}
              {activeTab === 'RISK'       && renderBondRisk()}
              {activeTab === 'CASH FLOWS' && renderCashFlows()}
              {activeTab === 'MACRO'      && renderFXMacro()}
              {activeTab === 'FUND'       && renderFundamentals()}
              {activeTab === 'AI'         && renderAIFundamentals()}
              {activeTab === 'FIN'        && renderFinancials()}
              {activeTab === 'INSIDER'    && renderInsider()}
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
        <button className="id-action-btn-bar" onClick={() => toggleWatchlist(disp)} aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}>{watched ? '\u2605' : '\u2606'} Watch</button>
        <button className="id-action-btn-bar id-action-btn-bar--primary" onClick={openPositionEditor} aria-label="Add to portfolio">+ Portfolio</button>
        <button className="id-action-btn-bar" onClick={openAlertCreator} aria-label="Create price alert">{String.fromCharCode(128276)} Alert</button>
        {handleOpenChat && <button className="id-action-btn-bar" onClick={sendToChat} aria-label="Send to chat">{String.fromCharCode(128172)} Chat</button>}
        <button className="id-action-btn-bar" onClick={handleShare} aria-label="Share ticker information">{String.fromCharCode(8599)} Share</button>
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

      {/* Link copied toast */}
      {copyToast && (
        <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', border: '1px solid var(--accent)', color: '#fff', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, zIndex: 99999, animation: 'fadeInUp 200ms ease-out' }}>
          Link copied!
        </div>
      )}
    </div>
  );
}
