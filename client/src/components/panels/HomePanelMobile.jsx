/**
 * HomePanelMobile.jsx
 *
 * Mobile Home tab — curated 6 section cards + news card.
 * Each section shows 3-4 key tickers with live price and change%.
 * Tapping a card navigates to the full section.
 * Tapping a ticker opens InstrumentDetail.
 *
 * Phase 5 rewrite: all prices come from useTickerPrice (PriceContext)
 * instead of raw MarketContext maps. This fixes the key-mismatch bug
 * where prefixed symbols (C:EURUSD, X:BTCUSD, PETR4.SA) would show "--"
 * because MarketContext strips prefixes during normalization.
 */

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useTickerPrice } from '../../context/PriceContext';
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
  if (v == null) return null;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function displaySymbol(sym) {
  if (!sym) return '';
  if (sym.startsWith('C:')) return sym.slice(2, 5) + '/' + sym.slice(5);
  if (sym.startsWith('X:')) return sym.slice(2).replace('USD', '');
  if (sym.endsWith('.SA')) return sym.slice(0, -3);
  return sym;
}

/* ── TickerRow: individual row that calls useTickerPrice for proper data ──── */
const TickerRow = memo(function TickerRow({ symbol, onOpenDetail }) {
  const quote = useTickerPrice(symbol);
  const priceStr = formatPrice(quote?.price);
  const pct = quote?.changePct;

  return (
    <div
      className="hpm-ticker-row"
      onClick={(e) => { e.stopPropagation(); onOpenDetail?.(symbol); }}
    >
      <span className="hpm-ticker-sym">{displaySymbol(symbol)}</span>
      <span className="hpm-ticker-price">
        {priceStr != null
          ? priceStr
          : <span className="hpm-ticker-loading">LOADING</span>
        }
      </span>
      <span className={`hpm-ticker-chg ${pct != null && pct >= 0 ? 'up' : pct != null ? 'down' : ''}`}>
        {pct != null
          ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
          : priceStr != null ? 'NO DATA' : ''
        }
      </span>
    </div>
  );
});

/* ── SectionCard: renders a section header + ticker rows ─────────────────── */
const SectionCard = memo(function SectionCard({ section, tickers, onOpenDetail, onSectionClick }) {
  return (
    <div className="hpm-section-card" onClick={() => onSectionClick?.(section.id)}>
      <div className="hpm-section-header">
        <span className="hpm-section-title">{section.label}</span>
        <span className="hpm-section-arrow">&rsaquo;</span>
      </div>
      <div className="hpm-ticker-list">
        {tickers.slice(0, 4).map(sym => (
          <TickerRow key={sym} symbol={sym} onOpenDetail={onOpenDetail} />
        ))}
      </div>
    </div>
  );
});

/* ── Main component ──────────────────────────────────────────────────────── */
function HomePanelMobile({ onOpenDetail, onSearchClick }) {
  const { settings } = useSettings();
  const [news, setNews] = useState([]);
  const [aiPulse, setAiPulse] = useState(null);
  const [aiPulseLoading, setAiPulseLoading] = useState(false);

  // Fetch top news headlines
  useEffect(() => {
    apiFetch('/api/news')
      .then(r => r.ok ? r.json() : { articles: [] })
      .then(d => setNews((d.articles || d.results || []).slice(0, 5)))
      .catch(() => {});
  }, []);

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

  const fetchAiPulse = useCallback(() => {
    if (aiPulseLoading || aiPulse) return;
    setAiPulseLoading(true);
    apiFetch('/api/search/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Give me a brief 2-sentence market pulse summary for today. Focus on major US indices, any notable moves, and overall sentiment.' }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.reply || data?.response) {
          setAiPulse(data.reply || data.response);
        }
      })
      .catch(() => {})
      .finally(() => setAiPulseLoading(false));
  }, [aiPulseLoading, aiPulse]);

  const handleSectionClick = (sectionId) => {
    if (onSearchClick) onSearchClick('search');
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

      {/* AI Market Pulse card */}
      <div className="hpm-ai-card" onClick={fetchAiPulse}>
        <span className="hpm-ai-badge">MARKET PULSE</span>
        {!aiPulse && !aiPulseLoading && (
          <div className="hpm-ai-tagline">Tap for AI-powered market overview</div>
        )}
        {aiPulseLoading && <div className="hpm-ai-loading">Analyzing markets...</div>}
        {aiPulse && <div className="hpm-ai-result">{aiPulse}</div>}
      </div>

      {/* Curated Section Cards */}
      <div className="hpm-section-grid">
        {MOBILE_HOME_SECTIONS.map(section => (
          <SectionCard
            key={section.id}
            section={section}
            tickers={SECTION_TICKERS[section.id] || []}
            onOpenDetail={onOpenDetail}
            onSectionClick={handleSectionClick}
          />
        ))}

        {/* User-Added Section Cards (from Search → Add to Home) */}
        {userSections.map(section => (
          <div className="hpm-section-card" key={`user-${section.id}`}>
            <div className="hpm-section-header">
              <span className="hpm-section-title">{section.label}</span>
            </div>
            <div className="hpm-ticker-list">
              {section.symbols.slice(0, 4).map(sym => (
                <TickerRow key={sym} symbol={sym} onOpenDetail={onOpenDetail} />
              ))}
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
