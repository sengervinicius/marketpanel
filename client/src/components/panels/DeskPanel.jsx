/**
 * DeskPanel.jsx — #292 F3: "GOOD MORNING, VINI".
 *
 * The box that uses everything the AI has wired to say what matters today.
 * Replaces the dense Daily Brief list at the same registry key ('brief'),
 * so saved layouts get it without a reset.
 *
 * Anatomy (fits the ~190px bottom row):
 *   1. Greeting line — "Good morning, Vini" · local date · the next
 *      session event (B3 opens in 43m / NYSE closes in 2h 10m).
 *   2. The One Thing — the brief engine's lede (AI, cached 30 min).
 *   3. Pay attention — up to three names from the brief's buckets, each
 *      with the LIVE price and move from PriceContext, the reason chip
 *      (NEWS / FLOW / EARN / MACRO) and the AI's one-liner.
 *   4. Today — earnings on your book and the day's macro prints, folded
 *      in from the calendar endpoints (the Calendar box is retired).
 *
 * Data: /api/brief · /api/market/earnings-calendar?symbols= ·
 *       /api/market/macro-calendar · PriceContext for live numbers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../utils/api';
import { swallow } from '../../utils/swallow';
import { useAuth } from '../../context/AuthContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { getSession } from '../../utils/marketSession';
import PanelChrome from '../common/PanelChrome';
import PanelState from '../common/PanelState';
import './DeskPanel.css';

const REFRESH_MS = 5 * 60_000;

function firstName(user) {
  const raw = (user?.displayName || user?.username || '').trim();
  if (!raw) return null;
  const n = raw.split(/[\s._-]+/)[0];
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

function timeOfDay(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

/** "B3 opens in 43m" / "NYSE closes in 2h 10m" — the next thing on the clock. */
function nextSessionEvent(now = new Date()) {
  const out = [];
  for (const [group, label, tz] of [['B3', 'B3', 'America/Sao_Paulo'], ['US', 'NYSE', 'America/New_York']]) {
    const s = getSession(group, now.getTime());
    if (!s.opensAt && !s.closesAt) continue;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(now);
    const g = (t) => (parts.find(p => p.type === t) || {}).value;
    const mins = (parseInt(g('hour'), 10) % 24) * 60 + parseInt(g('minute'), 10);
    const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[g('weekday')] ?? 0;
    if (dow === 0 || dow === 6) continue;
    if (s.state === 'OPEN') out.push({ in: s.closesAt - mins, text: `${label} closes in` });
    else if (mins < s.opensAt) out.push({ in: s.opensAt - mins, text: `${label} opens in` });
  }
  out.sort((a, b) => a.in - b.in);
  const e = out[0];
  if (!e) return null;
  const h = Math.floor(e.in / 60), m = e.in % 60;
  return `${e.text} ${h ? `${h}h ` : ''}${m}m`;
}

function AttentionRow({ item, onOpen }) {
  const q = useTickerPrice(item.symbol);
  const pct = q?.changePct;
  const tone = pct == null ? '' : pct > 0 ? ' desk-pct--up' : pct < 0 ? ' desk-pct--down' : '';
  return (
    <button type="button" className="desk-row" onClick={() => onOpen(item.symbol)} title={item.line}>
      <span className="desk-sym">{item.symbol}</span>
      <span className="desk-price">{q?.price != null ? q.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</span>
      <span className={`desk-pct${tone}`}>{pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}</span>
      <span className={`desk-reason desk-reason--${(item.reason || 'macro').toLowerCase()}`}>{item.meta || item.reason}</span>
      <span className="desk-line">{item.line}</span>
    </button>
  );
}

export default function DeskPanel() {
  const { user } = useAuth();
  const openDetail = useOpenDetail();
  const [brief, setBrief] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [today, setToday] = useState({ earnings: [], macro: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [, tick] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const id = setInterval(() => tick(t => t + 1), 60_000); return () => clearInterval(id); }, []);

  const load = async (force = false) => {
    try {
      const r = await apiFetch(`/api/brief${force ? '?force=1' : ''}`);
      if (!r.ok) throw new Error(r.status === 429 ? 'AI quota reached — try later' : `HTTP ${r.status}`);
      const j = await r.json();
      if (!mounted.current) return;
      setBrief(j.data || null);
      setGeneratedAt(j.generatedAt || null);
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e.message || 'failed');
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  useEffect(() => { load(); const id = setInterval(() => load(), REFRESH_MS); return () => clearInterval(id); }, []);

  // Today's events: earnings for names on the brief + macro prints dated today.
  const bookSymbols = useMemo(() => {
    const s = new Set();
    for (const b of brief?.buckets || []) for (const it of b.items || []) if (it.symbol) s.add(it.symbol);
    return [...s].slice(0, 40);
  }, [brief]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const todayISO = new Date().toISOString().slice(0, 10);
      const out = { earnings: [], macro: [] };
      try {
        const u = bookSymbols.length ? `/api/market/earnings-calendar?symbols=${encodeURIComponent(bookSymbols.join(','))}` : '/api/market/earnings-calendar';
        const r = await apiFetch(u);
        const j = r.ok ? await r.json() : null;
        const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j?.earnings) ? j.earnings : Array.isArray(j) ? j : [];
        out.earnings = rows.filter(e => String(e.date || e.reportDate || '').slice(0, 10) === todayISO).slice(0, 6)
          .map(e => ({ symbol: e.symbol || e.ticker, when: /amc|after/i.test(e.time || e.hour || '') ? 'AMC' : /bmo|before/i.test(e.time || e.hour || '') ? 'BMO' : '' }));
      } catch (e) { swallow(e, 'DeskPanel.earnings'); }
      try {
        const r = await apiFetch('/api/market/macro-calendar');
        const j = r.ok ? await r.json() : null;
        const rows = Array.isArray(j?.data) ? j.data : [];
        out.macro = rows.filter(e => String(e.date || e.datetime || '').slice(0, 10) === todayISO)
          .filter(e => /high|medium/i.test(String(e.importance || e.impact || 'medium')))
          .slice(0, 5)
          .map(e => ({ name: e.name || e.event || e.title, time: e.time || '' }));
      } catch (e) { swallow(e, 'DeskPanel.macro'); }
      if (!cancelled) setToday(out);
    })();
    return () => { cancelled = true; };
  }, [bookSymbols]);

  const attention = useMemo(() => {
    const items = [];
    for (const b of brief?.buckets || []) for (const it of b.items || []) items.push({ ...it, bucket: b.name });
    const rank = { NEWS: 0, FLOW: 1, EARN: 2, MACRO: 3 };
    items.sort((a, b) => (rank[a.reason] ?? 9) - (rank[b.reason] ?? 9));
    return items.slice(0, 3);
  }, [brief]);

  const name = firstName(user);
  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
  const clock = nextSessionEvent(now);

  return (
    <div className="desk-panel">
      <PanelChrome
        title={`GOOD ${timeOfDay(now).toUpperCase()}${name ? `, ${name.toUpperCase()}` : ''}`}
        subtitle={`${dateLabel}${clock ? ` · ${clock.toUpperCase()}` : ''}`}
        updatedAt={generatedAt}
        source="particle-ai"
        actions={<button type="button" className="panel-chrome-btn" onClick={() => { setLoading(true); load(true); }} title="Regenerate with the latest tape">REFRESH</button>}
      />
      {loading && !brief ? (
        <PanelState kind="loading" title="READING THE TAPE" compact />
      ) : error && !brief ? (
        <PanelState kind="error" title="BRIEF UNAVAILABLE" detail={error} onRetry={() => { setLoading(true); load(); }} compact />
      ) : (
        <div className="desk-body">
          {brief?.oneThing ? <div className="desk-lede">{brief.oneThing}</div> : null}
          {attention.length > 0 ? (
            <div className="desk-attention">
              <div className="desk-label">PAY ATTENTION</div>
              {attention.map((it) => <AttentionRow key={`${it.symbol}-${it.reason}`} item={it} onOpen={openDetail} />)}
            </div>
          ) : (
            <div className="desk-quiet">Quiet tape on your book — no live triggers right now.</div>
          )}
          {(today.earnings.length > 0 || today.macro.length > 0 || (brief?.macro || []).length > 0) && (
            <div className="desk-today">
              <span className="desk-label">TODAY</span>
              {today.macro.map((m, i) => <span key={`m${i}`} className="desk-chip desk-chip--macro">{m.time ? `${m.time} ` : ''}{m.name}</span>)}
              {today.earnings.map((e, i) => <span key={`e${i}`} className="desk-chip desk-chip--earn">{e.symbol} EARN{e.when ? ` ${e.when}` : ''}</span>)}
              {(brief?.macro || []).slice(0, 2).map((m, i) => <span key={`b${i}`} className="desk-chip" title={m.line}>{m.label}{m.odds ? ` · ${m.odds}` : ''}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
