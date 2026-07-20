/**
 * SectorPulsePanel.jsx — Phase S W1 item 2: SECTOR PULSE.
 *
 * Approved mockup: particle-phase-s-design-review.html section 2 (right).
 *
 * Left column — the 11 GICS sectors as horizontal bars (SPDR ETFs),
 * sorted best -> worst for the selected horizon. Bars are scaled to the
 * biggest |move| of the day; green/red with opacity graded by magnitude
 * so rotation direction reads in one second. Value right-aligned.
 * Click a bar -> chart the ETF.
 *
 * Right column — LEADING · <best sector> top-2 and LAGGING · <worst
 * sector> bottom-2 names with day %chg. Snapshot rows carry no GICS
 * sector, so the names come from a hardcoded top-10-holdings map per
 * SPDR (config/sectorConstituents.js) quoted through the existing
 * /api/snapshot/tickers batch and ranked by day %.
 *
 * Data: GET /api/market/sector-performance (10 min server cache) for the
 * bars; 1D/1W/YTD chips re-render from the horizons already in that
 * payload (no second endpoint).
 */

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { apiFetch } from '../../utils/api';
import PanelChrome from '../common/PanelChrome';
import ViewChips, { loadPersistedChip } from '../common/ViewChips';
import { getSectorHoldings } from '../../config/sectorConstituents';
import './SectorPulsePanel.css';

const HORIZON_KEY = 'sectorPulseHorizon_v1';
const HORIZONS = [
  { key: '1D',  label: '1D' },
  { key: '1W',  label: '1W' },
  { key: 'YTD', label: 'YTD' },
];
const REFRESH_MS = 10 * 60_000;        // matches the server-side 10 min cache
const LEADERS_REFRESH_MS = 2 * 60_000; // constituent day-% quotes

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 1 : 2)}%`;
}

// Bar visuals: width scaled to the max |move| of the horizon, opacity
// graded by magnitude (mockup: faint 0.45 -> loud 0.9); near-flat = muted.
function barStyle(v, maxAbs) {
  if (v == null || !Number.isFinite(v) || maxAbs <= 0) return { width: 0 };
  const frac = Math.min(1, Math.abs(v) / maxAbs);
  const width = `${Math.max(4, Math.round(frac * 100))}%`;
  if (Math.abs(v) < 0.05) return { width, background: 'var(--text-faint)' };
  return {
    width,
    background: v > 0 ? 'var(--price-up)' : 'var(--price-down)',
    opacity: 0.45 + 0.45 * frac,
  };
}

function valueClass(v) {
  if (v == null || !Number.isFinite(v)) return 'spp-v';
  if (Math.abs(v) < 0.05) return 'spp-v spp-v--flat';
  return v > 0 ? 'spp-v spp-v--up' : 'spp-v spp-v--dn';
}

function SectorPulsePanel({ onTickerClick }) {
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
      console.warn('[SectorPulse] load error:', e.message);
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

  // Sorted best -> worst for the active horizon (nulls sink to the bottom).
  const sorted = useMemo(() => {
    const val = r => r.perf?.[horizon];
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return vb - va;
    });
  }, [rows, horizon]);

  const maxAbs = useMemo(() => sorted.reduce((m, r) => {
    const v = r.perf?.[horizon];
    return v != null && Number.isFinite(v) ? Math.max(m, Math.abs(v)) : m;
  }, 0), [sorted, horizon]);

  const withVal = sorted.filter(r => r.perf?.[horizon] != null);
  const best  = withVal[0] || null;
  const worst = withVal.length > 1 ? withVal[withVal.length - 1] : null;

  // ── Right column: quote the best/worst sectors' top-10 holdings ────
  const constituentKey = useMemo(() => {
    const syms = new Set([
      ...getSectorHoldings(best?.symbol),
      ...getSectorHoldings(worst?.symbol),
    ]);
    return Array.from(syms).join(',');
  }, [best?.symbol, worst?.symbol]);

  useEffect(() => {
    if (!constituentKey) return undefined;
    let alive = true;
    const loadQuotes = async () => {
      try {
        const res = await apiFetch(`/api/snapshot/tickers?symbols=${encodeURIComponent(constituentKey)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!alive || !json?.results) return;
        const map = {};
        for (const [sym, entry] of Object.entries(json.results)) {
          const pct = entry?.ticker?.todaysChangePerc;
          if (pct != null && Number.isFinite(pct)) map[sym] = pct;
        }
        setQuotes(map);
      } catch { /* right column degrades to em-dash */ }
    };
    loadQuotes();
    const iv = setInterval(loadQuotes, LEADERS_REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, [constituentKey]);

  const rank = useCallback((etf) => {
    return getSectorHoldings(etf)
      .filter(s => quotes[s] != null)
      .map(s => ({ sym: s, pct: quotes[s] }))
      .sort((a, b) => b.pct - a.pct);
  }, [quotes]);

  const leaders  = best  ? rank(best.symbol).slice(0, 2) : [];
  const laggards = worst ? rank(worst.symbol).slice(-2).reverse() : [];

  const nameRow = (it) => (
    <div
      key={it.sym}
      className="spp-llrow"
      title={`${it.sym} — day move · click to chart`}
      onClick={() => onTickerClick?.(it.sym)}
    >
      <span className="spp-llsym">{it.sym}</span>
      <span className={valueClass(it.pct)}>{fmtPct(it.pct)}</span>
    </div>
  );

  return (
    <div className="spp-panel">
      <PanelChrome
        title="SECTOR PULSE"
        subtitle="SPDR SECTOR ETFs · S&P 500"
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
        <div className="spp-state">…</div>
      ) : rows.length === 0 ? (
        <div className="spp-state">
          <span>NO DATA</span>
          <button className="spp-retry-btn" onClick={() => { setLoading(true); load(); }}>RETRY</button>
        </div>
      ) : (
        <div className="spp-grid">
          {/* Left — 11 sector bars, best -> worst */}
          <div className="spp-bars">
            {sorted.map(r => {
              const v = r.perf?.[horizon] ?? null;
              return (
                <div
                  key={r.symbol}
                  className="spp-bar-row"
                  title={`${r.name} (${r.symbol}) · ${horizon} ${fmtPct(v)} — click to chart`}
                  onClick={() => onTickerClick?.(r.symbol)}
                >
                  <span className="spp-k">{r.symbol}</span>
                  <span className="spp-track"><span className="spp-fill" style={barStyle(v, maxAbs)} /></span>
                  <span className={valueClass(v)}>{fmtPct(v)}</span>
                </div>
              );
            })}
          </div>

          {/* Right — the names driving the best/worst sector (day %) */}
          <div className="spp-leaders">
            {best && (
              <>
                <div className="spp-sechead">LEADING · {String(best.name || best.symbol).toUpperCase()}</div>
                {leaders.length ? leaders.map(nameRow) : <div className="spp-llrow spp-llrow--empty">—</div>}
              </>
            )}
            {worst && (
              <>
                <div className="spp-sechead">LAGGING · {String(worst.name || worst.symbol).toUpperCase()}</div>
                {laggards.length ? laggards.map(nameRow) : <div className="spp-llrow spp-llrow--empty">—</div>}
              </>
            )}
          </div>
        </div>
      )}

      <div className="spp-source">
        Yahoo · bars scaled to the biggest {horizon} move · leaders/laggards = top-10 SPDR holdings ranked by day %
      </div>
    </div>
  );
}

export { SectorPulsePanel };
export default memo(SectorPulsePanel);
