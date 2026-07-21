/**
 * PanelChrome.jsx — H1.1: the ONE shared panel header for home panels.
 *
 * Successor of panels/_shared/PanelHeader (deleted) and of every
 * hand-rolled `.wp-header` / `.fut-header` / `.cp-header` / `.ohw-header`
 * strip. Structural slots only — colours/padding/typography live in
 * PanelChrome.css and must not be overridden per panel.
 *
 *   <PanelChrome
 *     title="YIELDS"                      // mono uppercase, token font/size
 *     subtitle="12 STORIES · LIVE"        // optional faint mono subtitle
 *     count={rows.length}                 // optional count, next to title
 *     status={<SyncBadge … />}            // left status-dot slot
 *     badge={{ text: 'CLOSED', tone: 'closed' }}  // or 'live' / 'warn'
 *     onEdit={() => openEditor()}         // optional edit pencil
 *     updatedAt={data?.asOf} source="Yahoo"  // standardized FreshnessDot
 *     timestamp="16:20:01"                // legacy plain-text ts (if no updatedAt)
 *     actions={<>{…buttons…}</>}          // right-side controls slot
 *   />
 *
 * Panels whose header is fused with editing behaviour (EditablePanelHeader:
 * Global Indices / US Equities / Brazil / FX / Commodities) keep their own
 * markup but share the `.panel-chrome-title` typography class.
 */
import { isValidElement } from 'react';
import FreshnessDot from '../panels/_shared/FreshnessDot';
import './PanelChrome.css';

const PENCIL = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
);

export function PanelChrome({
  title,
  // Phase S §4 — when set, the title becomes the panel's deep-view
  // overlay entry point (subtle hover ↗ affordance, CSS only).
  onTitleClick,
  subtitle,
  count,
  status,
  badge,
  onEdit,
  updatedAt,
  source,
  timestamp,
  actions,
  className = '',
}) {
  const hasFreshness = updatedAt != null;
  const badgeNode = badge == null ? null
    : isValidElement(badge) ? badge
    : typeof badge === 'object' && badge.text != null
      ? (
        <span className={`panel-chrome-badge panel-chrome-badge--${badge.tone || 'live'}`}>
          {badge.text}
        </span>
      )
      : <span className="panel-chrome-badge panel-chrome-badge--live">{badge}</span>;

  return (
    <div className={`panel-chrome ${className}`.trim()}>
      {status ? <span className="panel-chrome-status">{status}</span> : null}
      {onTitleClick ? (
        <button type="button" className="panel-chrome-title panel-chrome-title--overlay" onClick={onTitleClick} title="Click to open deep view">
          {title}
        </button>
      ) : (
        <span className="panel-chrome-title">{title}</span>
      )}
      {count != null ? <span className="panel-chrome-count">{count}</span> : null}
      {onEdit ? (
        <button type="button" className="panel-chrome-edit" onClick={onEdit} title="Edit panel">
          {PENCIL}
        </button>
      ) : null}
      {subtitle ? <span className="panel-chrome-sub">{subtitle}</span> : null}
      {badgeNode}
      <span className="panel-chrome-spacer" />
      {hasFreshness ? <FreshnessDot updatedAt={updatedAt} source={source} /> : null}
      {timestamp && !hasFreshness ? (
        <span className="panel-chrome-ts" data-testid="panel-header-ts">{timestamp}</span>
      ) : null}
      {actions ? <div className="panel-chrome-actions">{actions}</div> : null}
    </div>
  );
}

export default PanelChrome;
