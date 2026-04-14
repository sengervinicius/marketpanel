/**
 * PredictionPanel.jsx — Prediction Markets panel for the terminal grid.
 *
 * Shows live prediction market data from Kalshi and Polymarket.
 * Displays probability bars, volume, and source for each market.
 * Filterable by category (Fed/Rates, Crypto, Politics, etc.)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../utils/api';
import './PredictionPanel.css';
const REFRESH_INTERVAL = 120_000; // 2 min

const CATEGORY_LABELS = {
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
  const [activeCategory, setActiveCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (activeCategory !== 'all') params.set('category', activeCategory);

      const [marketsData, catsData] = await Promise.all([
        apiFetch(`/api/predictions?${params}`).then(r => r.json()).catch(() => null),
        apiFetch('/api/predictions/categories').then(r => r.json()).catch(() => null),
      ]);

      if (marketsData?.markets) setMarkets(marketsData.markets);
      if (catsData?.categories) setCategories(catsData.categories);
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
        <span className="pred-sources">Kalshi + Polymarket</span>
      </div>

      {/* Category filter pills */}
      <div className="pred-categories">
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

  return (
    <div className="pred-card">
      <div className="pred-card-top">
        <span className="pred-card-question">{market.title || market.question}</span>
        <span className="pred-card-source" data-source={market.source}>
          {market.source === 'kalshi' ? 'K' : 'P'}
        </span>
      </div>

      {/* Probability bar */}
      <div className="pred-card-bar-row">
        <div className="pred-card-bar">
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

      {/* Meta row */}
      <div className="pred-card-meta">
        <span className="pred-card-vol">Vol: {formatVolume(market.volume24h)}</span>
        {market.closeTime && (
          <span className="pred-card-close">
            Closes: {new Date(market.closeTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
    </div>
  );
}
