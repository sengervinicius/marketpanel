import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { apiFetch } from '../utils/api';
import {
  normalizeTicker, displayTicker, getFromDate, fmtLabel,
  RANGES,
} from '../components/common/InstrumentDetailHelpers';

const FX_CCY_MAP = { USD:'US', EUR:'EU', GBP:'GB', JPY:'JP', BRL:'BR', CNY:'CN', MXN:'MX', AUD:'AU', CAD:'CA', CHF:'CH' };

/**
 * useInstrumentData — extracts the data-fetching chain from InstrumentDetail.
 *
 * Owns: bars, snapshot, info, fundamentals, news, AI fundamentals, bond data,
 * macro data, ETF metadata, other listings.
 *
 * Handles race conditions via stale-closure checks.
 */
export function useInstrumentData(ticker) {
  const norm = normalizeTicker(ticker);
  const disp = displayTicker(norm);

  // Asset class flags
  const isFX         = norm.startsWith('C:');
  const isCrypto     = norm.startsWith('X:');
  const isBrazil     = norm.endsWith('.SA');
  const isBondTicker = /^(US|DE|GB|JP|BR)\d+Y$/i.test(norm);
  const isStock      = !isFX && !isCrypto && !isBondTicker;

  // Chart state
  const [rangeIdx, setRangeIdx]   = useState(0);
  const [bars, setBars]           = useState([]);
  const [loading, setLoading]     = useState(true);

  // Snapshot & reference
  const [snap, setSnap]           = useState(null);
  const [info, setInfo]           = useState(null);

  // Fundamentals
  const [fundsData, setFundsData]       = useState(null);
  const [fundsLoading, setFundsLoading] = useState(false);
  const [fundsError, setFundsError]     = useState(false);

  // ETF metadata + listings
  const [etfMeta, setEtfMeta]                     = useState(null);
  const [otherListings, setOtherListings]         = useState([]);
  const [instrumentCompanyId, setInstrumentCompanyId] = useState(null);

  // Bond data
  const [bondData, setBondData]       = useState(null);
  const [bondLoading, setBondLoading] = useState(false);

  // Macro (FX)
  const [macroData, setMacroData] = useState(null);

  // News
  const [news, setNews]             = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);

  // AI Fundamentals
  const [aiFunds, setAiFunds]             = useState(null);
  const [aiFundsLoading, setAiFundsLoading] = useState(false);
  const [aiFundsError, setAiFundsError]     = useState(null);
  const aiFundsCacheRef = useRef({});

  const range = RANGES[rangeIdx];

  // Derived
  const isBond = isBondTicker || etfMeta?.assetClass === 'fixed_income';
  const isETF  = etfMeta?.assetClass === 'etf';

  // ── Fetch bars ────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setBars([]);
    const from = getFromDate(range);
    const to = new Date().toISOString().split('T')[0];
    let stale = false;
    apiFetch(
      `/api/chart/${encodeURIComponent(norm)}` +
      `?multiplier=${range.multiplier}&timespan=${range.timespan}&from=${from}&to=${to}`
    )
      .then(r => r.json())
      .then(d => {
        if (stale) return;
        const results = Array.isArray(d.results) ? d.results : (Array.isArray(d) ? d : []);
        setBars(results.map(b => ({
          t: b.t, label: fmtLabel(b.t, range.timespan),
          open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0,
        })));
        setLoading(false);
      })
      .catch(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [norm, rangeIdx]);

  // ── Fetch snapshot ────────────────────────────────────────────────────
  useEffect(() => {
    let stale = false;
    apiFetch(`/api/snapshot/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.json())
      .then(d => { if (!stale) setSnap(d?.ticker ?? d); })
      .catch(() => {});
    return () => { stale = true; };
  }, [norm]);

  // ── Fetch reference info (stocks only) ────────────────────────────────
  useEffect(() => {
    if (isFX || isCrypto) return;
    let stale = false;
    apiFetch(`/api/ticker/${encodeURIComponent(norm)}`)
      .then(r => r.json())
      .then(d => { if (!stale) setInfo(d?.results ?? d); })
      .catch(() => {});
    return () => { stale = true; };
  }, [norm, isFX, isCrypto]);

  // ── Fetch fundamentals ────────────────────────────────────────────────
  useEffect(() => {
    if (!isStock || isBondTicker) return;
    setFundsData(null);
    setFundsError(false);
    setFundsLoading(true);
    let stale = false;
    apiFetch('/api/fundamentals/' + encodeURIComponent(norm))
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(d => {
        if (stale) return;
        if (d && !d.error) setFundsData(d);
        else setFundsError(true);
        setFundsLoading(false);
      })
      .catch(() => { if (!stale) { setFundsError(true); setFundsLoading(false); } });
    return () => { stale = true; };
  }, [norm, isStock, isBondTicker]);

  // ── Fetch ETF/instrument metadata + other listings ────────────────────
  useEffect(() => {
    setEtfMeta(null);
    setOtherListings([]);
    setInstrumentCompanyId(null);
    let stale = false;
    apiFetch(`/api/instruments/${encodeURIComponent(disp)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (stale || !d || d.error) return;
        setEtfMeta(d);
        if (d.companyId) {
          setInstrumentCompanyId(d.companyId);
          apiFetch(`/api/instruments/search?companyId=${encodeURIComponent(d.companyId)}&limit=20`)
            .then(r => r.json())
            .then(data => {
              if (!stale) {
                const others = (data.results || []).filter(item => item.symbolKey !== disp);
                setOtherListings(others);
              }
            })
            .catch(() => { if (!stale) setOtherListings([]); });
        }
      })
      .catch(() => {});
    return () => { stale = true; };
  }, [disp]);

  // ── Fetch bond data ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isBondTicker) return;
    setBondLoading(true);
    setBondData(null);
    let stale = false;
    apiFetch(`/api/debt/bond/${encodeURIComponent(norm)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale) { if (d && !d.error) setBondData(d); setBondLoading(false); } })
      .catch(() => { if (!stale) setBondLoading(false); });
    return () => { stale = true; };
  }, [norm, isBondTicker]);

  // ── Fetch macro data for FX pairs ─────────────────────────────────────
  useEffect(() => {
    if (!isFX) return;
    setMacroData(null);
    const raw = norm.replace(/^C:/, '');
    const base = raw.slice(0, 3);
    const quote = raw.slice(3);
    const baseCty = FX_CCY_MAP[base];
    const quoteCty = FX_CCY_MAP[quote];
    const countries = [baseCty, quoteCty].filter(Boolean);
    if (countries.length === 0) return;
    let stale = false;
    apiFetch(`/api/macro/compare?countries=${countries.join(',')}&indicators=policyRate,cpiYoY,gdpGrowthYoY,unemploymentRate,debtGDP`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.countries) setMacroData(d); })
      .catch(() => {});
    return () => { stale = true; };
  }, [norm, isFX]);

  // ── Fetch news ────────────────────────────────────────────────────────
  useEffect(() => {
    setNewsLoading(true);
    setNews([]);
    const newsTicker = norm.replace(/^[XCI]:/, '');
    let stale = false;
    apiFetch(`/api/news?ticker=${encodeURIComponent(newsTicker)}&limit=12`)
      .then(r => r.json())
      .then(d => { if (!stale) { setNews(d?.results || []); setNewsLoading(false); } })
      .catch(() => { if (!stale) setNewsLoading(false); });
    return () => { stale = true; };
  }, [norm]);

  // ── Fetch AI Fundamentals ─────────────────────────────────────────────
  useEffect(() => {
    if (aiFundsCacheRef.current[norm]) {
      setAiFunds(aiFundsCacheRef.current[norm]);
      setAiFundsLoading(false);
      setAiFundsError(null);
      return;
    }
    setAiFunds(null);
    setAiFundsError(null);
    setAiFundsLoading(true);
    let stale = false;
    apiFetch('/api/search/fundamentals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: norm }),
    })
      .then(r => { if (!r.ok) throw new Error(`AI error (${r.status})`); return r.json(); })
      .then(data => {
        if (stale) return;
        aiFundsCacheRef.current[norm] = data;
        setAiFunds(data);
        setAiFundsLoading(false);
      })
      .catch(err => {
        if (!stale) {
          setAiFundsError(err.message || 'AI fundamentals unavailable');
          setAiFundsLoading(false);
        }
      });
    return () => { stale = true; };
  }, [norm]);

  // ── Tab-triggered fundamentals refetch ────────────────────────────────
  const refetchFundamentals = useCallback(async () => {
    if (!isStock) return;
    setFundsLoading(true);
    setFundsError(false);
    try {
      const res = await apiFetch(`/api/fundamentals/${norm}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFundsData(data);
    } catch {
      setFundsError(true);
    } finally {
      setFundsLoading(false);
    }
  }, [norm, isStock]);

  return {
    // Ticker info
    norm,
    disp,
    isFX,
    isCrypto,
    isBrazil,
    isBondTicker,
    isStock,
    isBond,
    isETF,

    // Chart
    rangeIdx,
    setRangeIdx,
    bars,
    loading,
    range,

    // Snapshot & ref
    snap,
    info,

    // Fundamentals
    fundsData,
    fundsLoading,
    fundsError,
    refetchFundamentals,

    // ETF & listings
    etfMeta,
    otherListings,
    instrumentCompanyId,

    // Bond
    bondData,
    bondLoading,

    // Macro
    macroData,

    // News
    news,
    newsLoading,

    // AI Fundamentals
    aiFunds,
    aiFundsLoading,
    aiFundsError,
  };
}
