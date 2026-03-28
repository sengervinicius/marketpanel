import { useState, useRef, useCallback, memo } from 'react';
import { FOREX_PAIRS, CRYPTO_PAIRS } from '../../utils/constants';
import { useSettings } from '../../context/SettingsContext';
import { apiFetch } from '../../utils/api';

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

      // Map Polygon items, skip if already in registry
      const regKeys = new Set([...local.map(l => l.symbol), ...fromRegistry.map(r => r.symbol)]);
      const fromPoly = polyItems
        .filter(r => !regKeys.has(r.ticker || r.symbol))
        .map(r => ({
          symbol:          r.ticker || r.symbol,
          name:            r.name,
          type:            r.type,
          market:          r.market,
          primaryExchange: r.primaryExchange || r.market || '',
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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a', fontFamily: 'inherit' }}>

      {/* ── Header ── */}
      <div style={{ padding: '6px 10px 4px', borderBottom: '1px solid #1e1e1e', flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: ORANGE, fontWeight: 700, fontSize: 11, letterSpacing: '0.2em' }}>SEARCH</span>
        <span style={{ color: '#2a2a2a', fontSize: 7 }}>CLICK → DETAIL  ·  DRAG → CHART</span>
      </div>

      {/* ── Search input ── */}
      <div style={{ position: 'relative', padding: '6px 8px', flexShrink: 0 }}>
        <input
          value={query}
          onChange={handleInput}
          placeholder="ticker or company name..."
          style={{
            width: '100%', background: '#0f0f0f',
            border: '1px solid #2a2a2a', color: '#ccc',
            fontSize: 15, padding: '9px 8px',
            fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
            borderRadius: 2,
          }}
          onFocus={e => e.target.style.borderColor = ORANGE}
          onBlur={e => e.target.style.borderColor = '#2a2a2a'}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#444', fontSize: 7 }}>
            SEARCHING...
          </span>
        )}
      </div>

      {/* ── Asset class filter tabs ── */}
      <div style={{ display: 'flex', gap: 3, padding: '4px 8px', borderBottom: '1px solid #141414', flexShrink: 0, flexWrap: 'wrap' }}>
        {ASSET_FILTERS.map(f => (
          <button
            key={String(f.id)}
            onClick={() => handleFilterChange(f.id)}
            style={{
              background:   assetFilter === f.id ? '#1a0900' : 'transparent',
              border:       `1px solid ${assetFilter === f.id ? ORANGE : '#1e1e1e'}`,
              color:        assetFilter === f.id ? ORANGE : '#333',
              fontSize:     7, padding: '2px 5px', cursor: 'pointer',
              fontFamily:   'inherit', borderRadius: 2, fontWeight: 700,
              letterSpacing: '0.05em',
            }}
          >{f.label}</button>
        ))}
      </div>

      {/* ── Results list ── */}
      {results.length > 0 && (
        <div style={{ borderBottom: '1px solid #1e1e1e', flexShrink: 0, maxHeight: '55vh', overflowY: 'auto' }}>
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
                title={dot.title}
                style={{
                  padding: '8px 10px', borderBottom: '1px solid #141414',
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  gap: 7, userSelect: 'none',
                  opacity: cov === 'none' ? 0.55 : 1,
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {/* Coverage dot */}
                <span
                  title={dot.title}
                  style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: dot.color, flexShrink: 0,
                    boxShadow: cov === 'live' ? `0 0 4px ${dot.color}` : 'none',
                  }}
                />

                {/* Drag grip */}
                <span style={{ color: '#1e1e1e', fontSize: 11, flexShrink: 0 }}>⠿</span>

                {/* Symbol */}
                <span style={{
                  color: isBR ? '#8bc34a' : (ASSET_CLASS_COLOR[item.assetClass] || TYPE_COLOR[item.type] || '#aaa'),
                  fontSize: 12, fontWeight: 700, minWidth: '68px', flexShrink: 0,
                }}>
                  {displaySymbol(item.symbol)}
                </span>

                {/* Name */}
                <span style={{ color: '#666', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {item.name}
                </span>

                {/* Badges + Add to Home button */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                  {covTag && (
                    <span style={{
                      fontSize: 7, padding: '1px 4px', borderRadius: 2,
                      background: covTag.bg, color: covTag.color,
                      fontWeight: 700, letterSpacing: 0.3,
                    }}>
                      {covTag.label}
                    </span>
                  )}
                  {badge ? (
                    <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 2, background: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                  ) : (
                    item.type && !covTag && (
                      <span style={{ color: '#333', fontSize: 7 }}>{item.type}</span>
                    )
                  )}
                  <button
                    onClick={(e) => handleAddToHome(e, item)}
                    title="Add to home screen"
                    style={{
                      background: 'none',
                      border: `1px solid ${addedToHome === item.symbol ? '#00cc66' : '#2a2a2a'}`,
                      color: addedToHome === item.symbol ? '#00cc66' : '#555',
                      fontSize: 8,
                      padding: '2px 6px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      letterSpacing: '0.1em',
                      fontWeight: addedToHome === item.symbol ? 'bold' : 'normal',
                      transition: 'all 0.2s',
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
        <div style={{ padding: '16px 10px', color: '#2a2a2a', fontSize: 8, textAlign: 'center', lineHeight: 2 }}>
          TYPE TO SEARCH<br />
          <span style={{ color: '#1e1e1e' }}>● CLICK RESULT → OPEN IN DEPTH</span><br />
          <span style={{ color: '#1e1e1e' }}>⠿ DRAG RESULT → ADD TO CHART</span>
        </div>
      )}
      {query.trim().length > 0 && !results.length && !loading && !selected && (
        <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: 10, letterSpacing: '0.1em' }}>
          NO RESULTS
        </div>
      )}

      {/* ── Quote preview / action area ── */}
      {(selected || quoteLoading) && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 12px' }}>

          {/* Coverage warning banner */}
          {selected && coverageLevel(selected) !== 'live' && (
            <div style={{
              marginBottom: 10, padding: '6px 10px', borderRadius: 2,
              background: coverageLevel(selected) === 'none' ? '#1a0000' : '#1a1400',
              border: `1px solid ${coverageLevel(selected) === 'none' ? '#440000' : '#332200'}`,
              color: coverageLevel(selected) === 'none' ? RED : YELLOW,
              fontSize: 9, lineHeight: 1.5,
            }}>
              {coverageLevel(selected) === 'none'
                ? '⚠ This ticker trades on an international exchange not covered by this terminal. Chart and price data will not be available.'
                : '⚠ This ticker is OTC/fund class — data may be sparse or unavailable.'}
            </div>
          )}

          {quoteLoading && (
            <div style={{ color: '#333', fontSize: 9, textAlign: 'center', padding: '12px 0' }}>LOADING...</div>
          )}

          {selected && !quoteLoading && (
            <>
              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <button
                  onClick={() => onOpenDetail?.(selected.symbol)}
                  style={{
                    flex: 2, padding: '9px 0', fontSize: 10, fontWeight: 700,
                    background: ORANGE, color: '#fff', border: 'none',
                    borderRadius: 2, cursor: 'pointer', letterSpacing: 0.5,
                    fontFamily: 'inherit',
                  }}
                >
                  OPEN IN DEPTH →
                </button>
                <button
                  draggable
                  onDragStart={(e) => handleDragStart(e, selected)}
                  onClick={() => onTickerSelect?.(selected.symbol)}
                  style={{
                    flex: 1, padding: '9px 0', fontSize: 10,
                    background: 'transparent', color: '#555',
                    border: '1px solid #252525',
                    borderRadius: 2, cursor: 'grab', letterSpacing: 0.5,
                    fontFamily: 'inherit',
                  }}
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
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                      <span style={{ color: ORANGE, fontWeight: 700, fontSize: 13 }}>
                        {displaySymbol(quote.ticker || selected.symbol)}
                      </span>
                      {isBR && (
                        <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 2, background: '#1a2800', color: '#8bc34a' }}>B3</span>
                      )}
                      {quote.name && quote.name !== quote.ticker && (
                        <span style={{ color: '#333', fontSize: 8, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {quote.name}
                        </span>
                      )}
                      <span style={{ color: '#2a2a2a', fontSize: 7, marginLeft: 'auto', flexShrink: 0 }}>{quote.currency}</span>
                    </div>

                    {/* Price */}
                    <div style={{ color: '#e0e0e0', fontSize: 22, fontVariantNumeric: 'tabular-nums', fontWeight: 600, lineHeight: 1.1 }}>
                      {fmtNum(quote.price)}
                    </div>
                    <div style={{ color: up ? '#00c853' : RED, fontSize: 13, marginTop: 3, marginBottom: 10 }}>
                      {(up ? '+' : '')}{fmtNum(quote.change)}&nbsp;({fmtPct(quote.changePct)})
                    </div>

                    {/* OHLCV grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                      {[
                        ['OPEN',   fmtNum(quote.open)],
                        ['HIGH',   fmtNum(quote.high)],
                        ['LOW',    fmtNum(quote.low)],
                        ['VOLUME', fmtVol(quote.volume)],
                      ].map(([lbl, val]) => (
                        <div key={lbl}>
                          <div style={{ color: '#2a2a2a', fontSize: 7, letterSpacing: 0.5 }}>{lbl}</div>
                          <div style={{ color: '#888', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })() : (
                !quoteLoading && coverageLevel(selected) !== 'none' && (
                  <div style={{ color: '#2a2a2a', fontSize: 9, textAlign: 'center', padding: '8px 0' }}>
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
