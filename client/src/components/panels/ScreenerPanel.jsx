/**
 * ScreenerPanel.jsx — Fundamental Screener with AI Helper
 *
 * Phase 7:  Filter by asset class, country, sector, price, market cap, volume.
 * Phase 19: Saved presets, screener alerts, bulk price alerts, watchlist add,
 *           gamification hooks.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { usePortfolio } from '../../context/PortfolioContext';
import './ScreenerPanel.css';

const COUNTRIES     = ['US','BR','GB','EU','JP','AU','CA'];
const SECTORS       = ['Technology','Financial','Energy','Industrial','Consumer','Healthcare','Auto','Materials','Agriculture','Diversified'];
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

// ── Mini-modal wrapper ───────────────────────────────────────────────────────
function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="scr-modal-overlay" onClick={onClose}>
      <div className="scr-modal" onClick={e => e.stopPropagation()}>
        <div className="scr-modal-header">
          <span className="scr-modal-title">{title}</span>
          <button className="scr-modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="scr-modal-body">{children}</div>
      </div>
    </div>
  );
}

export default function ScreenerPanel({ onOpenDetail }) {
  const { triggerGamificationEvent } = useAuth();
  const portfolio = usePortfolio() || {};

  // ── Filters ────────────────────────────────────────────────────────────────
  const [assetClass, setAssetClass] = useState('');
  const [countries, setCountries]   = useState([]);
  const [sectors, setSectors]       = useState([]);
  const [minPrice, setMinPrice]     = useState('');
  const [maxPrice, setMaxPrice]     = useState('');
  const [minMcap, setMinMcap]       = useState('');
  const [maxMcap, setMaxMcap]       = useState('');
  const [minVol, setMinVol]         = useState('');
  const [maxVol, setMaxVol]         = useState('');

  // ── Results ────────────────────────────────────────────────────────────────
  const [results, setResults]           = useState([]);
  const [resultCount, setResultCount]   = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [selectedRows, setSelectedRows] = useState(new Set());

  // ── AI helper ──────────────────────────────────────────────────────────────
  const [aiQuery, setAiQuery]           = useState('');
  const [aiLoading, setAiLoading]       = useState(false);
  const [aiExplanation, setAiExplanation] = useState('');
  const [aiError, setAiError]           = useState(null);

  // ── Presets ────────────────────────────────────────────────────────────────
  const [presets, setPresets]               = useState([]);
  const [activePresetId, setActivePresetId] = useState(null);
  const [presetName, setPresetName]         = useState('');
  const [showSavePreset, setShowSavePreset] = useState(false);
  const presetsLoaded = useRef(false);

  // ── Modals ─────────────────────────────────────────────────────────────────
  const [showScreenerAlert, setShowScreenerAlert] = useState(false);
  const [screenerAlertMode, setScreenerAlertMode] = useState('new_match');
  const [showBulkAlert, setShowBulkAlert]         = useState(false);
  const [bulkAlertType, setBulkAlertType]         = useState('price_above');
  const [bulkAlertPct, setBulkAlertPct]           = useState('5');
  const [showAddToPortfolio, setShowAddToPortfolio] = useState(false);
  const [bulkStatus, setBulkStatus]               = useState(null);

  // ── Load presets on mount ──────────────────────────────────────────────────
  useEffect(() => {
    if (presetsLoaded.current) return;
    presetsLoaded.current = true;
    apiFetch('/api/screener/presets')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.ok) {
          setPresets(data.data || []);
          // Auto-load favorite preset
          const fav = (data.data || []).find(p => p.favorite);
          if (fav) loadPreset(fav);
        }
      })
      .catch(() => {});
  }, []);

  // ── Filter helpers ─────────────────────────────────────────────────────────
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

  const applyFiltersToState = useCallback((f) => {
    if (f.assetClass) setAssetClass(Array.isArray(f.assetClass) ? f.assetClass[0] : f.assetClass);
    if (f.country) setCountries(Array.isArray(f.country) ? f.country : [f.country]);
    if (f.sector) setSectors(Array.isArray(f.sector) ? f.sector : [f.sector]);
    if (f.minPrice != null) setMinPrice(String(f.minPrice));
    if (f.maxPrice != null) setMaxPrice(String(f.maxPrice));
    if (f.minMarketCap != null) setMinMcap(String(f.minMarketCap));
    if (f.maxMarketCap != null) setMaxMcap(String(f.maxMarketCap));
    if (f.minVolume != null) setMinVol(String(f.minVolume));
    if (f.maxVolume != null) setMaxVol(String(f.maxVolume));
  }, []);

  // ── Run screener ───────────────────────────────────────────────────────────
  const runScreener = useCallback(async (overrideFilters) => {
    setLoading(true);
    setError(null);
    setSelectedRows(new Set());
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
      triggerGamificationEvent('screener_run');
    } catch (e) {
      setError(e.message || 'Screener request failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [buildFilters, triggerGamificationEvent]);

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
    setActivePresetId(null);
    setSelectedRows(new Set());
  };

  // ── AI helper ──────────────────────────────────────────────────────────────
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
      applyFiltersToState(f);
      setAiExplanation(data.explanation || '');
      await runScreener(f);
      triggerGamificationEvent('screener_ai_helper');
    } catch (e) {
      setAiError('AI helper unavailable. Adjust filters manually.');
    } finally {
      setAiLoading(false);
    }
  }, [aiQuery, runScreener, applyFiltersToState, triggerGamificationEvent]);

  const toggleMulti = (arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  };

  // ── Preset management ──────────────────────────────────────────────────────
  const loadPreset = useCallback((preset) => {
    setActivePresetId(preset.id);
    resetFilters();
    if (preset.filters) {
      applyFiltersToState(preset.filters);
      runScreener(preset.filters);
    }
  }, [applyFiltersToState, runScreener]);

  const savePreset = async () => {
    if (!presetName.trim()) return;
    const filters = buildFilters();
    try {
      const res = await apiFetch('/api/screener/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: presetName.trim(), filters }),
      });
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      if (data.ok) {
        setPresets(prev => [...prev, data.data]);
        setActivePresetId(data.data.id);
        setShowSavePreset(false);
        setPresetName('');
        triggerGamificationEvent('screener_save_preset');
      }
    } catch { /* silent */ }
  };

  const updatePreset = async () => {
    if (!activePresetId) return;
    const filters = buildFilters();
    try {
      const res = await apiFetch(`/api/screener/presets/${activePresetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        setPresets(prev => prev.map(p => p.id === activePresetId ? data.data : p));
      }
    } catch { /* silent */ }
  };

  const deletePreset = async (id) => {
    try {
      const res = await apiFetch(`/api/screener/presets/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      setPresets(prev => prev.filter(p => p.id !== id));
      if (activePresetId === id) setActivePresetId(null);
    } catch { /* silent */ }
  };

  const toggleFavorite = async (id) => {
    try {
      const res = await apiFetch(`/api/screener/presets/${id}/fav`, { method: 'PATCH' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        setPresets(prev => prev.map(p => p.id === id ? data.data : p));
      }
    } catch { /* silent */ }
  };

  // ── Row selection ──────────────────────────────────────────────────────────
  const toggleRow = (sym) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  };

  const toggleAllRows = () => {
    if (selectedRows.size === results.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(results.map(r => r.symbol)));
    }
  };

  const selectedSymbols = [...selectedRows];

  // ── Screener alert creation ────────────────────────────────────────────────
  const createScreenerAlert = async () => {
    const filters = buildFilters();
    try {
      const res = await apiFetch('/api/alerts/screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenerUniverse: 'GLOBAL_CORE',
          screenerFilters: filters,
          matchMode: screenerAlertMode,
          note: `Screener alert (${screenerAlertMode})`,
        }),
      });
      if (!res.ok) throw new Error('Create failed');
      setShowScreenerAlert(false);
      triggerGamificationEvent('screener_alert_created');
      setBulkStatus({ type: 'success', msg: 'Screener alert created!' });
      setTimeout(() => setBulkStatus(null), 3000);
    } catch {
      setBulkStatus({ type: 'error', msg: 'Failed to create screener alert' });
      setTimeout(() => setBulkStatus(null), 3000);
    }
  };

  // ── Bulk price alerts ──────────────────────────────────────────────────────
  const createBulkAlerts = async () => {
    if (selectedSymbols.length === 0) return;
    const pct = parseFloat(bulkAlertPct);
    if (!pct || pct <= 0) return;
    try {
      const res = await apiFetch('/api/alerts/bulk-from-screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: selectedSymbols,
          type: bulkAlertType,
          pctOffset: pct,
        }),
      });
      if (!res.ok) throw new Error('Bulk create failed');
      const data = await res.json();
      setShowBulkAlert(false);
      triggerGamificationEvent('screener_bulk_alerts');
      setBulkStatus({ type: 'success', msg: `${data.created} alert(s) created${data.skipped ? `, ${data.skipped} skipped` : ''}` });
      setTimeout(() => setBulkStatus(null), 4000);
    } catch {
      setBulkStatus({ type: 'error', msg: 'Failed to create bulk alerts' });
      setTimeout(() => setBulkStatus(null), 3000);
    }
  };

  // ── Bulk add to portfolio ──────────────────────────────────────────────────
  const addToPortfolio = async (subportfolioId) => {
    if (selectedSymbols.length === 0 || !portfolio) return;
    try {
      for (const sym of selectedSymbols) {
        portfolio.addPosition({
          symbol: sym,
          quantity: 0,
          entryPrice: 0,
          investedAmount: 0,
          currency: 'USD',
          portfolioId: portfolio.portfolios?.[0]?.id,
          subportfolioId: subportfolioId || portfolio.portfolios?.[0]?.subportfolios?.[0]?.id,
          note: 'Added from screener',
        });
      }
      setShowAddToPortfolio(false);
      triggerGamificationEvent('screener_add_to_watchlist');
      setBulkStatus({ type: 'success', msg: `${selectedSymbols.length} symbol(s) added to portfolio` });
      setTimeout(() => setBulkStatus(null), 3000);
    } catch {
      setBulkStatus({ type: 'error', msg: 'Failed to add to portfolio' });
      setTimeout(() => setBulkStatus(null), 3000);
    }
  };

  // Derive subportfolios list for the add-to-portfolio modal
  const allSubportfolios = (portfolio?.portfolios || []).flatMap(p =>
    (p.subportfolios || []).map(sp => ({ ...sp, portfolioName: p.name, portfolioId: p.id }))
  );

  return (
    <div className="scr-panel">
      {/* ── Preset bar ──────────────────────────────────────── */}
      {presets.length > 0 && (
        <div className="scr-preset-bar">
          <span className="scr-preset-label">PRESETS</span>
          <div className="scr-preset-pills">
            {presets.map(p => (
              <button
                key={p.id}
                className={`scr-preset-pill${activePresetId === p.id ? ' scr-preset-pill--active' : ''}`}
                onClick={() => loadPreset(p)}
                title={p.favorite ? 'Favorite' : ''}
              >
                {p.favorite && <span className="scr-preset-star">*</span>}
                {p.name}
              </button>
            ))}
          </div>
          {activePresetId && (
            <div className="scr-preset-actions">
              <button className="scr-preset-act" onClick={updatePreset} title="Update preset with current filters">UPD</button>
              <button className="scr-preset-act" onClick={() => toggleFavorite(activePresetId)} title="Toggle favorite">FAV</button>
              <button className="scr-preset-act scr-preset-act--del" onClick={() => deletePreset(activePresetId)} title="Delete preset">DEL</button>
            </div>
          )}
        </div>
      )}

      {/* ── AI Helper ───────────────────────────────────────── */}
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

      {/* ── Filters ─────────────────────────────────────────── */}
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
          <button className="scr-btn scr-btn--secondary" onClick={() => setShowSavePreset(true)} title="Save current filters as a preset">SAVE</button>
          <button className="scr-btn scr-btn--secondary" onClick={() => setShowScreenerAlert(true)} title="Create alert for this screener config">ALERT</button>
        </div>
      </div>

      {/* ── Save preset inline form ──────────────────────────── */}
      {showSavePreset && (
        <div className="scr-save-bar">
          <input
            className="scr-input scr-save-input"
            placeholder="Preset name..."
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && savePreset()}
            autoFocus
          />
          <button className="scr-btn scr-btn--primary scr-btn--sm" onClick={savePreset} disabled={!presetName.trim()}>SAVE</button>
          <button className="scr-btn scr-btn--secondary scr-btn--sm" onClick={() => setShowSavePreset(false)}>CANCEL</button>
        </div>
      )}

      {/* ── Bulk status toast ────────────────────────────────── */}
      {bulkStatus && (
        <div className={`scr-bulk-status scr-bulk-status--${bulkStatus.type}`}>{bulkStatus.msg}</div>
      )}

      {/* ── Results header + bulk actions ─────────────────────── */}
      {error && <div className="scr-error">{error}</div>}

      {resultCount !== null && (
        <div className="scr-result-bar">
          <span className="scr-result-header">{resultCount} result{resultCount !== 1 ? 's' : ''}</span>
          {results.length > 0 && (
            <div className="scr-bulk-actions">
              {selectedRows.size > 0 && (
                <>
                  <span className="scr-selected-count">{selectedRows.size} selected</span>
                  <button className="scr-bulk-btn" onClick={() => setShowBulkAlert(true)}>BULK ALERT</button>
                  <button className="scr-bulk-btn" onClick={() => setShowAddToPortfolio(true)}>ADD TO PORTFOLIO</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Results table ─────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="scr-table-wrap">
          <table className="scr-table">
            <thead>
              <tr>
                <th className="scr-th scr-th--check">
                  <input type="checkbox" checked={selectedRows.size === results.length && results.length > 0} onChange={toggleAllRows} />
                </th>
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
                  <tr key={r.symbol} className={`scr-row${selectedRows.has(r.symbol) ? ' scr-row--selected' : ''}`}>
                    <td className="scr-td scr-td--check">
                      <input type="checkbox" checked={selectedRows.has(r.symbol)} onChange={() => toggleRow(r.symbol)} />
                    </td>
                    <td className="scr-td scr-td--symbol"
                      onClick={() => onOpenDetail && onOpenDetail(r.symbol)}
                      style={{ cursor: onOpenDetail ? 'pointer' : 'default' }}
                    >{r.symbol.replace('.SA', '')}</td>
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

      {/* ── Screener Alert Modal ──────────────────────────────── */}
      <Modal open={showScreenerAlert} onClose={() => setShowScreenerAlert(false)} title="Create Screener Alert">
        <p className="scr-modal-desc">Get notified when screener results change based on your current filters.</p>
        <div className="scr-modal-radio-group">
          <label className="scr-modal-radio">
            <input type="radio" name="matchMode" value="new_match" checked={screenerAlertMode === 'new_match'} onChange={() => setScreenerAlertMode('new_match')} />
            <span>New matches</span>
            <small>Alert when new symbols appear in results</small>
          </label>
          <label className="scr-modal-radio">
            <input type="radio" name="matchMode" value="count_change" checked={screenerAlertMode === 'count_change'} onChange={() => setScreenerAlertMode('count_change')} />
            <span>Count change</span>
            <small>Alert when the number of results changes</small>
          </label>
        </div>
        <button className="scr-btn scr-btn--primary scr-modal-submit" onClick={createScreenerAlert}>CREATE ALERT</button>
      </Modal>

      {/* ── Bulk Price Alert Modal ────────────────────────────── */}
      <Modal open={showBulkAlert} onClose={() => setShowBulkAlert(false)} title="Bulk Price Alerts">
        <p className="scr-modal-desc">Create price alerts for {selectedSymbols.length} selected symbol(s).</p>
        <div className="scr-modal-field">
          <label className="scr-label">Alert type</label>
          <div className="scr-chips">
            <button className={`scr-chip${bulkAlertType === 'price_above' ? ' scr-chip--active' : ''}`} onClick={() => setBulkAlertType('price_above')}>ABOVE</button>
            <button className={`scr-chip${bulkAlertType === 'price_below' ? ' scr-chip--active' : ''}`} onClick={() => setBulkAlertType('price_below')}>BELOW</button>
          </div>
        </div>
        <div className="scr-modal-field">
          <label className="scr-label">% OFFSET FROM CURRENT PRICE</label>
          <input type="number" className="scr-input" value={bulkAlertPct} onChange={e => setBulkAlertPct(e.target.value)} min="0.1" step="0.5" />
        </div>
        <button className="scr-btn scr-btn--primary scr-modal-submit" onClick={createBulkAlerts} disabled={!selectedSymbols.length}>
          CREATE {selectedSymbols.length} ALERT(S)
        </button>
      </Modal>

      {/* ── Add to Portfolio Modal ────────────────────────────── */}
      <Modal open={showAddToPortfolio} onClose={() => setShowAddToPortfolio(false)} title="Add to Portfolio">
        <p className="scr-modal-desc">Add {selectedSymbols.length} symbol(s) to a subportfolio.</p>
        {allSubportfolios.length > 0 ? (
          <div className="scr-modal-list">
            {allSubportfolios.map(sp => (
              <button key={sp.id} className="scr-modal-list-item" onClick={() => addToPortfolio(sp.id)}>
                <span className="scr-modal-list-name">{sp.portfolioName} / {sp.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="scr-modal-desc" style={{ opacity: 0.6 }}>No subportfolios found. Create one in the Portfolio panel first.</p>
        )}
      </Modal>
    </div>
  );
}
