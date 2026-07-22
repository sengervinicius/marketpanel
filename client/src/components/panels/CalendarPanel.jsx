/**
 * CalendarPanel.jsx — S4.11 Enhanced Economic & Earnings Calendar
 * Two-tab panel: MACRO    (Eulerpool → Finnhub economic → static fallback)
 *                EARNINGS (Eulerpool → Finnhub /calendar/earnings)
 * AI-powered event previews via /api/search/event-preview.
 */
import { useState, useCallback, useMemo, memo, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import { useJsonQuery, STALE_TIMES } from '../../lib/queryHooks';
// #286 — surface "live | curated | provider offline" so the footer
// gives the CIO a one-glance read on why we're showing static data.
import { getProviderStatus } from '../../utils/providerStatus';
// H2 W1.2 — home-grade chrome: shared PanelChrome header + PanelTabRow
// tabs, watchlist filter for earnings, surprise coloring on macro rows.
import PanelChrome from '../common/PanelChrome';
import { PanelTabRow } from './_shared';
import ViewChips from '../common/ViewChips';
import { useWatchlist } from '../../context/WatchlistContext';
import './CalendarPanel.css';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerClicks } from '../../hooks/useTickerClicks';

// Timezone detection
const USER_TZ_SHORT = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
})();

// Static fallback economic events (used when the live providers return
// empty). Calendar-defect fix: the schedule had gone stale (Apr/May
// dates rendering in July) — refreshed to the upcoming Jul-Sep window.
// Curated dates follow the published Fed/BLS/BEA/ECB/BCB calendars; the
// footer already labels this view "(curated · provider offline)".
const STATIC_EVENTS = [
  { id: 'fomc', name: 'FOMC Rate Decision', date: 'Jul 29, 2026', time: '14:00 ET', importance: 'high', previous: '4.25-4.50%', forecast: '4.25-4.50%' },
  { id: 'gdp', name: 'US GDP Q2 (Advance)', date: 'Jul 30, 2026', time: '08:30 ET', importance: 'high', previous: '2.0%', forecast: null },
  { id: 'copom', name: 'COPOM (Selic) Decision', date: 'Jul 30, 2026', time: '18:30 BRT', importance: 'high', previous: '14.75%', forecast: null },
  { id: 'pce', name: 'US PCE Price Index (Jun)', date: 'Jul 31, 2026', time: '08:30 ET', importance: 'high', previous: '2.4% YoY', forecast: null },
  { id: 'ism', name: 'ISM Manufacturing PMI (Jul)', date: 'Aug 3, 2026', time: '10:00 ET', importance: 'medium', previous: '49.5', forecast: null },
  { id: 'nfp', name: 'US Non-Farm Payrolls (Jul)', date: 'Aug 7, 2026', time: '08:30 ET', importance: 'high', previous: '+200K', forecast: null },
  { id: 'cpi', name: 'US CPI (Jul)', date: 'Aug 12, 2026', time: '08:30 ET', importance: 'high', previous: '2.3% YoY', forecast: null },
  { id: 'retail', name: 'US Retail Sales (Jul)', date: 'Aug 14, 2026', time: '08:30 ET', importance: 'medium', previous: '+0.8%', forecast: null },
  { id: 'ecb', name: 'ECB Rate Decision', date: 'Sep 10, 2026', time: '08:15 ET', importance: 'high', previous: '2.40%', forecast: null },
  { id: 'fomc2', name: 'FOMC Rate Decision', date: 'Sep 16, 2026', time: '14:00 ET', importance: 'high', previous: '4.25-4.50%', forecast: null },
];

// H2 W1.2 — surprise read: parse the leading numeric out of strings like
// "2.4% YoY", "+228K", "4.25-4.50%" (first number wins) so actual can be
// compared against consensus. Returns null when nothing parses.
// fix/rates-earnings-popout item 2 — market-cap formatter for the earnings
// rows + the >$10B material filter. Cap arrives from /api/snapshot/tickers
// (results[SYM].ticker.fund.marketCap). Empty string when unknown.
const MATERIAL_CAP = 10e9;          // >$10B threshold for the default filter
const SNAPSHOT_BATCH_MAX = 50;      // server hard cap per /snapshot/tickers call
function fmtCap(v) {
  if (v == null || !Number.isFinite(v) || v <= 0) return '';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(0)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function parseEventNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

// 'beat' | 'miss' | null — only when BOTH actual and consensus parse.
function surpriseTone(actual, consensus) {
  const a = parseEventNum(actual);
  const c = parseEventNum(consensus);
  if (a == null || c == null || a === c) return null;
  return a > c ? 'beat' : 'miss';
}

// Polish W2 item 5 — wire-pattern rows. Day helpers for the date chips
// and thin day dividers (both tabs group rows by day like the news wire).
const DOW3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function parseDay(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr);
  const iso = str.match(/^\d{4}-\d{2}-\d{2}/);
  const d = iso ? new Date(`${iso[0]}T12:00:00`) : new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}
// "MON 27" — per-row date chip
function dayChip(dateStr) {
  const d = parseDay(dateStr);
  return d ? `${DOW3[d.getDay()]} ${d.getDate()}` : 'TBD';
}
// "MON · JUL 27" — day divider label
function dayLabel(dateStr) {
  const d = parseDay(dateStr);
  return d ? `${DOW3[d.getDay()]} · ${MON3[d.getMonth()]} ${d.getDate()}` : String(dateStr || 'DATE TBD');
}
// Stable grouping by calendar day, ordered chronologically (TBD last).
function groupByDay(items, getDate) {
  const map = new Map();
  for (const item of items) {
    const d = parseDay(getDate(item));
    const key = d ? d.toISOString().slice(0, 10) : 'zzz-tbd';
    if (!map.has(key)) map.set(key, { key, label: dayLabel(getDate(item)), items: [] });
    map.get(key).items.push(item);
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function EventRow({ event, expanded, onToggle, preview, previewLoading, previewError, onRequestPreview }) {
  // Polish W2 item 5 — wire-pattern macro row:
  // [TIME chip | importance dot | EVENT | consensus/prior | actual (beat/miss)]
  const tone = event.actual != null ? surpriseTone(event.actual, event.forecast) : null;
  return (
    <div className={`cp-event ${expanded ? 'cp-event--expanded' : ''}`}>
      <div className="cp-event-row cp-mac-row" onClick={onToggle} title={`${event.name} · ${event.date}${USER_TZ_SHORT ? ` (${USER_TZ_SHORT})` : ''}`}>
        <span className="cp-chip-date">{event.time || dayChip(event.date)}</span>
        <span className={`cp-imp-dot cp-imp-dot--${event.importance || 'medium'}`} />
        <span className="cp-mac-name">{event.name}</span>
        <span className="cp-mac-nums">
          {event.forecast != null && <span className="cp-mac-cons">CONS {event.forecast}</span>}
          {event.previous != null && <span className="cp-mac-prev">PREV {event.previous}</span>}
          {event.actual != null && (
            <span className={`cp-event-actual${tone ? ` cp-event-actual--${tone}` : ''}`}>
              ACT {event.actual}
            </span>
          )}
        </span>
        <span className="cp-event-chevron">{expanded ? '\u25BE' : '\u25B8'}</span>
      </div>
      {expanded && (
        <div className="cp-event-detail">
          {!preview && !previewLoading && !previewError && (
            <button className="btn cp-ai-preview-btn" onClick={(e) => { e.stopPropagation(); onRequestPreview(); }}>
              AI EVENT PREVIEW
            </button>
          )}
          {previewLoading && <div className="cp-ai-loading">Analyzing event impact...</div>}
          {previewError && (
            <div className="cp-ai-error">
              {previewError}
              <button className="btn cp-ai-retry-btn" onClick={(e) => { e.stopPropagation(); onRequestPreview(); }}>Retry</button>
            </div>
          )}
          {preview && (
            <div className="cp-ai-preview">
              <div className="cp-ai-preview-header">
                <span className={`cp-ai-impact cp-ai-impact--${preview.impact}`}>
                  {preview.impact?.toUpperCase()} IMPACT
                </span>
              </div>
              <p className="cp-ai-summary">{preview.summary}</p>
              {preview.marketExpectation && <p className="cp-ai-expectation">Consensus: {preview.marketExpectation}</p>}
              {preview.affectedSectors?.length > 0 && (
                <div className="cp-ai-tags">
                  <span className="cp-ai-tag-label">Sectors:</span>
                  {preview.affectedSectors.map(s => <span key={s} className="cp-ai-tag">{s}</span>)}
                </div>
              )}
              {preview.affectedAssets?.length > 0 && (
                <div className="cp-ai-tags">
                  <span className="cp-ai-tag-label">Tickers:</span>
                  {preview.affectedAssets.map(t => <span key={t} className="cp-ai-tag cp-ai-tag--ticker">{t}</span>)}
                </div>
              )}
              {preview.tradingConsiderations?.length > 0 && (
                <div className="cp-ai-considerations">
                  {preview.tradingConsiderations.map((c, i) => <div key={i} className="cp-ai-consideration">{c}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Earnings Row — Polish W2 item 5, news-wire pattern ───────────────
 * [DATE chip mono (MON 27) | BMO/AMC badge | TICKER bold | company muted
 *  ellipsized | est EPS right-aligned mono]. `mine` rows (watchlist names
 * in the pinned MY NAMES group) carry the accent left edge. */
function EarningsRow({ item, mine = false, cap, resolvedName, expanded, onToggle, preview, previewLoading, previewError }) {
  // fix/rates-earnings-popout item 2 — earnings rows are now macro-tab grade:
  //  · CLICK the row → expandable AI earnings preview (whatTheyDo, consensus,
  //    last-qtr beat/miss, 2 things to watch).
  //  · CLICK the TICKER → in-app detail overlay; DOUBLE-CLICK → detail window
  //    (wave-nov item 5 contract preserved; ticker click is isolated from the
  //    row's expand toggle via stopPropagation).
  const openDetail = useOpenDetail();
  const dateStr = item.date || item.reportDate || '';
  const timingRaw = String(item.timing || item.when || '').toUpperCase();
  const timing = timingRaw === 'BMO' ? 'BMO' : timingRaw === 'AMC' ? 'AMC' : 'TBD';
  const ticker = item.ticker || item.symbol || '—';
  const name = item.name || item.companyName || resolvedName || '';
  const epsEst = item.epsEstimate ?? item.consensusEps ?? null;
  const eps = epsEst == null ? '—'
    : `EST ${typeof epsEst === 'number' ? epsEst.toFixed(2) : String(epsEst)}`;

  const hasTicker = ticker && ticker !== '—';
  const rowClicks = useTickerClicks(ticker, { onSingle: (sym) => openDetail(sym) });
  const capStr = fmtCap(cap);

  return (
    <div className={`cp-ern-item${expanded ? ' cp-ern-item--open' : ''}`}>
      <div
        className={`cp-ern-row${mine ? ' cp-ern-row--mine' : ''}${expanded ? ' cp-ern-row--open' : ''}`}
        title={hasTicker ? `${ticker} · ${name}${capStr ? ` · ${capStr}` : ''} · ${dateStr} · click row → preview` : `${ticker} · ${name} · ${dateStr}`}
        role="button"
        style={{ cursor: 'pointer' }}
        onClick={onToggle}
      >
        <span className="cp-chip-date">{dayChip(dateStr)}</span>
        <span className={`cp-ern-tim cp-ern-tim--${timing.toLowerCase()}`}>{timing}</span>
        <span
          className="cp-ern-tkr"
          role={hasTicker ? 'button' : undefined}
          title={hasTicker ? `${ticker} · click → detail, double-click → window` : undefined}
          style={hasTicker ? { cursor: 'pointer' } : undefined}
          onClick={hasTicker ? (e) => { e.stopPropagation(); rowClicks.onClick(e); } : undefined}
          onDoubleClick={hasTicker ? (e) => { e.stopPropagation(); rowClicks.onDoubleClick(e); } : undefined}
        >{ticker}</span>
        <span className="cp-ern-co">{name}</span>
        <span className="cp-ern-cap">{capStr}</span>
        <span className="cp-ern-eps">{eps}</span>
        <span className={`cp-ern-caret${expanded ? ' cp-ern-caret--open' : ''}`} aria-hidden="true">▸</span>
      </div>
      {expanded && (
        <div className="cp-ern-detail">
          {previewLoading && <div className="cp-ai-loading">Loading earnings preview…</div>}
          {previewError && <div className="cp-ai-error">{previewError}</div>}
          {preview && (
            <div className="cp-ai-preview">
              {preview.whatTheyDo && <p className="cp-ai-summary">{preview.whatTheyDo}</p>}
              <div className="cp-ern-cons">
                <span><b>Cons. EPS</b> {preview.consensusEps ?? '—'}</span>
                <span><b>Cons. Rev</b> {preview.consensusRev ?? '—'}</span>
              </div>
              {preview.lastQtrResult && <p className="cp-ai-expectation">Last qtr: {preview.lastQtrResult}</p>}
              {preview.watchFor?.length > 0 && (
                <div className="cp-ai-considerations">
                  <span className="cp-ai-tag-label">WATCH FOR</span>
                  {preview.watchFor.map((w, i) => <div key={i} className="cp-ai-consideration">{w}</div>)}
                </div>
              )}
              {preview.degraded && <div className="cp-ai-src-note">preview via fallback model</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main CalendarPanel ───────────────────────────────────────────── */
function CalendarPanel() {
  // H2 W1.2 — EARNINGS first (home-grade spec); MACRO replaces the old
  // ECONOMIC label. State ids keep the tab names.
  const [tab, setTab] = useState('EARNINGS');
  // fix/rates-earnings-popout item 2a — MIN-CAP filter: MINE | 10B | ALL.
  // Default '10B' so only material reporters (>$10B) surface.
  const [capFilter, setCapFilter] = useState('10B');
  const [caps, setCaps] = useState({});   // { SYM: marketCap }
  const [names, setNames] = useState({}); // { SYM: companyName } — resolved from snapshot (earnings feed has no names)
  const { watchlist } = useWatchlist();
  const [expandedId, setExpandedId] = useState(null);
  const [previews, setPreviews] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [errors, setErrors] = useState({});

  // #245 P2.3 — TanStack Query replaces manual useEffect+fetch.
  // Calendar data changes on the hour (macro) or daily (earnings); 15m
  // staleTime matches the FUNDAMENTALS tier.
  const {
    data: macroResp,
    isPending: macroLoading,
  } = useJsonQuery(['/api/market/macro-calendar'], {
    staleTime: STALE_TIMES.FUNDAMENTALS,
  });
  // Calendar-defect fix: pass the watchlist so the server's keyless
  // Yahoo fallback (watchlist + S&P 100) can cover user names too.
  const earningsUrl = useMemo(() => {
    const syms = (watchlist || []).slice(0, 50).map(w => String(w)).filter(Boolean);
    return syms.length
      ? `/api/market/earnings-calendar?symbols=${encodeURIComponent(syms.join(','))}`
      : '/api/market/earnings-calendar';
  }, [watchlist]);
  const {
    data: earningsResp,
    isPending: earningsLoading,
  } = useJsonQuery([earningsUrl], {
    staleTime: STALE_TIMES.FUNDAMENTALS,
  });

  const macroEvents = useMemo(() => {
    if (!macroResp?.data?.length) return null;
    return macroResp.data.map((evt, i) => ({
      id: evt.id || `macro-${i}`,
      name: evt.name || evt.event || evt.title || '—',
      date: evt.date || evt.datetime || '',
      time: evt.time || '',
      importance: evt.importance || evt.impact || 'medium',
      // H2 W1.2 — keep actual separate from previous so the row can show
      // the beat/miss read (actual vs consensus) when both exist.
      previous: evt.previous ?? null,
      forecast: evt.forecast ?? evt.consensus ?? null,
      actual: evt.actual ?? null,
    }));
  }, [macroResp]);

  const earnings = useMemo(() => {
    if (!earningsResp?.data) return null;
    return Array.isArray(earningsResp.data) ? earningsResp.data : [];
  }, [earningsResp]);

  // H2 W1.2 — client-side watchlist filter for the earnings tab. Watchlist
  // symbols may carry venue suffixes (PETR4.SA) or prefixes (X:BTCUSD);
  // match on the bare uppercased root so AAPL rows match 'AAPL'.
  const watchSet = useMemo(() => {
    const set = new Set();
    for (const w of watchlist || []) {
      const up = String(w).toUpperCase();
      set.add(up);
      set.add(up.replace(/^(C:|X:)/, '').replace(/\.SA$/, ''));
    }
    return set;
  }, [watchlist]);

  const handleToggle = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const handleRequestPreview = useCallback(async (event) => {
    setLoadingId(event.id);
    setErrors(prev => ({ ...prev, [event.id]: null }));
    try {
      const res = await apiFetch('/api/search/event-preview', {
        method: 'POST',
        body: JSON.stringify({
          event: event.name, date: event.date,
          previousValue: event.previous, forecast: event.forecast,
        }),
      });
      if (!res.ok) {
        // FIX 2 (fix/ux-round4): show the server's honest human message;
        // never surface raw provider status codes or error slugs.
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || 'AI preview is temporarily unavailable. Try again shortly.');
      }
      const data = await res.json();
      setPreviews(prev => ({ ...prev, [event.id]: data }));
    } catch (e) {
      setErrors(prev => ({ ...prev, [event.id]: e.message }));
    } finally {
      setLoadingId(null);
    }
  }, []);

  // ── Market-cap batch fetch (item 2a) — feeds the >$10B filter + biggest-
  // first sort. /api/snapshot/tickers ships marketCap at ticker.fund.marketCap;
  // symbols are chunked to the 50/req cap. Degrades silently (empty map → the
  // filter falls back to MINE|ALL, see capChipOptions/note below).
  const earningsSymbols = useMemo(() => {
    const set = new Set();
    for (const it of earnings || []) {
      const t = String(it.ticker || it.symbol || '').toUpperCase().trim();
      if (t && /^[A-Z][A-Z0-9.\-]{0,11}$/.test(t)) set.add(t);
    }
    return [...set];
  }, [earnings]);

  useEffect(() => {
    if (!earningsSymbols.length) return;
    let alive = true;
    const chunks = [];
    // Cap total work at 150 symbols (3 requests) — plenty for a week's board.
    const syms = earningsSymbols.slice(0, 150);
    for (let i = 0; i < syms.length; i += SNAPSHOT_BATCH_MAX) chunks.push(syms.slice(i, i + SNAPSHOT_BATCH_MAX));
    (async () => {
      const map = {};
      const nameMap = {};
      await Promise.all(chunks.map(async (chunk) => {
        try {
          const res = await apiFetch(`/api/snapshot/tickers?symbols=${encodeURIComponent(chunk.join(','))}`);
          if (!res.ok) return;
          const json = await res.json();
          if (!json?.results) return;
          for (const [sym, entry] of Object.entries(json.results)) {
            const mc = entry?.ticker?.fund?.marketCap;
            if (mc != null && Number.isFinite(mc)) map[sym] = mc;
            // Earnings feeds ship tickers with no company name; the snapshot
            // does. Resolve it here so the row can show "AAPL  Apple Inc."
            // (movers-box layout) instead of a bare symbol.
            const nm = entry?.ticker?.name;
            if (nm) nameMap[sym] = nm;
          }
        } catch { /* cap/name columns degrade to blank */ }
      }));
      if (alive && Object.keys(map).length) setCaps(prev => ({ ...prev, ...map }));
      if (alive && Object.keys(nameMap).length) setNames(prev => ({ ...prev, ...nameMap }));
    })();
    return () => { alive = false; };
  }, [earningsSymbols]);

  const capOf = useCallback((item) => {
    const t = String(item.ticker || item.symbol || '').toUpperCase();
    return caps[t] ?? caps[t.replace(/\.SA$/, '')] ?? null;
  }, [caps]);

  const nameOf = useCallback((item) => {
    const t = String(item.ticker || item.symbol || '').toUpperCase();
    return names[t] ?? names[t.replace(/\.SA$/, '')] ?? null;
  }, [names]);

  // ── AI earnings preview (item 2b) — 24h server cache, Haiku fallback ──
  const handleRequestEarningsPreview = useCallback(async (item) => {
    const sym = String(item.ticker || item.symbol || '').toUpperCase();
    if (!sym) return;
    setLoadingId(sym);
    setErrors(prev => ({ ...prev, [sym]: null }));
    try {
      const res = await apiFetch('/api/search/earnings-preview', {
        method: 'POST',
        body: JSON.stringify({
          symbol: sym,
          name: item.name || item.companyName || null,
          date: item.date || item.reportDate || null,
          timing: item.timing || item.when || null,
          epsEstimate: item.epsEstimate ?? item.consensusEps ?? null,
          revEstimate: item.revenueEstimate ?? null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || 'Preview unavailable — try again shortly.');
      }
      const data = await res.json();
      setPreviews(prev => ({ ...prev, [sym]: data }));
    } catch (e) {
      setErrors(prev => ({ ...prev, [sym]: e.message }));
    } finally {
      setLoadingId(null);
    }
  }, []);

  // Toggle a row open and lazily request its preview (once) on first open.
  const handleToggleEarnings = useCallback((item) => {
    const sym = String(item.ticker || item.symbol || '').toUpperCase();
    setExpandedId(prev => {
      const next = prev === sym ? null : sym;
      if (next && !previews[sym] && loadingId !== sym) handleRequestEarningsPreview(item);
      return next;
    });
  }, [previews, loadingId, handleRequestEarningsPreview]);

  // Use dynamic or fall back to static
  const displayEvents = macroEvents || STATIC_EVENTS;
  const earningsAll = earnings || [];
  const isMine = useCallback((item) => {
    const t = String(item.ticker || item.symbol || '').toUpperCase();
    return !!t && (watchSet.has(t) || watchSet.has(t.replace(/\.SA$/, '')));
  }, [watchSet]);

  const hasCapData = useMemo(() => Object.keys(caps).length > 0, [caps]);

  // Biggest-market-cap-first within a day (item 2a); unknown caps sort last.
  const byCapThenDate = useCallback((a, b) => {
    const ca = capOf(a) ?? -1, cb = capOf(b) ?? -1;
    if (cb !== ca) return cb - ca;
    const da = parseDay(a.date || a.reportDate)?.getTime() ?? Infinity;
    const db = parseDay(b.date || b.reportDate)?.getTime() ?? Infinity;
    return da - db;
  }, [capOf]);

  // MINE = watchlist only; 10B = material reporters (>$10B) once caps load
  // (falls back to ALL while caps are still fetching / unavailable); ALL = all.
  const earningsList = useMemo(() => {
    if (capFilter === 'MINE') return earningsAll.filter(isMine);
    if (capFilter === '10B' && hasCapData) {
      return earningsAll.filter(it => { const c = capOf(it); return c != null && c >= MATERIAL_CAP; });
    }
    return earningsAll;
  }, [earningsAll, capFilter, isMine, hasCapData, capOf]);

  // MY NAMES stays pinned on top (watchlist names, even sub-$10B, so the user
  // never loses their own names to the material filter). In MINE mode the
  // whole board IS my names. Market list renders below, day-grouped.
  const mineEarnings = useMemo(() => {
    if (capFilter === 'MINE') return earningsList.slice().sort(byCapThenDate);
    return earningsAll.filter(isMine).sort(byCapThenDate);
  }, [capFilter, earningsList, earningsAll, isMine, byCapThenDate]);
  const marketEarnings = useMemo(
    () => (capFilter === 'MINE' ? [] : earningsList.filter(i => !isMine(i)).sort(byCapThenDate)),
    [capFilter, earningsList, isMine, byCapThenDate],
  );

  return (
    <div className="cp-panel">
      {/* H2 W1.2 — shared home-panel chrome + canonical tab row */}
      <PanelChrome
        title="CALENDAR"
        subtitle={tab === 'EARNINGS'
          ? `${earningsResp?.source && earningsResp.source !== 'unavailable' ? earningsResp.source.toUpperCase() + ' · ' : ''}UPCOMING PRINTS`
          : 'FOMC · CPI · NFP · COPOM'}
        actions={tab === 'EARNINGS' ? (
          <ViewChips
            options={[
              { key: 'MINE', label: 'MY NAMES', title: 'Only earnings for your watchlist names' },
              { key: '10B',  label: '>$10B',    title: 'Only material reporters (market cap > $10B)' },
              { key: 'ALL',  label: 'ALL',      title: 'All scheduled reporters' },
            ]}
            value={capFilter}
            onChange={setCapFilter}
            ariaLabel="Earnings size filter"
          />
        ) : null}
      />
      <PanelTabRow
        value={tab}
        onChange={setTab}
        equal
        items={[
          { id: 'EARNINGS', label: 'EARNINGS', count: earningsList.length || null },
          { id: 'MACRO',    label: 'MACRO',    count: displayEvents.length || null },
        ]}
      />

      <div className="cp-body">
        {tab === 'MACRO' && (
          <>
            {macroLoading && !macroEvents && (
              <div style={{ padding: 12, fontSize: 10, color: 'var(--text-muted)' }}>Loading events...</div>
            )}
            {/* #UX-3 — honest provider state: the curated schedule below is
                static, so say why the live feed is off (missing env var). */}
            {!macroLoading && !macroEvents && getProviderStatus(macroResp) === 'unavailable' && (
              <div className="cp-provider-note">
                {macroResp?.message || `Live macro feed offline — set ${macroResp?.missingEnv || 'FINNHUB_API_KEY'}.`} Showing curated schedule.
              </div>
            )}
            {groupByDay(displayEvents, e => e.date).map(group => (
              <div key={group.key}>
                <div className="cp-day-div">{group.label}</div>
                {group.items.map(evt => (
                  <EventRow
                    key={evt.id}
                    event={evt}
                    expanded={expandedId === evt.id}
                    onToggle={() => handleToggle(evt.id)}
                    preview={previews[evt.id]}
                    previewLoading={loadingId === evt.id}
                    previewError={errors[evt.id]}
                    onRequestPreview={() => handleRequestPreview(evt)}
                  />
                ))}
              </div>
            ))}
          </>
        )}

        {tab === 'EARNINGS' && (
          <>
            {earningsLoading && (
              <div style={{ padding: 12, fontSize: 10, color: 'var(--text-muted)' }}>Loading earnings...</div>
            )}
            {/* Calendar-defect fix: the server now tags empty envelopes
                with empty:'no-data' (a provider answered; week is quiet)
                vs empty:'no-provider'/source:'unavailable' (every feed is
                unconfigured or down) — render the honest reason. */}
            {!earningsLoading && earningsList.length === 0 && (
              <div className="cp-provider-note" style={{ padding: 12, fontSize: 10, color: 'var(--text-muted)' }}>
                {capFilter === 'MINE' && earningsAll.length > 0
                  ? 'No upcoming earnings for your watchlist tickers.'
                  : capFilter === '10B' && hasCapData && earningsAll.length > 0
                    ? 'No reporters above $10B in this window — switch to ALL.'
                  : getProviderStatus(earningsResp) === 'unavailable' || earningsResp?.empty === 'no-provider'
                    ? (earningsResp?.message || `Earnings feed offline — set ${earningsResp?.missingEnv || 'FINNHUB_API_KEY'} on the server.`)
                    : earningsResp?.empty === 'no-data'
                      ? (earningsResp?.message || 'Provider is live — no earnings scheduled in this window.')
                      : 'No earnings this week for your filters.'}
              </div>
            )}
            {/* Fallback provenance (e.g. "Finnhub degraded — Yahoo fallback") */}
            {!earningsLoading && earningsList.length > 0 && earningsResp?.note && (
              <div className="cp-provider-note">{earningsResp.note}</div>
            )}
            {/* MY NAMES — watchlist tickers pinned on top, accent edge. */}
            {mineEarnings.length > 0 && (
              <div>
                <div className="cp-day-div cp-day-div--mine">MY NAMES · {mineEarnings.length}</div>
                {mineEarnings.map((item, i) => {
                  const sym = String(item.ticker || item.symbol || '').toUpperCase();
                  return (
                    <EarningsRow
                      key={`mine-${item.ticker || item.symbol || i}`}
                      item={item} mine cap={capOf(item)} resolvedName={nameOf(item)}
                      expanded={expandedId === sym}
                      onToggle={() => handleToggleEarnings(item)}
                      preview={previews[sym]}
                      previewLoading={loadingId === sym}
                      previewError={errors[sym]}
                    />
                  );
                })}
              </div>
            )}
            {/* Market-wide list, grouped by day with thin dividers. */}
            {groupByDay(marketEarnings, it => it.date || it.reportDate).map(group => (
              <div key={group.key}>
                <div className="cp-day-div">{group.label}</div>
                {group.items.map((item, i) => {
                  const sym = String(item.ticker || item.symbol || '').toUpperCase();
                  return (
                    <EarningsRow
                      key={item.ticker || item.symbol || i}
                      item={item} cap={capOf(item)} resolvedName={nameOf(item)}
                      expanded={expandedId === sym}
                      onToggle={() => handleToggleEarnings(item)}
                      preview={previews[sym]}
                      previewLoading={loadingId === sym}
                      previewError={errors[sym]}
                    />
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="cp-footer">
        {tab === 'MACRO'
          ? `${displayEvents.length} events${
              macroEvents
                ? ' (live)'
                : getProviderStatus(macroResp) === 'unavailable'
                  ? ' (curated · provider offline)'
                  : ' (curated)'
            }. Click for AI preview.`
          : `${earningsList.length}${capFilter !== 'ALL' ? ` of ${earningsAll.length}` : ''} upcoming reports${capFilter === 'MINE' ? ' (my names)' : capFilter === '10B' ? (hasCapData ? ' (>$10B)' : ' (all — cap data loading)') : ''}. Click a row for an AI preview.`
        }
      </div>
    </div>
  );
}

export { CalendarPanel };
export default memo(CalendarPanel);
