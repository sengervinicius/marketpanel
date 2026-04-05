/**
 * DeepScreenBase.jsx — S3.B
 * Configurable layout grid for deep sector/thematic screens.
 * Each section component fetches its own data via useSectionData.
 */
import { memo } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import AIInsightCard from '../ai/AIInsightCard';
import './DeepScreen.css';

/* ── Section chrome — wraps each section component ───────────────────────── */
export function DeepSection({ title, badge, children }) {
  return (
    <div className="ds-section">
      <div className="ds-section-head">
        <span className="ds-section-title">{title}</span>
        {badge && <span className="ds-section-badge">{badge}</span>}
      </div>
      <div className="ds-section-body">
        {children}
      </div>
    </div>
  );
}

/* ── Skeleton loader ─────────────────────────────────────────────────────── */
export function DeepSkeleton({ rows = 6 }) {
  return (
    <div className="ds-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ds-skeleton-row" style={{ width: `${90 - i * 5}%` }} />
      ))}
    </div>
  );
}

/* ── Error banner ────────────────────────────────────────────────────────── */
export function DeepError({ message }) {
  return <div className="ds-error">{message || 'Failed to load data'}</div>;
}

/* ── Ticker chip with click ──────────────────────────────────────────────── */
export function TickerCell({ symbol, label, price, changePct, onClick }) {
  const displaySym = (symbol || '')
    .replace(/^C:/, '').replace(/^X:/, '')
    .replace('.SA', '').replace('=F', 'f');

  return (
    <div
      className="ds-ticker-cell"
      onClick={() => onClick?.(symbol)}
      title={label || symbol}
    >
      <span className="ds-ticker-sym">{displaySym}</span>
      {price != null && (
        <span className="ds-ticker-price">
          {price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )}
      {changePct != null && (
        <span className={`ds-ticker-chg ${changePct >= 0 ? 'up' : 'down'}`}>
          {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

/* ── Main DeepScreenBase ─────────────────────────────────────────────────── */
function DeepScreenBase({ title, accentColor, sections, aiType, aiContext, aiCacheKey, children }) {
  const isMobile = useIsMobile();

  return (
    <div className="ds-screen">
      {/* Header */}
      <div className="ds-header">
        <div className="ds-header-accent" style={{ background: accentColor || '#ff6b00' }} />
        <div className="ds-header-title">{title}</div>
      </div>

      {/* AI Insight */}
      {aiType && (
        <div className="ds-ai-slot">
          <AIInsightCard
            type={aiType}
            context={aiContext}
            cacheKey={aiCacheKey || `${aiType}:${title}`}
            compact={isMobile}
          />
        </div>
      )}

      {/* Section Grid */}
      <div className={`ds-grid ${isMobile ? 'ds-grid--mobile' : ''}`}>
        {sections && sections.map((sec) => (
          <DeepSection key={sec.id} title={sec.title} badge={sec.badge}>
            <sec.component />
          </DeepSection>
        ))}
      </div>

      {/* Extra content (e.g., ETF strips) */}
      {children}
    </div>
  );
}

export default memo(DeepScreenBase);
