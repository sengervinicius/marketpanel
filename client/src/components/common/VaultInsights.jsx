/**
 * VaultInsights.jsx
 * Reusable component to display vault research insights for a sector.
 * Fetches from /api/vault/sector-insights on mount.
 * Shows a compact card with 2-3 vault passages (filename, bank, snippet).
 * Uses Particle design tokens with a subtle gold accent (left border).
 * Shows nothing gracefully if no vault docs match.
 */

import { useState, useEffect, memo } from 'react';
import { apiFetch } from '../../utils/api';
import AIDisclaimer from './AIDisclaimer';
import './VaultInsights.css';

/**
 * Sector to friendly label mapping
 */
const SECTOR_LABELS = {
  energy: 'Energy & Transition',
  crypto: 'Crypto & Digital Assets',
  brazil: 'Brazil & Emerging Markets',
  macro: 'Macroeconomic',
  defense: 'Defense & Aerospace',
  tech: 'Technology & AI',
  healthcare: 'Healthcare & Pharma',
  finance: 'Financial Services',
  commodities: 'Commodities & Resources',
  retail: 'Global Retail & Consumer',
  'fixed-income': 'Fixed Income & Rates',
  asia: 'Asian Markets',
  europe: 'European Markets',
  fx: 'FX & Currency',
};

function VaultInsights({ sector }) {
  const [passages, setPassages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!sector) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setFailed(false);

    apiFetch(`/api/vault/sector-insights?sector=${encodeURIComponent(sector)}&limit=3`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        setPassages(data.passages || []);
      })
      .catch(err => {
        console.warn('VaultInsights fetch failed:', err);
        setFailed(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [sector]);

  // Show nothing if no passages or loading failed (graceful degradation)
  if (loading || failed || !passages.length) {
    return null;
  }

  const sectorLabel = SECTOR_LABELS[sector] || sector;

  return (
    <div className="vi-card">
      <div className="vi-header">
        <span className="vi-badge">RESEARCH INSIGHTS</span>
        <span className="vi-sector-label">{sectorLabel.toUpperCase()}</span>
      </div>

      <div className="vi-passages">
        {passages.slice(0, 3).map((passage, idx) => (
          <div key={idx} className="vi-passage">
            <div className="vi-passage-meta">
              {passage.bank && (
                <span className="vi-bank">{passage.bank}</span>
              )}
              {passage.filename && (
                <span className="vi-filename">{passage.filename}</span>
              )}
              {passage.date && (
                <span className="vi-date">{passage.date}</span>
              )}
            </div>
            <div className="vi-content">
              {passage.content.slice(0, 200)}
              {passage.content.length > 200 ? '...' : ''}
            </div>
            {passage.tickers && passage.tickers.length > 0 && (
              <div className="vi-tickers">
                {passage.tickers.slice(0, 3).map((ticker, i) => (
                  <span key={i} className="vi-ticker">
                    ${ticker}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {passages.length > 0 && (
        <div className="vi-source-note">
          {passages.some(p => p.isGlobal) && (
            <span>From Particle research vault</span>
          )}
          {passages.some(p => !p.isGlobal) && (
            <span>{passages.some(p => p.isGlobal) ? ' + your ' : 'From your '}private vault</span>
          )}
        </div>
      )}
      <AIDisclaimer variant="foot" />
    </div>
  );
}

export default memo(VaultInsights);
