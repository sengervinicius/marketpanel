/**
 * ParticleMarkdown.jsx — Shared markdown rendering for Particle AI responses.
 *
 * Handles: **bold**, `code`, $TICKER, [action:TYPE:PARAMS], [N] citations,
 *          [sentiment:BULL/BEAR/NEUTRAL], block-level markdown (headers, bullets, BOTTOM LINE)
 *
 * Used by: ParticleScreen.jsx (main chat), ChatPanel.jsx (sidebar chat)
 */

import { memo } from 'react';

/** AI-suggested terminal action button */
function ActionButton({ type, params }) {
  const ACTIONS = {
    watchlist_add: { label: '+ Watchlist', icon: '\u2605', color: 'var(--color-vault, #DAA520)' },
    alert_set:     { label: 'Set Alert',   icon: '\u26A0', color: 'var(--semantic-warn, #ff9800)' },
    chart_open:    { label: 'Open Chart',  icon: '\u25CF', color: 'var(--accent, #F97316)' },
    detail_open:   { label: 'Details',     icon: '\u2192', color: 'var(--accent, #F97316)' },
  };
  const action = ACTIONS[type] || { label: type, icon: '\u2022', color: 'var(--text-secondary)' };
  const ticker = params.split(':')[0] || '';

  const handleClick = () => {
    window.dispatchEvent(new CustomEvent('particle:action', {
      detail: { type, ticker, params },
    }));
  };

  return (
    <button
      className="particle-action-btn"
      onClick={handleClick}
      title={`${action.label}${ticker ? `: ${ticker}` : ''}`}
      style={{ '--action-color': action.color }}
    >
      <span className="particle-action-icon">{action.icon}</span>
      <span className="particle-action-label">{action.label}{ticker ? ` ${ticker}` : ''}</span>
    </button>
  );
}

/**
 * Render inline markdown tokens: bold, code, tickers, citations, sentiment, actions.
 */
export function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\$[A-Z]{1,5}(?:\.[A-Z]{1,2})?|\[action:[a-z_]+(?::[^\]]+)?\]|\[\d{1,2}\]|\[sentiment:(?:bull|bear|neutral)\])/gi);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="particle-md-bold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="particle-md-code">{part.slice(1, -1)}</code>;
    }
    if (/^\$[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(part)) {
      return <span key={i} className="particle-md-ticker">{part}</span>;
    }
    if (/^\[\d{1,2}\]$/.test(part)) {
      return <sup key={i} className="particle-md-cite">{part.slice(1, -1)}</sup>;
    }
    const sentMatch = part.match(/^\[sentiment:(bull|bear|neutral)\]$/i);
    if (sentMatch) {
      const mood = sentMatch[1].toLowerCase();
      const MOODS = {
        bull:    { emoji: '\u25B2', label: 'Bullish', cls: 'particle-md-sentiment--bull' },
        bear:    { emoji: '\u25BC', label: 'Bearish', cls: 'particle-md-sentiment--bear' },
        neutral: { emoji: '\u25CF', label: 'Neutral', cls: 'particle-md-sentiment--neutral' },
      };
      const m = MOODS[mood] || MOODS.neutral;
      return <span key={i} className={`particle-md-sentiment ${m.cls}`}>{m.emoji} {m.label}</span>;
    }
    const actionMatch = part.match(/^\[action:([a-z_]+)(?::([^\]]+))?\]$/);
    if (actionMatch) {
      return <ActionButton key={i} type={actionMatch[1]} params={actionMatch[2] || ''} />;
    }
    return part;
  });
}

/**
 * Render a full AI response with block-level markdown:
 * - Headers (## / ###)
 * - Bullet lists (- / *)
 * - BOTTOM LINE: highlighted
 * - Inline markdown within each block
 */
function ParticleMarkdown({ content, className = '' }) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements = [];
  let listItems = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="particle-md-list">
          {listItems.map((item, j) => (
            <li key={j} className="particle-md-li">{renderInline(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines (but flush lists)
    if (!trimmed) {
      flushList();
      continue;
    }

    // BOTTOM LINE: — highlighted verdict
    if (/^(\*\*)?BOTTOM LINE:?(\*\*)?/i.test(trimmed)) {
      flushList();
      const blText = trimmed.replace(/^\*?\*?BOTTOM LINE:?\*?\*?\s*/i, '');
      elements.push(
        <div key={`bl-${i}`} className="particle-md-bottomline">
          <strong>BOTTOM LINE:</strong> {renderInline(blText)}
        </div>
      );
      continue;
    }

    // Headers
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(<h4 key={`h3-${i}`} className="particle-md-h3">{renderInline(trimmed.slice(4))}</h4>);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(<h3 key={`h2-${i}`} className="particle-md-h2">{renderInline(trimmed.slice(3))}</h3>);
      continue;
    }

    // Bullet lists
    if (/^[-*]\s/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }
    // Numbered lists
    if (/^\d+[.)]\s/.test(trimmed)) {
      listItems.push(trimmed.replace(/^\d+[.)]\s+/, ''));
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(<p key={`p-${i}`} className="particle-md-p">{renderInline(trimmed)}</p>);
  }

  flushList();

  return <div className={`particle-md ${className}`}>{elements}</div>;
}

export default memo(ParticleMarkdown);
