// NewsPanel — scrolling news feed (self-fetching)
// Fetches from server /api/snapshot/news every 60s
import { useState, useEffect, useRef } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

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
  return (
    <div style={{
      padding: '4px 6px',
      borderBottom: '1px solid #0d0d0d',
      background: isNew ? '#1a0a00' : isBreaking ? '#120000' : 'transparent',
      transition: 'background 1s',
      cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ color: isBreaking ? '#ff2222' : '#ff6600', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>
          {isBreaking ? '◆ BREAKING ' : ''}{(item.publisher?.name || 'NEWSWIRE').toUpperCase()}
        </span>
        <span style={{ color: '#444', fontSize: 9 }}>{timeAgo(item.published_utc)}</span>
      </div>
      <div style={{ color: isBreaking ? '#ff6666' : '#c8c8c8', fontSize: 11, lineHeight: 1.35, fontWeight: isBreaking ? 600 : 400 }}>
        {item.title}
      </div>
      {item.tickers?.length > 0 && (
        <div style={{ marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {item.tickers.slice(0, 5).map((t) => (
            <span key={t} style={{ color: '#ff6600', fontSize: 9, background: '#1a0d00', padding: '1px 4px', border: '1px solid #2a1500' }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewsPanel() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newItems, setNewItems] = useState(new Set());
  const prevNews = useRef([]);

  async function load() {
    try {
      const res = await fetch(SERVER_URL + '/api/snapshot/news');
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#ff6600', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>NEWS FEED</span>
        <span style={{ color: '#333', fontSize: '8px' }}>{news.length > 0 ? news.length + ' STORIES' : ''}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', background: '#000' }}>
        {loading ? (
          <div style={{ color: '#333', padding: 12, textAlign: 'center', fontSize: 10 }}>Loading news feed...</div>
        ) : news.length === 0 ? (
          <div style={{ color: '#333', padding: 12, textAlign: 'center', fontSize: 10 }}>No stories available.</div>
        ) : (
          news.map(item => (
            <NewsItem key={item.id} item={item} isNew={newItems.has(item.id)} />
          ))
        )}
      </div>
    </div>
  );
}
