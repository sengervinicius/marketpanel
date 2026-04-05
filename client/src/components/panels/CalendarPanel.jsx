/**
 * CalendarPanel.jsx — S4.11 Enhanced Economic & Earnings Calendar
 * Two-tab panel: ECONOMIC (macro events from Eulerpool + static fallback)
 *                EARNINGS (upcoming earnings from Eulerpool)
 * AI-powered event previews via /api/search/event-preview.
 */
import { useState, useCallback, useEffect, memo } from 'react';
import { apiFetch } from '../../utils/api';
import './CalendarPanel.css';

// Timezone detection
const USER_TZ_SHORT = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
})();

// Static fallback economic events (used when Eulerpool API returns empty)
const STATIC_EVENTS = [
  { id: 'fomc', name: 'FOMC Rate Decision', date: 'May 7, 2026', time: '14:00 ET', importance: 'high', previous: '4.25-4.50%', forecast: '4.25-4.50%' },
  { id: 'cpi', name: 'US CPI (Apr)', date: 'May 13, 2026', time: '08:30 ET', importance: 'high', previous: '2.4% YoY', forecast: '2.3% YoY' },
  { id: 'nfp', name: 'US Non-Farm Payrolls (Apr)', date: 'May 2, 2026', time: '08:30 ET', importance: 'high', previous: '+228K', forecast: '+200K' },
  { id: 'pce', name: 'US PCE Price Index (Mar)', date: 'Apr 30, 2026', time: '08:30 ET', importance: 'high', previous: '2.5% YoY', forecast: '2.4% YoY' },
  { id: 'gdp', name: 'US GDP Q1 (Advance)', date: 'Apr 30, 2026', time: '08:30 ET', importance: 'high', previous: '2.4%', forecast: '2.0%' },
  { id: 'retail', name: 'US Retail Sales (Apr)', date: 'May 15, 2026', time: '08:30 ET', importance: 'medium', previous: '+1.4%', forecast: '+0.8%' },
  { id: 'ecb', name: 'ECB Rate Decision', date: 'Apr 17, 2026', time: '08:15 ET', importance: 'high', previous: '2.65%', forecast: '2.40%' },
  { id: 'copom', name: 'COPOM (Selic) Decision', date: 'May 7, 2026', time: '18:30 BRT', importance: 'high', previous: '14.25%', forecast: '14.75%' },
  { id: 'ism', name: 'ISM Manufacturing PMI (Apr)', date: 'May 1, 2026', time: '10:00 ET', importance: 'medium', previous: '49.0', forecast: '49.5' },
  { id: 'jolts', name: 'JOLTS Job Openings (Mar)', date: 'May 6, 2026', time: '10:00 ET', importance: 'medium', previous: '7.57M', forecast: '7.5M' },
];

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
  const [tab, setTab] = useState('ECONOMIC');
  const [expandedId, setExpandedId] = useState(null);
  const [previews, setPreviews] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [errors, setErrors] = useState({});

  // Dynamic data from Eulerpool
  const [macroEvents, setMacroEvents] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [earningsLoading, setEarningsLoading] = useState(false);

  // Fetch dynamic macro calendar
  useEffect(() => {
    let cancelled = false;
    setMacroLoading(true);
    apiFetch('/api/market/macro-calendar')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled && d?.data?.length > 0) {
          setMacroEvents(d.data.map((evt, i) => ({
            id: evt.id || `macro-${i}`,
            name: evt.name || evt.event || evt.title || '—',
            date: evt.date || evt.datetime || '',
            time: evt.time || '',
            importance: evt.importance || evt.impact || 'medium',
            previous: evt.previous ?? evt.actual ?? null,
            forecast: evt.forecast ?? evt.consensus ?? null,
          })));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMacroLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Fetch earnings calendar
  useEffect(() => {
    let cancelled = false;
    setEarningsLoading(true);
    apiFetch('/api/market/earnings-calendar')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled && d?.data) {
          setEarnings(Array.isArray(d.data) ? d.data : []);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setEarningsLoading(false); });
    return () => { cancelled = true; };
  }, []);

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
  const earningsList = earnings || [];

  return (
    <div className="cp-panel">
      <div className="cp-header">
        <span className="cp-title">CALENDAR</span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {['ECONOMIC', 'EARNINGS'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
                padding: '2px 8px', border: '1px solid',
                borderRadius: 3, cursor: 'pointer',
                background: tab === t ? 'rgba(255,102,0,0.15)' : 'transparent',
                color: tab === t ? '#ff6600' : '#888',
                borderColor: tab === t ? 'rgba(255,102,0,0.3)' : '#333',
              }}
            >{t}</button>
          ))}
        </div>
      </div>

      <div className="cp-body">
        {tab === 'ECONOMIC' && (
          <>
            {macroLoading && !macroEvents && (
              <div style={{ padding: 12, fontSize: 10, color: '#888' }}>Loading events...</div>
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
              <div style={{ padding: 12, fontSize: 10, color: '#888' }}>Loading earnings...</div>
            )}
            {!earningsLoading && earningsList.length === 0 && (
              <div style={{ padding: 12, fontSize: 10, color: '#888' }}>
                No upcoming earnings data available. Earnings calendar requires Eulerpool API.
              </div>
            )}
            {earningsList.map((item, i) => (
              <EarningsRow key={item.ticker || item.symbol || i} item={item} />
            ))}
          </>
        )}
      </div>

      <div className="cp-footer">
        {tab === 'ECONOMIC'
          ? `${displayEvents.length} events${macroEvents ? ' (live)' : ' (curated)'}. Click for AI preview.`
          : `${earningsList.length} upcoming earnings reports.`
        }
      </div>
    </div>
  );
}

export { CalendarPanel };
export default memo(CalendarPanel);
