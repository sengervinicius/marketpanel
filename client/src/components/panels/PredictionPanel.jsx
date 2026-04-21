/**
 * PredictionPanel.jsx — Prediction Markets panel.
 *
 * CIO-note (2026-04-20): redesigned from stacked PredictionCard
 * components (4-row-per-item cards) to Bloomberg-style tabular rows.
 * One row per market. Columns:
 *   QUESTION | SOURCE | PROBABILITY BAR | PCT | VOL | CLOSE
 *
 * Category pills above remain (same interaction model) but the list
 * body is now a dense grid that matches StockPanel / WatchlistPanel
 * density. The bar is inline so probability shape is still visible.
 *
 * Data: /api/predictions (category browse) + /api/predictions/for-you
 * (personalized). 2-minute auto-refresh.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../utils/api';
import { PanelHeader, PanelTabRow } from './_shared';
import './PredictionPanel.css';

const REFRESH_INTERVAL = 120_000; // 2 min

const CATEGORY_LABELS = {
  'for-you':     '⚡ For You',
  'all':         'All',
  'fed-rates':   'Fed',
  'inflation':   'CPI',
  'economy':     'Econ',
  'markets':     'Markets',
  'crypto':      'Crypto',
  'politics':    'Politics',
  'geopolitics': 'World',
  'tech':        'Tech',
};

function probabilityColor(p) {
  if (p >= 0.7) return 'var(--color-up, #22c55e)';
  if (p >= 0.4) return 'var(--color-warning, #f59e0b)';
  return 'var(--color-down, #ef4444)';
}

function formatVolume(v) {
  if (!v) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function formatClose(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

export default function PredictionPanel() {
  const [markets, setMarkets]               = useState([]);
  const [categories, setCategories]         = useState([]);
  const [activeCategory, setActiveCategory] = useState('for-you');
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState(null);
  const [interests, setInterests]           = useState([]);
  const [isPersonalized, setIsPersonalized] = useState(false);
  const [lastUpdated, setLastUpdated]       = useState(null);
  const timerRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      if (activeCategory === 'for-you') {
        const [forYouData, catsData] = await Promise.all([
          apiFetch('/api/predictions/for-you?limit=12').then(r => r.json()).catch(() => null),
          apiFetch('/api/predictions/categories').then(r => r.json()).catch(() => null),
        ]);

        if (forYouData?.markets) {
          setMarkets(forYouData.markets);
          setIsPersonalized(forYouData.personalized || false);
          setInterests(forYouData.interests || []);
        }
        if (catsData?.categories) setCategories(catsData.categories);
      } else {
        const params = new URLSearchParams({ limit: '30' });
        if (activeCategory !== 'all') params.set('category', activeCategory);

        const [marketsData, catsData] = await Promise.all([
          apiFetch(`/api/predictions?${params}`).then(r => r.json()).catch(() => null),
          apiFetch('/api/predictions/categories').then(r => r.json()).catch(() => null),
        ]);

        if (marketsData?.markets) setMarkets(marketsData.markets);
        if (catsData?.categories) setCategories(catsData.categories);
        setIsPersonalized(false);
        setInterests([]);
      }

      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError('Failed to load prediction markets');
      console.error('[PredictionPanel]', err.message);
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    timerRef.current = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  const tabItems = [
    { id: 'for-you', label: '⚡ FOR YOU' },
    { id: 'all',     label: 'ALL' },
    ...categories.map(cat => ({
      id: cat.id,
      label: (CATEGORY_LABELS[cat.id] || cat.label || '').toUpperCase(),
      count: cat.count,
    })),
  ];

  return (
    <div className="pred-panel">
      <PanelHeader
        title="PREDICTIONS"
        subtitle={isPersonalized && interests.length > 0 ? interests.join(' · ') : 'KALSHI · POLYMARKET'}
        updatedAt={lastUpdated}
        source="Kalshi/Polymarket"
      />

      {/* Category filter pills — canonical PanelTabRow */}
      <PanelTabRow
        value={activeCategory}
        onChange={setActiveCategory}
        items={tabItems}
      />

      {/* Column headers */}
      <div className="pred-row pred-row-hdr">
        <span className="pred-col-q">QUESTION</span>
        <span className="pred-col-src">SRC</span>
        <span className="pred-col-bar">PROBABILITY</span>
        <span className="pred-col-pct">%</span>
        <span className="pred-col-vol">VOL 24H</span>
        <span className="pred-col-close">CLOSE</span>
      </div>

      {/* Tabular rows */}
      <div className="pred-list">
        {loading && markets.length === 0 && (
          <div className="pred-loading">Loading prediction markets…</div>
        )}

        {error && (
          <div className="pred-error">{error}</div>
        )}

        {!loading && markets.length === 0 && !error && (
          <div className="pred-empty">No prediction markets available</div>
        )}

        {markets.map((m, i) => (
          <PredictionRow key={`${m.source}-${m.id}-${i}`} market={m} />
        ))}
      </div>
    </div>
  );
}

// Phase 10.3 — only open deep-links we've explicitly whitelisted. Prevents
// a compromised upstream feed from injecting hostile URLs into `market.url`.
const SAFE_MARKET_HOSTS = new Set(['polymarket.com', 'www.polymarket.com', 'kalshi.com', 'www.kalshi.com']);

function safeMarketUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (!SAFE_MARKET_HOSTS.has(u.hostname.toLowerCase())) return null;
    return u.toString();
  } catch { return null; }
}

function PredictionRow({ market }) {
  const pct = market.probability != null ? Math.round(market.probability * 100) : null;
  const barColor = pct != null ? probabilityColor(market.probability) : 'var(--text-faint)';
  const sourceShort = market.source === 'kalshi' ? 'KAL'
    : market.source === 'polymarket' ? 'POLY'
    : (market.source || '').toUpperCase().slice(0, 4);
  const question = market.title || market.question || '—';
  const reason = market._reason;
  const deepLink = safeMarketUrl(market.url);

  // Double-click → open the source market page. Single-click stays as a
  // no-op (selection / hover is the primary affordance). `noopener,noreferrer`
  // is set so the market venue can't reach back into our window via
  // window.opener, and so Referer isn't leaked.
  const handleDoubleClick = () => {
    if (!deepLink) return;
    window.open(deepLink, '_blank', 'noopener,noreferrer');
  };

  const titleText =
    question +
    (reason && reason !== 'trending' ? ` · ${reason}` : '') +
    (deepLink ? ` · Double-click to open on ${market.source === 'kalshi' ? 'Kalshi' : 'Polymarket'}` : '');

  return (
    <div
      className={`pred-row${deepLink ? ' pred-row--clickable' : ''}`}
      title={titleText}
      onDoubleClick={handleDoubleClick}
      role={deepLink ? 'link' : undefined}
      tabIndex={deepLink ? 0 : undefined}
      onKeyDown={deepLink ? (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleDoubleClick(); }
      } : undefined}
    >
      <span className="pred-col-q" title={question}>{question}</span>
      <span className={`pred-col-src pred-src--${market.source}`}>{sourceShort}</span>
      <div className="pred-col-bar">
        <div className="pred-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct || 0}>
          <span className="pred-bar-tick" style={{ left: '25%' }} />
          <span className="pred-bar-tick" style={{ left: '50%' }} />
          <span className="pred-bar-tick" style={{ left: '75%' }} />
          <div
            className="pred-bar-fill"
            style={{
              width: pct != null ? `${pct}%` : '0%',
              background: barColor,
            }}
          />
        </div>
      </div>
      <span className="pred-col-pct" style={{ color: barColor }}>
        {pct != null ? `${pct}%` : '—'}
      </span>
      <span className="pred-col-vol">{formatVolume(market.volume24h)}</span>
      <span className="pred-col-close">{formatClose(market.closeTime)}</span>
    </div>
  );
}
