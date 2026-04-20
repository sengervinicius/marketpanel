/**
 * CrossAssetStrip.jsx — Phase 8.5: Cross-asset correlation strip.
 *
 * Mounts below SentimentStrip as a second narrow band.
 * Shows 6 regime-defining pairs with 20-day Pearson correlation
 * (color-coded + magnitude bar) and 5-day side-by-side returns.
 *
 * Intent: answer "what's moving with what right now?" at a glance —
 * inversion of stock-bond correlation, dollar-gold decoupling,
 * BTC-as-risk-proxy validation, and the SPY↔VIX sanity check are
 * all CIO-level regime signals.
 *
 * Endpoint:
 *   /api/cross-asset-corr  — server-computed, 30-min cached
 *
 * Fails soft: if endpoint errors, the strip hides itself.
 */

import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';
import './CrossAssetStrip.css';

const REFRESH_MS = 30 * 60 * 1000; // 30 min — matches server cache

// Map |ρ| to color (strong positive = bull green, strong negative = bear red)
function corrColor(r) {
  if (r == null) return 'var(--text-faint)';
  if (r >=  0.6) return 'var(--sent-bull, #3dd68c)';
  if (r >=  0.3) return 'var(--sent-neutral, #8b93a7)';
  if (r >= -0.3) return 'var(--text-muted, #8b93a7)';
  if (r >= -0.6) return 'var(--sent-warn, #e8a020)';
  return 'var(--sent-bear, #e05c8a)';
}

function retColor(r) {
  if (r == null) return 'var(--text-faint)';
  if (r > 0) return 'var(--color-up, #22c55e)';
  if (r < 0) return 'var(--color-down, #ef4444)';
  return 'var(--text-muted)';
}

function fmtPct(r, digits = 2) {
  if (r == null || !Number.isFinite(r)) return '—';
  const v = r * 100;
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(digits)}%`;
}

function fmtCorr(r) {
  if (r == null || !Number.isFinite(r)) return '—';
  const s = r > 0 ? '+' : '';
  return `${s}${r.toFixed(2)}`;
}

function PairCell({ pair }) {
  const { labelA, labelB, corr, d5A, d5B } = pair;
  const c = corrColor(corr);
  const magPct = corr != null ? Math.abs(corr) * 100 : 0;
  return (
    <div className="ca-cell" title={`${labelA} vs ${labelB} — 20d correlation: ${fmtCorr(corr)}`}>
      <div className="ca-cell-label">
        <span>{labelA}</span>
        <span className="ca-cell-sep">↔</span>
        <span>{labelB}</span>
      </div>
      <div className="ca-cell-corr" style={{ color: c }}>{fmtCorr(corr)}</div>
      <div className="ca-cell-bar-track">
        <span
          className="ca-cell-bar-fill"
          style={{ width: `${magPct}%`, background: c, marginLeft: corr < 0 ? 'auto' : 0 }}
        />
      </div>
      <div className="ca-cell-returns">
        <span style={{ color: retColor(d5A) }}>{fmtPct(d5A, 1)}</span>
        <span style={{ color: retColor(d5B) }}>{fmtPct(d5B, 1)}</span>
      </div>
    </div>
  );
}

export default function CrossAssetStrip() {
  const [data, setData] = useState(null);
  const [err,  setErr]  = useState(false);
  const timer = useRef(null);

  async function load() {
    try {
      const r = await apiFetch('/api/cross-asset-corr');
      if (!r.ok) { setErr(true); return; }
      const j = await r.json();
      if (j && Array.isArray(j.pairs) && j.pairs.length) {
        setData(j);
        setErr(false);
      } else {
        setErr(true);
      }
    } catch (e) {
      console.warn('[CrossAssetStrip] load', e.message);
      setErr(true);
    }
  }

  useEffect(() => {
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, []);

  // Fail soft — hide strip if no data
  if (err || !data || !data.pairs?.length) return null;

  return (
    <div className="ca-strip" role="region" aria-label="Cross-asset correlations (20-day)">
      <span className="ca-group-label">20D ρ</span>
      {data.pairs.map(p => (
        <PairCell key={`${p.a}-${p.b}`} pair={p} />
      ))}
      <span className="ca-flex" />
      <span className="ca-legend" title="20-day rolling Pearson correlation of daily log-returns">
        <span className="ca-legend-swatch" style={{ background: 'var(--sent-bull, #3dd68c)' }} />
        <span>+0.6</span>
        <span className="ca-legend-swatch" style={{ background: 'var(--text-muted, #8b93a7)' }} />
        <span>0</span>
        <span className="ca-legend-swatch" style={{ background: 'var(--sent-bear, #e05c8a)' }} />
        <span>−0.6</span>
      </span>
    </div>
  );
}
