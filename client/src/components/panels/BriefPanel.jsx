/**
 * BriefPanel.jsx — Phase S wave 2: the personalized Daily Brief.
 *
 * Approved mockup: particle-phase-s-design-review.html §1 (BRIEF panel).
 *   · Opens with ✦ THE ONE THING — one AI-composed judgment connecting
 *     the tape to YOUR book (purple layer, same tone as the news
 *     briefing it replaces).
 *   · Bucket sections mirror the auto-sectorized watchlist:
 *     "EQUITIES · 3 of 12 names active" — only names with a real
 *     trigger appear; the count tells you the rest need nothing today.
 *   · Reason chips are the grammar: NEWS (purple) / FLOW (green) /
 *     EARN Nd (accent) / MACRO (blue) / VAULT (gold). Color = source,
 *     never sentiment.
 *   · Macro rows carry prediction-market odds chips when a market
 *     matches the event (POLY 34%).
 *   · VAULT CHECK — the user's stored research checked against the
 *     tape, with an honest verdict (CONFIRMS / CONTRADICTS / AGING).
 *   · EMAIL chip toggles the 07:30 BRT email opt-in
 *     (POST /api/brief/email-optin). ↻ re-fetches with force=1.
 *
 * Data: GET /api/brief (server-cached 30 min per user).
 * Loading = shimmer rows; error / empty = honest muted line.
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { apiFetch } from '../../utils/api';
import PanelChrome from '../common/PanelChrome';
import './BriefPanel.css';

const REFRESH_MS = 30 * 60_000; // matches the server-side per-user cache

function dateLabel(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  try {
    const day = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', weekday: 'short', month: 'short', day: '2-digit',
    }).format(d).toUpperCase().replace(/,/g, '');
    const hm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    }).format(d);
    return `${day} · ${hm} BRT`;
  } catch {
    return '';
  }
}

const REASON_CLASS = {
  NEWS: 'bp-rsn--news', FLOW: 'bp-rsn--flow', EARN: 'bp-rsn--earn',
  MACRO: 'bp-rsn--macro', VAULT: 'bp-rsn--vault',
};

const ReasonChip = memo(function ReasonChip({ reason, meta }) {
  return (
    <span className={`bp-rsn ${REASON_CLASS[reason] || 'bp-rsn--macro'}`}>
      {meta || reason}
    </span>
  );
});

const BucketSection = memo(function BucketSection({ bucket, counts, onTickerClick }) {
  const count = (counts || []).find(c => c.label === bucket.name);
  return (
    <div className="bp-bucket">
      <div className="bp-sechead">
        {bucket.name}
        {count ? <b> · {count.active} of {count.total} names active</b> : null}
      </div>
      {bucket.items.map(it => (
        <div className="bp-item" key={it.symbol}>
          <span
            className="bp-sym"
            role="button"
            tabIndex={0}
            onClick={() => onTickerClick && onTickerClick(it.symbol)}
            onKeyDown={e => { if (e.key === 'Enter' && onTickerClick) onTickerClick(it.symbol); }}
            title={`Chart ${it.symbol}`}
          >
            {it.symbol.replace(/\.SA$/, '')}
          </span>
          <span className="bp-why">{it.line}</span>
          <ReasonChip reason={it.reason} meta={it.meta} />
        </div>
      ))}
    </div>
  );
});

function Shimmer() {
  return (
    <div className="bp-shimmer" aria-label="Loading brief">
      <div className="bp-shimmer-block" style={{ height: 44 }} />
      {[72, 88, 64, 80, 58].map((w, i) => (
        <div className="bp-shimmer-row" key={i}>
          <span className="bp-shimmer-cell" style={{ width: 52 }} />
          <span className="bp-shimmer-cell" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

function BriefPanel({ onTickerClick }) {
  const [brief, setBrief]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState(null);
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async ({ force = false } = {}) => {
    if (force) setRefreshing(true);
    try {
      setError(null);
      const res = await apiFetch(`/api/brief${force ? '?force=1' : ''}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`);
      if (!mounted.current) return;
      setBrief(json.data || null);
      setEmailOptIn(json.emailOptIn === true);
    } catch (e) {
      if (mounted.current) setError(e.message || 'Brief unavailable');
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(() => load(), REFRESH_MS);
    return () => clearInterval(iv);
  }, [load]);

  const toggleEmail = useCallback(async () => {
    if (emailBusy) return;
    const next = !emailOptIn;
    setEmailBusy(true);
    setEmailOptIn(next); // optimistic
    try {
      const res = await apiFetch('/api/brief/email-optin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      if (mounted.current) setEmailOptIn(!next); // revert
    } finally {
      if (mounted.current) setEmailBusy(false);
    }
  }, [emailOptIn, emailBusy]);

  const buckets = brief?.buckets || [];
  const macro = brief?.macro || [];
  const vaultCheck = brief?.vaultCheck || [];
  const hasItems = buckets.length > 0 || macro.length > 0 || vaultCheck.length > 0;

  return (
    <div className="bp-container">
      <PanelChrome
        title="BRIEF"
        subtitle={brief?.generatedAt ? dateLabel(brief.generatedAt) : null}
        actions={(
          <>
            <span className="bp-chip bp-chip--on" title="Personalized to your watchlist">✦ FOR YOU</span>
            <button
              type="button"
              className={`bp-chip bp-chip--btn ${emailOptIn ? 'bp-chip--on' : ''}`}
              onClick={toggleEmail}
              disabled={emailBusy}
              title={emailOptIn
                ? 'Daily Brief email is ON (07:30 BRT) — click to turn off'
                : 'Get this brief by email every weekday at 07:30 BRT'}
            >
              {emailOptIn ? 'EMAIL ✓' : 'EMAIL'}
            </button>
            <button
              type="button"
              className="bp-chip bp-chip--btn"
              onClick={() => load({ force: true })}
              disabled={refreshing}
              title="Rebuild the brief from the latest tape"
            >
              {refreshing ? '…' : '↻'}
            </button>
          </>
        )}
      />

      <div className="bp-body">
        {loading ? (
          <Shimmer />
        ) : error ? (
          <div className="bp-empty">Brief unavailable — {error}</div>
        ) : !brief ? (
          <div className="bp-empty">No brief yet — try refresh.</div>
        ) : (
          <>
            <div className="bp-onething">
              <div className="bp-onething-label">✦ THE ONE THING</div>
              <div className="bp-onething-text">{brief.oneThing}</div>
            </div>

            {buckets.map(b => (
              <BucketSection
                key={b.name}
                bucket={b}
                counts={brief.counts}
                onTickerClick={onTickerClick}
              />
            ))}

            {macro.length > 0 && (
              <div className="bp-bucket">
                <div className="bp-sechead">MACRO</div>
                {macro.map((m, i) => (
                  <div className="bp-item" key={`${m.label}-${i}`}>
                    <span className="bp-sym bp-sym--static">{m.label}</span>
                    <span className="bp-why">{m.line}</span>
                    {m.odds ? <span className="bp-odds">{m.odds}</span> : null}
                  </div>
                ))}
              </div>
            )}

            {vaultCheck.length > 0 && (
              <div className="bp-bucket">
                <div className="bp-sechead">
                  VAULT CHECK
                  <b> · {vaultCheck.length} doc{vaultCheck.length > 1 ? 's' : ''} touched by the tape</b>
                </div>
                {vaultCheck.map((v, i) => (
                  <div className="bp-item" key={`${v.docName}-${i}`}>
                    <span className="bp-sym bp-sym--vault" title={v.docName}>
                      ◆ {v.docName.length > 12 ? `${v.docName.slice(0, 10)}…` : v.docName}
                    </span>
                    <span className="bp-why">{v.line}</span>
                    <ReasonChip reason="VAULT" meta={v.verdict} />
                  </div>
                ))}
              </div>
            )}

            {!hasItems && (
              <div className="bp-empty">{/* honest quiet day — the one thing above says why */}
                Nothing on your book needs attention right now.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(BriefPanel);
