// SentimentPanel.jsx — market breadth, live yields, top movers heatmap
// Accepts full data object: { stocks, forex, crypto, rates }
import { memo, useState } from 'react';
import { apiFetch } from '../../utils/api';
import './SentimentPanel.css';

// Map Yahoo Finance treasury symbols → display labels
const TREASURY_LABELS = {
  '^IRX': 'US 3M',
  '^FVX': 'US 5Y',
  '^TNX': 'US 10Y',
  '^TYX': 'US 30Y',
};

function BreadthBar({ label, items }) {
  if (!items) return null;
  const values = Object.values(items);
  if (!values.length) return null;
  const up    = values.filter(v => (v.changePct ?? 0) > 0).length;
  const down  = values.length - up;
  const upPct = (up / values.length) * 100;
  const avg   = values.reduce((a, b) => a + (b.changePct || 0), 0) / values.length;
  return (
    <div className="sp-breadth-row">
      <div className="sp-breadth-meta">
        <span className="sp-breadth-label">{label}</span>
        <span className="sp-breadth-avg" style={{ color: avg >= 0 ? 'var(--price-up)' : 'var(--price-down)' }}>
          avg {avg >= 0 ? '+' : ''}{avg.toFixed(2)}% ▲{up} ▼{down}
        </span>
      </div>
      <div className="sp-breadth-track">
        <div style={{ flex: upPct,       background: '#1b5e20', minWidth: upPct > 0       ? 2 : 0 }} />
        <div style={{ flex: 100 - upPct, background: '#b71c1c', minWidth: upPct < 100 ? 2 : 0 }} />
      </div>
    </div>
  );
}

function SentimentPanel({ data, loading }) {
  const stocks = data?.stocks || {};
  const forex  = data?.forex  || {};
  const crypto = data?.crypto || {};

  const rateResults = data?.rates?.results || [];
  const treasuries  = rateResults.filter(r => r.type === 'treasury');
  const policies    = rateResults.filter(r => r.type === 'policy');

  const topMovers = Object.values(stocks)
    .filter(s => s.changePct != null)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 12);

  // AI rotation state
  const [rotationData, setRotationData] = useState(null);
  const [rotationLoading, setRotationLoading] = useState(false);
  const [rotationError, setRotationError] = useState(null);

  const handleRequestRotationAI = async () => {
    if (!topMovers.length) return;

    setRotationLoading(true);
    setRotationError(null);
    setRotationData(null);

    try {
      // Gather sector data from topMovers
      const sectors = topMovers.map(s => ({
        name: s.symbol,
        changePct: s.changePct || 0,
      }));

      // Calculate market breadth
      const up = topMovers.filter(s => (s.changePct ?? 0) > 0).length;
      const down = topMovers.length - up;

      const payload = {
        sectors,
        marketBreadth: { up, down },
      };

      const response = await apiFetch('/api/search/sector-rotation', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch rotation data');
      }

      const result = await response.json();
      setRotationData(result);
    } catch (err) {
      setRotationError(err?.message || 'Error fetching AI rotation analysis');
    } finally {
      setRotationLoading(false);
    }
  };

  return (
    <div className="sp-panel">

      {/* Market Breadth */}
      <div className="sp-section-header">
        <span className="sp-section-title">MARKET BREADTH</span>
      </div>
      <div className="sp-breadth">
        {loading ? (
          <div className="sp-loading">LOADING...</div>
        ) : (
          <>
            <BreadthBar label="US EQUITIES" items={stocks} />
            <BreadthBar label="FOREX"       items={forex} />
            <BreadthBar label="CRYPTO"      items={crypto} />
          </>
        )}
      </div>

      {/* Fixed Income */}
      <div className="sp-section-header sp-section-header--alt">
        <span className="sp-section-title">FIXED INCOME</span>
        <span className="sp-section-note">LIVE YIELDS</span>
      </div>
      <div className="sp-rates">
        {treasuries.length === 0 && policies.length === 0 ? (
          <div className="sp-loading">Loading rates...</div>
        ) : (
          <>
            <div className="sp-rates-grid">
              {treasuries.map(r => {
                const label = TREASURY_LABELS[r.symbol] || r.name;
                const up    = (r.change ?? 0) >= 0;
                return (
                  <div key={r.symbol} className="sp-rate-card">
                    <div className="sp-rate-label">{label}</div>
                    <div className="sp-rate-value">{r.price?.toFixed(3)}%</div>
                    {r.change != null && (
                      <div className="sp-rate-chg" style={{ color: up ? 'var(--price-up)' : 'var(--price-down)' }}>
                        {up ? '+' : ''}{r.change?.toFixed(3)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {policies.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${policies.length}, 1fr)`, gap: 3 }}>
                {policies.map(r => (
                  <div key={r.symbol} className="sp-rate-card">
                    <div className="sp-policy-label">{r.name}</div>
                    <div className="sp-policy-value">{r.price?.toFixed(2)}%</div>
                    {r.note && <div className="sp-policy-note">{r.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Top Movers */}
      <div className="sp-section-header sp-section-header--alt">
        <span className="sp-section-title">TOP MOVERS</span>
        <button
          className="sp-ai-btn"
          onClick={handleRequestRotationAI}
          disabled={rotationLoading || topMovers.length === 0}
        >
          {rotationLoading ? 'ANALYZING...' : 'AI TAKE'}
        </button>
      </div>

      {/* AI Rotation Strip */}
      {rotationData && (
        <div className="sp-ai-strip">
          <div className="sp-ai-signal-badge" style={{
            backgroundColor: rotationData.rotationSignal === 'risk-on' ? '#1b5e20'
              : rotationData.rotationSignal === 'risk-off' ? '#b71c1c'
              : rotationData.rotationSignal === 'mixed' ? '#f57f17'
              : '#0277bd'
          }}>
            {rotationData.rotationSignal?.toUpperCase()}
          </div>
          {rotationData.theme && (
            <div className="sp-ai-theme">{rotationData.theme}</div>
          )}
          {rotationData.commentary && (
            <div className="sp-ai-commentary">{rotationData.commentary}</div>
          )}
          {(rotationData.leadingSectors || rotationData.laggingSectors) && (
            <div className="sp-ai-sectors">
              {rotationData.leadingSectors?.map((sec, i) => (
                <span key={`lead-${i}`} className="sp-ai-sector-tag sp-ai-sector-tag--leading">
                  {typeof sec === 'string' ? sec : sec.name || sec}
                </span>
              ))}
              {rotationData.laggingSectors?.map((sec, i) => (
                <span key={`lag-${i}`} className="sp-ai-sector-tag sp-ai-sector-tag--lagging">
                  {typeof sec === 'string' ? sec : sec.name || sec}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {rotationError && (
        <div className="sp-ai-error">
          {rotationError}
        </div>
      )}

      <div className="sp-movers">
        {loading || topMovers.length === 0 ? (
          <div className="sp-loading">Loading...</div>
        ) : (
          <>
            <div className="sp-movers-grid">
              {topMovers.map(s => {
                const up        = (s.changePct ?? 0) >= 0;
                const intensity = Math.min(Math.abs(s.changePct || 0) / 5, 1);
                const bg = up
                  ? `rgba(0, ${Math.floor(80 + intensity * 120)}, ${Math.floor(30 + intensity * 50)}, ${0.15 + intensity * 0.4})`
                  : `rgba(${Math.floor(80 + intensity * 120)}, 0, 0, ${0.15 + intensity * 0.4})`;
                return (
                  <div key={s.symbol} className="sp-mover-cell"
                    style={{ background: bg, border: `1px solid ${up ? '#004400' : '#440000'}` }}
                  >
                    <div className="sp-mover-symbol">{s.symbol}</div>
                    <div className="sp-mover-chg" style={{ color: up ? 'var(--price-up)' : 'var(--price-down)' }}>
                      {(s.changePct >= 0 ? '+' : '')}{s.changePct?.toFixed(2)}%
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', fontSize: 9, color: 'var(--text-faint)' }}>
              <span>-5%</span>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'linear-gradient(to right, rgba(244,67,54,0.6), rgba(244,67,54,0.15), rgba(255,255,255,0.05), rgba(76,175,80,0.15), rgba(76,175,80,0.6))' }} />
              <span>+5%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { SentimentPanel };
export default memo(SentimentPanel);
