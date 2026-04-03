/**
 * CalendarPanel.jsx — Economic Calendar with AI Event Preview
 * Phase AI1: New panel showing upcoming economic events with AI impact analysis.
 * Uses static curated events + AI-powered event preview via /api/search/event-preview.
 */
import { useState, useCallback, memo } from 'react';
import { apiFetch } from '../../utils/api';
import './CalendarPanel.css';

// Timezone detection: get user's local timezone abbreviation
const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
const USER_TZ_SHORT = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
})();

// Static economic events calendar (curated, updated periodically by data team)
const UPCOMING_EVENTS = [
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
          <span className="cp-event-date">{event.date} · {event.time}{USER_TZ_SHORT ? ` (${USER_TZ_SHORT} local)` : ''}</span>
        </div>
        <div className="cp-event-data">
          <span className="cp-event-prev">Prev: {event.previous}</span>
          {event.forecast && <span className="cp-event-fcst">Exp: {event.forecast}</span>}
        </div>
        <span className="cp-event-chevron">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div className="cp-event-detail">
          {!preview && !previewLoading && !previewError && (
            <button className="btn cp-ai-preview-btn" onClick={(e) => { e.stopPropagation(); onRequestPreview(); }}>
              ◆ AI EVENT PREVIEW
            </button>
          )}
          {previewLoading && (
            <div className="cp-ai-loading">Analyzing event impact...</div>
          )}
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
              {preview.marketExpectation && (
                <p className="cp-ai-expectation">Consensus: {preview.marketExpectation}</p>
              )}
              {preview.affectedSectors?.length > 0 && (
                <div className="cp-ai-tags">
                  <span className="cp-ai-tag-label">Sectors:</span>
                  {preview.affectedSectors.map(s => (
                    <span key={s} className="cp-ai-tag">{s}</span>
                  ))}
                </div>
              )}
              {preview.affectedAssets?.length > 0 && (
                <div className="cp-ai-tags">
                  <span className="cp-ai-tag-label">Tickers:</span>
                  {preview.affectedAssets.map(t => (
                    <span key={t} className="cp-ai-tag cp-ai-tag--ticker">{t}</span>
                  ))}
                </div>
              )}
              {preview.tradingConsiderations?.length > 0 && (
                <div className="cp-ai-considerations">
                  {preview.tradingConsiderations.map((c, i) => (
                    <div key={i} className="cp-ai-consideration">→ {c}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CalendarPanel() {
  const [expandedId, setExpandedId] = useState(null);
  const [previews, setPreviews] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [errors, setErrors] = useState({});

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
          event: event.name,
          date: event.date,
          previousValue: event.previous,
          forecast: event.forecast,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to get preview');
      }
      const data = await res.json();
      setPreviews(prev => ({ ...prev, [event.id]: data }));
    } catch (e) {
      setErrors(prev => ({ ...prev, [event.id]: e.message }));
    } finally {
      setLoadingId(null);
    }
  }, []);

  return (
    <div className="cp-panel">
      <div className="cp-header">
        <span className="cp-title">ECONOMIC CALENDAR</span>
        <span className="cp-subtitle">{UPCOMING_EVENTS.length} EVENTS</span>
      </div>
      <div className="cp-body">
        {UPCOMING_EVENTS.map(evt => (
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
      <div className="cp-footer">
        Events are curated. Click any event for AI impact preview.
      </div>
    </div>
  );
}

export { CalendarPanel };
export default memo(CalendarPanel);
