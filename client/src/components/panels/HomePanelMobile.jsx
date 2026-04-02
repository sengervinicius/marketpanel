/**
 * HomePanelMobile.jsx
 *
 * Mobile Home tab — curated 6 section cards + news card.
 * Each section shows 3-4 key tickers with live price and change%.
 * Tapping a card navigates to the full section.
 * Tapping a ticker opens InstrumentDetail.
 */

import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { useStocksData, useForexData, useCryptoData } from '../../context/MarketContext';
import { useSettings } from '../../context/SettingsContext';
import { apiFetch } from '../../utils/api';
import './HomePanelMobile.css';

const MOBILE_HOME_SECTIONS = [
  { id: 'us-equities',    label: 'US Equities' },
  { id: 'fx-rates',       label: 'FX / Rates' },
  { id: 'global-indexes', label: 'Global Indexes' },
  { id: 'brazil-b3',      label: 'Brazil B3' },
  { id: 'commodities',    label: 'Commodities' },
  { id: 'crypto',         label: 'Crypto' },
];

const SECTION_TICKERS = {
  'us-equities':    ['SPY', 'QQQ', 'AAPL', 'MSFT'],
  'fx-rates':       ['C:EURUSD', 'C:GBPUSD', 'C:USDJPY', 'C:USDBRL'],
  'global-indexes': ['EEM', 'EFA', 'EWZ', 'FXI'],
  'brazil-b3':      ['PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'BBDC4.SA'],
  'commodities':    ['GLD', 'SLV', 'USO', 'UNG'],
  'crypto':         ['X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'X:BNBUSD'],
};

function formatPrice(v) {
  if (v == null) return '--';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function displaySymbol(sym) {
  if (!sym) return '';
  if (sym.startsWith('C:')) return sym.slice(2, 5) + '/' + sym.slice(5);
  if (sym.startsWith('X:')) return sym.slice(2).replace('USD', '');
  if (sym.endsWith('.SA')) return sym.slice(0, -3);
  return sym;
}

function HomePanelMobile({ onOpenDetail, onSearchClick }) {
  const stocksData = useStocksData();
  const forexData = useForexData();
  const cryptoData = useCryptoData();
  const { settings } = useSettings();
  const [news, setNews] = useState([]);
  const [customQuotes, setCustomQuotes] = useState({});
  const fetchedRef = useRef(new Set());

  // Fetch top news headlines
  useEffect(() => {
    apiFetch('/api/news')
      .then(r => r.ok ? r.json() : { articles: [] })
      .then(d => setNews((d.articles || d.results || []).slice(0, 5)))
      .catch(() => {});
  }, []);

  function getPrice(sym) {
    return stocksData[sym] || forexData[sym] || cryptoData[sym] || customQuotes[sym] || null;
  }

  // Collect custom symbols from user-added home sections
  const customSymbols = useMemo(() => {
    const sections = settings?.home?.sections || [];
    const syms = [];
    for (const s of sections) {
      for (const sym of (s.symbols || [])) {
        // Skip if already in a curated section or already fetched
        const inCurated = Object.values(SECTION_TICKERS).flat().includes(sym);
        if (!inCurated) syms.push(sym);
      }
    }
    return [...new Set(syms)].slice(0, 10); // cap at 10
  }, [settings?.home?.sections]);

  // Fetch quotes for custom symbols not in MarketContext data
  useEffect(() => {
    if (customSymbols.length === 0) return;
    for (const sym of customSymbols) {
      // Skip if already in market data or already fetched this session
      if (stocksData[sym] || forexData[sym] || cryptoData[sym]) continue;
      if (fetchedRef.current.has(sym)) continue;
      fetchedRef.current.add(sym);
      apiFetch(`/api/quote/${encodeURIComponent(sym)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && data.price != null) {
            setCustomQuotes(prev => ({
              ...prev,
              [sym]: {
                symbol: sym,
                price: data.price,
                change: data.change ?? null,
                changePct: data.changePct ?? null,
              },
            }));
          }
        })
        .catch(() => {});
    }
  }, [customSymbols, stocksData, forexData, cryptoData]);

  // Build user-added sections for rendering alongside curated ones
  const userSections = useMemo(() => {
    const sections = settings?.home?.sections || [];
    return sections
      .filter(s => (s.symbols || []).some(sym => !Object.values(SECTION_TICKERS).flat().includes(sym)))
      .map(s => ({
        id: s.id,
        label: s.title || s.id,
        symbols: s.symbols || [],
      }));
  }, [settings?.home?.sections]);

  const sectionData = useMemo(() => {
    const result = {};
    for (const section of MOBILE_HOME_SECTIONS) {
      const tickers = SECTION_TICKERS[section.id] || [];
      result[section.id] = tickers.map(sym => {
        const d = getPrice(sym);
        return {
          ticker: displaySymbol(sym),
          rawSymbol: sym,
          price: d?.price ?? null,
          change: d?.change ?? null,
          changePct: d?.changePct ?? null,
        };
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocksData, forexData, cryptoData]);

  const openSection = (sectionId) => {
    // Map section IDs to mobile tabs or detail views
    const tabMap = {
      'us-equities': 'search',
      'fx-rates': 'search',
      'global-indexes': 'search',
      'brazil-b3': 'search',
      'commodities': 'search',
      'crypto': 'search',
    };
    if (onSearchClick) onSearchClick(tabMap[sectionId] || 'search');
  };

  const openNews = (item) => {
    const url = item.article_url || item.link || item.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="hpm-container">
      {/* Search Bar */}
      <div className="hpm-search-container">
        <input
          type="text"
          className="m-search"
          placeholder="Search instruments..."
          onClick={onSearchClick}
          readOnly
        />
      </div>

      {/* Curated Section Cards */}
      <div className="hpm-section-grid">
        {MOBILE_HOME_SECTIONS.map(section => (
          <div className="hpm-section-card" key={section.id} onClick={() => openSection(section.id)}>
            <div className="hpm-section-header">
              <span className="hpm-section-title">{section.label}</span>
              <span className="hpm-section-arrow">&rsaquo;</span>
            </div>
            <div className="hpm-ticker-list">
              {(sectionData[section.id] || []).slice(0, 4).map(t => (
                <div
                  className="hpm-ticker-row"
                  key={t.ticker}
                  onClick={(e) => { e.stopPropagation(); onOpenDetail?.(t.rawSymbol); }}
                >
                  <span className="hpm-ticker-sym">{t.ticker}</span>
                  <span className="hpm-ticker-price">{formatPrice(t.price)}</span>
                  <span className={`hpm-ticker-chg ${t.changePct != null && t.changePct >= 0 ? 'up' : 'down'}`}>
                    {t.changePct != null ? `${t.changePct >= 0 ? '+' : ''}${t.changePct.toFixed(2)}%` : '--'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* User-Added Section Cards (from Search → Add to Home) */}
        {userSections.map(section => (
          <div className="hpm-section-card" key={`user-${section.id}`}>
            <div className="hpm-section-header">
              <span className="hpm-section-title">{section.label}</span>
            </div>
            <div className="hpm-ticker-list">
              {section.symbols.slice(0, 4).map(sym => {
                const d = getPrice(sym);
                return (
                  <div
                    className="hpm-ticker-row"
                    key={sym}
                    onClick={(e) => { e.stopPropagation(); onOpenDetail?.(sym); }}
                  >
                    <span className="hpm-ticker-sym">{displaySymbol(sym)}</span>
                    <span className="hpm-ticker-price">{formatPrice(d?.price)}</span>
                    <span className={`hpm-ticker-chg ${d?.changePct != null && d.changePct >= 0 ? 'up' : 'down'}`}>
                      {d?.changePct != null ? `${d.changePct >= 0 ? '+' : ''}${d.changePct.toFixed(2)}%` : '--'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* News Feed Card */}
      {news.length > 0 && (
        <div className="hpm-news-card">
          <div className="hpm-section-header">
            <span className="hpm-section-title">News Feed</span>
          </div>
          {news.slice(0, 5).map((item, i) => (
            <div className="hpm-news-item" key={i} onClick={() => openNews(item)}>
              <div className="hpm-news-source">{item.publisher?.name || item.source || ''}</div>
              <div className="hpm-news-headline">{item.title}</div>
              <div className="hpm-news-time">
                {item.published_utc ? (() => {
                  const diff = (Date.now() - new Date(item.published_utc).getTime()) / 1000;
                  if (diff < 60) return 'now';
                  if (diff < 3600) return Math.round(diff / 60) + 'm ago';
                  if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
                  return Math.round(diff / 86400) + 'd ago';
                })() : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(HomePanelMobile);
