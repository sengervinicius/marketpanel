/**
 * PredictionPanel.jsx — Prediction Markets panel for the terminal grid.
 *
 * Shows live prediction market data from Kalshi and Polymarket.
 * Default view: AI-personalized picks based on user's portfolio/watchlist/interests.
 * User can switch to category-based browsing.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../utils/api';
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
  if (!v) return '--';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

export default function PredictionPanel() {
  const [markets, setMarkets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('for-you');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [interests, setInterests] = useState([]);
  const [isPersonalized, setIsPersonalized] = useState(false);
  const timerRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      if (activeCategory === 'for-you') {
        // Personalized endpoint
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
        // Category-based browsing
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

  return (
    <div className="pred-panel">
      {/* Header */}
      <div className="pred-header">
        <span className="pred-title">PREDICTIONS</span>
        {isPersonalized && interests.length > 0 && (
          <span className="pred-interests">{interests.join(' · ')}</span>
        )}
        <span className="pred-sources">Kalshi + Polymarket</span>
      </div>

      {/* Category filter pills */}
      <div className="pred-categories">
        {/* For You pill — always first */}
        <button
          className={`pred-cat-pill${activeCategory === 'for-you' ? ' pred-cat-pill--active pred-cat-pill--foryou' : ''}`}
          onClick={() => setActiveCategory('for-you')}
        >⚡ For You</button>

        <button
          className={`pred-cat-pill${activeCategory === 'all' ? ' pred-cat-pill--active' : ''}`}
          onClick={() => setActiveCategory('all')}
        >All</button>

        {categories.map(cat => (
          <button
            key={cat.id}
            className={`pred-cat-pill${activeCategory === cat.id ? ' pred-cat-pill--active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            {CATEGORY_LABELS[cat.id] || cat.label}
            <span className="pred-cat-count">{cat.count}</span>
          </button>
        ))}
      </div>

      {/* Markets list */}
      <div className="pred-list">
        {loading && markets.length === 0 && (
          <div className="pred-loading">Loading prediction markets...</div>
        )}

        {error && (
          <div className="pred-error">{error}</div>
        )}

        {!loading && markets.length === 0 && !error && (
          <div className="pred-empty">No prediction markets available</div>
        )}

        {markets.map((m, i) => (
          <PredictionCard key={`${m.source}-${m.id}-${i}`} market={m} />
        ))}
      </div>
    </div>
  );
}

function PredictionCard({ market }) {
  const pct = market.probability != null ? Math.round(market.probability * 100) : null;
  const barColor = pct != null ? probabilityColor(market.probability) : 'var(--color-text-muted)';
  const reason = market._reason;
  const sourceLabel = market.source === 'kalshi' ? 'Kalshi' : market.source === 'polymarket' ? 'Polymarket' : market.source;

  return (
    <div className="pred-card">
      {/* L1: Question — full width, no badges crowding it */}
      <div className="pred-card-question">{market.title || market.question}</div>

      {/* L2: Badges on their own line */}
      <div className="pred-card-badges">
        <span className="pred-card-source" data-source={market.source}>
          {sourceLabel}
        </span>
        {reason && reason !== 'trending' && (
          <span className="pred-card-reason">{reason}</span>
        )}
      </div>

      {/* L3: Probability bar with tick marks (25/50/75) */}
      <div className="pred-card-bar-row">
        <div className="pred-card-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct || 0}>
          {/* Tick marks at 25%, 50%, 75% — help read the bar at a glance */}
          <span className="pred-card-bar-tick" style={{ left: '25%' }} />
          <span className="pred-card-bar-tick" style={{ left: '50%' }} />
          <span className="pred-card-bar-tick" style={{ left: '75%' }} />
          <div
            className="pred-card-bar-fill"
            style={{
              width: pct != null ? `${pct}%` : '0%',
              background: barColor,
            }}
          />
        </div>
        <span className="pred-card-pct" style={{ color: barColor }}>
          {pct != null ? `${pct}%` : '--'}
        </span>
      </div>

      {/* L4: Split footer — volume left, close date right */}
      <div className="pred-card-footer">
        <span className="pred-card-vol">Vol&nbsp;<strong>{formatVolume(market.volume24h)}</strong></span>
        <span className="pred-card-close">
          {market.closeTime
            ? `Closes ${new Date(market.closeTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : ''}
        </span>
      </div>
    </div>
  );
}
