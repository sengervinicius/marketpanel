/**
 * MoversPredictionsPanel.jsx — the MOVERS box, split into two halves:
 *   top  = live movers (reuses MoversPanel unchanged)
 *   bottom = market-relevant prediction odds (Polymarket + Kalshi)
 * Predictions come from /api/predictions/for-you, which is a finance/macro
 * feed that HARD-excludes sports/junk markets server-side.
 */
import { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import MoversPanel from './MoversPanel';
import PanelChrome from '../common/PanelChrome';
import './MoversPredictionsPanel.css';

const SAFE_HOSTS = new Set(['polymarket.com', 'www.polymarket.com', 'kalshi.com', 'www.kalshi.com']);
function safeUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try { const u = new URL(raw); if (u.protocol !== 'https:') return null; if (!SAFE_HOSTS.has(u.hostname.toLowerCase())) return null; return u.toString(); }
  catch { return null; }
}
function pctColor(p) { if (p == null) return 'var(--text-faint,#5c5c5c)'; return p >= 0.5 ? 'var(--color-up,#22c55e)' : 'var(--color-down,#ef4444)'; }

function PredRow({ m }) {
  const pct = m.probability != null ? Math.round(m.probability * 100) : null;
  const src = m.source === 'kalshi' ? 'KAL' : m.source === 'polymarket' ? 'POLY' : (m.source || '').toUpperCase().slice(0, 4);
  const q = m.title || m.question || '—';
  const link = safeUrl(m.url);
  return (
    <div
      className={`mpp-prow${link ? ' mpp-clickable' : ''}`}
      title={q + (link ? ` · double-click → ${m.source === 'kalshi' ? 'Kalshi' : 'Polymarket'}` : '')}
      onDoubleClick={() => { if (link) window.open(link, '_blank', 'noopener,noreferrer'); }}
    >
      <span className="mpp-q">{q}</span>
      <span className={`mpp-src mpp-src--${m.source}`}>{src}</span>
      <span className="mpp-pct" style={{ color: pctColor(m.probability) }}>{pct != null ? pct + '%' : '—'}</span>
    </div>
  );
}

function PredictionsMini() {
  const [markets, setMarkets] = useState([]);
  const [state, setState] = useState('loading');
  useEffect(() => {
    let alive = true;
    const load = () => apiFetch('/api/predictions/for-you?limit=10')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive) return;
        const list = Array.isArray(d) ? d : (d?.markets || d?.data || []);
        setMarkets(list.slice(0, 10)); setState(list.length ? 'ok' : 'empty');
      })
      .catch(() => { if (alive) setState('error'); });
    load();
    const id = setInterval(load, 120000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return (
    <div className="mpp-pred">
      <div className="mpp-subhead">
        <span className="mpp-subhead-label">PREDICTIONS</span>
        <span className="mpp-subhead-meta">
          <span className="mpp-subhead-src">POLYMARKET · KALSHI</span>
        </span>
      </div>
      <div className="mpp-pred-list">
        {state === 'loading' && <div className="mpp-pred-empty">…</div>}
        {state === 'error' && <div className="mpp-pred-empty">Predictions unavailable — try again shortly.</div>}
        {state === 'empty' && <div className="mpp-pred-empty">No market predictions right now.</div>}
        {state === 'ok' && markets.map((m, i) => <PredRow key={(m.source || '') + '-' + (m.id || i)} m={m} />)}
      </div>
    </div>
  );
}

export default function MoversPredictionsPanel({ onTickerClick }) {
  return (
    <div className="mpp">
      <PanelChrome title="MOVERS & PREDICTIONS" subtitle="LIVE MOVERS + PREDICTION ODDS" />
      <div className="mpp-movers"><MoversPanel embedded onTickerClick={onTickerClick} /></div>
      <PredictionsMini />
    </div>
  );
}
