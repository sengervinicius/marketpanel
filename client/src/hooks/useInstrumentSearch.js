import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { FOREX_PAIRS, CRYPTO_PAIRS } from '../utils/constants';
import { resolveAlias } from '../config/instrumentAliases';

// ── Module-level recent searches store (survives re-renders, not page refresh) ──
let _recentSearches = [];

/**
 * Local FX/Crypto search from constants
 */
function localSearch(q) {
  if (!q || q.trim().length < 2) return [];
  const uq = q.toUpperCase().replace(/[\s/\-]/g, '');
  const fxResults = FOREX_PAIRS
    .filter(p => p.symbol.includes(uq) || p.label.replace('/', '').includes(uq))
    .map(p => ({
      symbol: 'C:' + p.symbol,
      symbolKey: 'C:' + p.symbol,
      name: p.label + ' Exchange Rate',
      assetClass: 'forex',
      type: 'CURRENCY',
      local: true,
      _source: 'local',
    }));
  const cryptoResults = CRYPTO_PAIRS
    .filter(c => c.symbol.toUpperCase().includes(uq) || c.label.toUpperCase().includes(q.trim().toUpperCase()))
    .map(c => ({
      symbol: 'X:' + c.symbol,
      symbolKey: 'X:' + c.symbol,
      name: c.label + ' / USD',
      assetClass: 'crypto',
      type: 'CRYPTO',
      local: true,
      _source: 'local',
    }));
  return [...fxResults, ...cryptoResults];
}

/**
 * useInstrumentSearch — unified search hook used by both HeaderSearchBar and SearchPanel.
 *
 * Combines: local FX/crypto search, registry search, Polygon search, and AI semantic search.
 * Returns normalized results with consistent shape.
 */
export function useInstrumentSearch({ debounceMs = 220, registryLimit = 20, enablePolygon = false, enableAiAuto = false } = {}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [aiResults, setAiResults] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  // Recent searches
  const [recentSearches, setRecentSearches] = useState(_recentSearches);

  const addToRecents = useCallback((item) => {
    const key = item.symbolKey || item.symbol;
    const updated = [item, ..._recentSearches.filter(x => (x.symbolKey || x.symbol) !== key)].slice(0, 5);
    _recentSearches = updated;
    setRecentSearches(updated);
  }, []);

  // Clear search state
  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setAiResults([]);
    setAiError(null);
    setAiLoading(false);
    setSelectedIdx(0);
  }, []);

  // AI semantic search (explicit trigger)
  const searchAI = useCallback(async (q) => {
    if (!q || q.trim().length < 3) return;
    setAiLoading(true);
    setAiError(null);
    try {
      // Try the semantic-search endpoint first (HeaderSearchBar's endpoint)
      const res = await apiFetch('/api/instruments/semantic-search', {
        method: 'POST',
        body: JSON.stringify({ query: q.trim() }),
      });
      if (!res.ok) throw new Error('AI error');
      const data = await res.json();
      setAiResults((data.results || []).map(r => ({
        symbol: r.symbol,
        symbolKey: r.symbol,
        name: r.name,
        assetClass: r.assetClass,
        aiReason: r.aiReason || r.reason,
        _source: 'ai',
      })));
    } catch {
      // Fall back to instrument-lookup endpoint (SearchPanel's endpoint)
      try {
        const res2 = await apiFetch('/api/search/instrument-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q.trim() }),
        });
        if (!res2.ok) throw new Error('AI fallback error');
        const data2 = await res2.json();
        setAiResults((data2.results || []).map(r => ({
          symbol: r.symbol,
          symbolKey: r.symbol,
          name: r.name,
          assetClass: r.assetClass,
          aiReason: r.aiReason || r.reason,
          _source: 'ai',
        })));
      } catch {
        setAiError('AI search unavailable');
        setAiResults([]);
      }
    } finally {
      setAiLoading(false);
    }
  }, []);

  // Main search function
  const executeSearch = useCallback(async (q) => {
    if (!q.trim()) {
      setResults([]);
      setAiResults([]);
      setAiLoading(false);
      setAiError(null);
      return;
    }

    // Start with local results immediately
    const local = localSearch(q);
    setResults(local);
    setLoading(true);
    setSelectedIdx(0);

    // Abort previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Registry search (always)
      const registryPromise = apiFetch(
        `/api/instruments/search?q=${encodeURIComponent(q)}&limit=${registryLimit}`,
        { signal: controller.signal }
      ).then(r => r.json()).catch(() => ({ results: [] }));

      // Polygon search (SearchPanel mode)
      const polygonPromise = enablePolygon
        ? apiFetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
            .then(r => r.json()).catch(() => ({ results: [] }))
        : Promise.resolve({ results: [] });

      // AI search in parallel (HeaderSearchBar mode, min 3 chars)
      if (!enablePolygon && q.trim().length >= 3) {
        // Don't await — let it run in parallel
        setAiLoading(true);
        setAiError(null);
        apiFetch('/api/instruments/semantic-search', {
          method: 'POST',
          body: JSON.stringify({ query: q.trim() }),
          signal: controller.signal,
        })
          .then(r => { if (!r.ok) throw new Error(); return r.json(); })
          .then(d => {
            if (!controller.signal.aborted) {
              setAiResults((d.results || []).map(r => ({
                symbol: r.symbol,
                symbolKey: r.symbol,
                name: r.name,
                assetClass: r.assetClass,
                aiReason: r.aiReason || r.reason,
                _source: 'ai',
              })));
              setAiLoading(false);
            }
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              setAiResults([]);
              setAiLoading(false);
              setAiError(true);
            }
          });
      } else if (!enablePolygon) {
        setAiResults([]);
        setAiLoading(false);
        setAiError(null);
      }

      const [regData, polyData] = await Promise.all([registryPromise, polygonPromise]);

      if (controller.signal.aborted) return;

      const regItems = regData.results || [];
      const polyItems = polyData.results || [];

      // Normalize registry results
      const fromRegistry = regItems.map(r => ({
        symbol: r.symbolKey || r.symbol,
        symbolKey: r.symbolKey || r.symbol,
        name: r.name,
        assetClass: r.assetClass,
        type: (r.assetClass || '').toUpperCase(),
        exchange: r.exchange,
        companyId: r.companyId,
        currency: r.currency,
        market: 'stocks',
        group: r.group,
        local: false,
        fromRegistry: true,
        isFutures: r.isFutures,
        isETFProxy: r.isETFProxy,
        _source: 'registry',
        _raw: r,
      }));

      // Normalize Polygon results (deduped)
      const seen = new Set([...local.map(l => l.symbol), ...fromRegistry.map(r => r.symbol)]);
      const fromPoly = polyItems
        .filter(r => !seen.has(r.ticker || r.symbol))
        .map(r => ({
          symbol: r.ticker || r.symbol,
          symbolKey: r.ticker || r.symbol,
          name: r.name,
          type: r.type,
          assetType: r.assetType || null,
          market: r.market,
          primaryExchange: r.primaryExchange || r.market || '',
          exchange: r.exchange || '',
          active: r.active,
          _source: 'polygon',
        }));

      // Merge and dedupe
      const allSeen = new Set();
      const merged = [...local, ...fromRegistry, ...fromPoly]
        .filter(item => {
          if (allSeen.has(item.symbol)) return false;
          allSeen.add(item.symbol);
          return true;
        })
        .slice(0, 20);

      setResults(merged);
      setLoading(false);

      // Auto-trigger AI if few results (SearchPanel mode)
      if (enablePolygon && enableAiAuto && merged.length < 3 && q.trim().length >= 3) {
        searchAI(q);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLoading(false);
      }
    }
  }, [registryLimit, enablePolygon, enableAiAuto, searchAI]);

  // Debounced search triggered by query change
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setAiResults([]);
      setAiLoading(false);
      setAiError(null);
      return;
    }
    debounceRef.current = setTimeout(() => executeSearch(query), debounceMs);
    return () => clearTimeout(debounceRef.current);
  }, [query, debounceMs, executeSearch]);

  // Group results by companyId (for HeaderSearchBar alternates)
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
    const displayItems = [];
    for (const [, items] of Object.entries(companyGroups)) {
      displayItems.push({ ...items[0], _alternates: items.slice(1) });
    }
    displayItems.push(...ungrouped);
    // Maintain original order
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

  // Combined flat list for keyboard nav (registry + AI, deduped)
  const allItems = useMemo(() => {
    const items = [...groupedByCompany];
    const registryKeys = new Set(groupedByCompany.map(r => r.symbolKey));
    for (const ai of aiResults) {
      if (!registryKeys.has(ai.symbol)) {
        items.push(ai);
      }
    }
    return items;
  }, [groupedByCompany, aiResults]);

  // Handle result click: normalize and apply alias resolution
  const handleResultClick = useCallback((result) => {
    if (!result) return null;
    const rawSymbol = result.symbolKey || result.symbol;
    if (!rawSymbol) return null;
    const resolved = resolveAlias(rawSymbol);
    return {
      symbol: resolved,
      name: result.name || result.label || resolved,
      assetClass: result.assetClass || result.type || 'unknown',
      exchange: result.exchange || null,
      raw: result,
    };
  }, []);

  return {
    query,
    setQuery,
    results,
    groupedByCompany,
    allItems,
    loading,
    aiResults,
    aiLoading,
    aiError,
    selectedIdx,
    setSelectedIdx,
    recentSearches,
    addToRecents,
    clearSearch,
    searchAI,
    handleResultClick,
  };
}
