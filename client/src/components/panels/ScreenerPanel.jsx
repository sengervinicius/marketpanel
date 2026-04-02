/**
 * ScreenerPanel.jsx — Fundamental Screener with AI Helper
 *
 * Phase 7: Filter by asset class, country, sector, price, market cap, volume.
 * AI helper converts natural-language queries into structured filters.
 */
import { useState, useCallback, useRef } from 'react';
import { apiFetch } from '../../utils/api';
import './ScreenerPanel.css';

const COUNTRIES  = ['US','BR','GB','EU','JP','AU','CA'];
const SECTORS    = ['Technology','Financial','Energy','Industrial','Consumer','Healthcare','Auto','Materials','Agriculture','Diversified'];
const ASSET_CLASSES = ['equity','etf'];

function fmtCompact(n) {
  if (n == null) return '--';
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (Math.abs(n) >= 1e9)  return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3)  return (n / 1e3).toFixed(0) + 'K';
  return n.toLocaleString();
}

function fmtPrice(n) {
  if (n == null) return '--';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ScreenerPanel({ onOpenDetail }) {
  // Filters
  const [assetClass, setAssetClass] = useState('');
  const [countries, setCountries]   = useState([]);
  const [sectors, setSectors]       = useState([]);
  const [minPrice, setMinPrice]     = useState('');
  const [maxPrice, setMaxPrice]     = useState('');
  const [minMcap, setMinMcap]       = useState('');
  const [maxMcap, setMaxMcap]       = useState('');
  const [minVol, setMinVol]         = useState('');
  const [maxVol, setMaxVol]         = useState('');

  // Results
  const [results, setResults]       = useState([]);
  const [resultCount, setResultCount] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);

  // AI helper
  const [aiQuery, setAiQuery]       = useState('');
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiExplanation, setAiExplanation] = useState('');
  const [aiError, setAiError]       = useState(null);

  const buildFilters = useCallback(() => {
    const f = {};
    if (assetClass) f.assetClass = assetClass;
    if (countries.length) f.country = countries;
    if (sectors.length) f.sector = sectors;
    if (minPrice !== '') f.minPrice = parseFloat(minPrice);
    if (maxPrice !== '') f.maxPrice = parseFloat(maxPrice);
    if (minMcap !== '') f.minMarketCap = parseFloat(minMcap);
    if (maxMcap !== '') f.maxMarketCap = parseFloat(maxMcap);
    if (minVol !== '') f.minVolume = parseFloat(minVol);
    if (maxVol !== '') f.maxVolume = parseFloat(maxVol);
    return f;
  }, [assetClass, countries, sectors, minPrice, maxPrice, minMcap, maxMcap, minVol, maxVol]);

  const runScreener = useCallback(async (overrideFilters) => {
    setLoading(true);
    setError(null);
    try {
      const filters = overrideFilters || buildFilters();
      const res = await apiFetch('/api/screener/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universe: 'GLOBAL_CORE', filters, limit: 200 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(data.results || []);
      setResultCount(data.count ?? 0);
    } catch (e) {
      setError(e.message || 'Screener request failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [buildFilters]);

  const resetFilters = () => {
    setAssetClass('');
    setCountries([]);
    setSectors([]);
    setMinPrice('');
    setMaxPrice('');
    setMinMcap('');
    setMaxMcap('');
    setMinVol('');
    setMaxVol('');
    setResults([]);
    setResultCount(null);
    setAiExplanation('');
    setAiError(null);
  };

  const askAI = useCallback(async () => {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    setAiError(null);
    setAiExplanation('');
    try {
      const res = await apiFetch('/api/search/screener-helper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: aiQuery.trim(), universe: 'GLOBAL_CORE' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'AI parse error');
      const f = data.filters || {};
      // Merge AI filters into state
      if (f.assetClass) setAssetClass(Array.isArray(f.assetClass) ? f.assetClass[0] : f.assetClass);
      if (f.country) setCountries(Array.isArray(f.country) ? f.country : [f.country]);
      if (f.sector) setSectors(Array.isArray(f.sector) ? f.sector : [f.sector]);
      if (f.minPrice != null) setMinPrice(String(f.minPrice));
      if (f.maxPrice != null) setMaxPrice(String(f.maxPrice));
      if (f.minMarketCap != null) setMinMcap(String(f.minMarketCap));
      if (f.maxMarketCap != null) setMaxMcap(String(f.maxMarketCap));
      if (f.minVolume != null) setMinVol(String(f.minVolume));
      if (f.maxVolume != null) setMaxVol(String(f.maxVolume));
      setAiExplanation(data.explanation || '');
      // Auto-run with the AI filters
      await runScreener(f);
    } catch (e) {
      setAiError('AI helper unavailable. Adjust filters manually.');
    } finally {
      setAiLoading(false);
    }
  }, [aiQuery, runScreener]);

  const toggleMulti = (arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  };

  return (
    <div className="scr-panel">
      {/* AI Helper */}
      <div className="scr-ai-bar">
        <input
          className="scr-ai-input"
          type="text"
          placeholder="Describe what you're looking for..."
          value={aiQuery}
          onChange={e => setAiQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && askAI()}
        />
        <button className="scr-ai-btn" onClick={askAI} disabled={aiLoading || !aiQuery.trim()}>
          {aiLoading ? 'THINKING...' : 'ASK AI'}
        </button>
      </div>
      {aiExplanation && <div className="scr-ai-explanation">{aiExplanation}</div>}
      {aiError && <div className="scr-ai-error">{aiError}</div>}

      {/* Filters */}
      <div className="scr-filters">
        <div className="scr-filter-group">
          <label className="scr-label">ASSET CLASS</label>
          <div className="scr-chips">
            {ASSET_CLASSES.map(ac => (
              <button key={ac}
                className={`scr-chip${assetClass === ac ? ' scr-chip--active' : ''}`}
                onClick={() => setAssetClass(assetClass === ac ? '' : ac)}
              >{ac.toUpperCase()}</button>
            ))}
          </div>
        </div>

        <div className="scr-filter-group">
          <label className="scr-label">COUNTRY</label>
          <div className="scr-chips">
            {COUNTRIES.map(c => (
              <button key={c}
                className={`scr-chip${countries.includes(c) ? ' scr-chip--active' : ''}`}
                onClick={() => toggleMulti(countries, setCountries, c)}
              >{c}</button>
            ))}
          </div>
        </div>

        <div className="scr-filter-group">
          <label className="scr-label">SECTOR</label>
          <div className="scr-chips">
            {SECTORS.map(s => (
              <button key={s}
                className={`scr-chip${sectors.includes(s) ? ' scr-chip--active' : ''}`}
                onClick={() => toggleMulti(sectors, setSectors, s)}
              >{s}</button>
            ))}
          </div>
        </div>

        <div className="scr-filter-row">
          <div className="scr-range">
            <label className="scr-label">PRICE (USD)</label>
            <div className="scr-range-inputs">
              <input type="number" placeholder="Min" value={minPrice} onChange={e => setMinPrice(e.target.value)} className="scr-input" />
              <span className="scr-range-sep">-</span>
              <input type="number" placeholder="Max" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} className="scr-input" />
            </div>
          </div>
          <div className="scr-range">
            <label className="scr-label">MARKET CAP (USD)</label>
            <div className="scr-range-inputs">
              <input type="number" placeholder="Min" value={minMcap} onChange={e => setMinMcap(e.target.value)} className="scr-input" />
              <span className="scr-range-sep">-</span>
              <input type="number" placeholder="Max" value={maxMcap} onChange={e => setMaxMcap(e.target.value)} className="scr-input" />
            </div>
          </div>
          <div className="scr-range">
            <label className="scr-label">VOLUME</label>
            <div className="scr-range-inputs">
              <input type="number" placeholder="Min" value={minVol} onChange={e => setMinVol(e.target.value)} className="scr-input" />
              <span className="scr-range-sep">-</span>
              <input type="number" placeholder="Max" value={maxVol} onChange={e => setMaxVol(e.target.value)} className="scr-input" />
            </div>
          </div>
        </div>

        <div className="scr-actions">
          <button className="scr-btn scr-btn--primary" onClick={() => runScreener()} disabled={loading}>
            {loading ? 'RUNNING...' : 'RUN SCREENER'}
          </button>
          <button className="scr-btn scr-btn--secondary" onClick={resetFilters}>RESET</button>
        </div>
      </div>

      {/* Results */}
      {error && <div className="scr-error">{error}</div>}

      {resultCount !== null && (
        <div className="scr-result-header">
          {resultCount} result{resultCount !== 1 ? 's' : ''}
        </div>
      )}

      {results.length > 0 && (
        <div className="scr-table-wrap">
          <table className="scr-table">
            <thead>
              <tr>
                <th className="scr-th">Symbol</th>
                <th className="scr-th">Name</th>
                <th className="scr-th">Country</th>
                <th className="scr-th">Sector</th>
                <th className="scr-th scr-th--right">Price</th>
                <th className="scr-th scr-th--right">Chg %</th>
                <th className="scr-th scr-th--right">Volume</th>
                <th className="scr-th scr-th--right">MCap</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => {
                const isUp = (r.changePct ?? 0) >= 0;
                return (
                  <tr key={r.symbol} className="scr-row"
                    onClick={() => onOpenDetail && onOpenDetail(r.symbol)}
                    style={{ cursor: onOpenDetail ? 'pointer' : 'default' }}
                  >
                    <td className="scr-td scr-td--symbol">{r.symbol.replace('.SA', '')}</td>
                    <td className="scr-td scr-td--name">{r.name}</td>
                    <td className="scr-td">{r.country}</td>
                    <td className="scr-td">{r.sector}</td>
                    <td className="scr-td scr-td--right scr-td--mono">{fmtPrice(r.price)}</td>
                    <td className={`scr-td scr-td--right scr-td--mono${isUp ? ' scr-td--up' : ' scr-td--down'}`}>
                      {r.changePct != null ? `${isUp ? '+' : ''}${r.changePct.toFixed(2)}%` : '--'}
                    </td>
                    <td className="scr-td scr-td--right scr-td--mono">{fmtCompact(r.volume)}</td>
                    <td className="scr-td scr-td--right scr-td--mono">{fmtCompact(r.marketCap)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {resultCount === 0 && !loading && (
        <div className="scr-empty">No instruments match these filters. Try broadening your criteria.</div>
      )}
    </div>
  );
}
