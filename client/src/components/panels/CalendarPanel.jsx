/**
 * CalendarPanel.jsx — S4.11 Enhanced Economic & Earnings Calendar
 * Two-tab panel: MACRO    (Eulerpool → Finnhub economic → static fallback)
 *                EARNINGS (Eulerpool → Finnhub /calendar/earnings)
 * AI-powered event previews via /api/search/event-preview.
 */
import { useState, useCallback, useMemo, memo } from 'react';
import { apiFetch } from '../../utils/api';
import { useJsonQuery, STALE_TIMES } from '../../lib/queryHooks';
// #286 — surface "live | curated | provider offline" so the footer
// gives the CIO a one-glance read on why we're showing static data.
import { getProviderStatus } from '../../utils/providerStatus';
// H2 W1.2 — home-grade chrome: shared PanelChrome header + PanelTabRow
// tabs, watchlist filter for earnings, surprise coloring on macro rows.
import PanelChrome from '../common/PanelChrome';
import { PanelTabRow } from './_shared';
import { useWatchlist } from '../../context/WatchlistContext';
import './CalendarPanel.css';

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

function importanceBadge(imp) {
  if (imp === 'high') return { label: 'HIGH', cls: 'cp-imp--high' };
  if (imp === 'medium') return { label: 'MED', cls: 'cp-imp--medium' };
  return { label: 'LOW', cls: 'cp-imp--low' };
}

function EventRow({ event, expanded, onToggle, preview, previewLoading, previewError, onRequestPreview }) {
  const imp = importanceBadge(event.importance);
  return (
    <div className={`cp-event ${expanded ? 'cp-event--expanded' : ''}`}>
      <div className="cp-event-row" onClick={onToggle}>
        <span className={`cp-imp ${imp.cls}`}>{imp.label}</span>
        <div className="cp-event-info">
          <span className="cp-event-name">{event.name}</span>
          <span className="cp-event-date">{event.date}{event.time ? ` · ${event.time}` : ''}{USER_TZ_SHORT ? ` (${USER_TZ_SHORT})` : ''}</span>
        </div>
        <div className="cp-event-data">
          {event.previous && <span className="cp-event-prev">Prev: {event.previous}</span>}
          {event.forecast && <span className="cp-event-fcst">Exp: {event.forecast}</span>}
          {event.actual != null && (() => {
            // H2 W1.2 — surprise coloring: actual vs consensus where both
            // exist, tinted with the shared up/down tokens.
            const tone = surpriseTone(event.actual, event.forecast);
            return (
              <span className={`cp-event-actual${tone ? ` cp-event-actual--${tone}` : ''}`}>
                Act: {event.actual}
              </span>
            );
          })()}
        </div>
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

/* ── Earnings Row ─────────────────────────────────────────────────── */
function EarningsRow({ item }) {
  const dateStr = item.date || item.reportDate || '';
  const timing = item.timing || item.when || '';
  const epsEst = item.epsEstimate ?? item.consensusEps ?? null;
  const epsPrev = item.epsPrevious ?? item.lastEps ?? null;
  const revEst = item.revenueEstimate ?? item.consensusRevenue ?? null;

  const fmtNum = (n) => n == null ? '—' : typeof n === 'number' ? n.toFixed(2) : String(n);
  const fmtRev = (n) => {
    if (n == null) return '—';
    if (typeof n !== 'number') return String(n);
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
    return `$${n.toFixed(0)}`;
  };

  return (
    <div className="cp-event">
      <div className="cp-event-row" style={{ cursor: 'default' }}>
        <span className="cp-imp cp-imp--medium" style={{ width: 36 }}>
          {timing === 'BMO' || timing === 'bmo' ? 'BMO' : timing === 'AMC' || timing === 'amc' ? 'AMC' : 'TBD'}
        </span>
        <div className="cp-event-info">
          <span className="cp-event-name">{item.ticker || item.symbol || '—'}</span>
          <span className="cp-event-date">{item.name || item.companyName || ''} · {dateStr}</span>
        </div>
        <div className="cp-event-data">
          <span className="cp-event-prev">EPS Est: {fmtNum(epsEst)}</span>
          <span className="cp-event-fcst">Rev Est: {fmtRev(revEst)}</span>
          {epsPrev != null && <span className="cp-event-prev" style={{ fontSize: 7 }}>Prev EPS: {fmtNum(epsPrev)}</span>}
        </div>
      </div>
    </div>
  );
}

/* ── Main CalendarPanel ───────────────────────────────────────────── */
function CalendarPanel() {
  // H2 W1.2 — EARNINGS first (home-grade spec); MACRO replaces the old
  // ECONOMIC label. State ids keep the tab names.
  const [tab, setTab] = useState('EARNINGS');
  const [watchOnly, setWatchOnly] = useState(false);
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
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
      const data = await res.json();
      setPreviews(prev => ({ ...prev, [event.id]: data }));
    } catch (e) {
      setErrors(prev => ({ ...prev, [event.id]: e.message }));
    } finally {
      setLoadingId(null);
    }
  }, []);

  // Use dynamic or fall back to static
  const displayEvents = macroEvents || STATIC_EVENTS;
  const earningsAll = earnings || [];
  const earningsList = useMemo(() => {
    if (!watchOnly) return earningsAll;
    return earningsAll.filter(item => {
      const t = String(item.ticker || item.symbol || '').toUpperCase();
      return t && (watchSet.has(t) || watchSet.has(t.replace(/\.SA$/, '')));
    });
  }, [earningsAll, watchOnly, watchSet]);

  return (
    <div className="cp-panel">
      {/* H2 W1.2 — shared home-panel chrome + canonical tab row */}
      <PanelChrome
        title="CALENDAR"
        subtitle={tab === 'EARNINGS'
          ? `${earningsResp?.source && earningsResp.source !== 'unavailable' ? earningsResp.source.toUpperCase() + ' · ' : ''}UPCOMING PRINTS`
          : 'FOMC · CPI · NFP · COPOM'}
        actions={tab === 'EARNINGS' ? (
          <button
            type="button"
            className={`cal-wl-btn${watchOnly ? ' cal-wl-btn--active' : ''}`}
            title="Only show earnings for tickers on your watchlist"
            onClick={() => setWatchOnly(v => !v)}
          >WATCHLIST</button>
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
            {displayEvents.map(evt => (
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
                {watchOnly && earningsAll.length > 0
                  ? 'No upcoming earnings for your watchlist tickers.'
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
            {earningsList.map((item, i) => (
              <EarningsRow key={item.ticker || item.symbol || i} item={item} />
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
          : `${earningsList.length}${watchOnly ? ` of ${earningsAll.length}` : ''} upcoming earnings reports${watchOnly ? ' (watchlist)' : ''}.`
        }
      </div>
    </div>
  );
}

export { CalendarPanel };
export default memo(CalendarPanel);
