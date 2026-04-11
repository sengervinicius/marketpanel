import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useInstrumentSearch } from '../../hooks/useInstrumentSearch';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { resolveAlias } from '../../config/instrumentAliases';
import Sparkline from '../shared/Sparkline';
import './HeaderSearchBar.css';

// ── Format helpers ──
function fmtMktCap(v) {
  if (v == null || isNaN(v)) return null;
  const n = parseFloat(v);
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(0) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(0) + 'M';
  return null;
}

function fmtPrice(p) {
  if (p == null) return null;
  return p >= 1000 ? p.toLocaleString(undefined, { maximumFractionDigits: 2 }) : p.toFixed(2);
}

// ── Enriched result row with live price data ──
function HsbEnrichedRow({ item, idx, selectedIdx, onSelect, onMouseEnter, typeBadge }) {
  const priceData = useTickerPrice(item.symbolKey || item.symbol);
  const price = priceData?.price;
  const changePct = priceData?.changePct;
  const mktCap = priceData?.marketCap || item.marketCap;
  const isPos = changePct != null && changePct >= 0;
  const sparkData = useMemo(() => {
    if (!priceData?.bars || priceData.bars.length < 2) return [];
    return priceData.bars.map(b => b.c || b.close).slice(-20);
  }, [priceData?.bars]);

  return (
    <div
      className={`hsb-result ${idx === selectedIdx ? 'hsb-result--active' : ''}`}
      onClick={() => onSelect(item)}
      onMouseEnter={() => onMouseEnter(idx)}
    >
      <span className={`hsb-badge hsb-badge--${item.assetClass}`}>{typeBadge(item)}</span>
      <span className="hsb-symbol">{item.symbolKey}</span>
      <span className="hsb-name">{item.name}</span>
      {sparkData.length >= 2 && (
        <span className="hsb-spark">
          <Sparkline data={sparkData} isPositive={isPos} width={48} height={14} />
        </span>
      )}
      {price != null && (
        <span className="hsb-price">{fmtPrice(price)}</span>
      )}
      {changePct != null && (
        <span className="hsb-change" style={{ color: isPos ? 'var(--semantic-up, #4caf50)' : 'var(--semantic-down, #ef5350)' }}>
          {isPos ? '+' : ''}{changePct.toFixed(2)}%
        </span>
      )}
      {fmtMktCap(mktCap) && (
        <span className="hsb-mktcap">{fmtMktCap(mktCap)}</span>
      )}
      {!price && item.exchange && <span className="hsb-exchange">{item.exchange}</span>}
    </div>
  );
}

export default function HeaderSearchBar({ onSelectTicker }) {

  const [open, setOpen] = useState(false);
  const [isAIMode, setIsAIMode] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Use the search hook
  const {
    query, setQuery, results, groupedByCompany, allItems,
    loading, aiResults, aiLoading, aiError,
    selectedIdx, setSelectedIdx, clearSearch,
  } = useInstrumentSearch({ debounceMs: 200, registryLimit: 20 });

  // Open on "/" or Cmd+K
  useEffect(() => {
    const handleKey = (e) => {
      if ((e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') ||
          (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        clearSearch();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, clearSearch]);

  // Keyboard nav
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { setOpen(false); clearSearch(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, allItems.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && allItems[selectedIdx]) {
      e.preventDefault();
      const item = allItems[selectedIdx];
      selectItem(item);
    }
  }, [allItems, selectedIdx, clearSearch]);

  const openDetail = useOpenDetail();
  const selectItem = useCallback((item) => {
    const sym = resolveAlias(item.symbolKey || item.symbol);
    if (sym) {
      openDetail(sym);
      clearSearch();
      setOpen(false);
    }
  }, [openDetail, clearSearch]);

  // Detect AI mode from query prefix
  const detectAIMode = (q) => {
    const trimmed = q.trim();
    return trimmed.startsWith('@ai ') || trimmed.startsWith('?');
  };

  // Asset class badge
  const typeBadge = (item) => {
    if (item.isFutures) return 'FUTURES';
    if (item.isETFProxy) return 'ETF PROXY';
    const labels = { equity: 'EQUITY', etf: 'ETF', forex: 'FX', crypto: 'CRYPTO', commodity: 'CMDTY', index: 'INDEX', fixed_income: 'BOND', fund: 'FUND' };
    return labels[item.assetClass] || item.assetClass?.toUpperCase() || '';
  };

  // Group results by asset class (using grouped-by-company results)
  const grouped = {};
  for (const r of groupedByCompany) {
    const cls = r.isFutures ? 'Futures / Commodities' :
                r.isETFProxy ? 'ETF Proxies' :
                r.assetClass === 'equity' ? 'Equities' :
                r.assetClass === 'etf' ? 'ETFs' :
                r.assetClass === 'forex' ? 'FX' :
                r.assetClass === 'crypto' ? 'Crypto' :
                r.assetClass === 'fixed_income' ? 'Fixed Income' :
                r.assetClass || 'Other';
    (grouped[cls] = grouped[cls] || []).push(r);
  }

  // Flat list for keyboard nav
  let flatIdx = 0;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  const shortcutLabel = isMac ? '\u2318K' : 'Ctrl K';

  if (!open) {
    return (
      <div className="hsb-trigger" onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}>
        <svg className="hsb-trigger-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <span className="hsb-trigger-label">SEARCH</span>
        <span className="hsb-trigger-text">Ticker, company, macro theme, or ask AI...</span>
        <span className="hsb-trigger-shortcut">{shortcutLabel}</span>
      </div>
    );
  }

  return (
    <div className="hsb-container" ref={containerRef}>
      <div className="hsb-input-row">
        <svg className="hsb-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <span className={`hsb-input-label ${isAIMode ? 'hsb-input-label--ai' : ''}`}>
          {isAIMode ? 'AI MODE' : 'SEARCH'}
        </span>
        <input
          ref={inputRef}
          className={`hsb-input ${isAIMode ? 'hsb-input--ai-mode' : ''}`}
          value={query}
          onChange={e => {
            const newQuery = e.target.value;
            setQuery(newQuery);
            setIsAIMode(detectAIMode(newQuery));
          }}
          onKeyDown={handleKeyDown}
          placeholder={isAIMode ? "Ask AI anything..." : "Search stocks, ETFs, FX, crypto, commodities... (⌘K)"}
          autoFocus
        />
        {query && <button className="hsb-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>&times;</button>}
      </div>

      {(results.length > 0 || loading || query.trim() || aiLoading || aiResults.length > 0) && (
        <div className="hsb-dropdown">
          {loading && <div className="hsb-loading">Searching...</div>}
          {!loading && query.trim() && results.length === 0 && !aiLoading && aiResults.length === 0 && (
            <div className="hsb-empty">No results for &ldquo;{query}&rdquo;</div>
          )}
          {Object.entries(grouped).map(([groupLabel, items]) => (
            <div key={groupLabel} className="hsb-group">
              <div className="hsb-group-header">{groupLabel}</div>
              {items.map((item) => {
                const idx = flatIdx++;
                return (
                  <div key={item.symbolKey}>
                    <HsbEnrichedRow
                      item={item}
                      idx={idx}
                      selectedIdx={selectedIdx}
                      onSelect={selectItem}
                      onMouseEnter={setSelectedIdx}
                      typeBadge={typeBadge}
                    />
                    {/* Alternates row */}
                    {item._alternates && item._alternates.length > 0 && (
                      <div className="hsb-alternate-row">
                        <span className="hsb-alternate-label">Also:</span>
                        {item._alternates.map((alt) => (
                          <a
                            key={alt.symbolKey}
                            className="hsb-alternate-link"
                            onClick={() => selectItem(alt)}
                          >
                            {alt.exchange} ({alt.symbolKey} · {alt.currency || 'N/A'})
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* AI Suggestions section */}
          {(aiLoading || aiResults.length > 0 || aiError) && (() => {
            const registryKeys = new Set(results.map(r => r.symbolKey));
            const uniqueAi = aiResults.filter(ai => !registryKeys.has(ai.symbol));
            return (
              <div className="hsb-group hsb-ai-group">
                <div className="hsb-group-header hsb-ai-header">&#10022; AI SUGGESTIONS</div>
                {aiLoading && (
                  <div className="hsb-ai-thinking">
                    <span className="hsb-ai-pulse"></span>
                    &#10022; AI is thinking&hellip;
                  </div>
                )}
                {aiError && !aiLoading && (
                  <div className="hsb-ai-note">AI search unavailable</div>
                )}
                {!aiLoading && !aiError && uniqueAi.length === 0 && aiResults.length > 0 && (
                  <div className="hsb-ai-note">All AI suggestions already shown above</div>
                )}
                {!aiLoading && uniqueAi.map((ai) => {
                  const idx = flatIdx++;
                  return (
                    <div
                      key={ai.symbol}
                      className={`hsb-result hsb-ai-result ${idx === selectedIdx ? 'hsb-result--active' : ''}`}
                      onClick={() => selectItem(ai)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      <span className={`hsb-badge hsb-badge--${ai.assetClass}`}>
                        {(ai.assetClass || '').toUpperCase()}
                      </span>
                      <span className="hsb-symbol">{ai.symbol}</span>
                      <span className="hsb-name">{ai.name}</span>
                      {ai.aiReason && <span className="hsb-ai-reason" title={ai.aiReason}>{ai.aiReason}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
