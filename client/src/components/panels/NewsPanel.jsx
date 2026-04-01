// NewsPanel — scrolling news feed (self-fetching)
// Fetches from server /api/news every 60s
import { useState, useEffect, useRef, memo } from 'react';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { apiFetch } from '../../utils/api';
import EmptyState from '../common/EmptyState';
import './NewsPanel.css';

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)    return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function NewsItem({ item, isNew }) {
  const isBreaking = item.importance === 'high' ||
    (item.title || '').toUpperCase().includes('BREAKING') ||
    (item.title || '').toUpperCase().includes('ALERT');
  const url = item.article_url || item.link || item.url;
  return (
    <div
      className={`np-news-item ${isNew ? 'np-news-item.new' : ''} ${isBreaking ? 'np-news-item.breaking' : ''}`}
      onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
      style={{ cursor: url ? 'pointer' : 'default' }}
    >
      <div className="flex-row np-news-header">
        <span className={`np-news-publisher ${isBreaking ? 'np-news-publisher.breaking' : 'np-news-publisher.normal'}`}>
          {isBreaking ? '◆ BREAKING ' : ''}{(item.publisher?.name || 'NEWSWIRE').toUpperCase()}
        </span>
        <span className="np-news-time">{timeAgo(item.published_utc)}</span>
      </div>
      <div className={`np-news-title ${isBreaking ? 'np-news-title.breaking' : 'np-news-title.normal'}`}>
        {item.title}
      </div>
      {item.tickers?.length > 0 && (
        <div className="flex-row np-news-tickers">
          {item.tickers.slice(0, 5).map((t) => (
            <span key={t} className="np-news-ticker">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function NewsPanel() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newItems, setNewItems] = useState(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const prevNews = useRef([]);
  const { getBadge } = useFeedStatus();
  const badge = getBadge('stocks');

  async function load() {
    try {
      const res = await apiFetch('/api/news');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const items = Array.isArray(json) ? json : (json.results || json.news || []);
      const prevIds = new Set(prevNews.current.map(n => n.id));
      const fresh = items.filter(n => !prevIds.has(n.id)).map(n => n.id);
      if (fresh.length > 0) {
        setNewItems(new Set(fresh));
        setTimeout(() => setNewItems(new Set()), 3000);
      }
      prevNews.current = items;
      setNews(items);
    } catch (e) {
      console.warn('NewsPanel load error:', e.message);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="flex-col np-container">
      <div className="flex-row np-header">
        <span className="np-header-title">NEWS FEED</span>
        <span className="np-header-count">{news.length > 0 ? news.length + ' STORIES' : ''}</span>
        <span className="np-header-badge" style={{ background: badge.bg, color: badge.color, borderColor: badge.color + '33' }}>
          {badge.text}
        </span>
        <div className="np-header-spacer" />
        <button className="btn np-collapse-btn" onClick={() => setCollapsed(v => !v)} title={collapsed ? 'Expand' : 'Collapse'}
        >{collapsed ? '+' : '−'}</button>
      </div>
      {!collapsed && (<>
      {error && news.length === 0 && (
        <div className="flex-row np-error-banner">
          <span className="np-error-icon">⚠</span>
          <span className="np-error-text">Feed error — retrying</span>
        </div>
      )}
      <div className="np-content">
        {loading ? (
          <EmptyState
            icon="⟳"
            message="Loading news feed..."
          />
        ) : news.length === 0 ? (
          <EmptyState
            icon="◎"
            title="No news available"
            message="News stories will appear here when the feed is available."
          />
        ) : (
          news.map(item => (
            <NewsItem key={item.id} item={item} isNew={newItems.has(item.id)} />
          ))
        )}
      </div>
      </>)}
    </div>
  );
}

export { NewsPanel };
export default memo(NewsPanel);
