import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { apiFetch } from '../../utils/api';
import './HeaderSearchBar.css';

export default function HeaderSearchBar({ onSelectTicker, onOpenDetail }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [aiResults, setAiResults] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

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
        setQuery('');
        setResults([]);
        setAiResults([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Search debounced — registry + AI in parallel
  useEffect(() => {
    if (!query.trim()) { setResults([]); setAiResults([]); setAiLoading(false); setAiError(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      // Registry search
      apiFetch(`/api/instruments/search?q=${encodeURIComponent(query)}&limit=20`)
        .then(r => r.json())
        .then(d => { setResults(d.results || []); setLoading(false); setSelectedIdx(0); })
        .catch(() => setLoading(false));

      // AI semantic search in parallel (min 3 chars)
      if (query.trim().length >= 3) {
        setAiLoading(true);
        setAiError(false);
        apiFetch('/api/instruments/semantic-search', {
          method: 'POST',
          body: JSON.stringify({ query: query.trim() }),
        })
          .then(r => { if (!r.ok) throw new Error('AI error'); return r.json(); })
          .then(d => { setAiResults(d.results || []); setAiLoading(false); })
          .catch(() => { setAiResults([]); setAiLoading(false); setAiError(true); });
      } else {
        setAiResults([]);
        setAiLoading(false);
        setAiError(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Group results by companyId (multi-listing support)
  const groupedByCompany = useMemo(() => {
    const companyGroups = {};
    const ungrouped = [];
    for (const r of results) {
      if (r.companyId) {
        if (!companyGroups[r.companyId]) companyGroups[r.companyId] = [];
        companyGroups[r.companyId].push(r);
      } else {
        ungrouped.push(r);
      }
    }
    // Build display list: primary + alternates
    const displayItems = [];
    for (const [cid, items] of Object.entries(companyGroups)) {
      displayItems.push({ ...items[0], _alternates: items.slice(1) });
    }
    displayItems.push(...ungrouped);
    // Maintain original order by tracking positions
    const posMap = {};
    results.forEach((r, idx) => {
      if (!posMap[r.companyId || r.symbolKey]) posMap[r.companyId || r.symbolKey] = idx;
    });
    displayItems.sort((a, b) => {
      const aPos = posMap[a.companyId || a.symbolKey] ?? results.length;
      const bPos = posMap[b.companyId || b.symbolKey] ?? results.length;
      return aPos - bPos;
    });
    return displayItems;
  }, [results]);

  // Build combined flat list for keyboard nav: registry results + AI results
  const allItems = useMemo(() => {
    const items = groupedByCompany.map(r => ({ ...r, _source: 'registry' }));
    // Add AI results that aren't already in registry results
    const registryKeys = new Set(groupedByCompany.map(r => r.symbolKey));
    for (const ai of aiResults) {
      if (!registryKeys.has(ai.symbol)) {
        items.push({ symbolKey: ai.symbol, name: ai.name, assetClass: ai.assetClass, aiReason: ai.aiReason, _source: 'ai' });
      }
    }
    return items;
  }, [groupedByCompany, aiResults]);

  // Keyboard nav
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); setResults([]); setAiResults([]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, allItems.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && allItems[selectedIdx]) {
      e.preventDefault();
      const item = allItems[selectedIdx];
      onOpenDetail?.(item.symbolKey);
      setOpen(false);
      setQuery('');
      setResults([]);
      setAiResults([]);
    }
  }, [allItems, selectedIdx, onOpenDetail]);

  const selectItem = (item) => {
    onOpenDetail?.(item.symbolKey || item.symbol);
    setOpen(false);
    setQuery('');
    setResults([]);
    setAiResults([]);
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
        <span className="hsb-input-label">SEARCH</span>
        <input
          ref={inputRef}
          className="hsb-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search any ticker, company, theme, or ask AI..."
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
                    <div
                      className={`hsb-result ${idx === selectedIdx ? 'hsb-result--active' : ''}`}
                      onClick={() => selectItem(item)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      <span className={`hsb-badge hsb-badge--${item.assetClass}`}>{typeBadge(item)}</span>
                      <span className="hsb-symbol">{item.symbolKey}</span>
                      <span className="hsb-name">{item.name}</span>
                      {item.exchange && <span className="hsb-exchange">{item.exchange}</span>}
                    </div>
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
