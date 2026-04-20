/**
 * SentimentStrip.jsx — Full-width market sentiment strip (Phase 8.2).
 *
 * Mounts ABOVE the home-grid as a narrow (~36px) band that gives the
 * CIO an instant read on market mood the moment the terminal loads.
 *
 * Shows (left → right):
 *   • Equity Fear & Greed  (gauge + value + label)
 *   • Crypto Fear & Greed  (gauge + value)
 *   • VIX                  (value, colored by regime)
 *   • SPY %                (live, flash-on-change)
 *   • DXY % (dollar regime)
 *   • 10Y yield & 1d change
 *   • Connection health pill (right edge)
 *
 * Data:
 *   /api/fear-greed             — composite equity + crypto (2 min)
 *   /api/snapshot/stocks        — live tickers
 *
 * CIO-note: deliberately information-dense — every element is a live
 * signal, nothing decorative.
 */

import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';
import { useFeedStatus } from '../context/FeedStatusContext';
import { LiveCell, fmtPct } from './panels/_shared';
import './SentimentStrip.css';

const REFRESH_MS = 120_000;

function moodColor(v) {
  if (v == null) return 'var(--text-faint)';
  if (v <= 20) return 'var(--sent-bear, #e05c8a)';
  if (v <= 40) return 'var(--sent-warn, #e8a020)';
  if (v <= 60) return 'var(--sent-neutral, #8b93a7)';
  if (v <= 80) return 'var(--sent-bull, #3dd68c)';
  return 'var(--sent-bull, #3dd68c)';
}

function vixColor(v) {
  if (v == null) return 'var(--text-faint)';
  if (v < 15) return 'var(--sent-bull, #3dd68c)';
  if (v < 20) return 'var(--sent-neutral, #8b93a7)';
  if (v < 25) return 'var(--sent-warn, #e8a020)';
  return 'var(--sent-bear, #e05c8a)';
}

function MoodGauge({ value, label }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const c = moodColor(v);
  return (
    <div className="ss-gauge" title={label ? `${label} (${v})` : ''}>
      <div className="ss-gauge-bar">
        <div className="ss-gauge-bar-bg" />
        {v != null && (
          <>
            <span className="ss-gauge-tick" style={{ left: '25%' }} />
            <span className="ss-gauge-tick" style={{ left: '50%' }} />
            <span className="ss-gauge-tick" style={{ left: '75%' }} />
            <span className="ss-gauge-pin" style={{ left: `${v}%`, background: c }} />
          </>
        )}
      </div>
      <LiveCell value={v} className="ss-gauge-val" direction="flat">
        <span style={{ color: c }}>{v != null ? v : '—'}</span>
      </LiveCell>
    </div>
  );
}

function Metric({ label, value, color, flashKey }) {
  return (
    <div className="ss-metric">
      <span className="ss-metric-label">{label}</span>
      <LiveCell value={flashKey ?? value} className="ss-metric-val">
        <span style={{ color: color || 'var(--text-primary)' }}>
          {value != null ? value : '—'}
        </span>
      </LiveCell>
    </div>
  );
}

export default function SentimentStrip() {
  const [fg, setFg] = useState(null);
  const [snap, setSnap] = useState({});
  const [error, setError] = useState(false);
  const timer = useRef(null);
  const { getOverallStatus, getBadge } = useFeedStatus();
  const overall = getOverallStatus();
  const overallBadge = getBadge('stocks');

  async function load() {
    try {
      const [fgRes, snapRes] = await Promise.all([
        apiFetch('/api/fear-greed').then(r => r.ok ? r.json() : null).catch(() => null),
        apiFetch('/api/snapshot/stocks?tickers=SPY,QQQ,VIX,DXY,TNX').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      if (fgRes) setFg(fgRes);

      // Normalize snap into ticker-keyed map
      if (snapRes) {
        const map = {};
        const tickers = snapRes.tickers || snapRes.results || snapRes.data || [];
        const arr = Array.isArray(tickers) ? tickers : Object.values(tickers);
        arr.forEach(t => {
          const sym = t.ticker || t.symbol || t.T;
          if (!sym) return;
          const price = t.lastTrade?.p ?? t.price ?? t.last ?? t.c;
          const pct = t.todaysChangePerc ?? t.changePercent ?? t.percent_change ?? t.cp;
          map[sym] = { price, pct };
        });
        setSnap(map);
      }

      setError(false);
    } catch (e) {
      console.warn('[SentimentStrip] load', e.message);
      setError(true);
    }
  }

  useEffect(() => {
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, []);

  const equity = fg?.equity;
  const crypto = fg?.crypto?.current;
  const spy = snap.SPY;
  const vix = snap.VIX;
  const dxy = snap.DXY;
  const tnx = snap.TNX;

  return (
    <div className="ss-strip" role="region" aria-label="Market sentiment">
      <div className="ss-group">
        <span className="ss-group-label">MOOD</span>
        <MoodGauge value={equity?.value} label={equity?.label || 'Equity F&G'} />
        <span className="ss-mood-label">{equity?.label || '—'}</span>
      </div>

      <span className="ss-divider" />

      <div className="ss-group">
        <span className="ss-group-label">CRYPTO</span>
        <MoodGauge value={crypto?.value} label={crypto?.label || 'Crypto F&G'} />
      </div>

      <span className="ss-divider" />

      <Metric
        label="VIX"
        value={vix?.price != null ? vix.price.toFixed(2) : null}
        color={vixColor(vix?.price)}
        flashKey={vix?.price}
      />
      <Metric
        label="SPY"
        value={spy?.pct != null ? fmtPct(spy.pct, { digits: 2, sign: true, fromPct: true }) : null}
        color={spy?.pct > 0 ? 'var(--color-up, #22c55e)' : spy?.pct < 0 ? 'var(--color-down, #ef4444)' : undefined}
        flashKey={spy?.pct}
      />
      <Metric
        label="DXY"
        value={dxy?.pct != null ? fmtPct(dxy.pct, { digits: 2, sign: true, fromPct: true }) : null}
        color={dxy?.pct > 0 ? 'var(--color-up, #22c55e)' : dxy?.pct < 0 ? 'var(--color-down, #ef4444)' : undefined}
        flashKey={dxy?.pct}
      />
      <Metric
        label="10Y"
        value={tnx?.price != null ? `${tnx.price.toFixed(2)}%` : null}
        color={tnx?.pct > 0 ? 'var(--sent-warn, #e8a020)' : undefined}
        flashKey={tnx?.price}
      />

      <span className="ss-flex" />

      {/* Feed health pill */}
      <div
        className="ss-health"
        style={{ color: overallBadge.color, background: overallBadge.bg }}
        title={`Feeds: ${overall}`}
      >
        <span className="ss-health-dot" style={{ background: overallBadge.color }} />
        {overallBadge.text}
      </div>
    </div>
  );
}
