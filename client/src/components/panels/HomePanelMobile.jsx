/**
 * HomePanelMobile.jsx
 *
 * Mobile Home tab — curated section cards with live prices.
 * Phase M: Shows expandable ticker lists (all tickers per section),
 * fixes ticker→detail navigation so tapped symbol opens correctly,
 * and adds "View all" expansion.
 */

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useTickerPrice } from '../../context/PriceContext';
import { apiFetch } from '../../utils/api';
import {
  US_STOCKS, BRAZIL_ADRS, FOREX_PAIRS, CRYPTO_PAIRS, COMMODITIES,
} from '../../utils/constants';
import './HomePanelMobile.css';

const MOBILE_HOME_SECTIONS = [
  { id: 'us-equities',    label: 'US Equities' },
  { id: 'fx-rates',       label: 'FX / Rates' },
  { id: 'global-indexes', label: 'Global Indexes' },
  { id: 'brazil-b3',      label: 'Brazil B3' },
  { id: 'commodities',    label: 'Commodities' },
  { id: 'crypto',         label: 'Crypto' },
];

// Preview tickers shown collapsed (first N per section)
const PREVIEW_COUNT = 4;

// Full ticker lists per section — matches desktop panels
const SECTION_TICKERS = {
  'us-equities':    US_STOCKS.map(s => s.symbol),
  'fx-rates':       FOREX_PAIRS.map(s => 'C:' + s.symbol),
  'global-indexes': ['SPY', 'QQQ', 'DIA', 'IWM', 'EEM', 'EFA', 'EWZ', 'FXI', 'EWJ'],
  'brazil-b3':      ['PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'BBDC4.SA', 'ABEV3.SA', 'PETR3.SA', 'WEGE3.SA'],
  'commodities':    COMMODITIES.map(s => s.symbol),
  'crypto':         CRYPTO_PAIRS.map(s => 'X:' + s.symbol),
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

/* ── TickerRow: individual row with live price from PriceContext ──── */
const TickerRow = memo(function TickerRow({ symbol, onOpenDetail }) {
  const quote = useTickerPrice(symbol);
  const priceStr = formatPrice(quote?.price);
  const pct = quote?.changePct;

  return (
    <div
      className="hpm-ticker-row"
      onClick={(e) => {
        e.stopPropagation();
        onOpenDetail?.(symbol);
      }}
    >
      <span className="hpm-ticker-sym">{displaySymbol(symbol)}</span>
      <span className="hpm-ticker-price">
        {priceStr != null
          ? priceStr
          : <span className="hpm-ticker-loading">--</span>
        }
      </span>
      <span className={`hpm-ticker-chg ${pct != null && pct >= 0 ? 'up' : pct != null ? 'down' : ''}`}>
        {pct != null
          ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
          : ''
        }
      </span>
    </div>
  );
});

/* ── SectionCard: expandable card with View All ─────────────────── */
const SectionCard = memo(function SectionCard({ section, tickers, onOpenDetail }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = tickers.length > PREVIEW_COUNT;
  const visibleTickers = expanded ? tickers : tickers.slice(0, PREVIEW_COUNT);

  return (
    <div className="hpm-section-card">
      <div className="hpm-section-header">
        <span className="hpm-section-title">{section.label}</span>
        <span className="hpm-section-count">{tickers.length}</span>
      </div>
      <div className="hpm-ticker-list">
        {visibleTickers.map(sym => (
          <TickerRow key={sym} symbol={sym} onOpenDetail={onOpenDetail} />
        ))}
      </div>
      {needsExpand && (
        <button
          className="hpm-view-all-btn"
          onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
        >
          {expanded ? 'Show less' : `View all ${tickers.length} tickers`}
        </button>
      )}
    </div>
  );
});

/* ── Main component ──────────────────────────────────────────────── */
function HomePanelMobile({ onOpenDetail, onSearchClick }) {
  const { settings } = useSettings();
  const [news, setNews] = useState([]);
  const [aiPulse, setAiPulse] = useState(null);
  const [aiPulseLoading, setAiPulseLoading] = useState(false);

  useEffect(() => {
    apiFetch('/api/news')
      .then(r => r.ok ? r.json() : { articles: [] })
      .then(d => setNews((d.articles || d.results || []).slice(0, 5)))
      .catch(() => {});
  }, []);

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
          className="hpm-search-input"
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

      {/* Curated Section Cards — full ticker lists with View All */}
      <div className="hpm-section-grid">
        {MOBILE_HOME_SECTIONS.map(section => (
          <SectionCard
            key={section.id}
            section={section}
            tickers={SECTION_TICKERS[section.id] || []}
            onOpenDetail={onOpenDetail}
          />
        ))}

        {/* User-Added Section Cards */}
        {userSections.map(section => (
          <SectionCard
            key={`user-${section.id}`}
            section={{ id: section.id, label: section.label }}
            tickers={section.symbols}
            onOpenDetail={onOpenDetail}
          />
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
