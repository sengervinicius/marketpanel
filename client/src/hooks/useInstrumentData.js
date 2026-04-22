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
  const rawNorm = normalizeTicker(ticker);

  // #219 — user types a brand-name ticker (JUMBO.AT) that isn't what
  // Yahoo actually lists the company under (Jumbo S.A. trades as BELA.AT
  // on Athens). The chart endpoint 404s and the whole page reads as
  // "UNAVAILABLE" despite #215 routing .AT → EUROPE correctly. Under
  // the hood we ask the server's /symbol/resolve once, and if it comes
  // back with a better match we swap `norm` over to the resolved
  // ticker so every downstream fetch runs against the tradeable symbol.
  const [resolvedNorm, setResolvedNorm] = useState(null);
  const [resolution, setResolution]     = useState(null);

  // Any time the caller swaps to a different raw ticker, throw away the
  // previous resolution so we don't accidentally pin BELA.AT onto a
  // brand-new unrelated symbol.
  useEffect(() => {
    setResolvedNorm(null);
    setResolution(null);
  }, [rawNorm]);

  const norm = resolvedNorm || rawNorm;
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

  // S4 Wave 3: Insider transactions, dividends, splits (Eulerpool + Polygon)
  const [insiderData, setInsiderData]       = useState(null);
  const [insiderLoading, setInsiderLoading] = useState(false);
  const [dividendData, setDividendData]     = useState(null);
  const [dividendLoading, setDividendLoading] = useState(false);
  const [splitsData, setSplitsData]         = useState(null);
  const [polyFinancials, setPolyFinancials] = useState(null);

  // S4.6: Company logo from Twelve Data
  const [logoUrl, setLogoUrl]               = useState(null);

  // S5: Twelve Data deep fundamentals
  const [tdProfile, setTdProfile]           = useState(null);
  const [tdStatistics, setTdStatistics]     = useState(null);
  const [tdFinancials, setTdFinancials]     = useState(null);
  const [tdFinancialsLoading, setTdFinancialsLoading] = useState(false);
  const [tdHolders, setTdHolders]           = useState(null);
  const [tdHoldersLoading, setTdHoldersLoading] = useState(false);
  const [tdExecutives, setTdExecutives]     = useState(null);
  const [tdEarnings, setTdEarnings]         = useState(null);

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

        // #219 — empty bars on a foreign-suffix ticker strongly suggests
        // we're trying to fetch a brand name (e.g. JUMBO.AT) instead of
        // the actual exchange code (BELA.AT). Ask the server resolver
        // once; if it returns a better match, swap `norm` over and let
        // the effect chain re-fire against the tradeable ticker.
        if (results.length === 0 && !resolvedNorm) {
          const hasForeignSuffix = /\.[A-Z]{1,5}$/.test(rawNorm)
            && !rawNorm.startsWith('C:') && !rawNorm.startsWith('X:');
          if (hasForeignSuffix) {
            apiFetch(`/api/symbol/resolve?q=${encodeURIComponent(rawNorm)}`)
              .then(rr => rr.ok ? rr.json() : null)
              .then(rd => {
                if (stale || !rd || !rd.resolved || rd.resolved === rawNorm) return;
                setResolvedNorm(rd.resolved);
                setResolution({
                  from: rawNorm,
                  to:   rd.resolved,
                  name: rd.name || null,
                  exchange: rd.exchange || null,
                });
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [norm, rangeIdx, rawNorm, resolvedNorm]);

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

  // ── S4 Wave 3: Fetch insider, dividends, splits, Polygon financials ────
  useEffect(() => {
    if (!isStock || !norm) return;
    let stale = false;

    // Insider transactions (Eulerpool)
    setInsiderLoading(true);
    apiFetch(`/api/market/insider/${encodeURIComponent(norm)}?limit=15`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.data) setInsiderData(d.data); })
      .catch(() => {})
      .finally(() => { if (!stale) setInsiderLoading(false); });

    // Dividends (Polygon)
    apiFetch(`/api/market/dividends/${encodeURIComponent(norm)}?limit=12`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.data) setDividendData(d.data); })
      .catch(() => {});

    // Splits (Polygon)
    apiFetch(`/api/market/splits/${encodeURIComponent(norm)}?limit=10`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.data) setSplitsData(d.data); })
      .catch(() => {});

    // Polygon financials
    apiFetch(`/api/market/financials/${encodeURIComponent(norm)}?limit=4&timeframe=annual`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.data) setPolyFinancials(d.data); })
      .catch(() => {});

    // Company logo (Twelve Data)
    apiFetch(`/api/market/td/logo/${encodeURIComponent(norm)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.url) setLogoUrl(d.url); })
      .catch(() => {});

    // S5: Twelve Data profile (sector, industry, description, CEO, website)
    apiFetch(`/api/market/td/profile/${encodeURIComponent(norm)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.data) setTdProfile(d.data); })
      .catch(() => {});

    // S5: Twelve Data statistics (PE, EPS, beta, market cap, 52w range)
    apiFetch(`/api/market/td/statistics/${encodeURIComponent(norm)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.data) setTdStatistics(d.data); })
      .catch(() => {});

    // S5: Twelve Data earnings history
    apiFetch(`/api/market/td/earnings/${encodeURIComponent(norm)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.data) setTdEarnings(d.data); })
      .catch(() => {});

    // S5: Twelve Data executives
    apiFetch(`/api/market/td/executives/${encodeURIComponent(norm)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.data) setTdExecutives(d.data); })
      .catch(() => {});

    // S5: Twelve Data holders (institutional + fund)
    setTdHoldersLoading(true);
    apiFetch(`/api/market/td/holders/${encodeURIComponent(norm)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.data) setTdHolders(d.data); })
      .catch(() => {})
      .finally(() => { if (!stale) setTdHoldersLoading(false); });

    // S5: Twelve Data financials (income, balance sheet, cash flow)
    setTdFinancialsLoading(true);
    apiFetch(`/api/market/td/financials/${encodeURIComponent(norm)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!stale && d?.data) setTdFinancials(d.data); })
      .catch(() => {})
      .finally(() => { if (!stale) setTdFinancialsLoading(false); });

    return () => { stale = true; };
  }, [norm, isStock]);

  return {
    // Ticker info
    norm,
    disp,
    // #219 — non-null when we swapped to a Yahoo-tradeable ticker
    // (e.g. user typed JUMBO.AT, this resolves to BELA.AT). The detail
    // component renders a small banner explaining the remap.
    resolution,
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

    // S4 Wave 3: Enhanced data
    insiderData,
    insiderLoading,
    dividendData,
    dividendLoading,
    splitsData,
    polyFinancials,
    logoUrl,

    // S5: Twelve Data deep fundamentals
    tdProfile,
    tdStatistics,
    tdFinancials,
    tdFinancialsLoading,
    tdHolders,
    tdHoldersLoading,
    tdExecutives,
    tdEarnings,
  };
}
