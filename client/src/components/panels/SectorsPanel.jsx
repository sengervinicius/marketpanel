/**
 * SectorsPanel.jsx — H2 Wave 1: sector performance grid.
 *
 * Compact matrix: rows = the 11 SPDR sector ETFs, cols = 1D/1W/1M/YTD.
 * Data: GET /api/market/sector-performance (routes/market/sectors.js,
 * server-cached 10 min). Cells are tinted by sign/magnitude with the
 * token up/down colors at graded opacity — pure CSS color-mix, no chart
 * lib. Click a sector row → chart the ETF.
 *
 * Registry-only panel (Cmd+K addable, NOT in the default layout).
 */

import { useState, useEffect, useCallback, memo } from 'react';
import { apiFetch } from '../../utils/api';
import PanelChrome from '../common/PanelChrome';
import { useTickerClicksFactory } from '../../hooks/useTickerClicks';
import './SectorsPanel.css';

const HORIZONS = ['1D', '1W', '1M', 'YTD'];
const REFRESH_MS = 10 * 60_000; // matches the server-side 10 min cache

// Per-horizon "full tint" scale, mixed into the OPAQUE panel base so cells
// are solid, always-visible tinted swatches (kept consistent with the
// MARKET MAP blockTint ramp — direction must read even on a calm tape).
const FULL_SCALE = { '1D': 1.5, '1W': 4, '1M': 8, 'YTD': 20 };
const MAX_TINT = 80; // % of the token color mixed in at full scale
const MIN_TINT = 22;

function cellTint(horizon, v) {
  if (v == null || !Number.isFinite(v) || v === 0) {
    return { background: 'var(--bg-elevated)' };
  }
  const token = v > 0 ? 'var(--price-up)' : 'var(--price-down)';
  const frac = Math.min(1, Math.abs(v) / (FULL_SCALE[horizon] || 5));
  const pctMix = Math.round(MIN_TINT + frac * (MAX_TINT - MIN_TINT));
  return { background: `color-mix(in srgb, ${token} ${pctMix}%, var(--bg-elevated))` };
}

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(Math.abs(v) >= 10 ? 1 : 2)}%`;
}

function SectorsPanel({ onTickerClick }) {
  const tickerClicks = useTickerClicksFactory(); // wave-nov item 5
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [updatedAt, setUpdated] = useState('');

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await apiFetch('/api/market/sector-performance');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.error && !(json.data || []).length) throw new Error(json.error);
      setRows(Array.isArray(json.data) ? json.data : []);
      setUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      console.warn('[Sectors] load error:', e.message);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => clearInterval(iv);
  }, [load]);

  return (
    <div className="sp-panel">
      <PanelChrome
        title="SECTORS"
        subtitle="SPDR SECTOR ETFs · S&P 500"
        timestamp={loading ? 'LOADING…' : error ? 'ERR' : updatedAt}
      />

      <div className="sp-grid-head">
        <span className="sp-col-sector">SECTOR</span>
        {HORIZONS.map(h => <span key={h} className="sp-col-h">{h}</span>)}
      </div>

      {loading && rows.length === 0 ? (
        <div className="sp-state">…</div>
      ) : rows.length === 0 ? (
        <div className="sp-state">
          <span>NO DATA</span>
          <button className="sp-retry-btn" onClick={() => { setLoading(true); load(); }}>RETRY</button>
        </div>
      ) : (
        <div className="sp-grid">
          {rows.map(r => (
            <div
              key={r.symbol}
              className="sp-row"
              title={`${r.name} (${r.symbol})${r.price != null ? ` · ${r.price}` : ''} — click to chart, double-click → window`}
              {...tickerClicks(r.symbol, { onSingle: (sym) => onTickerClick?.(sym) })}
            >
              <span className="sp-col-sector">
                <span className="sp-etf">{r.symbol}</span>
                <span className="sp-name">{r.name}</span>
              </span>
              {HORIZONS.map(h => {
                const v = r.perf?.[h] ?? null;
                return (
                  <span key={h} className="sp-col-h sp-cell" style={cellTint(h, v)}>
                    {fmtPct(v)}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="sp-source">
        Yahoo · 1W/1M/YTD from daily closes · refreshed 10 min · click sector to chart
      </div>
    </div>
  );
}

export { SectorsPanel };
export default memo(SectorsPanel);
