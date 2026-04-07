import { useState, useRef, useCallback, memo } from 'react';
import { FOREX_PAIRS, CRYPTO_PAIRS } from '../../utils/constants';
import { useSettings } from '../../context/SettingsContext';
import { useInstrumentSearch } from '../../hooks/useInstrumentSearch';
import { useOpenDetail } from '../../context/OpenDetailContext';
import Badge from '../ui/Badge';
import './SearchPanel.css';
import { resolveAlias } from '../../config/instrumentAliases';

// Module-level recent searches store (survives re-renders but not page refresh)
let _recentSearches = [];

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
  Screen:  { bg: '#001a3a', color: '#4fc3f7', label: 'SCREEN' },
};

function deriveAssetType(item) {
  if (item.type === 'SCREEN') return 'Screen';
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
  if (ac === 'commodity')    return 'ETF';
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

const LIVE_EXCHANGES    = new Set(['NYQ', 'NMS', 'PCX', 'ARCX', 'NYE', 'ASE', 'BVSP', 'SAO']);
const LIMITED_EXCHANGES = new Set(['OTC', 'PNK', 'OTCM', 'GREY', 'OTCQX', 'OTCQB', 'PINK']);
// S4.6: International exchanges now covered by Twelve Data — promoted to LIMITED.
const INTL_EXCHANGES = new Set([
  'LSE','LON','L','TYO','TSE','T','HKG','HK','SHH','SHZ',
  'BOM','NSE','NS','BO','ASX','AX','FRA','ETR','F','EPA','PA',
  'AMS','AS','BME','MC','MIL','MI','STO','ST','CPH','CO',
  'OSL','OL','HEL','HE','WSE','WAR','SGX','SI','KRX','KS','KQ',
  'TWSE','TW','TWO','TAI',
]);
const NO_DATA_EXCHANGES = new Set([]);

function coverageLevel(item) {
  if (!item) return 'unknown';
  if (item.local) return 'live';
  const type   = (item.type || '').toUpperCase();
  const market = (item.market || '').toLowerCase();
  const exch   = (item.primaryExchange || item.market || '').toUpperCase();
  if (type === 'CRYPTO' || type === 'CRYPTOCURRENCY') return 'live';
  if (type === 'CURRENCY') return 'live';
  if (type === 'MUTUALFUND') return 'limited';
  if (market === 'stocks')  return 'live';
  if (market === 'crypto')  return 'live';
  if (market === 'fx' || market === 'forex') return 'live';
  if (market === 'otc')     return 'limited';
  if (market === 'indices') return 'limited';
  if (LIVE_EXCHANGES.has(exch))    return 'live';
  if (LIMITED_EXCHANGES.has(exch)) return 'limited';
  if (INTL_EXCHANGES.has(exch))    return 'limited'; // S4.6: Twelve Data coverage
  if (NO_DATA_EXCHANGES.has(exch)) return 'none';
  const sym = (item.symbol || '').toUpperCase();
  if (/\.(L|T|HK|AX|TO|NS|BO|PA|DE|MI|AS|MC|ST|CO|OL|HE|SI|KS|KQ)$/.test(sym)) return 'limited';
  return 'unknown';
}

const COVERAGE_DOT = {
  live:    { color: '#00c853', title: 'Live data available' },
  limited: { color: YELLOW,   title: 'Limited data (OTC/fund) — chart may be empty' },
  none:    { color: YELLOW,   title: 'Live data not available for this exchange. Tap for AI-generated summary.' },
  unknown: { color: '#444',   title: 'Coverage unknown' },
};

const COVERAGE_TAG = {
  none:    { bg: '#1a1400', color: YELLOW, label: 'AI OVERVIEW' },
  limited: { bg: '#1a1400', color: YELLOW, label: 'LIMITED' },
};

const ASSET_CLASS_COLOR = {
  equity: '#4fc3f7', etf: '#81c784', forex: '#ce93d8',
  crypto: '#f48fb1', fixed_income: '#ffb74d', commodity: '#80cbc4', index: '#ffb74d',
};

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

function SearchPanel({ onTickerSelect }) {
  const openDetail = useOpenDetail();

  const [addedToHome,   setAddedToHome]   = useState(null);
  const [isFocused,     setIsFocused]     = useState(false);
  const [searchError,   setSearchError]   = useState(null);

  const inputRef = useRef(null);
  const { addToHomeSection } = useSettings();

  // Use the search hook with Polygon + auto AI enabled
  const {
    query, setQuery, results, loading,
    aiResults, aiLoading, aiError,
    selectedIdx, setSelectedIdx,
    recentSearches, addToRecents, searchAI, handleResultClick,
  } = useInstrumentSearch({ debounceMs: 280, enablePolygon: true, enableAiAuto: true });

  // Arrow key navigation, Enter, Escape
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetIdx = selectedIdx >= 0 ? selectedIdx : 0;
      if (results.length > targetIdx && targetIdx >= 0) {
        handleSelect(results[targetIdx]);
      }
    } else if (e.key === 'Escape') {
      setQuery('');
      setSelectedIdx(-1);
      setIsFocused(false);
    }
  }, [results, selectedIdx]);

  const handleSelect = useCallback((item) => {
    addToRecents(item);
    const normalized = handleResultClick(item);
    if (!normalized) {
      setSearchError('Cannot open this instrument yet.');
      return;
    }
    // Screen navigation — dispatch a custom event for the layout to handle
    if (normalized.isScreen && normalized.screenId) {
      window.dispatchEvent(new CustomEvent('senger:navigate-screen', { detail: { screenId: normalized.screenId } }));
      setSearchError(null);
      return;
    }
    openDetail(normalized.symbol);
    setSearchError(null);
  }, [addToRecents, openDetail, handleResultClick]);

  const badgeClass = (item) => {
    if (item.isFutures || item.assetClass === 'commodity') return 'badge-commodity';
    if (item.assetClass === 'crypto') return 'badge-crypto';
    if (item.assetClass === 'forex') return 'badge-forex';
    if (item.assetClass === 'index') return 'badge-index';
    if (item.assetClass === 'rate') return 'badge-rate';
    return 'badge-equity';
  };

  const handleDragStart = (e, item) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-ticker', JSON.stringify({
      symbol: item.symbol, name: item.name, type: item.type,
    }));
  };

  const handleAddToHome = (e, item) => {
    e.stopPropagation();
    addToHomeSection(item.symbol, item.name);
    setAddedToHome(item.symbol);
    setTimeout(() => setAddedToHome(null), 1500);
  };

  return (
    <div className="sp-container">

      {/* ── Header with labels ── */}
      <div className="search-panel-header">
        <span className="search-panel-title">SEARCH INSTRUMENTS</span>
        <span className="search-panel-hint">
          Stocks · ETFs · Crypto · FX · Futures · Indices · Bonds
        </span>
      </div>

      {/* ── Search input ── */}
      <div className="sp-search-wrapper">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setSearchError(null);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="ticker or company name..."
          className="sp-search-input"
        />
        {!query && !isFocused && (
          <span className="search-shortcut-badge">Press / to search</span>
        )}
        {loading && (
          <span className="sp-search-loading">SEARCHING...</span>
        )}
      </div>
      {searchError && (
        <div style={{ fontSize: '13px', color: '#f44336', padding: '8px 12px', marginTop: '-4px' }}>
          {searchError}
        </div>
      )}

      {/* ── Recent searches (when focused, empty query, and no results) ── */}
      {isFocused && !query && !results.length && recentSearches.length > 0 && (
        <div className="sp-results-container">
          <div className="search-recent-header">RECENT</div>
          {recentSearches.map((item, idx) => (
            <div
              key={item.symbol}
              className={`sp-result-row ${idx === selectedIdx ? 'selected' : ''}`}
              onClick={() => handleSelect(item)}
              title="Click to open detail"
            >
              <span className="sp-symbol"
                style={{
                  color: item.assetClass ? '#888' : '#666',
                }}>
                {displaySymbol(item.symbol)}
              </span>
              <span className="sp-name">{item.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Results list (ABOVE AI card — clickable to open InstrumentDetail) ── */}
      {results.length > 0 && (
        <div className="sp-results-container">
          <div className="sp-results-header">
            <span className="sp-results-header-text">DRAG RESULTS TO ANY PANEL TO ADD TICKERS</span>
          </div>
          {results.map((item, idx) => {
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
                title="Click to open detail · Drag to any panel to add ticker"
                className={`sp-result-row ${cov === 'none' ? 'no-coverage' : ''} ${idx === selectedIdx ? 'selected' : ''}`}
              >
                <span className="sp-drag-icon" title="Drag to any panel">⠿</span>
                <span
                  title={dot.title}
                  className={`sp-coverage-dot ${cov === 'live' ? 'sp-coverage-dot-live' : ''}`}
                  style={{ background: dot.color }}
                />
                <span className="sp-drag-grip">⠿</span>
                <span className="sp-symbol"
                  style={{
                    color: isBR ? '#8bc34a' : (ASSET_CLASS_COLOR[item.assetClass] || TYPE_COLOR[item.type] || '#aaa'),
                  }}>
                  {displaySymbol(item.symbol)}
                </span>
                <span className="sp-name">{item.name}</span>
                <div className="sp-badge-container">
                  {(() => {
                    const assetType = deriveAssetType(item);
                    const typeBadge = ASSET_TYPE_BADGE[assetType];
                    return typeBadge ? (
                      <span className="sp-type-badge"
                        style={{ background: typeBadge.bg, color: typeBadge.color, border: `1px solid ${typeBadge.color}33` }}>
                        {typeBadge.label}
                      </span>
                    ) : null;
                  })()}
                  {badge && (
                    <span className="sp-exchange-badge" style={{ background: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                  )}
                  {covTag && (
                    <Badge variant="warning" size="xs" title={dot.title}>
                      {covTag.label}
                    </Badge>
                  )}
                  {item.assetClass && (
                    <span className={`spr-badge ${badgeClass(item)}`}>
                      {item.assetClass.toUpperCase()}
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
                    {addedToHome === item.symbol ? 'ADDED' : '+ HOME'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* AI-powered semantic results */}
      {aiLoading && (
        <div className="sp-ai-loading">
          <span className="sp-ai-badge">AI</span> SEARCHING...
        </div>
      )}
      {aiError && (
        <div className="sp-ai-error">{aiError}</div>
      )}
      {aiResults.length > 0 && !aiLoading && (
        <div className="sp-ai-results">
          <div className="sp-ai-header">
            <span className="sp-ai-badge">AI</span>
            <span className="sp-ai-header-text">SEMANTIC MATCHES</span>
          </div>
          {aiResults.map(item => (
            <div
              key={item.symbol}
              draggable
              onDragStart={(e) => handleDragStart(e, item)}
              onClick={() => openDetail(item.symbol)}
              className="sp-result-row sp-result-row--ai"
            >
              <span className="sp-drag-icon">⠿</span>
              <span className="sp-symbol" style={{ color: '#ff6b00' }}>
                {item.symbol}
              </span>
              <span className="sp-name">{item.name}</span>
              {item.reason && (
                <span className="sp-ai-reason">{item.reason}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {query.trim().length >= 3 && !aiLoading && (
        <button className="sp-ai-search-btn" onClick={() => searchAI(query)}>
          AI SEARCH
        </button>
      )}

      {/* ── Empty state ── */}
      {!results.length && !query && (
        <div className="sp-empty-state">
          TYPE TO SEARCH<br />
          <span className="sp-empty-state-hint">CLICK RESULT  —  OPEN IN DEPTH</span><br />
          <span className="sp-empty-state-hint">DRAG RESULT  —  ADD TO CHART</span>
        </div>
      )}
      {query.trim().length > 0 && !results.length && !loading && (
        <div className="sp-no-results">NO RESULTS</div>
      )}
    </div>
  );
}

export { SearchPanel };
export default memo(SearchPanel);
