/**
 * NewsPanel — scrolling Bloomberg-style news feed
 * Shows Polygon news, highlights breaking news in red
 */

import { useState, useEffect, useRef } from 'react';
import { SectionHeader } from '../common/SectionHeader';

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)   return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
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
      {/* Header: source + time */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ color: isBreaking ? '#ff2222' : '#ff6600', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>
          {isBreaking ? '◆ BREAKING  ' : ''}{(item.publisher?.name || 'NEWSWIRE').toUpperCase()}
        </span>
        <span style={{ color: '#444', fontSize: 9 }}>{timeAgo(item.published_utc)}</span>
      </div>

      {/* Headline */}
      <div style={{
        color: isBreaking ? '#ff6666' : '#c8c8c8',
        fontSize: 11,
        lineHeight: 1.35,
        fontWeight: isBreaking ? 600 : 400,
      }}>
        {item.title}
      </div>

      {/* Tickers */}
      {item.tickers?.length > 0 && (
        <div style={{ marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {item.tickers.slice(0, 5).map((t) => (
            <span key={t} style={{
              color: '#ff6600',
              fontSize: 9,
              background: '#1a0d00',
              padding: '1px 4px',
              border: '1px solid #2a1500',
            }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewsPanel({ news }) {
  const [newItems, setNewItems] = useState(new Set());
  const prevNews = useRef([]);
  const containerRef = useRef(null);

  useEffect(() => {
    if (news.length === 0) return;
    const prevIds = new Set(prevNews.current.map((n) => n.id));
    const fresh = news.filter((n) => !prevIds.has(n.id)).map((n) => n.id);
    if (fresh.length > 0) {
      setNewItems(new Set(fresh));
      setTimeout(() => setNewItems(new Set()), 3000);
    }
    prevNews.current = news;
  }, [news]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SectionHeader title="NEWS FEED" right={`${news.length} STORIES`} />

      <div
        ref={containerRef}
        style={{ flex: 1, overflowY: 'auto', background: '#000' }}
      >
        {news.length === 0 ? (
          <div style={{ color: '#333', padding: 12, textAlign: 'center', fontSize: 10 }}>
            Loading news feed...
          </div>
        ) : (
          news.map((item) => (
            <NewsItem
              key={item.id}
              item={item}
              isNew={newItems.has(item.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
