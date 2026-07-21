/**
 * SectorPulsePanel.jsx — fix/ux-round4 FIX 3: MARKET MAP.
 *
 * Replaces the SECTOR PULSE bars/leaders layout ("makes zero sense" —
 * user) with a compact treemap-style MARKET MAP: a CSS-grid block layout
 * of the 11 GICS sectors where each block's area is roughly weighted by
 * its S&P 500 sector weight (hardcoded approximate weights below), the
 * block background is the up/down token color with opacity graded by
 * |%chg| (same color-mix ramp as SectorsPanel), and each block shows the
 * FULL sector name (the XL* codes were the confusion), the %chg for the
 * selected horizon, and the sector's top mover (from the hardcoded SPDR
 * top-10 holdings in config/sectorConstituents.js quoted through the
 * existing /api/snapshot/tickers batch endpoint, chunked to respect the
 * 50-symbol batch cap).
 *
 * Legibility over cleverness: blocks are size containers; the mover line
 * only renders when the block is big enough (container query), and no
 * font ever drops below 8.5px.
 *
 * Panel id stays 'sectorPulse' (title MARKET MAP) so saved layouts keep
 * working. Blocks are intentionally NOT clickable — ticker clicks no
 * longer touch the chart grid (FIX 4); the sector-overlay hook lands in
 * the next phase.
 *
 * Data: GET /api/market/sector-performance (10 min server cache) for the
 * tiles; 1D/1W/YTD chips re-render from the horizons already in that
 * payload (no second endpoint).
 */

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { apiFetch } from '../../utils/api';
import PanelChrome from '../common/PanelChrome';
import ViewChips, { loadPersistedChip } from '../common/ViewChips';
import { SECTOR_ETF_HOLDINGS, getSectorHoldings } from '../../config/sectorConstituents';
import './SectorPulsePanel.css';

const HORIZON_KEY = 'sectorPulseHorizon_v1';
const HORIZONS = [
  { key: '1D',  label: '1D' },
  { key: '1W',  label: '1W' },
  { key: 'YTD', label: 'YTD' },
];
const REFRESH_MS = 10 * 60_000;      // matches the server-side 10 min cache
const MOVERS_REFRESH_MS = 2 * 60_000; // constituent day-% quotes
const SNAPSHOT_BATCH_MAX = 50;        // server /snapshot/tickers cap

// Approximate S&P 500 sector weights (%) — drive the block AREAS only.
// grid-template-areas (CSS) is hand-tiled on a 10×10 grid to match these
// as closely as rectangles allow; `area` names the CSS grid-area token.
export const SECTOR_MAP_META = {
  XLK:  { area: 'tech', weight: 31,  name: 'Technology' },
  XLF:  { area: 'fin',  weight: 13,  name: 'Financials' },
  XLV:  { area: 'hlth', weight: 12,  name: 'Health Care' },
  XLY:  { area: 'disc', weight: 10,  name: 'Cons. Discretionary' },
  XLC:  { area: 'comm', weight: 9,   name: 'Communications' },
  XLI:  { area: 'indu', weight: 8,   name: 'Industrials' },
  XLP:  { area: 'stpl', weight: 6,   name: 'Cons. Staples' },
  XLE:  { area: 'engy', weight: 4,   name: 'Energy' },
  XLU:  { area: 'util', weight: 2.5, name: 'Utilities' },
  XLRE: { area: 're',   weight: 2.2, name: 'Real Estate' },
  XLB:  { area: 'matl', weight: 2,   name: 'Materials' },
};

// Same tint ramp as SectorsPanel.cellTint: per-horizon "full tint" scale,
// token color mixed in at 5–42% so a flat tape reads calm.
const FULL_SCALE = { '1D': 2, '1W': 4, '1M': 8, 'YTD': 20 };
const MAX_TINT = 42;
const MIN_TINT = 5;

export function blockTint(horizon, v) {
  if (v == null || !Number.isFinite(v) || v === 0) return undefined;
  const token = v > 0 ? 'var(--price-up)' : 'var(--price-down)';
  const frac = Math.min(1, Math.abs(v) / (FULL_SCALE[horizon] || 5));
  const pctMix = Math.round(MIN_TINT + frac * (MAX_TINT - MIN_TINT));
  return { background: `color-mix(in srgb, ${token} ${pctMix}%, transparent)` };
}

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(Math.abs(v) >= 10 ? 1 : 2)}%`;
}

function valueClass(v) {
  if (v == null || !Number.isFinite(v)) return '';
  if (Math.abs(v) < 0.05) return 'mm-flat';
  return v > 0 ? 'mm-up' : 'mm-dn';
}

/** Top mover of a sector = constituent with the biggest |day %|. */
export function topMover(etf, quotes) {
  let bestSym = null, bestPct = null;
  for (const s of getSectorHoldings(etf)) {
    const p = quotes[s];
    if (p == null || !Number.isFinite(p)) continue;
    if (bestPct == null || Math.abs(p) > Math.abs(bestPct)) { bestSym = s; bestPct = p; }
  }
  return bestSym == null ? null : { sym: bestSym, pct: bestPct };
}

function SectorPulsePanel() {
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [updatedAt, setUpdated] = useState('');
  const [horizon, setHorizon]   = useState(() => loadPersistedChip(HORIZON_KEY, HORIZONS, '1D'));
  const [quotes, setQuotes]     = useState({}); // SYM -> day changePct

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
      console.warn('[MarketMap] load error:', e.message);
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

  // ── Top movers: quote every sector's top-10 holdings, chunked to the
  // 50-symbol /snapshot/tickers cap (11 × 10 = 110 syms → 3 requests).
  useEffect(() => {
    const all = Array.from(new Set(Object.values(SECTOR_ETF_HOLDINGS).flat()));
    let alive = true;
    const loadQuotes = async () => {
      const map = {};
      const chunks = [];
      for (let i = 0; i < all.length; i += SNAPSHOT_BATCH_MAX) chunks.push(all.slice(i, i + SNAPSHOT_BATCH_MAX));
      await Promise.all(chunks.map(async (chunk) => {
        try {
          const res = await apiFetch(`/api/snapshot/tickers?symbols=${encodeURIComponent(chunk.join(','))}`);
          if (!res.ok) return;
          const json = await res.json();
          if (!json?.results) return;
          for (const [sym, entry] of Object.entries(json.results)) {
            const pct = entry?.ticker?.todaysChangePerc;
            if (pct != null && Number.isFinite(pct)) map[sym] = pct;
          }
        } catch { /* mover line degrades away */ }
      }));
      if (alive && Object.keys(map).length) setQuotes(map);
    };
    loadQuotes();
    const iv = setInterval(loadQuotes, MOVERS_REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Only sectors we know how to place; unknown symbols are ignored.
  const blocks = useMemo(() => rows
    .filter(r => SECTOR_MAP_META[r.symbol])
    .map(r => {
      const meta = SECTOR_MAP_META[r.symbol];
      const v = r.perf?.[horizon] ?? null;
      return {
        symbol: r.symbol,
        area: meta.area,
        name: (r.name || meta.name),
        v,
        mover: topMover(r.symbol, quotes),
      };
    }), [rows, horizon, quotes]);

  return (
    <div className="mm-panel">
      <PanelChrome
        title="MARKET MAP"
        subtitle="S&P 500 SECTORS · AREA ≈ INDEX WEIGHT"
        timestamp={loading ? 'LOADING…' : error ? 'ERR' : updatedAt}
        actions={(
          <ViewChips
            options={HORIZONS.map(h => ({ key: h.key, label: h.label, title: `${h.label} sector performance` }))}
            value={horizon}
            onChange={setHorizon}
            storageKey={HORIZON_KEY}
            ariaLabel="Performance horizon"
          />
        )}
      />

      {loading && rows.length === 0 ? (
        <div className="mm-state">…</div>
      ) : blocks.length === 0 ? (
        <div className="mm-state">
          <span>NO DATA</span>
          <button className="mm-retry-btn" onClick={() => { setLoading(true); load(); }}>RETRY</button>
        </div>
      ) : (
        <div className="mm-map">
          {blocks.map(b => (
            <div
              key={b.symbol}
              className="mm-block"
              style={{ gridArea: b.area, ...(blockTint(horizon, b.v) || {}) }}
              title={`${b.name} · ${horizon} ${fmtPct(b.v)}${b.mover ? ` · top mover ${b.mover.sym} ${fmtPct(b.mover.pct)}` : ''}`}
            >
              <div className="mm-block-inner">
                <span className="mm-name">{b.name}</span>
                <span className={`mm-chg ${valueClass(b.v)}`}>{fmtPct(b.v)}</span>
                {b.mover && (
                  <span className="mm-mover">
                    <b>{b.mover.sym}</b>
                    <i className={valueClass(b.mover.pct)}>{fmtPct(b.mover.pct)}</i>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mm-source">
        Yahoo · area ≈ S&P sector weight · tint = {horizon} move · mover = top-10 SPDR holding by |day %|
      </div>
    </div>
  );
}

export { SectorPulsePanel };
export default memo(SectorPulsePanel);
