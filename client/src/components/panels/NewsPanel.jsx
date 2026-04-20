// NewsPanel — scrolling news feed (self-fetching)
// Fetches from server /api/news every 60s
import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { apiFetch } from '../../utils/api';
import EmptyState from '../common/EmptyState';
import { PanelHeader } from './_shared';
import './NewsPanel.css';

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)    return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const NewsItem = memo(function NewsItem({ item, isNew, sentimentMap }) {
  const isBreaking = item.importance === 'high' ||
    (item.title || '').toUpperCase().includes('BREAKING') ||
    (item.title || '').toUpperCase().includes('ALERT');
  const url = item.article_url || item.link || item.url;
  const sentiment = sentimentMap?.[item.id];

  return (
    <div
      className={`np-news-item ${isNew ? 'np-news-item--new' : ''} ${isBreaking ? 'np-news-item--breaking' : ''}`}
      onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
      style={{ cursor: url ? 'pointer' : 'default' }}
    >
      <div className="flex-row np-news-header">
        <div className="flex-row np-news-publisher-wrapper">
          <span className={`np-news-publisher ${isBreaking ? 'np-news-publisher--breaking' : 'np-news-publisher--normal'}`}>
            {isBreaking ? '◆ BREAKING ' : ''}{(item.publisher?.name || 'NEWSWIRE').toUpperCase()}
          </span>
          {sentiment && (
            <span className={`np-sentiment-badge np-sentiment-badge--${sentiment}`}>
              {sentiment === 'bullish' ? '▲' : sentiment === 'bearish' ? '▼' : '◆'}
            </span>
          )}
        </div>
        <span className="np-news-time">{timeAgo(item.published_utc)}</span>
      </div>
      <div className={`np-news-title ${isBreaking ? 'np-news-title--breaking' : 'np-news-title--normal'}`}>
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
});

function NewsPanel() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newItems, setNewItems] = useState(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [sentimentMap, setSentimentMap] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
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
      setLastUpdated(new Date());
    } catch (e) {
      console.warn('NewsPanel load error:', e.message);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const handleAiSummary = useCallback(async () => {
    if (news.length === 0) return;

    setAiLoading(true);
    setAiError(null);

    try {
      const headlines = news.map(item => item.title);
      const res = await apiFetch('/api/search/news-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headlines })
      });

      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      // Build sentiment map from items
      const newSentimentMap = {};
      if (data.items && Array.isArray(data.items)) {
        data.items.forEach((item, idx) => {
          if (idx < news.length) {
            newSentimentMap[news[idx].id] = item.sentiment;
          }
        });
      }
      setSentimentMap(newSentimentMap);
      setAiSummary(data.summary || []);
      setAiSummaryOpen(true);
    } catch (e) {
      console.warn('AI summary error:', e.message);
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  }, [news]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="flex-col np-container">
      <PanelHeader
        title="NEWS FEED"
        subtitle={news.length > 0 ? `${news.length} STORIES · ${badge.text}` : badge.text}
        updatedAt={lastUpdated}
        source="Multi-source"
        actions={(
          <>
            {news.length > 0 && (
              <button
                className="pp-header-btn pp-header-btn--accent"
                onClick={handleAiSummary}
                disabled={aiLoading}
                title="Generate AI summary and sentiment"
              >{aiLoading ? '⟳' : '◆'} AI</button>
            )}
            <button
              className="pp-header-btn"
              onClick={() => setCollapsed(v => !v)}
              title={collapsed ? 'Expand' : 'Collapse'}
            >{collapsed ? '+' : '−'}</button>
          </>
        )}
      />
      {aiSummaryOpen && (
        <div className="np-ai-summary">
          {aiError && (
            <div className="np-ai-error">
              <span>Error: {aiError}</span>
              <button className="np-ai-retry" onClick={handleAiSummary}>Retry</button>
            </div>
          )}
          {aiSummary && aiSummary.length > 0 && (
            <div className="np-ai-summary-bullets">
              {aiSummary.slice(0, 3).map((bullet, idx) => (
                <div key={idx} className="np-ai-summary-bullet">
                  • {bullet}
                </div>
              ))}
            </div>
          )}
          {aiLoading && (
            <div className="np-ai-loading">Generating summary...</div>
          )}
          <button
            className="np-ai-close-btn"
            onClick={() => setAiSummaryOpen(false)}
            title="Close summary"
          >×</button>
        </div>
      )}
      {!collapsed && (<>
      {error && news.length === 0 && (
        <div className="flex-row np-error-banner">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:'middle',marginRight:2}} className="np-error-icon"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
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
          <div>
            <EmptyState
              icon="◎"
              title="No news available"
              message="News stories will appear here when the feed is available."
            />
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <button onClick={() => load()} style={{ marginTop: 8, padding: '6px 12px', fontSize: 11, fontWeight: 600, background: 'transparent', border: '1px solid var(--accent)', borderRadius: 3, color: 'var(--accent)', cursor: 'pointer' }}>
                REFRESH
              </button>
            </div>
          </div>
        ) : (
          news.map(item => (
            <NewsItem key={item.id} item={item} isNew={newItems.has(item.id)} sentimentMap={sentimentMap} />
          ))
        )}
      </div>
      </>)}
    </div>
  );
}

export { NewsPanel };
export default memo(NewsPanel);
