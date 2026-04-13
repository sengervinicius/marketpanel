/**
 * WirePanel.jsx — The Wire: Live AI Market Commentary
 *
 * Terminal-mode panel showing timestamped market commentary entries.
 * Auto-refreshes every 2 minutes. Shows mood indicator + tickers.
 */
import { useWireFeed } from '../../hooks/useWire';
import './WirePanel.css';

const MOOD_COLORS = {
  bullish:  '#22c55e',
  bearish:  '#ef4444',
  volatile: '#f59e0b',
  cautious: '#f59e0b',
  neutral:  'var(--text-faint, #888)',
};

const MOOD_ICONS = {
  bullish:  '▲',
  bearish:  '▼',
  volatile: '◆',
  cautious: '◇',
  neutral:  '●',
};

export default function WirePanel() {
  const { entries, loading, error, refresh } = useWireFeed(30);

  if (loading && entries.length === 0) {
    return (
      <div className="wire-panel">
        <div className="wire-header">
          <span className="wire-title">The Wire</span>
          <span className="wire-subtitle">Live Market Commentary</span>
        </div>
        <div className="wire-loading">
          <div className="wire-loading-pulse" />
          <span>Waiting for Wire...</span>
        </div>
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div className="wire-panel">
        <div className="wire-header">
          <span className="wire-title">The Wire</span>
        </div>
        <div className="wire-empty">Wire offline — {error}</div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="wire-panel">
        <div className="wire-header">
          <span className="wire-title">The Wire</span>
          <span className="wire-subtitle">Live Market Commentary</span>
        </div>
        <div className="wire-empty">
          No Wire entries yet. Commentary generates every 7 minutes during market hours.
        </div>
      </div>
    );
  }

  return (
    <div className="wire-panel">
      <div className="wire-header">
        <span className="wire-title">The Wire</span>
        <span className="wire-live-badge">LIVE</span>
        <div style={{ flex: 1 }} />
        <button className="wire-refresh-btn" onClick={refresh} title="Refresh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </button>
      </div>

      <div className="wire-entries">
        {entries.map((entry, i) => (
          <WireEntry key={entry.id || i} entry={entry} isLatest={i === 0} />
        ))}
      </div>
    </div>
  );
}

function WireEntry({ entry, isLatest }) {
  const moodColor = MOOD_COLORS[entry.mood] || MOOD_COLORS.neutral;
  const moodIcon  = MOOD_ICONS[entry.mood] || MOOD_ICONS.neutral;
  const time = entry.timestamp ? formatTime(entry.timestamp) : '';

  return (
    <div className={`wire-entry${isLatest ? ' wire-entry--latest' : ''}`}>
      <div className="wire-entry-meta">
        <span className="wire-entry-mood" style={{ color: moodColor }}>
          {moodIcon}
        </span>
        <span className="wire-entry-time">{time}</span>
        {entry.category && entry.category !== 'market' && (
          <span className="wire-entry-cat">{entry.category}</span>
        )}
      </div>
      <div className="wire-entry-content">
        {renderWireText(entry.content)}
      </div>
      {entry.tickers && entry.tickers.length > 0 && (
        <div className="wire-entry-tickers">
          {entry.tickers.map(t => (
            <span key={t} className="wire-ticker">${t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function renderWireText(text) {
  if (!text) return null;
  // Highlight $TICKER patterns and **bold**
  const parts = text.split(/(\$[A-Z]{1,5}(?:\.[A-Z]{1,2})?|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (/^\$[A-Z]{1,5}/.test(part)) {
      return <span key={i} className="wire-ticker-inline">{part}</span>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
