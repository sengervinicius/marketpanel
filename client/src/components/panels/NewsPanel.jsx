// NewsPanel — scrolling news feed (self-fetching)
// Fetches from server /api/news every 60s.
// Phase 9.3: Adds a "Today's Briefing" card at the top — a CIO-voice top-3
// synthesis of the incoming feed, served by POST /api/search/news-briefing
// (cached server-side for 10 minutes).
import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { apiFetch } from '../../utils/api';
import EmptyState from '../common/EmptyState';
import { PanelHeader } from './_shared';
import './NewsPanel.css';

// ── Morning Briefing card ─────────────────────────────────────────
const REGIME_LABELS = { macro: 'MACRO', earnings: 'EARNINGS', policy: 'POLICY', geo: 'GEO', idio: 'IDIO' };
const SENT_GLYPH    = { bullish: '▲', bearish: '▼', neutral: '◆' };

const BriefingCard = memo(function BriefingCard({ briefing, loading, error, onRefresh, generatedAt, onTickerClick }) {
  const [open, setOpen] = useState(true);

  if (!briefing && !loading && !error) return null;

  const minsAgo = generatedAt
    ? Math.max(0, Math.round((Date.now() - new Date(generatedAt).getTime()) / 60000))
    : null;

  return (
    <div className="np-briefing">
      <div className="np-briefing-header">
        <span className="np-briefing-title">
          <span className="np-briefing-title-glyph">◆</span>
          Today&apos;s Briefing
        </span>
        <div className="np-briefing-meta">
          {minsAgo != null && !loading && <span>{minsAgo}m ago</span>}
          <button
            className="np-briefing-refresh"
            onClick={onRefresh}
            disabled={loading}
            title="Regenerate briefing from latest feed"
          >{loading ? '⟳ SYNCING' : 'REFRESH'}</button>
          <button
            className="np-briefing-refresh"
            onClick={() => setOpen(o => !o)}
            title={open ? 'Collapse' : 'Expand'}
          >{open ? '−' : '+'}</button>
        </div>
      </div>

      {!open ? (
        <div className="np-briefing-collapsed">
          {briefing?.length
            ? `${briefing.length} pick${briefing.length === 1 ? '' : 's'} ready — click + to expand`
            : 'Click + to expand'}
        </div>
      ) : loading && !briefing ? (
        <div className="np-briefing-loading">Synthesizing top-3 from the feed…</div>
      ) : error ? (
        <div className="np-briefing-error">⚠ {error}</div>
      ) : !briefing || briefing.length === 0 ? (
        <div className="np-briefing-empty">No high-impact stories in the current feed.</div>
      ) : (
        <div className="np-briefing-list">
          {briefing.map(item => (
            <div key={item.rank} className="np-briefing-item">
              <span className="np-briefing-rank">{item.rank}.</span>
              <div className="np-briefing-body">
                <div className="np-briefing-headline">
                  <span className={`np-briefing-sent np-briefing-sent--${item.sentiment}`}>
                    {SENT_GLYPH[item.sentiment] || '◆'}
                  </span>{' '}
                  {item.headline}
                </div>
                <div className="np-briefing-why">{item.whyItMatters}</div>
                {(item.tickers?.length > 0 || item.regime) && (
                  <div className="np-briefing-tags">
                    {(item.tickers || []).map(t => (
                      <span
                        key={t}
                        className="np-briefing-ticker"
                        onClick={() => onTickerClick?.(t)}
                        title={`Chart ${t}`}
                      >{t}</span>
                    ))}
                    {item.regime && (
                      <span className={`np-briefing-regime np-briefing-regime--${item.regime}`}>
                        {REGIME_LABELS[item.regime] || item.regime}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

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

  // Phase 9.3 — Today's Briefing state
  const [briefing, setBriefing]               = useState(null);  // array of { rank, headline, ... }
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError]     = useState(null);
  const [briefingAt, setBriefingAt]           = useState(null);
  const briefingFetchedFor                    = useRef(null); // hash of story ids we last sent

  const loadBriefing = useCallback(async (stories, { force = false } = {}) => {
    if (!stories || stories.length === 0) return;
    // Hash first-10 ids — same heuristic the server uses to cache.
    const hash = stories.slice(0, 10).map(s => s.id).join('|');
    if (!force && briefingFetchedFor.current === hash) return;
    briefingFetchedFor.current = hash;

    setBriefingLoading(true);
    setBriefingError(null);
    try {
      const payload = stories.slice(0, 30).map(s => ({
        id: s.id,
        title: s.title,
        publisher: s.publisher?.name || s.publisher || '',
        tickers: s.tickers || [],
        publishedAt: s.published_utc || s.publishedAt || null,
      }));
      const res  = await apiFetch('/api/search/news-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stories: payload }),
      });
      const json = await res.json();
      if (!res.ok) {
        setBriefingError(json.error || `Briefing unavailable (${res.status})`);
        return;
      }
      setBriefing(json.briefing || []);
      setBriefingAt(json.generatedAt || new Date().toISOString());
    } catch (e) {
      setBriefingError(e.message || 'Briefing failed');
    } finally {
      setBriefingLoading(false);
    }
  }, []);

  const handleBriefingRefresh = useCallback(() => {
    loadBriefing(news, { force: true });
  }, [loadBriefing, news]);

  const handleBriefingTickerClick = useCallback((ticker) => {
    if (!ticker) return;
    // Soft-navigate: dispatch the app's chart-change event so the main
    // chart picks it up, without making NewsPanel own a ticker prop.
    window.dispatchEvent(new CustomEvent('chart:set-ticker', { detail: { ticker } }));
  }, []);

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
      // Fire-and-forget briefing on the latest feed; server caches for 10 min.
      if (items.length > 0) loadBriefing(items);
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
      {/* Phase 9.3: CIO-voice morning briefing atop the feed */}
      <BriefingCard
        briefing={briefing}
        loading={briefingLoading}
        error={briefingError}
        generatedAt={briefingAt}
        onRefresh={handleBriefingRefresh}
        onTickerClick={handleBriefingTickerClick}
      />
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
