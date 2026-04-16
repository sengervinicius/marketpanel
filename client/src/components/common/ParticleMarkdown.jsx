/**
 * ParticleMarkdown.jsx — Shared markdown rendering for Particle AI responses.
 *
 * Handles: **bold**, `code`, $TICKER, [action:TYPE:PARAMS], [N] citations,
 *          [sentiment:BULL/BEAR/NEUTRAL], [chart:TYPE:DATA:PERIOD],
 *          block-level markdown (headers, bullets, BOTTOM LINE)
 *
 * INLINE CHARTS SYNTAX (block-level only):
 *   [chart:sparkline:AAPL:1M] — price sparkline for single ticker
 *   [chart:comparison:AAPL,MSFT,GOOGL:3M] — overlay comparison of multiple tickers
 *   [chart:bar:LABEL1=VALUE1,LABEL2=VALUE2] — horizontal bar chart with custom data
 *
 * Used by: ParticleScreen.jsx (main chat), ChatPanel.jsx (sidebar chat)
 */

import { memo } from 'react';
import { API_BASE } from '../../utils/api';
import InlineChart from './InlineChart';

/** AI-suggested terminal action button */
function ActionButton({ type, params }) {
  const ACTIONS = {
    watchlist_add: { label: '+ Watchlist', icon: '\u2605', color: 'var(--color-vault-accent)' },
    alert_set:     { label: 'Set Alert',   icon: '\u26A0', color: 'var(--semantic-warn, #ff9800)' },
    chart_open:    { label: 'Open Chart',  icon: '\u25CF', color: 'var(--accent, #F97316)' },
    detail_open:   { label: 'Details',     icon: '\u2192', color: 'var(--accent, #F97316)' },
  };
  const action = ACTIONS[type] || { label: type, icon: '\u2022', color: 'var(--text-secondary)' };
  const ticker = params.split(':')[0] || '';

  const handleClick = () => {
    // Log action feedback asynchronously (fire-and-forget)
    fetch(`${API_BASE}/api/search/action-feedback`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: type,
        ticker: ticker || null,
        params: params || null,
        timestamp: Date.now(),
      }),
    }).catch(() => {
      // Silently fail if logging endpoint is unavailable
    });

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
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\$[A-Z]{1,5}(?:\.[A-Z]{1,2})?|\[action:[a-z_]+(?::[^\]]+)?\]|\[V\d{1,2}(?:,\s*[^\]]+)?\]|\[\d{1,2}\]|\[sentiment:(?:bull|bear|neutral)\])/gi);
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
    // Vault citation: [V1], [V2], or [V1, Document.pdf, p.5] (gold color, styled as badge)
    if (/^\[V\d{1,2}/.test(part) && part.endsWith(']')) {
      const vaultNum = part.match(/V(\d{1,2})/)?.[1] || '';
      const pageMatch = part.match(/p\.(\d+)/);
      const pageNum = pageMatch ? pageMatch[1] : null;
      const displayText = pageNum ? `V${vaultNum} p.${pageNum}` : `V${vaultNum}`;
      const titleText = pageNum ? `Vault source ${vaultNum}, page ${pageNum}` : `Vault source ${vaultNum}`;
      return (
        <span
          key={i}
          className="particle-md-vault-cite"
          title={titleText}
          onClick={() => window.dispatchEvent(new CustomEvent('particle:vault-cite', { detail: { vaultNum, pageNum, raw: part } }))}
          style={{ cursor: 'pointer' }}
        >
          [{displayText}]
        </span>
      );
    }
    // Web citation: [1], [2], etc. (orange/blue color, styled as superscript)
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
 * Parse chart block: [chart:TYPE:DATA:PERIOD]
 * Returns: { type, data, period, title } or null
 */
function parseChartBlock(line) {
  const match = line.trim().match(/^\[chart:([a-z]+):([^:]+)(?::([^:\]]+))?\](?:\s+(.+))?$/i);
  if (!match) return null;

  const [, type, data, period, title] = match;
  return {
    type: type.toLowerCase(),
    data: data.trim(),
    period: period?.trim() || '1M',
    title: title?.trim() || null,
  };
}

/**
 * Render a full AI response with block-level markdown:
 * - Headers (## / ###)
 * - Bullet lists (- / *)
 * - BOTTOM LINE: highlighted
 * - Inline charts [chart:...]
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

    // Inline chart: [chart:TYPE:DATA:PERIOD]
    const chartMatch = parseChartBlock(trimmed);
    if (chartMatch) {
      flushList();

      // Parse chart data based on type
      let chartType = chartMatch.type;
      let chartProps = {
        type: chartType,
        period: chartMatch.period,
        title: chartMatch.title,
      };

      if (chartType === 'sparkline') {
        // Single ticker: [chart:sparkline:AAPL:1M]
        chartProps.tickers = chartMatch.data;
      } else if (chartType === 'comparison') {
        // Multiple tickers: [chart:comparison:AAPL,MSFT,GOOGL:3M]
        chartProps.tickers = chartMatch.data.split(',').map(t => t.trim());
      } else if (chartType === 'bar') {
        // Bar data: [chart:bar:LABEL1=VAL1,LABEL2=VAL2]
        chartProps.tickers = chartMatch.data;
      }

      elements.push(
        <InlineChart key={`chart-${i}`} {...chartProps} />
      );
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
