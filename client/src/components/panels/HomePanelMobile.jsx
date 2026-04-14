/**
 * HomePanelMobile.jsx
 *
 * Mobile Home tab — curated section cards with live prices.
 * Phase M: Shows expandable ticker lists (all tickers per section),
 * fixes ticker→detail navigation so tapped symbol opens correctly,
 * and adds "View all" expansion.
 */

import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { apiFetch } from '../../utils/api';
import {
  US_STOCKS, BRAZIL_ADRS, FOREX_PAIRS, CRYPTO_PAIRS, COMMODITIES,
} from '../../utils/constants';
import { getMobileHomeScreens } from '../../config/templates';
import { checkAIAvailable } from '../../hooks/useAIInsight';
import OptionsHomeWidget from '../common/OptionsHomeWidget';
import './HomePanelMobile.css';

/**
 * Phase 4: Featured Sector Cards — surfaces sector screens prominently on mobile Home.
 * Shows live ETF price + change as tappable cards.
 */
const FEATURED_SECTORS = [
  { id: 'technology',       label: 'Tech & AI',   etf: 'XLK',  color: '#00bcd4' },
  { id: 'defence',          label: 'Defence',      etf: 'ITA',  color: '#ef5350' },
  { id: 'commodities',      label: 'Commodities',  etf: 'DJP',  color: '#ff9800' },
  { id: 'crypto',           label: 'Crypto',       etf: 'BITO', color: '#f7931a' },
  { id: 'global-macro',     label: 'Macro',        etf: 'SPY',  color: '#9c27b0' },
  { id: 'brazil-em',        label: 'Brazil',       etf: 'EWZ',  color: '#4caf50' },
  { id: 'asian-markets',    label: 'Asia',         etf: 'EWJ',  color: '#ff5722' },
  { id: 'european-markets', label: 'Europe',       etf: 'VGK',  color: '#3f51b5' },
];

const SectorChip = memo(function SectorChip({ sector, onTap }) {
  const q = useTickerPrice(sector.etf);
  const pct = q?.changePct;
  const isUp = pct != null && pct >= 0;
  return (
    <button
      className="hpm-sector-chip"
      style={{ borderColor: sector.color + '44' }}
      onClick={() => onTap(sector.id)}
    >
      <span className="hpm-sector-chip-label">{sector.label}</span>
      <span className={`hpm-sector-chip-pct ${isUp ? 'up' : pct != null ? 'down' : ''}`}>
        {pct != null ? `${isUp ? '+' : ''}${pct.toFixed(1)}%` : '...'}
      </span>
    </button>
  );
});

const FeaturedSectors = memo(function FeaturedSectors({ onSectorScreen }) {
  if (!onSectorScreen) return null;
  return (
    <div className="hpm-sectors-featured">
      <div className="hpm-section-header" style={{ padding: '0 16px' }}>
        <span className="hpm-section-title">Sector Screens</span>
        <span className="hpm-section-count">{FEATURED_SECTORS.length}</span>
      </div>
      <div className="hpm-sectors-scroll">
        {FEATURED_SECTORS.map(s => (
          <SectorChip key={s.id} sector={s} onTap={onSectorScreen} />
        ))}
      </div>
    </div>
  );
});

// Curated sections aligned to PARTICLE_HOME_SCREEN_REPORT.md audit
// Order: US leadership → global overview → FX → crypto → commodities → Brazil
const MOBILE_HOME_SECTIONS = [
  { id: 'us-equities',    label: 'US Equities' },
  { id: 'global-indexes', label: 'Global Indexes' },
  { id: 'fx-markets',     label: 'FX Markets' },
  { id: 'crypto',         label: 'Crypto' },
  { id: 'commodities',    label: 'Commodities' },
  { id: 'brazil-b3',      label: 'Brazil B3' },
];

// Preview tickers shown collapsed (first N per section)
const PREVIEW_COUNT = 4;

// Curated ticker lists per section — globally representative, audit-aligned
const SECTION_TICKERS = {
  'us-equities':    ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'JPM', 'XOM', 'GS', 'WMT', 'LLY', 'BRK-B'],
  'global-indexes': ['SPY', 'QQQ', 'DIA', 'IWM', 'EWZ', 'EEM', 'VGK', 'EWJ', 'FXI', 'EFA'],
  'fx-markets':     ['C:EURUSD', 'C:USDJPY', 'C:GBPUSD', 'C:USDBRL', 'C:USDCNY', 'C:USDCHF', 'C:AUDUSD', 'C:USDCAD', 'C:USDMXN'],
  'brazil-b3':      ['PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'BBDC4.SA', 'ABEV3.SA', 'WEGE3.SA', 'B3SA3.SA', 'BBAS3.SA'],
  'commodities':    ['GLD', 'SLV', 'USO', 'UNG', 'CORN', 'WEAT', 'SOYB', 'CPER', 'BHP'],
  'crypto':         ['X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'X:XRPUSD', 'X:BNBUSD', 'X:DOGEUSD'],
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
const TickerRow = memo(function TickerRow({ symbol }) {
  const quote = useTickerPrice(symbol);
  const priceStr = formatPrice(quote?.price);
  const pct = quote?.changePct;
  const openDetail = useOpenDetail();

  return (
    <div
      className="hpm-ticker-row"
      onClick={(e) => {
        e.stopPropagation();
        openDetail(symbol);
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

/* ── SectionLoadingCheck: returns true if at least one ticker has data ── */
function useSectionHasData(tickers) {
  // Check first 4 tickers (preview set) for any loaded price
  const t0 = useTickerPrice(tickers[0]);
  const t1 = useTickerPrice(tickers[1] || tickers[0]);
  const t2 = useTickerPrice(tickers[2] || tickers[0]);
  const t3 = useTickerPrice(tickers[3] || tickers[0]);
  return t0?.price != null || t1?.price != null || t2?.price != null || t3?.price != null;
}

/* ── Section skeleton for loading state ────────────────────────── */
function SectionSkeleton({ count = 4 }) {
  return (
    <div className="hpm-ticker-list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="hpm-ticker-row" style={{ opacity: 0.3 }}>
          <span className="hpm-ticker-sym" style={{ background: '#1a1a1a', borderRadius: 3, width: 40, height: 12, display: 'inline-block' }} />
          <span className="hpm-ticker-price" style={{ background: '#1a1a1a', borderRadius: 3, width: 50, height: 12, display: 'inline-block' }} />
          <span style={{ background: '#1a1a1a', borderRadius: 3, width: 40, height: 12, display: 'inline-block' }} />
        </div>
      ))}
      <div style={{ textAlign: 'center', fontSize: 9, color: '#555', padding: '4px 0' }}>Loading prices...</div>
    </div>
  );
}

/* ── SectionCard: expandable card with View All ─────────────────── */
const SectionCard = memo(function SectionCard({ section, tickers }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = useSectionHasData(tickers);
  const needsExpand = tickers.length > PREVIEW_COUNT;
  const visibleTickers = expanded ? tickers : tickers.slice(0, PREVIEW_COUNT);

  return (
    <div className="hpm-section-card">
      <div className="hpm-section-header">
        <span className="hpm-section-title">{section.label}</span>
        <span className="hpm-section-count">{tickers.length}</span>
      </div>
      {!hasData ? (
        <SectionSkeleton count={Math.min(tickers.length, PREVIEW_COUNT)} />
      ) : (
        <div className="hpm-ticker-list">
          {visibleTickers.map(sym => (
            <TickerRow key={sym} symbol={sym} />
          ))}
        </div>
      )}
      {needsExpand && hasData && (
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

/* ── MarketScreensGallery: horizontal-scroll screen cards ──── */
const MarketScreensGallery = memo(function MarketScreensGallery({ onApplyScreen }) {
  const screens = useMemo(() => getMobileHomeScreens(), []);
  const [applying, setApplying] = useState(null);

  const handleTap = useCallback(async (screen) => {
    if (applying) return;
    setApplying(screen.id);
    try { await onApplyScreen?.(screen.id, 'full'); } catch {}
    setTimeout(() => setApplying(null), 600);
  }, [applying, onApplyScreen]);

  if (!screens.length) return null;

  return (
    <div className="hpm-screens-section">
      <div className="hpm-section-header" style={{ padding: '0 16px' }}>
        <span className="hpm-section-title">Market Screens</span>
        <span className="hpm-section-count">{screens.length}</span>
      </div>
      <div className="hpm-screens-scroll">
        {screens.map(s => (
          <div
            key={s.id}
            className={`hpm-screen-card ${applying === s.id ? 'hpm-screen-card--applying' : ''}`}
            style={{ borderLeftColor: s.mobileCardStyle || 'var(--color-particle, #F97316)' }}
            onClick={() => handleTap(s)}
          >
            <div className="hpm-screen-card-label">{s.visualLabel}</div>
            <div className="hpm-screen-card-subtitle">{s.subtitle}</div>
            <div className="hpm-screen-card-heroes">
              {(s.heroSymbols || []).slice(0, 3).map(sym => (
                <span key={sym} className="hpm-screen-card-hero">{sym.replace('.SA','').replace('=F','')}</span>
              ))}
            </div>
            {applying === s.id && <div className="hpm-screen-card-applying">Applying...</div>}
          </div>
        ))}
      </div>
    </div>
  );
});

/* ── Main component ──────────────────────────────────────────────── */
function HomePanelMobile({ onSearchClick, onSectorScreen }) {
  const { settings, applyTemplate } = useSettings();
  const [news, setNews] = useState([]);
  const [aiPulse, setAiPulse] = useState(null);
  const [aiPulseLoading, setAiPulseLoading] = useState(false);
  const [aiPulseError, setAiPulseError] = useState(null);

  // ── Pull-to-refresh ──────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const [pullY, setPullY] = useState(0);
  const touchStartY = useRef(0);
  const containerRef = useRef(null);

  const PULL_THRESHOLD = 60;

  const handleTouchStart = useCallback((e) => {
    if (containerRef.current && containerRef.current.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
    } else {
      touchStartY.current = 0;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!touchStartY.current) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0 && dy <= 120) {
      setPullY(dy);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (pullY >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullY(0);
      // Re-fetch news
      apiFetch('/api/news')
        .then(r => r.ok ? r.json() : { articles: [] })
        .then(d => setNews((d.articles || d.results || []).slice(0, 5)))
        .catch(() => {})
        .finally(() => {
          setTimeout(() => setRefreshing(false), 600);
        });
    } else {
      setPullY(0);
    }
    touchStartY.current = 0;
  }, [pullY, refreshing]);

  const fetchNews = useCallback(() => {
    apiFetch('/api/news')
      .then(r => r.ok ? r.json() : { articles: [] })
      .then(d => setNews((d.articles || d.results || []).slice(0, 5)))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchNews(); }, [fetchNews]);

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
    if (aiPulseLoading) return;

    // Check if AI is available before attempting fetch
    if (!checkAIAvailable()) {
      setAiPulseError('_unavailable');
      return;
    }

    setAiPulse(null);
    setAiPulseError(null);
    setAiPulseLoading(true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    apiFetch('/api/search/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Give me a brief 2-sentence market pulse summary for today. Focus on major US indices, any notable moves, and overall sentiment.' }),
      signal: controller.signal,
    })
      .then(r => {
        if (!r.ok) throw new Error('unavailable');
        return r.json();
      })
      .then(data => {
        if (data?.summary) {
          setAiPulse(data.summary);
        } else {
          setAiPulseError('_unavailable');
        }
      })
      .catch(() => {
        // Never show raw error — use sentinel for "unavailable" state
        setAiPulseError('_unavailable');
      })
      .finally(() => {
        clearTimeout(timer);
        setAiPulseLoading(false);
      });
  }, [aiPulseLoading]);

  const openNews = (item) => {
    const url = item.article_url || item.link || item.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="hpm-container"
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {(pullY > 10 || refreshing) && (
        <div className="hpm-ptr-indicator" style={{ height: refreshing ? 36 : Math.min(pullY, 60), opacity: refreshing ? 1 : Math.min(pullY / PULL_THRESHOLD, 1) }}>
          <span className={`hpm-ptr-text${refreshing ? ' hpm-ptr-spinning' : ''}`}>
            {refreshing ? '↻ Refreshing...' : pullY >= PULL_THRESHOLD ? '↑ Release to refresh' : '↓ Pull to refresh'}
          </span>
        </div>
      )}

      {/* AI Market Pulse card */}
      <div className="hpm-ai-card" onClick={fetchAiPulse}>
        <span className="hpm-ai-badge">MARKET PULSE</span>
        {!aiPulse && !aiPulseLoading && !aiPulseError && (
          <div className="hpm-ai-tagline">Tap for AI-powered market overview</div>
        )}
        {aiPulseLoading && <div className="hpm-ai-loading">Analyzing markets...</div>}
        {aiPulseError && !aiPulseLoading && (
          <div className="hpm-ai-error" style={{ color: '#888' }}>
            <span>Market data is loading</span>
            <span className="hpm-ai-retry">Tap to retry</span>
          </div>
        )}
        {aiPulse && <div className="hpm-ai-result">{aiPulse}</div>}
      </div>

      {/* Phase 4: Featured Sector Screen Cards */}
      <FeaturedSectors onSectorScreen={onSectorScreen} />

      {/* Phase 4: Prediction Markets tile */}
      <div className="hpm-feature-card" onClick={() => onSectorScreen?.('predictions')}>
        <div className="hpm-feature-icon" style={{ color: '#9c27b0' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
          </svg>
        </div>
        <div className="hpm-feature-text">
          <div className="hpm-feature-title">Prediction Markets</div>
          <div className="hpm-feature-sub">Kalshi + Polymarket — bet on real-world events</div>
        </div>
        <svg className="hpm-feature-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>

      {/* Phase 4: Brazil Markets featured card */}
      <div className="hpm-feature-card" onClick={() => onSectorScreen?.('brazil-em')}>
        <div className="hpm-feature-icon" style={{ color: '#4caf50' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div className="hpm-feature-text">
          <div className="hpm-feature-title">Brazil B3 & DI Curve</div>
          <div className="hpm-feature-sub">USD/BRL, DI futures, B3 stocks — unique coverage</div>
        </div>
        <svg className="hpm-feature-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>

      {/* Phase 4: Vault upload CTA card */}
      <div className="hpm-vault-cta" onClick={() => onSectorScreen?.('vault')}>
        <div className="hpm-vault-cta-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <line x1="12" y1="6" x2="12" y2="14" />
            <polyline points="9 11 12 14 15 11" />
          </svg>
        </div>
        <div className="hpm-vault-cta-text">
          <div className="hpm-vault-cta-title">Upload Research</div>
          <div className="hpm-vault-cta-sub">PDFs and reports make your AI smarter</div>
        </div>
        <svg className="hpm-vault-cta-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
      </div>

      {/* Options Flow Widget */}
      <OptionsHomeWidget onNavigate={(view) => {
        // Navigate to options flow tab in 'more' section
        if (onSearchClick) onSearchClick();
      }} />

      {/* Market Screens Gallery — horizontal scroll */}
      <MarketScreensGallery onApplyScreen={applyTemplate} />

      {/* Curated Section Cards — full ticker lists with View All */}
      <div className="hpm-section-grid">
        {MOBILE_HOME_SECTIONS.map(section => (
          <SectionCard
            key={section.id}
            section={section}
            tickers={SECTION_TICKERS[section.id] || []}
          />
        ))}

        {/* User-Added Section Cards */}
        {userSections.map(section => (
          <SectionCard
            key={`user-${section.id}`}
            section={{ id: section.id, label: section.label }}
            tickers={section.symbols}
          />
        ))}
      </div>

      {/* News Feed Card — always visible, shows loading skeleton or headlines */}
      <div className="hpm-news-card">
        <div className="hpm-section-header">
          <span className="hpm-section-title">News Feed</span>
          {news.length > 0 && <span className="hpm-section-count">{news.length}</span>}
        </div>
        {news.length === 0 ? (
          <div className="hpm-news-loading">
            {[1,2,3].map(i => (
              <div key={i} className="hpm-news-item" style={{ opacity: 0.4 }}>
                <div className="shimmer-bar" style={{ width: '30%', height: 10, marginBottom: 4 }} />
                <div className="shimmer-bar" style={{ width: '90%', height: 14, marginBottom: 4 }} />
                <div className="shimmer-bar" style={{ width: '20%', height: 10 }} />
              </div>
            ))}
          </div>
        ) : (
          news.slice(0, 5).map((item, i) => (
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
          ))
        )}
      </div>
    </div>
  );
}

export default memo(HomePanelMobile);
