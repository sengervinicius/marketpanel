/**
 * BriefInbox.jsx — Phase 10.7 Morning Brief inbox drawer.
 *
 * Rendered as a fixed-position popover anchored under the header inbox
 * button. Shows the user's 30 most recent briefs newest-first. Clicking
 * a row expands that brief inline and marks it read. A dismiss control
 * removes the row from the unread badge but keeps it readable.
 *
 * All data flows through useBriefInbox() — optimistic updates mean the
 * badge drops instantly on click while the PATCH call runs in the
 * background.
 */
import { useState, useCallback } from 'react';
import './BriefInbox.css';

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return String(dateStr).slice(0, 10);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' });
  } catch {
    return String(dateStr).slice(0, 10);
  }
}

function briefHeadline(brief) {
  const content = brief?.content;
  if (!content) return '(empty brief)';
  if (typeof content === 'string') {
    const firstSentence = content.split(/[.!?]\s/)[0];
    return firstSentence.slice(0, 140) + (firstSentence.length > 140 ? '…' : '');
  }
  // content is JSONB — try a few common shapes.
  if (content.headline) return content.headline;
  if (content.sections?.market_overnight) {
    return content.sections.market_overnight.split('.')[0] + '.';
  }
  if (typeof content.content === 'string') {
    return content.content.split('.')[0] + '.';
  }
  return '(brief)';
}

function briefBodyText(brief) {
  const content = brief?.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (typeof content.content === 'string') return content.content;
  if (content.sections && typeof content.sections === 'object') {
    return Object.values(content.sections).filter(v => typeof v === 'string').join('\n\n');
  }
  return '';
}

function BriefRow({ item, expanded, onToggle, onDismiss }) {
  const unread = !item.readAt && !item.dismissedAt;
  const body = expanded ? briefBodyText(item) : '';

  return (
    <div className={`brief-inbox-row ${unread ? 'brief-inbox-row--unread' : ''} ${expanded ? 'brief-inbox-row--expanded' : ''}`}>
      <button
        type="button"
        className="brief-inbox-row-summary"
        onClick={() => onToggle(item.id)}
      >
        <div className="brief-inbox-row-date-col">
          {unread && <span className="brief-inbox-unread-dot" aria-label="unread" />}
          <span className="brief-inbox-date">{formatDate(item.briefDate)}</span>
        </div>
        <div className="brief-inbox-row-headline">{briefHeadline(item)}</div>
      </button>
      {expanded && (
        <div className="brief-inbox-row-body">
          {body
            ? body.split('\n').filter(Boolean).map((line, i) => (
                <p key={i}>{line}</p>
              ))
            : <p className="brief-inbox-empty">Nothing to show.</p>}
          <div className="brief-inbox-row-actions">
            <button
              type="button"
              className="brief-inbox-ask"
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('particle-prefill', {
                  detail: `Based on the ${formatDate(item.briefDate)} morning brief, what should I watch most closely today?`,
                }));
              }}
            >Ask Particle</button>
            <button
              type="button"
              className="brief-inbox-dismiss"
              onClick={(e) => { e.stopPropagation(); onDismiss(item.id); }}
            >Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BriefInbox({ inbox = [], unread = 0, loading, onClose, markRead, dismissItem }) {
  const [expandedId, setExpandedId] = useState(null);

  const handleToggle = useCallback((id) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id;
      // Mark as read the moment the user opens a row.
      if (next !== null && typeof markRead === 'function') {
        const row = inbox.find(b => b.id === id);
        if (row && !row.readAt) markRead(id);
      }
      return next;
    });
  }, [inbox, markRead]);

  return (
    <>
      {/* Backdrop captures outside-clicks */}
      <div className="brief-inbox-backdrop" onClick={onClose} />

      <div className="brief-inbox-drawer" role="dialog" aria-label="Morning Brief inbox">
        <div className="brief-inbox-header">
          <div className="brief-inbox-title">
            Morning Brief
            {unread > 0 && <span className="brief-inbox-title-count">{unread} unread</span>}
          </div>
          <button type="button" className="brief-inbox-close" onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="brief-inbox-body">
          {loading && inbox.length === 0 ? (
            <div className="brief-inbox-placeholder">Loading briefs…</div>
          ) : inbox.length === 0 ? (
            <div className="brief-inbox-placeholder">
              No morning briefs yet. Your first brief arrives tomorrow at
              your configured send time.
            </div>
          ) : (
            inbox.map(item => (
              <BriefRow
                key={item.id}
                item={item}
                expanded={expandedId === item.id}
                onToggle={handleToggle}
                onDismiss={dismissItem}
              />
            ))
          )}
        </div>

        <div className="brief-inbox-footer">
          Briefs are generated weekday mornings and kept for 30 days.
        </div>
      </div>
    </>
  );
}
