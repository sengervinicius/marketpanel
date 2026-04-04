/**
 * MarketScreenGallery.jsx
 * Desktop-only horizontal gallery of market screen cards.
 * Shows in a collapsible strip below the search bar.
 * Each card shows visualLabel, subtitle, heroSymbols, and thesis snippet.
 * Tapping a card applies the market screen template.
 */

import { useState, useMemo, useCallback, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { getTemplatesByKind, getTemplate } from '../../config/templates';
import AiIdeaCard from './AiIdeaCard';
import './MarketScreenGallery.css';

function MarketScreenGallery() {
  const { settings, applyTemplate } = useSettings();
  const [expanded, setExpanded] = useState(false);
  const [applying, setApplying] = useState(null);
  const [applied, setApplied] = useState(null);

  const screens = useMemo(() =>
    getTemplatesByKind('market-screen').filter(s => s.visibleInMobileHome),
  []);

  const activeId = settings?.activeTemplate || null;
  const activeScreen = activeId ? getTemplate(activeId) : null;
  const showAiCard = activeScreen?.kind === 'market-screen' && activeScreen?.aiIdeaContext;

  const handleApply = useCallback(async (id) => {
    if (applying) return;
    setApplying(id);
    try {
      await applyTemplate(id, 'full');
      setApplied(id);
      setTimeout(() => setApplied(null), 1200);
    } catch (e) {
      console.error('[Gallery] apply failed:', e.message);
    } finally {
      setApplying(null);
    }
  }, [applying, applyTemplate]);

  return (
    <div className="msg-container">
      {/* AI Idea Card — only shown when active template is a market screen */}
      {showAiCard && <AiIdeaCard screen={activeScreen} />}

      {/* Toggle */}
      <button
        className="msg-toggle"
        onClick={() => setExpanded(s => !s)}
      >
        <span className="msg-toggle-label">MARKET SCREENS</span>
        <span className="msg-toggle-count">{screens.length}</span>
        <span className="msg-toggle-arrow">{expanded ? '▴' : '▾'}</span>
      </button>

      {/* Gallery grid */}
      {expanded && (
        <div className="msg-grid">
          {screens.map(s => {
            const isActive = activeId === s.id;
            const isApplying = applying === s.id;
            const wasApplied = applied === s.id;
            return (
              <div
                key={s.id}
                className={`msg-card ${isActive ? 'msg-card--active' : ''} ${isApplying ? 'msg-card--applying' : ''}`}
                style={{ borderLeftColor: s.mobileCardStyle || '#ff6600' }}
                onClick={() => handleApply(s.id)}
                role="button"
                tabIndex={0}
              >
                <div className="msg-card-top">
                  <span className="msg-card-label">{s.visualLabel}</span>
                  <span className="msg-card-status">
                    {wasApplied ? '✓' : isApplying ? '...' : isActive ? '●' : ''}
                  </span>
                </div>
                <div className="msg-card-subtitle">{s.subtitle}</div>
                <div className="msg-card-heroes">
                  {(s.heroSymbols || []).slice(0, 4).map(sym => (
                    <span key={sym} className="msg-card-hero">{sym.replace('.SA','').replace('=F','f')}</span>
                  ))}
                </div>
                {s.thesis && (
                  <div className="msg-card-thesis">{s.thesis.slice(0, 80)}{s.thesis.length > 80 ? '...' : ''}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default memo(MarketScreenGallery);
