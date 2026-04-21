/**
 * OptionsFlowPanel.jsx — SMART MONEY, clustered by conviction
 *
 * CIO-note (2026-04-20, v3): the v2 tabular feed showed a scroll of
 * 60 disconnected trades — "a bunch of isolated random trades".
 * It didn't answer the question a CIO actually asks when they look at
 * options flow: "What is smart money doing right now, and where is the
 * conviction?"
 *
 * v3 reframes the panel around two questions and answers them top-down:
 *
 *   1. WHAT IS THE TAPE DOING? — a single thesis line: posture
 *      (BULLISH / BEARISH / MIXED), the net-premium dollar skew, and
 *      a signal count. This is computed across all bullish vs bearish
 *      signals weighted by dollar size (premium / notional).
 *
 *   2. WHERE IS THE CONVICTION? — signals are grouped by ticker into
 *      clusters. Each cluster shows its ticker, directional posture,
 *      net $ skew, signal count, and type confluence (OPT · DP · CON).
 *      Under each cluster header, the individual signals are rendered
 *      as compact detail rows. Clusters are sorted by a conviction
 *      score that rewards confluence (multiple signals, multiple types)
 *      and dollar size.
 *
 * The filter tabs (ALL / OPTIONS / DARK POOL / CONGRESS) still exist —
 * they filter the underlying item set before clustering, so you can ask
 * "which tickers are seeing coordinated DARK POOL accumulation" in one
 * click.
 *
 * Data source unchanged: /api/unusual-whales/panel-data, 2-minute
 * refresh.
 */

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { apiFetch } from '../../utils/api';
import { PanelHeader, PanelTabRow } from './_shared';
import { useIsMobile } from '../../hooks/useIsMobile';
import DesktopOnlyPlaceholder from '../common/DesktopOnlyPlaceholder';
import './OptionsFlowPanel.css';

/* ── Formatting helpers ────────────────────────────────────── */

const fmtMoney = (value) => {
  if (!value && value !== 0) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return '—';
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000)    return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000)        return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
};

const fmtMoneySigned = (num) => {
  if (num == null || isNaN(num) || num === 0) return '$0';
  const sign = num > 0 ? '+' : '−';
  return sign + fmtMoney(Math.abs(num)).replace(/^\$/, '$');
};

const fmtStrike = (strike) => {
  if (!strike || strike === 0) return '';
  return `$${parseFloat(strike).toFixed(0)}`;
};

const fmtExpiry = (exp) => {
  if (!exp) return '';
  try {
    const d = new Date(exp);
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  } catch { return ''; }
};

const timeAgo = (ts) => {
  if (!ts) return '';
  try {
    const diffMs = Date.now() - new Date(ts).getTime();
    const diffM = Math.round(diffMs / 60000);
    if (diffM < 1) return 'now';
    if (diffM < 60) return `${diffM}m`;
    const diffH = Math.round(diffM / 60);
    if (diffH < 24) return `${diffH}h`;
    const diffD = Math.round(diffH / 24);
    return `${diffD}d`;
  } catch { return ''; }
};

const fmtShares = (n) => {
  if (!n) return '';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M sh`;
  if (num >= 1_000)     return `${(num / 1_000).toFixed(0)}K sh`;
  return `${num.toLocaleString()} sh`;
};

/* ── Build unified feed items ──────────────────────────────── */

function buildFeedItems(alerts, darkPool, congress) {
  const items = [];

  // Options flow items
  for (const a of alerts) {
    const ticker = a.symbol || a.ticker;
    if (!ticker || ticker === 'N/A') continue;

    const rawSent = (a.sentiment || a.type || '').toLowerCase();
    const isCall = rawSent.includes('call') || rawSent.includes('bull');
    const isPut  = rawSent.includes('put')  || rawSent.includes('bear');
    const signal = isCall ? 'bullish' : isPut ? 'bearish' : 'neutral';

    const isSweep    = a.isSweep    || (a.type || '').toLowerCase().includes('sweep');
    const isFloor    = a.isFloor    || (a.type || '').toLowerCase().includes('floor');
    const isMultiLeg = a.isMultiLeg || (a.type || '').toLowerCase().includes('multi');
    const isGolden   = isSweep && isFloor;
    const typeLabel = isGolden ? 'GOLDEN' : isSweep ? 'SWEEP' : isFloor ? 'FLOOR' : isMultiLeg ? 'MULTI' : 'BLOCK';

    const side = isCall ? 'C' : isPut ? 'P' : '';
    const strike = a.strike ? fmtStrike(a.strike) : '';
    const exp = fmtExpiry(a.expiry || a.expiration);
    const detail = [side, strike, exp].filter(Boolean).join(' ');

    items.push({
      type: 'options',
      ticker,
      signal,
      typeLabel,
      isGolden,
      detail,
      size: fmtMoney(a.premium),
      sortValue: a.premium || 0,
      time: a.timestamp || a.date,
      sortWeight: isGolden ? 3 : isSweep ? 2 : 1,
    });
  }

  // Dark pool items
  for (const dp of darkPool) {
    const ticker = dp.symbol || dp.ticker;
    if (!ticker) continue;

    const size     = dp.size || dp.volume || 0;
    const price    = dp.price || dp.averagePrice || 0;
    const notional = size && price ? size * price : dp.notional || 0;

    const detail = price
      ? `@ $${parseFloat(price).toFixed(2)} · ${fmtShares(size)}`
      : fmtShares(size);

    items.push({
      type: 'darkpool',
      ticker,
      signal: 'neutral',
      typeLabel: 'DRK PL',
      detail,
      size: fmtMoney(notional || 0),
      sortValue: notional || size || 0,
      time: dp.timestamp || dp.date || dp.executed_at,
      sortWeight: 1.5,
    });
  }

  // Congress items
  for (const t of congress) {
    const ticker = t.ticker;
    if (!ticker || ticker === 'N/A') continue;

    const rawTxn = (t.transactionType || t.action || '').toLowerCase();
    const isBuy  = rawTxn.includes('buy') || rawTxn.includes('purchase');
    const isSell = rawTxn.includes('sell') || rawTxn.includes('sale') || rawTxn.includes('sold');
    const signal = isBuy ? 'bullish' : isSell ? 'bearish' : 'neutral';

    const member = t.representative || 'Unknown';
    const party  = t.party ? t.party.charAt(0) : '';
    const action = isBuy ? 'BUY' : isSell ? 'SELL' : 'TXN';
    const memberShort = member.length > 18 ? member.slice(0, 17) + '…' : member;

    items.push({
      type: 'congress',
      ticker,
      signal,
      typeLabel: action,
      detail: party ? `${memberShort} (${party})` : memberShort,
      size: t.amountRange || fmtMoney(t.amount),
      // Congress transactions lack dollar granularity — use a floor value
      // just large enough to keep the item in the cluster-conviction math.
      sortValue: (t.amount && !isNaN(t.amount)) ? t.amount : 25_000,
      time: t.transactionDate || t.date || t.filedDate,
      sortWeight: 1,
    });
  }

  return items;
}

/* ── Cluster aggregation (THE thesis layer) ────────────────── */

/**
 * Groups items by ticker and scores each cluster.
 *
 *   netDollars: Σ(bullish $) − Σ(bearish $)   — directional skew
 *   conviction: |netDollars|
 *                 × (1 + 0.25 × (signalCount − 1))      [more signals = more conviction]
 *                 × (1 + 0.35 × (typeCount − 1))         [cross-type confluence is golden]
 *
 * Clusters are returned sorted by conviction descending.
 */
function buildClusters(items) {
  const byTicker = new Map();
  for (const it of items) {
    if (!byTicker.has(it.ticker)) {
      byTicker.set(it.ticker, {
        ticker: it.ticker,
        items: [],
        netDollars: 0,
        grossDollars: 0,
        signalCount: 0,
        types: new Set(),
        goldenCount: 0,
      });
    }
    const c = byTicker.get(it.ticker);
    c.items.push(it);
    c.signalCount += 1;
    c.types.add(it.type);
    if (it.isGolden) c.goldenCount += 1;
    const v = it.sortValue || 0;
    c.grossDollars += v;
    if (it.signal === 'bullish') c.netDollars += v;
    else if (it.signal === 'bearish') c.netDollars -= v;
  }

  const clusters = Array.from(byTicker.values()).map(c => {
    const absNet = Math.abs(c.netDollars);
    // Directional posture: require at least 70% net-to-gross skew, otherwise MIXED.
    const tilt = c.grossDollars > 0 ? absNet / c.grossDollars : 0;
    const posture = tilt < 0.35 || c.netDollars === 0
      ? 'mixed'
      : c.netDollars > 0 ? 'bullish' : 'bearish';
    const conviction = absNet
      * (1 + 0.25 * Math.max(0, c.signalCount - 1))
      * (1 + 0.35 * Math.max(0, c.types.size - 1))
      + (c.goldenCount * 100_000); // golden sweeps bias clusters up

    // Sort inner items by conviction: golden first, then $ size, then recency
    c.items.sort((a, b) => {
      if (a.sortWeight !== b.sortWeight) return b.sortWeight - a.sortWeight;
      if (a.sortValue  !== b.sortValue)  return b.sortValue  - a.sortValue;
      const ta = a.time ? new Date(a.time).getTime() : 0;
      const tb = b.time ? new Date(b.time).getTime() : 0;
      return tb - ta;
    });

    return { ...c, absNet, posture, conviction };
  });

  clusters.sort((a, b) => b.conviction - a.conviction);
  return clusters;
}

/* ── Sector mapping (compact, CIO-focused) ─────────────────── */

/**
 * Static ticker → sector map for the top ~120 tickers that drive
 * options flow signal. Anything not mapped falls into OTHER.
 * CIO-note (Phase 8.3): deliberately coarse — we want 8 buckets to
 * read at a glance, not a 25-sector GICS breakdown.
 */
const SECTOR_MAP = {
  // Tech
  AAPL: 'TECH', MSFT: 'TECH', GOOGL: 'TECH', GOOG: 'TECH', META: 'TECH', AMZN: 'TECH',
  NVDA: 'TECH', AMD: 'TECH', AVGO: 'TECH', ORCL: 'TECH', CRM: 'TECH', ADBE: 'TECH',
  INTC: 'TECH', QCOM: 'TECH', TXN: 'TECH', MU: 'TECH', AMAT: 'TECH', ASML: 'TECH',
  PANW: 'TECH', NOW: 'TECH', SNOW: 'TECH', PLTR: 'TECH', SMCI: 'TECH', ARM: 'TECH',
  NFLX: 'TECH', CRWD: 'TECH', UBER: 'TECH', SHOP: 'TECH', SQ: 'TECH', SPOT: 'TECH',
  // Financials
  JPM: 'FIN', BAC: 'FIN', WFC: 'FIN', C: 'FIN', GS: 'FIN', MS: 'FIN',
  BLK: 'FIN', SCHW: 'FIN', V: 'FIN', MA: 'FIN', AXP: 'FIN', PYPL: 'FIN',
  COF: 'FIN', USB: 'FIN', TFC: 'FIN', BRK: 'FIN',
  // Energy
  XOM: 'ENERGY', CVX: 'ENERGY', COP: 'ENERGY', EOG: 'ENERGY', SLB: 'ENERGY',
  OXY: 'ENERGY', MPC: 'ENERGY', PSX: 'ENERGY', VLO: 'ENERGY', PXD: 'ENERGY',
  USO: 'ENERGY', XLE: 'ENERGY', HAL: 'ENERGY',
  // Healthcare
  UNH: 'HLTH', JNJ: 'HLTH', PFE: 'HLTH', MRK: 'HLTH', ABBV: 'HLTH', LLY: 'HLTH',
  TMO: 'HLTH', ABT: 'HLTH', CVS: 'HLTH', AMGN: 'HLTH', GILD: 'HLTH', BMY: 'HLTH',
  ISRG: 'HLTH', MDT: 'HLTH', SYK: 'HLTH',
  // Consumer
  WMT: 'CONS', HD: 'CONS', LOW: 'CONS', TGT: 'CONS', COST: 'CONS', NKE: 'CONS',
  MCD: 'CONS', SBUX: 'CONS', TSLA: 'CONS', F: 'CONS', GM: 'CONS', DIS: 'CONS',
  PEP: 'CONS', KO: 'CONS', PG: 'CONS',
  // Industrials
  BA: 'IND', CAT: 'IND', GE: 'IND', HON: 'IND', LMT: 'IND', RTX: 'IND',
  NOC: 'IND', UPS: 'IND', FDX: 'IND', DE: 'IND', MMM: 'IND',
  // Crypto / speculative
  COIN: 'CRYPTO', MSTR: 'CRYPTO', MARA: 'CRYPTO', RIOT: 'CRYPTO',
  // Indices & broad ETFs
  SPY: 'INDEX', QQQ: 'INDEX', IWM: 'INDEX', DIA: 'INDEX', VIX: 'INDEX', UVXY: 'INDEX',
  SPX: 'INDEX', NDX: 'INDEX', VXX: 'INDEX',
};

function sectorOf(ticker) {
  if (!ticker) return 'OTHER';
  const t = ticker.toUpperCase();
  return SECTOR_MAP[t] || 'OTHER';
}

/**
 * Aggregate items by sector into { sector, netDollars, signalCount }.
 * Sorted by absolute netDollars descending.
 */
function buildSectorTilt(items) {
  const m = new Map();
  for (const it of items) {
    if (it.type === 'darkpool' || it.signal === 'neutral') continue; // directional only
    const sec = sectorOf(it.ticker);
    if (!m.has(sec)) m.set(sec, { sector: sec, netDollars: 0, grossDollars: 0, signalCount: 0 });
    const s = m.get(sec);
    const v = it.sortValue || 0;
    s.grossDollars += v;
    s.signalCount += 1;
    if (it.signal === 'bullish') s.netDollars += v;
    else if (it.signal === 'bearish') s.netDollars -= v;
  }
  return Array.from(m.values())
    .filter(s => s.sector !== 'OTHER' || s.signalCount >= 3) // hide OTHER unless loud
    .sort((a, b) => Math.abs(b.netDollars) - Math.abs(a.netDollars));
}

/* ── Tape posture (the top thesis line) ────────────────────── */

function computeTapePosture(items) {
  let bullDollars = 0, bearDollars = 0;
  for (const it of items) {
    const v = it.sortValue || 0;
    if (it.signal === 'bullish') bullDollars += v;
    else if (it.signal === 'bearish') bearDollars += v;
  }
  const net = bullDollars - bearDollars;
  const gross = bullDollars + bearDollars;
  const tilt = gross > 0 ? Math.abs(net) / gross : 0;
  let posture = 'MIXED';
  if (gross > 0 && tilt >= 0.20) {
    posture = net > 0 ? 'BULLISH' : 'BEARISH';
  }
  return { posture, net, bullDollars, bearDollars, total: gross, signals: items.length };
}

/* ── Filter tabs ───────────────────────────────────────────── */

const TABS = [
  { key: 'all',      label: 'ALL' },
  { key: 'options',  label: 'OPTIONS' },
  { key: 'darkpool', label: 'DARK POOL' },
  { key: 'congress', label: 'CONGRESS' },
];

/* ── Sub-components ────────────────────────────────────────── */

const TapePostureBar = memo(function TapePostureBar({ posture }) {
  const cls = posture.posture === 'BULLISH' ? 'sm-thesis--bull'
    : posture.posture === 'BEARISH' ? 'sm-thesis--bear' : 'sm-thesis--mix';
  const glyph = posture.posture === 'BULLISH' ? '▲'
    : posture.posture === 'BEARISH' ? '▼' : '◆';

  return (
    <div className={`sm-thesis ${cls}`}>
      <span className="sm-thesis-glyph">{glyph}</span>
      <span className="sm-thesis-label">{posture.posture} TAPE</span>
      <span className="sm-thesis-sep">·</span>
      <span className="sm-thesis-metric">
        <span className="sm-thesis-metric-label">NET</span>
        <span className="sm-thesis-metric-val">{fmtMoneySigned(posture.net)}</span>
      </span>
      <span className="sm-thesis-sep">·</span>
      <span className="sm-thesis-metric">
        <span className="sm-thesis-metric-val">{posture.signals}</span>
        <span className="sm-thesis-metric-label">signals</span>
      </span>
    </div>
  );
});

/* ── Thesis Lane: 3 derived signals from current tape (Phase 8.3) ── */

const ThesisLane = memo(function ThesisLane({ items, clusters }) {
  const sectorTilt = useMemo(() => buildSectorTilt(items), [items]);
  const goldenCount = useMemo(
    () => items.filter(i => i.isGolden).length,
    [items]
  );
  const hotspot = clusters[0];

  const bullSec = sectorTilt.find(s => s.netDollars > 0);
  const bearSec = sectorTilt.find(s => s.netDollars < 0);

  return (
    <div className="sm-lane">
      {/* Hotspot — single ticker with highest conviction */}
      <div className="sm-lane-card">
        <span className="sm-lane-label">HOTSPOT</span>
        {hotspot ? (
          <span className="sm-lane-body">
            <span className={`sm-lane-ticker sm-lane-ticker--${hotspot.posture}`}>{hotspot.ticker}</span>
            <span className="sm-lane-meta">
              {hotspot.signalCount} sig · {fmtMoneySigned(hotspot.netDollars)}
            </span>
          </span>
        ) : (
          <span className="sm-lane-body sm-lane-empty">—</span>
        )}
      </div>

      {/* Sector tilt — top bullish + top bearish */}
      <div className="sm-lane-card">
        <span className="sm-lane-label">SECTOR</span>
        <span className="sm-lane-body">
          {bullSec && (
            <span className="sm-lane-pill sm-lane-pill--bull">
              ▲ {bullSec.sector} {fmtMoneySigned(bullSec.netDollars)}
            </span>
          )}
          {bearSec && (
            <span className="sm-lane-pill sm-lane-pill--bear">
              ▼ {bearSec.sector} {fmtMoneySigned(bearSec.netDollars)}
            </span>
          )}
          {!bullSec && !bearSec && <span className="sm-lane-empty">no tilt</span>}
        </span>
      </div>

      {/* Golden sweeps — confluence of sweep+floor */}
      <div className="sm-lane-card">
        <span className="sm-lane-label">GOLDEN</span>
        <span className="sm-lane-body">
          <span className={`sm-lane-count ${goldenCount > 0 ? 'sm-lane-count--hot' : ''}`}>
            {goldenCount}
          </span>
          <span className="sm-lane-meta">sweeps today</span>
        </span>
      </div>
    </div>
  );
});

const TYPE_SHORT = { options: 'OPT', darkpool: 'DP', congress: 'CON' };

/**
 * Compute bull-share and bear-share from a cluster's item list.
 * Returns two normalized percentages ∈ [0, 100] that sum to 100 when gross > 0.
 */
function directionShares(cluster) {
  let bull = 0, bear = 0;
  for (const it of cluster.items) {
    const v = it.sortValue || 0;
    if (it.signal === 'bullish') bull += v;
    else if (it.signal === 'bearish') bear += v;
  }
  const total = bull + bear;
  if (total <= 0) return { bullPct: 50, bearPct: 50 };
  return { bullPct: (bull / total) * 100, bearPct: (bear / total) * 100 };
}

/* ── Ticker sentiment tile — the main visual primitive ──────── */
const TickerTile = memo(function TickerTile({ cluster, selected, onSelect }) {
  const postureCls = cluster.posture === 'bullish' ? 'sm-tile--bull'
    : cluster.posture === 'bearish' ? 'sm-tile--bear' : 'sm-tile--mix';
  const glyph = cluster.posture === 'bullish' ? '▲'
    : cluster.posture === 'bearish' ? '▼' : '◆';
  const { bullPct, bearPct } = directionShares(cluster);
  const hasGolden = cluster.goldenCount > 0;

  const typeStr = Array.from(cluster.types).map(t => TYPE_SHORT[t] || t).join(' · ');

  return (
    <button
      type="button"
      className={`sm-tile ${postureCls} ${selected ? 'sm-tile--selected' : ''}`}
      onClick={() => onSelect(cluster.ticker)}
      title={`${cluster.ticker} — ${cluster.posture.toUpperCase()} · ${cluster.signalCount} signals · ${fmtMoneySigned(cluster.netDollars)}${hasGolden ? ` · ${cluster.goldenCount} golden sweep${cluster.goldenCount>1?'s':''}` : ''}`}
    >
      {/* Top row: ticker + net $ pill */}
      <div className="sm-tile-top">
        <span className="sm-tile-ticker">{cluster.ticker}</span>
        {hasGolden && <span className="sm-tile-star" aria-label="Golden sweep">★</span>}
        <span className={`sm-tile-net sm-tile-net--${cluster.posture}`}>
          {glyph} {fmtMoneySigned(cluster.netDollars)}
        </span>
      </div>

      {/* Sentiment bar — two-sided from center: bull left, bear right */}
      <div className="sm-tile-bar" aria-hidden="true">
        <span className="sm-tile-bar-bull" style={{ width: `${bullPct}%` }} />
        <span className="sm-tile-bar-bear" style={{ width: `${bearPct}%` }} />
      </div>

      {/* Bottom row: signal count + type confluence */}
      <div className="sm-tile-meta">
        <span className="sm-tile-sig">{cluster.signalCount} sig</span>
        <span className="sm-tile-sep">·</span>
        <span className="sm-tile-types">{typeStr}</span>
      </div>
    </button>
  );
});

/* ── Detail drawer — shown when a ticker tile is selected ───── */
const DetailDrawer = memo(function DetailDrawer({ cluster, onClose }) {
  if (!cluster) return null;
  const postureLabel = cluster.posture === 'bullish' ? 'BULLISH'
    : cluster.posture === 'bearish' ? 'BEARISH' : 'MIXED';
  return (
    <div className="sm-drawer">
      <div className="sm-drawer-head">
        <span className="sm-drawer-ticker">{cluster.ticker}</span>
        <span className={`sm-clust-posture sm-clust-posture--${cluster.posture}`}>{postureLabel}</span>
        <span className="sm-drawer-net">{fmtMoneySigned(cluster.netDollars)}</span>
        <span className="sm-drawer-meta">{cluster.signalCount} signals · {Array.from(cluster.types).map(t => TYPE_SHORT[t] || t).join(' · ')}</span>
        <button className="sm-drawer-close" onClick={onClose} aria-label="Close detail">×</button>
      </div>
      <div className="sm-drawer-body">
        {cluster.items.map((item, i) => (
          <ClusterDetail key={`${item.type}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
});

const ClusterDetail = memo(function ClusterDetail({ item }) {
  const typeCls = `sm-type sm-type--${item.type}${item.isGolden ? ' sm-type--golden' : ''}`;
  const sigCls = item.signal === 'bullish' ? 'sm-sig--bull'
    : item.signal === 'bearish' ? 'sm-sig--bear' : 'sm-sig--neut';
  const sigGlyph = item.signal === 'bullish' ? '▲'
    : item.signal === 'bearish' ? '▼' : '·';

  return (
    <div className="sm-detail">
      <span className={typeCls}>{item.typeLabel}</span>
      <span className="sm-detail-body" title={item.detail}>{item.detail || '—'}</span>
      <span className="sm-detail-size">{item.size}</span>
      <span className={`sm-detail-sig ${sigCls}`}>{sigGlyph}</span>
      <span className="sm-detail-time">{timeAgo(item.time)}</span>
    </div>
  );
});

/* ── Main panel ────────────────────────────────────────────── */

function OptionsFlowPanelInner() {
  const [alerts, setAlerts]     = useState([]);
  const [darkPool, setDarkPool] = useState([]);
  const [congress, setCongress] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [activeTab, setActiveTab]   = useState('all');
  const [selectedTicker, setSelectedTicker] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/unusual-whales/panel-data');
      if (!res?.ok) throw new Error('fetch failed');
      const data = await res.json();

      if (data.alerts?.data)   setAlerts(data.alerts.data);
      if (data.darkPool?.data) setDarkPool(data.darkPool.data);
      if (data.congress?.data) setCongress(data.congress.data);
      setLastUpdate(new Date());
    } catch (err) {
      console.warn('[SmartMoney] Fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 120_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const allItems = useMemo(
    () => buildFeedItems(alerts, darkPool, congress),
    [alerts, darkPool, congress]
  );

  const filtered = useMemo(() => {
    if (activeTab === 'all') return allItems;
    return allItems.filter(i => i.type === activeTab);
  }, [allItems, activeTab]);

  const clusters = useMemo(() => buildClusters(filtered), [filtered]);
  const tape = useMemo(() => computeTapePosture(filtered), [filtered]);

  const counts = useMemo(() => ({
    all: allItems.length,
    options: allItems.filter(i => i.type === 'options').length,
    darkpool: allItems.filter(i => i.type === 'darkpool').length,
    congress: allItems.filter(i => i.type === 'congress').length,
  }), [allItems]);

  const ts = lastUpdate
    ? lastUpdate.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : '';

  // Top 18 clusters fit a 3-column tile grid nicely; most panels show ~12-18.
  const topClusters = clusters.slice(0, 18);

  // Clear selected ticker whenever the underlying tab/items change so
  // stale tickers don't persist.
  const selectedCluster = useMemo(
    () => (selectedTicker ? clusters.find(c => c.ticker === selectedTicker) : null),
    [selectedTicker, clusters]
  );
  // If the selected ticker no longer exists after filter change, clear it.
  useEffect(() => {
    if (selectedTicker && !clusters.some(c => c.ticker === selectedTicker)) {
      setSelectedTicker(null);
    }
  }, [selectedTicker, clusters]);

  function handleSelect(ticker) {
    setSelectedTicker(prev => prev === ticker ? null : ticker);
  }

  return (
    <div className="sm-panel">
      <PanelHeader
        title="OPTIONS / FLOW"
        updatedAt={lastUpdate}
        source="Unusual Whales"
        actions={(
          <button className="pp-header-btn" onClick={fetchData} title="Refresh">↻</button>
        )}
      />

      {/* Thesis — the one-line answer to "what is smart money doing?" */}
      <TapePostureBar posture={tape} />

      {/* Thesis lane — 3 derived signals (Phase 8.3) */}
      <ThesisLane items={filtered} clusters={clusters} />

      {/* Filter tabs */}
      <PanelTabRow
        equal
        value={activeTab}
        onChange={setActiveTab}
        items={TABS.map(t => ({
          id: t.key,
          label: t.label,
          count: counts[t.key] > 0 ? counts[t.key] : undefined,
        }))}
      />

      {/* Tile grid legend */}
      <div className="sm-clust-legend">
        <span className="sm-clust-legend-l">SENTIMENT BY TICKER</span>
        <span className="sm-clust-legend-r">click a tile for trade-level detail</span>
      </div>

      {/* Ticker tile grid — visual sentiment per ticker */}
      <div className="sm-tiles">
        {loading && topClusters.length === 0 ? (
          <div className="sm-empty">Loading smart-money signals…</div>
        ) : topClusters.length === 0 ? (
          <div className="sm-empty">No {activeTab === 'all' ? '' : activeTab + ' '}signals detected</div>
        ) : (
          topClusters.map(c => (
            <TickerTile
              key={c.ticker}
              cluster={c}
              selected={selectedTicker === c.ticker}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>

      {/* Drawer — detail rows for selected ticker */}
      {selectedCluster && (
        <DetailDrawer
          cluster={selectedCluster}
          onClose={() => setSelectedTicker(null)}
        />
      )}

      {/* Footer */}
      <div className="sm-footer">
        <span className="sm-footer-src">via Unusual Whales</span>
        <span className="sm-footer-count">
          {clusters.length} tickers · {counts.all} signals
        </span>
      </div>
    </div>
  );
}

/* ── Mobile wrapper ────────────────────────────────────────── */
// Phase 10.6 — Options Flow packs wide tables + clustered posture
// meters that don't work on a phone viewport. Swap in a branded
// "open on desktop" card instead of shipping a broken layout.
function OptionsFlowPanel() {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DesktopOnlyPlaceholder
        title="Options Flow"
        subtitle="Smart-money positioning, clustered by conviction"
        features={[
          'Tape posture (bullish / bearish / mixed) with net $ skew',
          'Ticker clusters ranked by confluence across OPT · DP · CON',
          'Unusual options, dark-pool prints, and Congress trades in one feed',
        ]}
      />
    );
  }
  return <OptionsFlowPanelInner />;
}

export default memo(OptionsFlowPanel);
