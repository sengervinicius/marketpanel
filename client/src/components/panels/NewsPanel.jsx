// NewsPanel — Bloomberg-style WIRE view (Design v1, variant A — approved).
// Fetches from server /api/news every 60s.
//
// Layout (approved mockup particle-home-design-review.html):
//   · Row = grid [time 44px | source 66px | headline 1fr | ticker chips auto]
//     — one line per story, ~9 visible. Headline is the only bright element;
//     breaking/negative stories paint the headline red (no badges).
//   · AI briefing = visually separate purple layer capped at 3 one-line
//     themes with an impact tag. Never mixes with the wire below.
//   · Scope chips ALL | WATCHLIST | MACRO | ✦ AI (persisted). MACRO is a
//     client-side keyword filter; ✦ AI toggles the briefing layer.
//   · Click row → expands summary + full ticker chips (chip → 7-day AI
//     ticker summary, unchanged fetch path).
import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import { useFeedStatus } from '../../context/FeedStatusContext';
import { useWatchlist } from '../../context/WatchlistContext';
import { useSettings } from '../../context/SettingsContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { apiFetch } from '../../utils/api';
import EmptyState from '../common/EmptyState';
import PanelChrome from '../common/PanelChrome';
import './NewsPanel.css';

// ── Scope (ALL | WATCHLIST | MACRO) + ✦ AI layer toggle, persisted ──
const NEWS_SCOPE_KEY = 'newsScope_v1';
const NEWS_AI_KEY    = 'newsAI_v1';
const SCOPES = ['all', 'watchlist', 'macro'];

function loadNewsScope() {
  try {
    const v = localStorage.getItem(NEWS_SCOPE_KEY);
    return SCOPES.includes(v) ? v : 'all';
  } catch { return 'all'; }
}
function loadAiOn() {
  try { return localStorage.getItem(NEWS_AI_KEY) !== 'off'; } catch { return true; }
}

// MACRO scope — client-side filter on the macro keyword list (approved):
// fed, copom, cpi, inflation, rates, treasury, boj, ecb, gdp, payrolls,
// tariff, opec (+ direct synonyms fomc/selic/bcb/boe/yield).
const MACRO_RE = /\b(fed|fomc|copom|selic|bcb|cpi|inflation|rates?|treasur(?:y|ies)|yields?|boj|ecb|boe|gdp|payrolls?|tariffs?|opec|central banks?)\b/i;
const isMacroStory = (item) =>
  MACRO_RE.test(item?.title || '') || MACRO_RE.test(item?.description || '');

function fmtClock(dateStr) {
  if (!dateStr) return '--:--';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Per-ticker sentiment ONLY when the story itself carries it (Polygon
// `insights: [{ ticker, sentiment }]`) — green/red chip border. Neutral
// grey otherwise; never inferred client-side.
function tickerSentiment(item, ticker) {
  const ins = item?.insights;
  if (!Array.isArray(ins)) return null;
  const hit = ins.find(x => String(x?.ticker || '').toUpperCase() === String(ticker).toUpperCase());
  const s = String(hit?.sentiment || '').toLowerCase();
  if (s === 'positive' || s === 'bullish') return 'up';
  if (s === 'negative' || s === 'bearish') return 'down';
  return null;
}

function isBreakingStory(item) {
  const t = (item?.title || '').toUpperCase();
  return item?.importance === 'high' ||
    String(item?.sentiment || '').toLowerCase() === 'negative' ||
    t.includes('BREAKING') || t.includes('ALERT');
}

// Impact-tag fallback when the briefing response predates `impactTag`.
const IMPACT_FALLBACK = { macro: 'MACRO', earnings: 'EARNINGS', policy: 'POLICY', geo: 'GEO', idio: 'IDIO' };

// ── ✦ BRIEFING layer — ≤3 one-line themes + impact tag ──────────────
const WireBriefing = memo(function WireBriefing({
  briefing, loading, error, stale, generatedAt, coverage, onRefresh, onTickerClick,
}) {
  const [openTheme, setOpenTheme] = useState(null);
  if (!briefing && !loading && !error) return null;

  const themes = (briefing || []).slice(0, 3);

  return (
    <div className="np-brief">
      <div className="np-brief-head">
        <span className="np-brief-glyph">✦</span>
        <span>BRIEFING</span>
        {generatedAt && !loading && (<>
          <span className="np-brief-sep">·</span>
          <span>{fmtClock(generatedAt)}</span>
        </>)}
        <span className="np-brief-sep">·</span>
        <span className="np-brief-meta">
          {loading && !themes.length
            ? 'SYNTHESIZING…'
            : `${themes.length} THEME${themes.length === 1 ? '' : 'S'}${coverage ? ` FROM ${coverage} STORIES` : ''}`}
        </span>
        {stale && !loading && (
          <span className="np-brief-stale" title="Fresh briefing unavailable — showing the last cached synthesis">STALE</span>
        )}
        <span className="np-brief-spacer" />
        <button
          className="np-brief-refresh"
          onClick={onRefresh}
          disabled={loading}
          title="Regenerate briefing from latest feed"
        >{loading ? '⟳' : '↻'}</button>
      </div>

      {error && themes.length === 0 ? (
        <div className="np-brief-error">⚠ {error}</div>
      ) : themes.length === 0 && !loading ? (
        <div className="np-brief-error np-brief-error--muted">No high-impact themes in the current feed.</div>
      ) : (
        themes.map(item => {
          const tone = item.sentiment === 'bearish' ? 'hi' : item.sentiment === 'bullish' ? 'up' : 'med';
          const tag  = item.impactTag || IMPACT_FALLBACK[item.regime] || 'MACRO';
          const open = openTheme === item.rank;
          return (
            <div key={item.rank}>
              <div
                className="np-brow"
                onClick={() => setOpenTheme(open ? null : item.rank)}
                title={open ? 'Collapse' : item.whyItMatters}
              >
                <span className="np-brow-n">{item.rank}</span>
                <span className="np-brow-hl">{item.headline}</span>
                <span className={`np-brow-imp np-brow-imp--${tone}`}>{tag}</span>
              </div>
              {open && (
                <div className="np-brow-why">
                  <span>{item.whyItMatters}</span>
                  {(item.tickers || []).map(t => (
                    <span
                      key={t}
                      className="np-tkc np-tkc--click"
                      onClick={(e) => { e.stopPropagation(); onTickerClick?.(t); }}
                      title={`Chart ${t}`}
                    >{t}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
});

// ── Wire row — single line; click expands summary + full chips ──────
const WireRow = memo(function WireRow({ item, isNew, expanded, onToggle, getTickerSummary }) {
  const breaking = isBreakingStory(item);
  const url = item.article_url || item.link || item.url;
  const source = String(item.publisher?.name || item.publisher || item.source || item.author || 'NEWSWIRE');
  const tickers = item.tickers || [];
  const description = item.description || item.summary || '';

  // Per-ticker 7-day AI summary (unchanged fetch path, memoized panel-side).
  const [sumTicker, setSumTicker]   = useState(null);
  const [sumData, setSumData]       = useState(null);
  const [sumLoading, setSumLoading] = useState(false);
  const [sumError, setSumError]     = useState(null);
  const sumReq = useRef(null); // stale-response guard

  const handleTickerClick = async (e, t) => {
    e.stopPropagation();
    if (sumTicker === t) { setSumTicker(null); return; }
    sumReq.current = t;
    setSumTicker(t);
    setSumData(null);
    setSumError(null);
    setSumLoading(true);
    try {
      const d = await getTickerSummary(t);
      if (sumReq.current !== t) return; // user moved on
      setSumData(d);
    } catch (err) {
      if (sumReq.current !== t) return;
      setSumError(err.message || 'Summary failed');
    } finally {
      if (sumReq.current === t) setSumLoading(false);
    }
  };

  return (
    <div className={isNew ? 'np-wr-wrap np-wr-wrap--new' : 'np-wr-wrap'}>
      <div className="np-wr" onClick={onToggle} title={item.title}>
        <span className="np-wr-tm">{fmtClock(item.published_utc)}</span>
        <span className="np-wr-src">{source.toUpperCase()}</span>
        <span className={`np-wr-hl ${breaking ? 'np-wr-hl--brk' : ''}`}>{item.title}</span>
        <span className="np-wr-tk">
          {tickers.slice(0, 3).map(t => {
            const s = tickerSentiment(item, t);
            return <span key={t} className={`np-tkc ${s ? `np-tkc--${s}` : ''}`}>{t}</span>;
          })}
        </span>
      </div>

      {expanded && (
        <div className="np-wr-detail" onClick={(e) => e.stopPropagation()}>
          <div className="np-wr-desc">
            {description || 'No summary available for this story.'}
          </div>
          {(tickers.length > 0 || url) && (
            <div className="np-wr-detail-row">
              {tickers.slice(0, 8).map(t => {
                const s = tickerSentiment(item, t);
                return (
                  <span
                    key={t}
                    className={`np-tkc np-tkc--click ${s ? `np-tkc--${s}` : ''} ${sumTicker === t ? 'np-tkc--open' : ''}`}
                    onClick={(e) => handleTickerClick(e, t)}
                    title={`7-day AI summary for ${t}`}
                  >{t}</span>
                );
              })}
              {url && (
                <a
                  className="np-wr-open"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >OPEN ↗</a>
              )}
            </div>
          )}
          {sumTicker && (
            <div className="np-tksum">
              <div className="np-tksum-header">
                <span className="np-tksum-title">{sumTicker} · 7-DAY AI SUMMARY</span>
                {sumData && (
                  <span className={`np-tksum-sent np-tksum-sent--${sumData.sentiment || 'neutral'}`}>
                    {(sumData.sentiment || 'neutral').toUpperCase()}
                  </span>
                )}
                <button
                  className="np-tksum-close"
                  onClick={(e) => { e.stopPropagation(); setSumTicker(null); }}
                  title="Close summary"
                >×</button>
              </div>
              {sumLoading ? (
                <div className="np-tksum-loading">Summarizing last 7 days…</div>
              ) : sumError ? (
                <div className="np-tksum-error">⚠ {sumError}</div>
              ) : sumData ? (
                <>
                  {sumData.summary && <div className="np-tksum-summary">{sumData.summary}</div>}
                  {sumData.bullets?.length > 0 && (
                    <div className="np-tksum-bullets">
                      {sumData.bullets.map((b, i) => (
                        <div key={i} className="np-tksum-bullet">• {b}</div>
                      ))}
                    </div>
                  )}
                  <div className="np-tksum-meta">
                    {sumData.articleCount ?? 0} articles{sumData.cached ? ' · cached' : ''}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function NewsPanel() {
  const openDetail = useOpenDetail(); // FIX 4: briefing chips open detail, never the chart grid
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newItems, setNewItems] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const prevNews = useRef([]);
  const { getBadge } = useFeedStatus();
  const badge = getBadge('stocks');

  // Scope: ALL | WATCHLIST | MACRO. WATCHLIST narrows the server feed to
  // the user's tickers (empty watchlist falls back to ALL, chip disabled);
  // MACRO filters the general feed client-side by macro keywords.
  const { watchlist } = useWatchlist();

  // Phase S W2 — the personalized BRIEF panel supersedes this panel's
  // generic ✦ AI briefing layer. When 'brief' is anywhere in the user's
  // layout (legacy desktopRows OR the active home_grid_v2 layout) we keep
  // the wire but suppress the briefing layer + chip so the home screen
  // never shows two briefings. Logged-out / brief-less layouts keep the
  // generic layer exactly as before.
  const { settings } = useSettings();
  const briefInLayout = useMemo(() => {
    try {
      const rows = settings?.layout?.desktopRows || [];
      if (rows.some(r => Array.isArray(r) && r.includes('brief'))) return true;
      const layouts = settings?.layouts;
      const grid = layouts?.items?.[layouts.activeId]?.grid;
      if (Array.isArray(grid) && grid.some(g => g && g.i === 'brief')) return true;
    } catch { /* malformed settings — keep the generic layer */ }
    return false;
  }, [settings]);
  const [scope, setScopeState] = useState(loadNewsScope);
  const hasWatchlist = watchlist.length > 0;
  const effectiveScope = scope === 'watchlist' && !hasWatchlist ? 'all' : scope;
  const scopeTickers = effectiveScope === 'watchlist' ? watchlist.slice(0, 30).join(',') : '';
  const setScope = useCallback((s) => {
    setScopeState(s);
    try { localStorage.setItem(NEWS_SCOPE_KEY, s); } catch { /* private mode */ }
  }, []);

  // ✦ AI chip — shows/hides the briefing layer (and gates its fetch).
  const [aiOn, setAiOnState] = useState(loadAiOn);
  const briefingLayerOn = aiOn && !briefInLayout;
  const aiOnRef = useRef(briefingLayerOn);
  aiOnRef.current = briefingLayerOn;
  const toggleAi = useCallback(() => {
    setAiOnState(v => {
      const next = !v;
      try { localStorage.setItem(NEWS_AI_KEY, next ? 'on' : 'off'); } catch { /* private mode */ }
      return next;
    });
  }, []);

  // Per-ticker summary memo: one fetch per symbol per session (server
  // also caches 30 min). Stores the in-flight promise so concurrent
  // clicks share a single request.
  const tickerSummaryCache = useRef(new Map());
  const getTickerSummary = useCallback(async (symbol) => {
    const cache = tickerSummaryCache.current;
    if (cache.has(symbol)) return cache.get(symbol);
    const p = (async () => {
      const res = await apiFetch(`/api/news/ticker-summary/${encodeURIComponent(symbol)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`);
      return json;
    })();
    cache.set(symbol, p);
    try { return await p; } catch (e) { cache.delete(symbol); throw e; }
  }, []);

  // ✦ Briefing state (POST /api/search/news-briefing, server-cached 10 min)
  const [briefing, setBriefing]               = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError]     = useState(null);
  const [briefingAt, setBriefingAt]           = useState(null);
  const [briefingStale, setBriefingStale]     = useState(false);
  const [briefingCoverage, setBriefingCoverage] = useState(null);
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
        // #291 W1.14 — prefer the server's human-readable `message`.
        setBriefingError(json.message || json.error || `Briefing unavailable (${res.status})`);
        return;
      }
      setBriefing(json.briefing || []);
      setBriefingAt(json.generatedAt || new Date().toISOString());
      setBriefingStale(json.stale === true);
      setBriefingCoverage(json.coverage ?? null);
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
    // FIX 4 (ux-round4): ticker clicks open the instrument DETAIL view —
    // never the chart grid (the old 'chart:set-ticker' event is gone).
    openDetail(ticker);
  }, [openDetail]);

  const load = useCallback(async () => {
    try {
      const url = scopeTickers
        ? `/api/news?tickers=${encodeURIComponent(scopeTickers)}`
        : '/api/news';
      const res = await apiFetch(url);
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
      // Fire-and-forget briefing on the latest feed (server caches 10 min)
      // — only while the ✦ AI layer is on.
      if (items.length > 0 && aiOnRef.current) loadBriefing(items);
    } catch (e) {
      console.warn('NewsPanel load error:', e.message);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [scopeTickers, loadBriefing]);

  useEffect(() => {
    setLoading(true);
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, [load]);

  // Turning ✦ AI back on should (re)hydrate the briefing from the feed
  // we already have — no extra news fetch.
  useEffect(() => {
    if (briefingLayerOn && news.length > 0) loadBriefing(news);
  }, [briefingLayerOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayed = effectiveScope === 'macro' ? news.filter(isMacroStory) : news;

  // Items carry no stable id from every provider — fall back to url/title.
  const rowKey = (item, i) => item.id || item.article_url || item.link || `${item.title}-${i}`;

  return (
    <div className="flex-col np-container">
      <PanelChrome
        title="NEWS"
        subtitle={displayed.length > 0 ? `${displayed.length} STORIES · ${badge.text}` : badge.text}
        updatedAt={lastUpdated}
        source="Multi-source"
        actions={(
          <div className="np-chips" role="group" aria-label="News scope">
            <button
              className={`np-chip ${effectiveScope === 'all' ? 'np-chip--on' : ''}`}
              onClick={() => setScope('all')}
              title="All market news"
            >ALL</button>
            <button
              className={`np-chip ${effectiveScope === 'watchlist' ? 'np-chip--on' : ''}`}
              onClick={() => setScope('watchlist')}
              disabled={!hasWatchlist}
              title={hasWatchlist ? 'Only stories matching your watchlist' : 'Watchlist is empty'}
            >WATCHLIST</button>
            <button
              className={`np-chip ${effectiveScope === 'macro' ? 'np-chip--on' : ''}`}
              onClick={() => setScope('macro')}
              title="Macro stories only — central banks, inflation, rates, tariffs, OPEC"
            >MACRO</button>
            {!briefInLayout && (
              <button
                className={`np-chip np-chip--ai ${aiOn ? 'np-chip--on' : ''}`}
                onClick={toggleAi}
                title={aiOn ? 'Hide AI briefing layer' : 'Show AI briefing layer'}
              >✦ AI</button>
            )}
          </div>
        )}
      />

      {briefingLayerOn && (
        <WireBriefing
          briefing={briefing}
          loading={briefingLoading}
          error={briefingError}
          stale={briefingStale}
          generatedAt={briefingAt}
          coverage={briefingCoverage}
          onRefresh={handleBriefingRefresh}
          onTickerClick={handleBriefingTickerClick}
        />
      )}

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
        ) : displayed.length === 0 ? (
          <div>
            <EmptyState
              icon="◎"
              title={effectiveScope === 'macro' ? 'No macro stories' : 'No news available'}
              message={effectiveScope === 'macro'
                ? 'No stories in the current feed match the macro filter.'
                : 'News stories will appear here when the feed is available.'}
            />
            {effectiveScope !== 'macro' && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                <button onClick={() => load()} style={{ marginTop: 8, padding: '6px 12px', fontSize: 11, fontWeight: 600, background: 'transparent', border: '1px solid var(--accent)', borderRadius: 3, color: 'var(--accent)', cursor: 'pointer' }}>
                  REFRESH
                </button>
              </div>
            )}
          </div>
        ) : (
          displayed.map((item, i) => {
            const key = rowKey(item, i);
            return (
              <WireRow
                key={key}
                item={item}
                isNew={newItems.has(item.id)}
                expanded={expandedId === key}
                onToggle={() => setExpandedId(id => (id === key ? null : key))}
                getTickerSummary={getTickerSummary}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

export { NewsPanel };
export default memo(NewsPanel);
