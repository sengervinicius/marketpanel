/**
 * HomePanelMobile.jsx — Mobile Wave 1 Home.
 *
 * Glanceable "state of the world" per the approved mockup
 * (particle-mobile-mockups.html · Home):
 *   · Mood / breadth strip        — GET /api/market/mood
 *   · THE ONE THING card          — GET /api/brief (data.oneThing)
 *   · Your book · today           — useWatchlist names via /api/snapshot/tickers,
 *                                   sorted by day move, tap → detail sheet
 *   · Macro that touches you       — GET /api/brief (data.macro)
 *   · Indexes tile row             — live via PriceContext
 *
 * A mobile-first rethink, not a shrunk terminal: the dense terminal
 * grids (options flow, section lists, market-screen gallery, news wire)
 * now live on the Markets tab and in the More menu.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTickerPrice } from '../../context/PriceContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useWatchlist } from '../../context/WatchlistContext';
import { displayToApi } from '../../utils/format';
import { apiFetch } from '../../utils/api';
import { swallow } from '../../utils/swallow';
import MobileQuoteRow from './MobileQuoteRow';
import './HomePanelMobile.css';
import './MobileWave1.css';

/* ── Mood / breadth strip ─────────────────────────────────────────── */
function MoodStrip() {
  const [mood, setMood] = useState(null);
  useEffect(() => {
    let alive = true;
    apiFetch('/api/market/mood')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.ok && j.composite != null) setMood(j); })
      .catch(e => swallow(e, 'panel.homeMobile.mood'));
    return () => { alive = false; };
  }, []);

  const composite = mood?.composite; // 0–100
  const label = mood?.label || (composite == null ? 'MARKET MOOD' : composite >= 55 ? 'RISK-ON' : composite <= 45 ? 'RISK-OFF' : 'NEUTRAL');
  const tone = composite == null ? 'neutral' : composite >= 55 ? 'on' : composite <= 45 ? 'off' : 'neutral';
  const pin = composite == null ? 50 : Math.max(2, Math.min(98, composite));
  const c = mood?.components || {};

  const parts = [];
  if (c.vix?.value != null) parts.push(`VIX ${c.vix.value}`);
  if (c.breadth?.value != null) parts.push(`breadth ${c.breadth.value}%`);
  if (c.hyOas?.changeBps != null) parts.push(`HY OAS Δ${c.hyOas.changeBps > 0 ? '+' : ''}${c.hyOas.changeBps}bp`);
  if (c.crypto?.value != null) parts.push(`crypto F&G ${c.crypto.value}`);

  return (
    <div className="mw-card mw-card--accent">
      <div className="mw-mood">
        <span className="mw-mood-lbl" data-tone={tone}>{label}</span>
        <div className="mw-gauge"><div className="mw-gauge-pin" style={{ left: `${pin}%` }} /></div>
      </div>
      <div className="mw-mood-sub">
        {parts.length ? parts.join(' · ') : 'Composite mood loading…'}
      </div>
    </div>
  );
}

/* ── Your book · today ────────────────────────────────────────────── */
function YourBook() {
  const { watchlist } = useWatchlist();
  const [meta, setMeta] = useState({}); // origSym → { name, changePct }
  // Pair each watchlist symbol with its API form (fixes slashed forex like
  // 'EUR/USD' which the quote endpoint can't resolve). meta stays keyed by the
  // ORIGINAL symbol for display/sort.
  const pairs = useMemo(
    () => (watchlist || []).slice(0, 20).map(orig => ({ orig, api: displayToApi(orig) })),
    [watchlist],
  );
  const symbolsKey = useMemo(() => pairs.map(p => p.api).join(','), [pairs]);

  useEffect(() => {
    if (!symbolsKey) return undefined;
    let alive = true;
    const load = () => {
      apiFetch(`/api/snapshot/tickers?symbols=${encodeURIComponent(symbolsKey)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
          if (!alive || !j?.results) return;
          const map = {};
          for (const { orig, api } of pairs) {
            const t = j.results[api]?.ticker || j.results[orig]?.ticker;
            if (t) map[orig] = { name: t.name || null, changePct: t.todaysChangePerc ?? null };
          }
          setMeta(map);
        })
        .catch(e => swallow(e, 'panel.homeMobile.yourbook'));
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [symbolsKey, pairs]);

  const ordered = useMemo(() => {
    return [...pairs].sort((a, b) => {
      const pa = meta[a.orig]?.changePct ?? -Infinity;
      const pb = meta[b.orig]?.changePct ?? -Infinity;
      return pb - pa;
    });
  }, [pairs, meta]);

  if (!ordered.length) {
    return (
      <>
        <div className="mw-sechead">Your book · today</div>
        <div className="mw-card"><div className="mw-empty">Your watchlist is empty — add names from Search.</div></div>
      </>
    );
  }

  return (
    <>
      <div className="mw-sechead">Your book · today</div>
      <div className="mw-card mw-card--list">
        {ordered.map(({ orig, api }) => (
          <MobileQuoteRow key={orig} symbol={api} display={orig} name={meta[orig]?.name} />
        ))}
      </div>
    </>
  );
}

/* ── Brief-backed cards (THE ONE THING + Macro) ───────────────────── */
function BriefCards() {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/brief')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) { setBrief(j?.data || null); setLoading(false); } })
      .catch(e => { swallow(e, 'panel.homeMobile.brief'); if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const oneThing = brief?.oneThing;
  const macro = brief?.macro || [];

  return (
    <>
      <div className="mw-card">
        <div className="mw-sechead" style={{ margin: '0 0 6px' }}>The one thing</div>
        <div className="mw-onething">
          {oneThing || (loading ? 'Composing today’s brief…' : 'No brief yet — open the Brief tab to generate one.')}
        </div>
      </div>

      {macro.length > 0 && (
        <>
          <div className="mw-sechead">Macro that touches you</div>
          <div className="mw-card mw-card--list">
            {macro.slice(0, 5).map((m, i) => (
              <div className="mw-row" key={`${m.label}-${i}`}>
                <div className="mw-row-l">
                  <span className="mw-tk">{m.label}</span>
                  {m.line ? <span className="mw-nm">{m.line}</span> : null}
                </div>
                {m.odds ? <div className="mw-row-r"><span className="mw-chip odds">{m.odds}</span></div> : null}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* ── Indexes tile row ─────────────────────────────────────────────── */
const INDEX_TILES = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'NASDAQ' },
  { symbol: 'EWZ', label: 'IBOV (EWZ)' },
];

function IndexTile({ symbol, label }) {
  const q = useTickerPrice(symbol);
  const openDetail = useOpenDetail();
  const price = q?.price;
  const pct = q?.changePct;
  const cls = pct == null ? '' : pct >= 0 ? 'u' : 'd';
  return (
    <div className="mw-tile" onClick={() => openDetail(symbol)} style={{ cursor: 'pointer' }}>
      <div className="mw-tile-t">{label}</div>
      <div className="mw-tile-v">{price != null ? price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</div>
      <div className={`mw-tile-c ${cls}`}>{pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '·'}</div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────────── */
function HomePanelMobile() {
  // Pull-to-refresh: re-fetch by remounting brief/mood via key bump.
  const containerRef = useRef(null);
  const touchStartY = useRef(0);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const PULL_THRESHOLD = 60;

  const onTouchStart = useCallback((e) => {
    touchStartY.current = containerRef.current && containerRef.current.scrollTop === 0
      ? e.touches[0].clientY : 0;
  }, []);
  const onTouchMove = useCallback((e) => {
    if (!touchStartY.current) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0 && dy <= 120) setPullY(dy);
  }, []);
  const onTouchEnd = useCallback(() => {
    if (pullY >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullY(0);
      setRefreshKey(k => k + 1);
      setTimeout(() => setRefreshing(false), 700);
    } else {
      setPullY(0);
    }
    touchStartY.current = 0;
  }, [pullY, refreshing]);

  return (
    <div
      className="mw-scroll"
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {(pullY > 10 || refreshing) && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', height: refreshing ? 24 : Math.min(pullY, 60), lineHeight: '24px', overflow: 'hidden' }}>
          {refreshing ? '↻ Refreshing…' : pullY >= PULL_THRESHOLD ? '↑ Release to refresh' : '↓ Pull to refresh'}
        </div>
      )}

      <MoodStrip key={`mood-${refreshKey}`} />
      <BriefCards key={`brief-${refreshKey}`} />
      <YourBook />

      <div className="mw-sechead">Indexes</div>
      <div className="mw-tiles">
        {INDEX_TILES.map(t => <IndexTile key={t.symbol} symbol={t.symbol} label={t.label} />)}
      </div>
    </div>
  );
}

export default HomePanelMobile;
