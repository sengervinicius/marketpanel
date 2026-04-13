/**
 * BriefNotification.jsx — Toast notification for Morning Brief.
 *
 * Renders at App.jsx level so it appears regardless of which screen
 * the user is on. Click to expand full brief, dismiss to hide for the day.
 * Dispatches particle-prefill to navigate to ParticleScreen for follow-up.
 */
import { useState, useCallback } from 'react';
import { useMorningBrief } from '../../hooks/useWire';
import './BriefNotification.css';

export default function BriefNotification() {
  const { brief, dismissed, dismiss } = useMorningBrief();
  const [expanded, setExpanded] = useState(false);

  const handleAskParticle = useCallback(() => {
    setExpanded(false);
    window.dispatchEvent(new CustomEvent('particle-prefill', {
      detail: 'Based on today\'s morning brief, what should I watch most closely today?',
    }));
  }, []);

  if (!brief || !brief.content || dismissed) return null;

  // Extract headline (first sentence of market_overnight or first ~100 chars)
  const headline = brief.sections?.market_overnight
    ? brief.sections.market_overnight.split('.')[0] + '.'
    : brief.content.slice(0, 100).split('.')[0] + '.';

  return (
    <div className={`brief-notif ${expanded ? 'brief-notif--expanded' : ''}`}>
      <div className="brief-notif-header">
        <span className="brief-notif-badge">&#10022; Morning Brief</span>
        <div className="brief-notif-actions">
          {expanded && (
            <button className="brief-notif-btn" onClick={handleAskParticle}>
              Ask Particle
            </button>
          )}
          <button className="brief-notif-dismiss" onClick={dismiss} aria-label="Dismiss">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      {!expanded ? (
        <div className="brief-notif-preview" onClick={() => setExpanded(true)}>
          <p className="brief-notif-headline">{headline}</p>
          <span className="brief-notif-expand">Click to read full brief</span>
        </div>
      ) : (
        <div className="brief-notif-body">
          <div className="brief-notif-content">
            {brief.content.split('\n').map((line, i) =>
              line.trim() ? <p key={i}>{line}</p> : null
            )}
          </div>
        </div>
      )}
    </div>
  );
}
