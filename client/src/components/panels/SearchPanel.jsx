import { useState, useRef, useCallback, memo } from 'react';
import { FOREX_PAIRS, CRYPTO_PAIRS } from '../../utils/constants';
import { useSettings } from '../../context/SettingsContext';
import { apiFetch } from '../../utils/api';
import './SearchPanel.css';

const ORANGE = '#ff6b00';
const GREEN  = '#4caf50';
const RED    = '#f44336';
const YELLOW = '#ffd54f';

const TYPE_COLOR = {
  EQUITY:     '#4fc3f7',
  ETF:        '#81c784',
  INDEX:      '#ffb74d',
  CURRENCY:   '#ce93d8',
  CRYPTO:     '#f48fb1',
  MUTUALFUND: '#80cbc4',
};

// ── Prominent asset type badge config ──
// Each search result gets a clearly visible badge showing what kind of security it is
const ASSET_TYPE_BADGE = {
  Equity:  { bg: '#001a2e', color: '#4fc3f7', label: 'EQUITY' },
  ETF:     { bg: '#0a2000', color: '#81c784', label: 'ETF' },
  Fund:    { bg: '#0a2a2a', color: '#80cbc4', label: 'FUND' },
  Crypto:  { bg: '#2a0020', color: '#f48fb1', label: 'CRYPTO' },
  FX:      { bg: '#1a0030', color: '#ce93d8', label: 'FX' },
  Index:   { bg: '#1a1400', color: '#ffb74d', label: 'INDEX' },
  Bond:    { bg: '#1a1a00', color: '#ffd54f', label: 'BOND' },
  ADR:     { bg: '#001a20', color: '#4dd0e1', label: 'ADR' },
  REIT:    { bg: '#0a1a00', color: '#aed581', label: 'REIT' },
  Warrant: { bg: '#2a1a00', color: '#ffcc80', label: 'WARRANT' },
  Option:  { bg: '#2a0a1a', color: '#ef9a9a', label: 'OPTION' },
  Future:  { bg: '#1a0a00', color: '#ff8a65', label: 'FUTURE' },
  OTC:     { bg: '#1a1a1a', color: '#999',    label: 'OTC' },
};

// Derive asset type from search result (client-side normalization)
function deriveAssetType(item) {
  // If server already sent an assetType, use it
  if (item.assetType && ASSET_TYPE_BADGE[item.assetType]) return item.assetType;

  const type = (item.type || '').toUpperCase();
  const ac   = (item.assetClass || '').toLowerCase();
  const sym  = (item.symbol || '').toUpperCase();

  if (item.local && type === 'CURRENCY') return 'FX';
  if (item.local && type === 'CRYPTO')   return 'Crypto';
  if (ac === 'etf'   || type === 'ETF')  return 'ETF';
  if (ac === 'forex' || type === 'CURRENCY') return 'FX';
  if (ac === 'crypto' || type === 'CRYPTO' || type === 'CRYPTOCURRENCY') return 'Crypto';
  if (ac === 'fixed_income' || type === 'BOND') return 'Bond';
  if (ac === 'commodity')    return 'ETF'; // commodity ETFs
  if (ac === 'index' || type === 'INDEX') return 'Index';
  if (ac === 'fund'  || type === 'MUTUALFUND') return 'Fund';
  if (type === 'ADR' || type === 'ADRC') return 'ADR';
  if (type === 'REIT') return 'REIT';
  if (type === 'WARRANT') return 'Warrant';
  if (sym.endsWith('.SA')) return 'Equity';
  if (type === 'CS' || type === 'EQUITY' || type === 'COMMONSTOCK' || type === 'PFD') return 'Equity';
  if (ac === 'equity') return 'Equity';
  return 'Equity';
}

const MARKET_BADGE = {
  BVSP: { bg: '#1a2800', color: '#8bc34a', label: 'B3'     },
  SAO:  { bg: '#1a2800', color: '#8bc34a', label: 'B3'     },
  NYQ:  { bg: '#001a2e', color: '#4fc3f7', label: 'NYSE'   },
  NMS:  { bg: '#001a2e', color: '#4fc3f7', label: 'NASDAQ' },
  PCX:  { bg: '#001a2e', color: '#4fc3f7', label: 'ARCA'   },
  ARCX: { bg: '#001a2e', color: '#4fc3f7', label: 'ARCA'   },
};

// Yahoo Finance exchange codes with confirmed live coverage in this terminal
const LIVE_EXCHANGES    = new Set(['NYQ', 'NMS', 'PCX', 'ARCX', 'NYE', 'ASE', 'BVSP', 'SAO']);
// OTC / sparse coverage
const LIMITED_EXCHANGES = new Set(['OTC', 'PNK', 'OTCM', 'GREY', 'OTCQX', 'OTCQB', 'PINK']);
// International exchanges we definitively DO NOT cover — show red "NO DATA"
const NO_DATA_EXCHANGES = new Set([
  'LSE','LON','L',        // London
  'TYO','TSE','T',        // Tokyo
  'HKG','HK',            // Hong Kong
  'SHH','SHZ',           // Shanghai/Shenzhen
  'BOM','NSE','NS','BO', // India
  'ASX','AX',            // Australia
  'FRA','ETR','F',       // Frankfurt
  'EPA','PA',            // Paris
  'AMS','AS',            // Amsterdam
  'BME','MC',            // Madrid
  'MIL','MI',            // Milan
  'STO','ST',            // Stockholm
  'CPH','CO',            // Copenhagen
  'OSL','OL',            // Oslo
  'HEL','HE',            // Helsinki
  'WSE','WAR',           // Warsaw
  'SGX','SI',            // Singapore
  'KRX','KS','KQ',       // Korea
]);

/**
 * coverageLevel — returns 'live' | 'limited' | 'none' | 'unknown'
 *
 * ── KEY FIX ──────────────────────────────────────────────────────────────────
 * Polygon's search API returns `market` as a GENERIC CATEGORY:
 *   'stocks' | 'otc' | 'crypto' | 'fx' | 'indices'
 * NOT an exchange code (NMS, NYQ, etc.).
 * Old code compared these lowercase category strings against LIVE_EXCHANGES
 * (uppercase Yahoo codes), causing every Polygon result — including AAPL, MSFT,
 * DEFT, etc. — to be wrongly flagged 'none' / "NO DATA".
 * ─────────────────────────────────────────────────────────────────────────────
 */
function coverageLevel(item) {
  if (!item) return 'unknown';

  // Our locally-defined FX/crypto pairs — always live
  if (item.local) return 'live';

  const type   = (item.type            || '').toUpperCase();
  const market = (item.market          || '').toLowerCase(); // Polygon: 'stocks','otc','crypto','fx'
  const exch   = (item.primaryExchange || item.market || '').toUpperCase(); // Yahoo: 'NMS','NYQ'

  // ── Type shortcuts ────────────────────────────────────────────────────
  if (type === 'CRYPTO' || type === 'CRYPTOCURRENCY') return 'live';
  if (type === 'CURRENCY')                            return 'live';
  if (type === 'MUTUALFUND')                          return 'limited';

  // ── Polygon generic CATEGORY strings (lowercase from Polygon API) ─────
  // These are not exchange codes — handle them before checking exchange sets
  if (market === 'stocks')  return 'live';    // all Polygon equity results
  if (market === 'crypto')  return 'live';
  if (market === 'fx' || market === 'forex') return 'live';
  if (market === 'otc')     return 'limited';
  if (market === 'indices') return 'limited';

  // ── Yahoo Finance exchange codes (uppercase 2–5 chars) ────────────────
  if (LIVE_EXCHANGES.has(exch))    return 'live';
  if (LIMITED_EXCHANGES.has(exch)) return 'limited';
  if (NO_DATA_EXCHANGES.has(exch)) return 'none';

  // Well-known international ticker suffixes
  const sym = (item.symbol || '').toUpperCase();
  if (/\.(L|T|HK|AX|TO|NS|BO|PA|DE|MI|AS|MC|ST|CO|OL|HE|SI|KS|KQ)$/.test(sym)) return 'none';

  // Unknown — don't block the user, show grey dot (no red warning)
  return 'unknown';
}

const COVERAGE_DOT = {
  live:    { color: '#00c853', title: 'Live data available' },
  limited: { color: YELLOW,   title: 'Limited data (OTC/fund) — chart may be empty' },
  none:    { color: RED,      title: 'No data — international exchange not covered' },
  unknown: { color: '#444',   title: 'Coverage unknown' },
};

const COVERAGE_TAG = {
  none:    { bg: '#2a0000', color: RED,    label: 'NO DATA' },
  limited: { bg: '#1a1400', color: YELLOW, label: 'LIMITED' },
};

// Fixed: use C: prefix (Polygon format) not =X (Yahoo format)
function localSearch(q) {
  if (!q || q.trim().length < 2) return [];
  const uq = q.toUpperCase().replace(/[\s/\-]/g, '');
  const fxResults = FOREX_PAIRS
    .filter(p => p.symbol.includes(uq) || p.label.replace('/', '').includes(uq))
    .map(p => ({ symbol: 'C:' + p.symbol, name: p.label + ' Exchange Rate', type: 'CURRENCY', local: true }));
  const cryptoResults = CRYPTO_PAIRS
    .filter(c => c.symbol.toUpperCase().includes(uq) || c.label.toUpperCase().includes(q.trim().toUpperCase()))
    .map(c => ({ symbol: 'X:' + c.symbol, name: c.label + ' / USD', type: 'CRYPTO', local: true }));
  return [...fxResults, ...cryptoResults];
}

function displaySymbol(sym) {
  if (!sym) return '';
  if (sym.startsWith('C:')) return sym.slice(2, 5) + '/' + sym.slice(5);
  if (sym.startsWith('X:')) return sym.slice(2).replace('USD', '') + '/USD';
  if (sym.endsWith('.SA')) return sym.slice(0, -3);
  return sym;
}

const ASSET_FILTERS = [
  { id: null,           label: 'ALL' },
  { id: 'equity',       label: 'EQUITY' },
  { id: 'etf',          label: 'ETF' },
  { id: 'forex',        label: 'FX' },
  { id: 'crypto',       label: 'CRYPTO' },
  { id: 'fixed_income', label: 'BONDS' },
  { id: 'commodity',    label: 'COMMOD' },
];

const ASSET_CLASS_COLOR = {
  equity:       '#4fc3f7',
  etf:          '#81c784',
  forex:        '#ce93d8',
  crypto:       '#f48fb1',
  fixed_income: '#ffb74d',
  commodity:    '#80cbc4',
  index:        '#ffb74d',
};

function SearchPanel({ onTickerSelect, onOpenDetail }) {
  const [query,         setQuery]         = useState('');
  const [results,       setResults]       = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [selected,      setSelected]      = useState(null);
  const [quote,         setQuote]         = useState(null);
  const [quoteLoading,  setQuoteLoading]  = useState(false);
  const [addedToHome,   setAddedToHome]   = useState(null);
  const [assetFilter,   setAssetFilter]   = useState(null); // null = all
  const debounceRef = useRef(null);
  const { addToHomeSection } = useSettings();

  const search = useCallback((q, assetClass) => {
    if (!q.trim()) { setResults([]); return; }
    const local = localSearch(q);
    setResults(local);
    setLoading(true);

    // Query both instrument registry and Polygon simultaneously
    const registryPath = `/api/instruments/search?q=${encodeURIComponent(q)}&limit=10${assetClass ? `&assetClass=${assetClass}` : ''}`;
    const polygonPath  = `/api/search?q=${encodeURIComponent(q)}`;

    Promise.allSettled([
      apiFetch(registryPath).then(r => r.json()),
      apiFetch(polygonPath).then(r => r.json()),
    ]).then(([regRes, polyRes]) => {
      const regItems   = regRes.status  === 'fulfilled' ? (regRes.value.results  || []) : [];
      const polyItems  = polyRes.status === 'fulfilled' ? (polyRes.value.results || []) : [];

      // Map registry items to display format
      const fromRegistry = regItems.map(r => ({
        symbol:     r.symbolKey,
        name:       r.name,
        type:       (r.assetClass || '').toUpperCase(),
        assetClass: r.assetClass,
        market:     'stocks', // so coverageLevel works
        group:      r.group,
        local:      false,
        fromRegistry: true,
      }));

      // Map Polygon/Yahoo items, skip if already in registry
      const regKeys = new Set([...local.map(l => l.symbol), ...fromRegistry.map(r => r.symbol)]);
      const fromPoly = polyItems
        .filter(r => !regKeys.has(r.ticker || r.symbol))
        .map(r => ({
          symbol:          r.ticker || r.symbol,
          name:            r.name,
          type:            r.type,
          assetType:       r.assetType || null,  // normalized type from server
          market:          r.market,
          primaryExchange: r.primaryExchange || r.market || '',
          exchange:        r.exchange || '',
          active:          r.active,
        }));

      // Merge: local FX/crypto → registry → polygon, dedup
      const seen = new Set();
      const merged = [...local, ...fromRegistry, ...fromPoly]
        .filter(item => {
          if (seen.has(item.symbol)) return false;
          seen.add(item.symbol);
          // Filter by asset class if active
          if (assetClass && item.assetClass && item.assetClass !== assetClass) return false;
          return true;
        })
        .slice(0, 20);

      setResults(merged);
      setLoading(false);
    });
  }, []);

  const handleInput = (e) => {
    const q = e.target.value;
    setQuery(q);
    setSelected(null);
    setQuote(null);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q, assetFilter), 280);
  };

  const handleFilterChange = (f) => {
    setAssetFilter(f);
    if (query.trim()) search(query, f);
  };

  const handleSelect = useCallback((item) => {
    setSelected(item);
    setResults([]);
    setQuery(displaySymbol(item.symbol));
    setQuote(null);

    const cov = coverageLevel(item);
    if (cov === 'none') return; // don't bother fetching quote for no-coverage tickers

    setQuoteLoading(true);
    apiFetch(`/api/quote/${encodeURIComponent(item.symbol)}`)
      .then(r => r.json())
      .then(d => { setQuote(d); setQuoteLoading(false); })
      .catch(() => setQuoteLoading(false));
  }, []);

  const handleDragStart = (e, item) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-ticker', JSON.stringify({
      symbol: item.symbol, name: item.name, type: item.type,
    }));
  };

  const handleAddToHome = (e, item) => {
    e.stopPropagation(); // prevent triggering row click
    addToHomeSection(item.symbol, item.name);
    setAddedToHome(item.symbol);
    setTimeout(() => setAddedToHome(null), 1500);
  };

  const fmtNum = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const fmtVol = (n) => !n ? '—' : n >= 1e9 ? (n/1e9).toFixed(1)+'B' : n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(0)+'K' : String(n);

  return (
    <div className="sp-container">

      {/* ── Header ── */}
      <div className="sp-header">
        <span className="sp-header-label">SEARCH</span>
        <span className="sp-header-hint">CLICK → DETAIL  ·  DRAG → CHART</span>
      </div>

      {/* ── Search input ── */}
      <div className="sp-search-wrapper">
        <input
          autoFocus
          value={query}
          onChange={handleInput}
          placeholder="ticker or company name..."
          className="sp-search-input"
          onFocus={e => e.target.style.borderColor = ORANGE}
          onBlur={e => e.target.style.borderColor = '#2a2a2a'}
        />
        {loading && (
          <span className="sp-search-loading">
            SEARCHING...
          </span>
        )}
      </div>

      {/* ── Asset class filter tabs ── */}
      <div className="sp-filter-tabs">
        {ASSET_FILTERS.map(f => (
          <button className="btn sp-filter-btn"
            key={String(f.id)}
            onClick={() => handleFilterChange(f.id)}
            style={{
              background:   assetFilter === f.id ? '#1a0900' : 'transparent',
              border:       `1px solid ${assetFilter === f.id ? ORANGE : '#1e1e1e'}`,
              color:        assetFilter === f.id ? ORANGE : '#333',
            }}
          >{f.label}</button>
        ))}
      </div>

      {/* ── Results list ── */}
      {results.length > 0 && (
        <div className="sp-results-container">
          <div className="sp-results-header">
            <span className="sp-results-header-text">⠿ DRAG RESULTS TO ANY PANEL TO ADD TICKERS</span>
          </div>
          {results.map(item => {
            const badge  = MARKET_BADGE[(item.market || '').toUpperCase()];
            const isBR   = item.symbol?.endsWith('.SA');
            const cov    = coverageLevel(item);
            const dot    = COVERAGE_DOT[cov];
            const covTag = COVERAGE_TAG[cov];

            return (
              <div
                key={item.symbol}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                onClick={() => handleSelect(item)}
                title="Click to view details · Drag to any panel to add ticker"
                className={`sp-result-row ${cov === 'none' ? 'sp-result-row no-coverage' : ''}`}
                onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {/* Drag grip indicator */}
                <span className="sp-drag-icon" title="Drag to any panel">⠿</span>
                {/* Coverage dot */}
                <span
                  title={dot.title}
                  className={`sp-coverage-dot ${cov === 'live' ? 'sp-coverage-dot-live' : ''}`}
                  style={{ background: dot.color }}
                />

                {/* Drag grip */}
                <span className="sp-drag-grip">⠿</span>

                {/* Symbol */}
                <span className="sp-symbol"
                  style={{
                    color: isBR ? '#8bc34a' : (ASSET_CLASS_COLOR[item.assetClass] || TYPE_COLOR[item.type] || '#aaa'),
                  }}>
                  {displaySymbol(item.symbol)}
                </span>

                {/* Name */}
                <span className="sp-name">
                  {item.name}
                </span>

                {/* Asset type badge + exchange + coverage + Add to Home */}
                <div className="sp-badge-container">
                  {/* Asset type badge — always visible */}
                  {(() => {
                    const assetType = deriveAssetType(item);
                    const typeBadge = ASSET_TYPE_BADGE[assetType];
                    return typeBadge ? (
                      <span className="sp-type-badge"
                        style={{
                          background: typeBadge.bg, color: typeBadge.color,
                          border: `1px solid ${typeBadge.color}33`,
                        }}>
                        {typeBadge.label}
                      </span>
                    ) : null;
                  })()}
                  {/* Exchange badge (B3, NYSE, NASDAQ, etc.) */}
                  {badge && (
                    <span className="sp-exchange-badge" style={{ background: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                  )}
                  {/* Coverage warning tag */}
                  {covTag && (
                    <span className="sp-coverage-tag" style={{ background: covTag.bg, color: covTag.color }}>
                      {covTag.label}
                    </span>
                  )}
                  <button className={`btn sp-add-home-btn ${addedToHome === item.symbol ? 'sp-add-home-btn-active' : ''}`}
                    onClick={(e) => handleAddToHome(e, item)}
                    title="Add to home screen"
                    style={{
                      border: `1px solid ${addedToHome === item.symbol ? '#00cc66' : '#2a2a2a'}`,
                      color: addedToHome === item.symbol ? '#00cc66' : '#555',
                    }}
                  >
                    {addedToHome === item.symbol ? '✓' : '+ HOME'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Empty state ── */}
      {!results.length && !query && !selected && (
        <div className="sp-empty-state">
          TYPE TO SEARCH<br />
          <span className="sp-empty-state-hint">● CLICK RESULT → OPEN IN DEPTH</span><br />
          <span className="sp-empty-state-hint">⠿ DRAG RESULT → ADD TO CHART</span>
        </div>
      )}
      {query.trim().length > 0 && !results.length && !loading && !selected && (
        <div className="sp-no-results">
          NO RESULTS
        </div>
      )}

      {/* ── Quote preview / action area ── */}
      {(selected || quoteLoading) && (
        <div className="sp-quote-section">

          {/* Coverage warning banner */}
          {selected && coverageLevel(selected) !== 'live' && (
            <div className={`sp-coverage-warning ${coverageLevel(selected) === 'none' ? 'sp-coverage-warning-none' : 'sp-coverage-warning-limited'}`}>
              {coverageLevel(selected) === 'none'
                ? '⚠ This ticker trades on an international exchange not covered by this terminal. Chart and price data will not be available.'
                : '⚠ This ticker is OTC/fund class — data may be sparse or unavailable.'}
            </div>
          )}

          {quoteLoading && (
            <div className="sp-quote-loading">LOADING...</div>
          )}

          {selected && !quoteLoading && (
            <>
              {/* Action buttons */}
              <div className="sp-action-buttons">
                <button className="btn sp-open-depth-btn"
                  onClick={() => onOpenDetail?.(selected.symbol)}
                >
                  OPEN IN DEPTH →
                </button>
                <button className="btn sp-chart-btn"
                  draggable
                  onDragStart={(e) => handleDragStart(e, selected)}
                  onClick={() => onTickerSelect?.(selected.symbol)}
                  title="Click to set as chart ticker, or drag to a chart slot"
                >
                  + CHART
                </button>
              </div>

              {/* Quote data (if available) */}
              {quote?.price != null ? (() => {
                const up  = (quote.changePct ?? 0) >= 0;
                const isBR = quote.currency === 'BRL' || quote.ticker?.endsWith('.SA');
                return (
                  <div>
                    {/* Ticker + currency row */}
                    <div className="sp-ticker-row">
                      <span className="sp-ticker">
                        {displaySymbol(quote.ticker || selected.symbol)}
                      </span>
                      {isBR && (
                        <span className="sp-ticker-badge">B3</span>
                      )}
                      {quote.name && quote.name !== quote.ticker && (
                        <span className="sp-ticker-name">
                          {quote.name}
                        </span>
                      )}
                      <span className="sp-ticker-currency">{quote.currency}</span>
                    </div>

                    {/* Price */}
                    <div className="sp-price">
                      {fmtNum(quote.price)}
                    </div>
                    <div className="sp-change" style={{ color: up ? '#00c853' : RED }}>
                      {(up ? '+' : '')}{fmtNum(quote.change)}&nbsp;({fmtPct(quote.changePct)})
                    </div>

                    {/* OHLCV grid */}
                    <div className="sp-ohlcv-grid">
                      {[
                        ['OPEN',   fmtNum(quote.open)],
                        ['HIGH',   fmtNum(quote.high)],
                        ['LOW',    fmtNum(quote.low)],
                        ['VOLUME', fmtVol(quote.volume)],
                      ].map(([lbl, val]) => (
                        <div key={lbl}>
                          <div className="sp-ohlcv-label">{lbl}</div>
                          <div className="sp-ohlcv-value">{val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })() : (
                !quoteLoading && coverageLevel(selected) !== 'none' && (
                  <div className="sp-no-quote">
                    No quote data available
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export { SearchPanel };
export default memo(SearchPanel);
