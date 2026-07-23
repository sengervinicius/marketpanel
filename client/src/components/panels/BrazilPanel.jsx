// BrazilPanel.jsx — B3 stocks via server Yahoo Finance proxy
// Phase 10: Removed bespoke polling loop; prices flow through PriceContext via PriceRow's
// ticker prop. The initial /api/snapshot/brazil fetch seeds the batch map, and PriceRow's
// useMergedTickerQuote handles fallback for any symbol not in the snapshot.
// CIO-note (2026-04-21): removed the inline USD/BRL/MIX revenue-mix pill.
// It was misread as a price-currency label (users thought VALE3 was quoted
// in USD). The underlying revenueMix field is still carried on the row
// object so AI context / drag metadata / detail pages can surface it with
// clearer wording, but we do NOT render a 3-char badge next to the name.
import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useSparklineData } from '../../hooks/useSparklineData';
import PanelConfigModal from '../common/PanelConfigModal';
import CountryOverview, { COUNTRY_OPTIONS } from './CountryOverview';
import './CountryOverview.css';
import EditablePanelHeader from '../common/EditablePanelHeader';
import PanelShell from '../common/PanelShell';
import { PriceRow } from '../common/PriceRow';
import ColumnHeaders from '../common/ColumnHeaders';
import { apiFetch } from '../../utils/api';
import { COLS_STANDARD_SPARK } from '../../utils/panelColumns';
import { useTickerPrice } from '../../context/PriceContext';
import { ADR_PAIRS, computeAdrPremium } from '../../utils/adrPremium';
import { useOverlay } from '../overlay/OverlayContext';
import Tape from '../common/Tape';
import { openDetailWindow } from '../../utils/detailWindow';
import { useTickerClicks } from '../../hooks/useTickerClicks';

// CIO-note (2026-04-20): was '52px 1fr 64px 52px' — CHG% of 52px crushed
// 2-digit % values into the price column (ONCO3 +15.33% case). The
// shared template reserves 76px for CHG% and 80px for price across the
// board so this bug cannot recur panel-by-panel.
const COLS = COLS_STANDARD_SPARK;

const SORT_COLS = [
  { key: 'symbol', label: 'TICKER', align: 'left' },
  { key: 'name',   label: 'NAME',   align: 'left' },
  { key: 'price',  label: 'PRICE',  align: 'right' },
  { key: 'chg',    label: 'CHG%',   align: 'right' },
];

/* ── Header tape (Phase S W1 item 3, mockup section 3) ───────────────
 * The four numbers of the Brazil day: IBOV · IFIX · SELIC/CDI ·
 * IPCA 12M vs Focus. Reuses the shared Tape primitive. IBOV/IFIX ride
 * PriceContext extras (^BVSP / ^IFIX with IFIX.SA fallback); SELIC, CDI
 * and IPCA 12M come from /api/market/brazil-macro (BCB SGS, 6h cache);
 * the FOCUS subtext reuses the already-fetched brazil-focus payload.
 * Every cell degrades independently to an em-dash.
 */
const BR_SECTIONS_KEY = 'brSections_v1'; // { b3, fii, adr } visibility

function loadBrSections() {
  try {
    const v = JSON.parse(localStorage.getItem(BR_SECTIONS_KEY));
    if (v && typeof v === 'object') {
      return { b3: v.b3 !== false, fii: v.fii !== false, adr: v.adr !== false };
    }
  } catch { /* corrupted / private mode */ }
  return { b3: true, fii: true, adr: true };
}

const brChipStyle = (on) => ({
  background: 'none',
  border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
  color: on ? 'var(--accent)' : 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  letterSpacing: '0.06em',
  padding: '1px 6px',
  borderRadius: 2,
  cursor: 'pointer',
});

const fmtIdx = (n) => (n == null || !Number.isFinite(n))
  ? '—'
  : n.toLocaleString('en-US', { maximumFractionDigits: n >= 10_000 ? 0 : 2 });
const fmtPctSigned = (n) => (n == null || !Number.isFinite(n))
  ? null
  : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const upDownColor = (n) => (n == null ? 'var(--text-faint)'
  : n >= 0 ? 'var(--semantic-up)' : 'var(--semantic-down)');

function BrazilTape({ macro, focus }) {
  const ibov = useTickerPrice('^BVSP');
  // IFIX: real index first; the IFIX.SA alias fills in when Yahoo doesn't
  // carry ^IFIX. Both ride the same extras batch — no extra endpoints.
  const ifix = useTickerPrice('^IFIX');
  const ifixAlt = useTickerPrice('IFIX.SA');
  const ifixQ = ifix?.price != null ? ifix : (ifixAlt?.price != null ? ifixAlt : null);

  const selic   = macro?.selic   ?? null;
  const cdi     = macro?.cdi     ?? null;
  const ipca12m = macro?.ipca12m ?? null;

  // FOCUS median for the current year's IPCA (already fetched for the strip).
  const focusYears = focus?.years || {};
  const curYear = String(new Date().getFullYear());
  const focusIpca = focusYears[curYear]?.ipca
    ?? focusYears[Object.keys(focusYears).sort()[0]]?.ipca
    ?? null;

  const cells = [
    {
      key: 'ibov', label: 'IBOV',
      value: ibov?.price != null ? fmtIdx(ibov.price) : null,
      delta: fmtPctSigned(ibov?.changePct),
      deltaColor: upDownColor(ibov?.changePct),
    },
    {
      key: 'ifix', label: 'IFIX',
      value: ifixQ ? fmtIdx(ifixQ.price) : null,
      delta: ifixQ ? fmtPctSigned(ifixQ.changePct) : null,
      deltaColor: upDownColor(ifixQ?.changePct),
    },
    {
      key: 'selic', label: 'SELIC',
      value: selic != null ? selic.toFixed(2) + '%' : null,
      delta: cdi != null ? `CDI ${cdi.toFixed(2)}` : null,
      deltaColor: 'var(--text-muted)',
    },
    {
      key: 'ipca', label: 'IPCA 12M',
      value: ipca12m != null ? ipca12m.toFixed(2) + '%' : null,
      delta: focusIpca != null ? `FOCUS ${focusIpca.toFixed(2)}` : null,
      // Focus below the trailing print = expected disinflation (green).
      deltaColor: focusIpca == null || ipca12m == null ? 'var(--text-muted)'
        : focusIpca < ipca12m ? 'var(--semantic-up)'
        : focusIpca > ipca12m ? 'var(--semantic-down)' : 'var(--text-muted)',
    },
  ];

  return (
    <Tape
      cells={cells}
      title="IBOV/IFIX via Yahoo · SELIC/CDI/IPCA 12M via BCB SGS · FOCUS = survey median"
    />
  );
}

/* ── FIIs section (Phase S W1 item 3) ────────────────────────────────
 * Fundos imobiliários with the FII investor's number — trailing DY% —
 * inline in gold (--vault-gold). Quotes ride the existing PriceContext
 * extras (.SA symbols); DY + display names come from /api/market/
 * fii-yields (brapi fundamentals, 12h server cache). List is editable
 * like every other section, persisted in settings.panels.brazilB3
 * (fiiSymbols).
 */
const DEFAULT_FII_SYMBOLS = ['HGLG11', 'KNRI11', 'MXRF11', 'XPML11', 'VISC11', 'BTLG11'];
const FII_COLS = '56px 1fr 72px 60px 62px';

const fiiStyles = {
  sechead: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '3px 8px', fontFamily: 'var(--font-mono)', fontSize: 9.5,
    fontWeight: 700, letterSpacing: '0.08em', color: 'var(--section-brazil)',
    borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)',
    background: 'var(--bg-surface)',
  },
  editBtn: (on) => ({
    marginLeft: 'auto', background: 'none',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
    color: on ? 'var(--accent)' : 'var(--text-muted)', fontSize: 9,
    padding: '0 5px', cursor: 'pointer', borderRadius: 2,
    fontFamily: 'var(--font-mono)', letterSpacing: '0.05em',
  }),
  row: {
    display: 'grid', gridTemplateColumns: FII_COLS, gap: 4,
    padding: '2px 8px', fontFamily: 'var(--font-mono)', fontSize: 11,
    alignItems: 'baseline', cursor: 'pointer',
  },
  right: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  addForm: { display: 'flex', gap: 4, padding: '3px 8px', borderBottom: '1px solid var(--border-subtle)' },
  addInput: {
    flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)',
    color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 10,
    padding: '1px 6px', borderRadius: 2, minWidth: 0,
  },
};

const fmt2fii = (n) => (n == null || !Number.isFinite(n))
  ? '—'
  : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function FiiRow({ sym, meta, editMode, onRemove, onTickerClick, openDetail }) {
  // wave-nov item 5 — see hooks/useTickerClicks.js
  const rowClicks = useTickerClicks(`${sym}.SA`, { onSingle: (t) => onTickerClick?.(t) });
  const quote = useTickerPrice(sym + '.SA');
  const chg = quote?.changePct ?? null;
  return (
    <div
      style={fiiStyles.row}
      title={`${meta?.name || sym} — DY = trailing dividend yield (brapi fundamentals)`}
      {...rowClicks}
      data-ticker={sym + '.SA'}
      data-ticker-label={meta?.name || sym}
      data-ticker-type="FII"
    >
      <span style={{ color: 'var(--section-brazil)', fontWeight: 600 }}>{sym}</span>
      <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {meta?.name || ''}
      </span>
      <span style={{ ...fiiStyles.right, color: 'var(--text-primary)' }}>{fmt2fii(quote?.price)}</span>
      <span style={{ ...fiiStyles.right, color: 'var(--vault-gold)', fontWeight: 600 }}>
        {meta?.dy != null ? `DY ${meta.dy.toFixed(1)}%` : '—'}
      </span>
      <span style={{ ...fiiStyles.right, color: upDownColor(chg) }}>
        {editMode ? (
          <button
            style={{ background: 'none', border: 'none', color: 'var(--semantic-down)', cursor: 'pointer', fontSize: 11, padding: 0 }}
            title={`Remove ${sym}`}
            onClick={(e) => { e.stopPropagation(); onRemove(sym); }}
          >✕</button>
        ) : (fmtPctSigned(chg) ?? '—')}
      </span>
    </div>
  );
}

function FiiSection({ symbols, onChangeSymbols, onTickerClick, openDetail }) {
  const [editMode, setEditMode] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [yields, setYields] = useState({}); // SYM -> { dy, name }

  const symbolsKey = symbols.join(',');
  useEffect(() => {
    if (!symbolsKey) return undefined;
    let alive = true;
    apiFetch(`/api/market/fii-yields?symbols=${encodeURIComponent(symbolsKey)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.ok && j.data) setYields(j.data); })
      .catch(() => { /* DY cells degrade to em-dash */ });
    return () => { alive = false; };
  }, [symbolsKey]);

  const handleAdd = (e) => {
    e.preventDefault();
    const sym = addInput.trim().toUpperCase().replace(/\.SA$/, '');
    if (sym && /^[A-Z]{4}\d{1,2}[A-Z]?$/.test(sym) && !symbols.includes(sym)) {
      onChangeSymbols([...symbols, sym]);
    }
    setAddInput('');
  };

  return (
    <>
      <div style={fiiStyles.sechead}>
        FIIs · DY%
        <button
          style={fiiStyles.editBtn(editMode)}
          onClick={() => setEditMode(v => !v)}
          title="Edit the FII list"
        >{editMode ? 'DONE' : 'EDIT'}</button>
      </div>
      {editMode && (
        <form style={fiiStyles.addForm} onSubmit={handleAdd}>
          <input
            style={fiiStyles.addInput}
            value={addInput}
            onChange={e => setAddInput(e.target.value.toUpperCase())}
            placeholder="Add FII, e.g. HGRU11"
          />
          <button className="btn" type="submit" style={fiiStyles.editBtn(false)}>ADD</button>
        </form>
      )}
      {symbols.map(sym => (
        <FiiRow
          key={sym}
          sym={sym}
          meta={yields[sym] || null}
          editMode={editMode}
          onRemove={(rm) => onChangeSymbols(symbols.filter(x => x !== rm))}
          onTickerClick={onTickerClick}
          openDetail={openDetail}
        />
      ))}
    </>
  );
}

// H2b item 4 — BCB Focus survey strip (Selic / IPCA / PIB / FX medians
// for current + next year). Hidden entirely when /api/market/brazil-focus
// is degraded; per-field em-dash when a single indicator is missing.
const focusStyles = {
  strip: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '2px 8px',
    borderBottom: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)',
    fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
    overflowX: 'auto', flexShrink: 0,
  },
  tag: { fontWeight: 700, letterSpacing: '0.08em', color: 'var(--sector-brazil)' },
  item: { display: 'inline-flex', gap: 3, alignItems: 'baseline' },
  label: { color: 'var(--text-faint)', fontSize: 9, letterSpacing: '0.05em' },
  value: { color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  sep: { color: 'var(--text-faint)' },
  yearBtn: {
    marginLeft: 'auto', background: 'none', border: '1px solid var(--border-strong)',
    color: 'var(--text-muted)', fontSize: 9, padding: '0 5px', cursor: 'pointer',
    borderRadius: 2, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', flexShrink: 0,
  },
};

function fmtFocus(v, digits = 2, suffix = '') {
  return v == null ? '—' : v.toFixed(digits) + suffix;
}

function FocusStrip({ focus }) {
  const yearKeys = useMemo(
    () => (focus ? Object.keys(focus.years || {}).sort() : []),
    [focus]
  );
  const [yearIdx, setYearIdx] = useState(0);
  if (!focus || yearKeys.length === 0) return null;

  const year = yearKeys[Math.min(yearIdx, yearKeys.length - 1)];
  const d = focus.years[year] || {};
  const hasAny = ['selic', 'ipca', 'pib', 'fx'].some(k => d[k] != null);
  if (!hasAny && yearKeys.length === 1) return null;

  const items = [
    ['SELIC', fmtFocus(d.selic, 2, '%')],
    ['IPCA',  fmtFocus(d.ipca, 2, '%')],
    ['PIB',   fmtFocus(d.pib, 1, '%')],
    ['FX',    fmtFocus(d.fx, 2)],
  ];

  return (
    <div
      style={focusStyles.strip}
      title={`BCB Focus survey medians${focus.referenceDate ? ` · ${focus.referenceDate}` : ''}`}
    >
      <span style={focusStyles.tag}>FOCUS {year.slice(2)}</span>
      {items.map(([label, value], i) => (
        <span key={label} style={focusStyles.item}>
          {i > 0 && <span style={focusStyles.sep}>·</span>}
          <span style={focusStyles.label}>{label}</span>
          <span style={focusStyles.value}>{value}</span>
        </span>
      ))}
      {yearKeys.length > 1 && (
        <button
          style={focusStyles.yearBtn}
          onClick={() => setYearIdx(i => (i + 1) % yearKeys.length)}
          title="Toggle reference year"
        >
          {yearKeys[(yearIdx + 1) % yearKeys.length].slice(2)} ›
        </button>
      )}
    </div>
  );
}

/* ── ADR premium section (P2 item 3) ─────────────────────────────────
 * Columns: ADR · LAST USD · LOCAL (BRL) · PREMIUM%.
 * premium% = (adrUSD / (localBRL × ratio / USDBRL) − 1) × 100, with the
 * ratio = local shares per ADR (see utils/adrPremium.js). Everything is
 * computed client-side from data already on the page: the B3 snapshot
 * (local legs), PriceContext extras (ADR quotes) and the FX snapshot
 * (USDBRL). Any missing leg or unknown ratio renders "—" — NEVER a
 * wrong number.
 */
const ADR_COLS = '52px 1fr 72px 72px 76px';
const ADR_PREMIUM_HIGHLIGHT_PCT = 1.5; // mockup note 3 — accent threshold

const adrStyles = {
  headerRow: {
    display: 'grid', gridTemplateColumns: ADR_COLS, gap: 4,
    padding: '2px 8px', fontFamily: 'var(--font-mono)', fontSize: 9,
    color: 'var(--text-faint)', letterSpacing: '0.06em',
    borderBottom: '1px solid var(--border-subtle)',
  },
  row: {
    display: 'grid', gridTemplateColumns: ADR_COLS, gap: 4,
    padding: '2px 8px', fontFamily: 'var(--font-mono)', fontSize: 11,
    alignItems: 'baseline', cursor: 'pointer',
  },
  right: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
};

const fmt2adr = (n) => (n == null || !Number.isFinite(n))
  ? '—'
  : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function AdrRow({ pair, localQuote, onTickerClick, openDetail }) {
  // wave-nov item 5 — see hooks/useTickerClicks.js
  const rowClicks = useTickerClicks(pair.adr, { onSingle: (t) => onTickerClick?.(t) });
  // ADR leg via PriceContext (batch-first, extras fallback). Local leg
  // prefers the already-loaded B3 snapshot; falls back to extras too.
  const adrQuote = useTickerPrice(pair.adr);
  const localCtx = useTickerPrice(localQuote?.price != null ? null : pair.local + '.SA');
  const usdbrl = useTickerPrice('C:USDBRL');

  const adrUsd = adrQuote?.price ?? null;
  const localBrl = localQuote?.price ?? localCtx?.price ?? null;
  const fx = usdbrl?.price ?? null;
  const premium = computeAdrPremium(adrUsd, localBrl, pair.ratio, fx);

  // Phase S W1 item 3 (mockup note 3): |premium| >= 1.5% is an actionable
  // dislocation — highlight in accent instead of the routine up/down tint.
  const premColor = premium == null ? 'var(--text-faint)'
    : Math.abs(premium) >= ADR_PREMIUM_HIGHLIGHT_PCT ? 'var(--accent)'
    : premium >= 0 ? 'var(--semantic-up)' : 'var(--semantic-down)';

  return (
    <div
      style={adrStyles.row}
      title={`${pair.name} — 1 ${pair.adr} = ${pair.ratio} × ${pair.local}. Premium vs B3 line via USD/BRL.`}
      {...rowClicks}
      data-ticker={pair.adr}
      data-ticker-label={pair.name}
      data-ticker-type="ADR"
    >
      <span style={{ color: 'var(--section-brazil)', fontWeight: 600 }}>{pair.adr}</span>
      <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pair.name}</span>
      <span style={{ ...adrStyles.right, color: 'var(--text-primary)' }}>{fmt2adr(adrUsd)}</span>
      <span style={{ ...adrStyles.right, color: 'var(--text-secondary)' }}>{fmt2adr(localBrl)}</span>
      <span style={{ ...adrStyles.right, color: premColor, fontWeight: 600 }}>
        {premium == null ? '—' : (premium >= 0 ? '+' : '') + premium.toFixed(2) + '%'}
      </span>
    </div>
  );
}

function AdrPremiumSection({ batchMap, onTickerClick, openDetail }) {
  return (
    <>
      <div style={{
        padding: '3px 8px', fontFamily: 'var(--font-mono)', fontSize: 9.5,
        fontWeight: 700, letterSpacing: '0.08em', color: 'var(--section-brazil)',
        borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
      }}>
        BRAZIL ADRs · PREMIUM vs B3
      </div>
      <div style={adrStyles.headerRow}>
        <span>ADR</span>
        <span>NAME</span>
        <span style={adrStyles.right}>LAST USD</span>
        <span style={adrStyles.right}>LOCAL</span>
        <span style={adrStyles.right}>PREMIUM%</span>
      </div>
      {ADR_PAIRS.map(pair => (
        <AdrRow
          key={pair.adr}
          pair={pair}
          localQuote={batchMap[pair.local] || null}
          onTickerClick={onTickerClick}
          openDetail={openDetail}
        />
      ))}
    </>
  );
}

function BrazilPanel({ onTickerClick }) {
  const openDetail = useOpenDetail();
  // Phase S §4 — title click opens the Brazil deep-view overlay.
  const { open: openOverlay } = useOverlay();
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();

  // Panel config from settings (with fallback defaults)
  const panelCfg = settings?.panels?.brazilB3 || {
    title: 'Brazil B3',
    symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA'],
  };
  const panelTitle   = panelCfg.title   || 'Brazil B3';
  const panelSymbols = panelCfg.symbols || [];
  const country = panelCfg.country || 'BR';

  // Snapshot from server — used to seed names and initial prices.
  // PriceRow handles live updates via PriceContext's ticker prop.
  const [snapshot, setSnapshot]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [lastUpdate, setLastUpdate]   = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [configOpen, setConfigOpen]   = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [collapsed, setCollapsed]     = useState(false);
  const [sortKey, setSortKey]         = useState(null);
  const [sortDir, setSortDir]         = useState('desc');

  // Phase 2: Sparkline data for Brazil tickers
  const brazilTickers = useMemo(() => panelSymbols.map(sym => sym.endsWith('.SA') ? sym : sym + '.SA'), [panelSymbols]);
  const sparklines = useSparklineData(brazilTickers);

  // H2b item 4 — BCB Focus strip (server caches 6h; hidden on failure)
  const [focus, setFocus] = useState(null);
  useEffect(() => {
    let alive = true;
    apiFetch('/api/market/brazil-focus')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.ok && j.years) setFocus(j); })
      .catch(() => { /* strip stays hidden */ });
    return () => { alive = false; };
  }, []);

  // Phase S W1 item 3 — SELIC/CDI/IPCA 12M for the header tape (BCB SGS,
  // server caches 6h; cells degrade to em-dash on failure).
  const [macro, setMacro] = useState(null);
  useEffect(() => {
    let alive = true;
    apiFetch('/api/market/brazil-macro')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.ok) setMacro(j); })
      .catch(() => { /* tape cells degrade */ });
    return () => { alive = false; };
  }, []);

  // Phase S W1 item 3 — B3 / FIIs / ADRs section visibility chips (persisted).
  const [brSections, setBrSections] = useState(loadBrSections);
  const toggleBrSection = useCallback((key) => {
    setBrSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(BR_SECTIONS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  // FII list — editable like every other section, persisted in the panel cfg.
  const fiiSymbols = panelCfg.fiiSymbols || DEFAULT_FII_SYMBOLS;
  const handleFiiChange = useCallback((next) => {
    updatePanelConfig('brazilB3', { ...panelCfg, title: panelTitle, symbols: panelSymbols, fiiSymbols: next });
  }, [panelCfg, panelTitle, panelSymbols, updatePanelConfig]);

  // Update lastUpdated when snapshot changes
  useEffect(() => {
    if (snapshot.length > 0) {
      setLastUpdated(new Date());
    }
  }, [snapshot]);

  const handleDropTicker = (ticker) => {
    const sym = ticker.trim().toUpperCase();
    const withSA = sym.endsWith('.SA') ? sym : sym + '.SA';
    if (!panelSymbols.includes(withSA) && !panelSymbols.includes(sym)) {
      updatePanelConfig('brazilB3', { title: panelTitle, symbols: [...panelSymbols, withSA] });
    }
  };

  const handleSortClick = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // Fetch snapshot once + refresh every 30s (just for metadata/names; PriceContext handles live prices)
  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/snapshot/brazil');
      if (!res.ok) throw new Error('server ' + res.status);
      const json = await res.json();
      if (!json.results?.length) throw new Error('no results');
      setSnapshot(json.results.map(s => ({
        symbol:     s.symbol,
        name:       s.name || s.symbol,
        price:      s.price,
        change:     s.change,
        changePct:  s.changePct,
        volume:     s.volume,
        // Phase 9.5 metadata — carried through so the revenue-mix pill
        // can render without a second fetch.
        sector:     s.sector     || null,
        capTier:    s.capTier    || null,
        revenueMix: s.revenueMix || null,
      })));
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000); // metadata refresh (PriceContext handles live)
    return () => clearInterval(id);
  }, [fetchData]);

  // Build a batchMap keyed by both bare symbol and .SA symbol for PriceRow lookup
  const batchMap = useMemo(() => {
    const m = {};
    snapshot.forEach(s => {
      m[s.symbol] = s;
      m[s.symbol + '.SA'] = s;
      // Also keyed without .SA if it has it
      if (s.symbol.endsWith('.SA')) {
        m[s.symbol.replace('.SA', '')] = s;
      }
    });
    return m;
  }, [snapshot]);

  // Filter displayed rows to only the configured symbols (preserving order)
  let displayedStocks = panelSymbols.length > 0
    ? panelSymbols
        .map(sym => {
          const baseSym = sym.replace(/\.SA$/i, '');
          return snapshot.find(s => s.symbol === baseSym || s.symbol === sym)
            || { symbol: baseSym, name: baseSym, price: null, changePct: null }; // placeholder for PriceContext
        })
    : snapshot;

  // Apply search filter
  if (searchFilter) {
    const sq = searchFilter.toLowerCase();
    displayedStocks = displayedStocks.filter(s =>
      s.symbol.toLowerCase().includes(sq) || s.name.toLowerCase().includes(sq)
    );
  }

  // Apply sorting — uses batchMap for sort values; PriceContext extras aren't in the map
  // but that's acceptable since batch data IS the same source as PriceContext
  if (sortKey) {
    displayedStocks = [...displayedStocks].sort((a, b) => {
      let va, vb;
      const da = batchMap[a.symbol] || {};
      const db = batchMap[b.symbol] || {};
      if (sortKey === 'symbol') { va = a.symbol; vb = b.symbol; }
      else if (sortKey === 'name') { va = a.name; vb = b.name; }
      else if (sortKey === 'price') { va = da.price ?? -Infinity; vb = db.price ?? -Infinity; }
      else if (sortKey === 'chg')   { va = da.changePct ?? -Infinity; vb = db.changePct ?? -Infinity; }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }

  const badge = error
    ? <span style={{ color: 'var(--price-down)', fontSize: 'var(--font-xs)' }}>{error}</span>
    : lastUpdate && <span style={{ color: 'var(--text-faint)', fontSize: 'var(--font-xs)' }}>{lastUpdate.toLocaleTimeString()}</span>;

  const countrySelect = (
    <select
      className="co-country-select"
      value={country}
      onChange={(e) => updatePanelConfig('brazilB3', { ...panelCfg, country: e.target.value })}
      title="Choose the country shown in this box"
    >
      {COUNTRY_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
    </select>
  );

  // In-Depth Country Box: Brazil keeps its bespoke rich panel; any other
  // country renders the self-contained CountryOverview (Brazil path untouched).
  if (country !== 'BR') {
    return <CountryOverview country={country} countrySelect={countrySelect} onTickerClick={onTickerClick} />;
  }

  return (
    <PanelShell onDropTicker={handleDropTicker}>
      {/* Header */}
      <EditablePanelHeader
        title={panelTitle}
        onTitleClick={() => openOverlay('brazil')}
        onTitleChange={(t) => updatePanelConfig('brazilB3', { title: t, symbols: panelSymbols })}
        onConfigOpen={() => setConfigOpen(true)}
        onDropTicker={handleDropTicker}
        onSearchChange={setSearchFilter}
        feedBadge={badge}
        lastUpdated={lastUpdated}
        source="Yahoo/BCB"
      >
        {countrySelect}
        {/* Phase S W1 item 3 — section visibility chips (persisted) */}
        <button className="btn" style={brChipStyle(brSections.b3)} onClick={() => toggleBrSection('b3')} title="Show/hide the B3 names section">B3</button>
        <button className="btn" style={brChipStyle(brSections.fii)} onClick={() => toggleBrSection('fii')} title="Show/hide the FIIs section">FIIs</button>
        <button className="btn" style={brChipStyle(brSections.adr)} onClick={() => toggleBrSection('adr')} title="Show/hide the ADR premium section">ADRs</button>
        <button className="btn"
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ background: 'none', border: '1px solid var(--border-strong)', color: 'var(--text-muted)', fontSize: 9, padding: '1px 5px' }}
        >{collapsed ? '+' : '−'}</button>
      </EditablePanelHeader>

      {!collapsed && (<>
        {/* Phase S W1 item 3 — header tape: IBOV · IFIX · SELIC/CDI · IPCA vs Focus */}
        <BrazilTape macro={macro} focus={focus} />

        {/* BCB Focus strip (H2b) — hides itself when the endpoint degrades */}
        <FocusStrip focus={focus} />

        {/* Column headers */}
        {brSections.b3 && (
          <ColumnHeaders
            columns={SORT_COLS}
            gridColumns={COLS}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortClick={handleSortClick}
          />
        )}

        {/* Rows */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {brSections.b3 && loading && !snapshot.length && (
            <div style={{ padding: 'var(--sp-5)', color: 'var(--text-muted)', textAlign: 'center' }}>LOADING...</div>
          )}
          {brSections.b3 && !loading && !error && !displayedStocks.length && (
            <div style={{ padding: 'var(--sp-5)', color: 'var(--text-faint)', textAlign: 'center', fontSize: 11 }}>Loading B3 data...</div>
          )}
          {brSections.b3 && displayedStocks.map(s => {
            const sym = s.symbol.endsWith('.SA') ? s.symbol : s.symbol + '.SA';
            const displaySym = s.symbol.replace('.SA', '');
            const d = batchMap[s.symbol] || {};
            // revenueMix is still carried on row objects + drag metadata
            // so AI context and the instrument-detail pane can use it;
            // we just don't render the inline 3-char pill anymore.
            const mix = d.revenueMix || s.revenueMix || null;
            return (
              <PriceRow
                key={sym}
                symbol={sym}
                ticker={sym}
                displaySymbol={displaySym}
                name={s.name}
                price={d.price}
                changePct={d.changePct}
                symbolColor="var(--section-brazil)"
                columns={COLS}
                draggable
                dragData={{ symbol: sym, name: s.name || s.symbol, type: 'BR', revenueMix: mix }}
                onClick={() => onTickerClick?.(sym)}
                onDoubleClick={() => openDetailWindow(sym)}
                onTouchHold={() => openDetail(sym)}
                touchRef={ptRef}
                sparklineData={sparklines[sym]}
                dataAttrs={{
                  'data-ticker': sym,
                  'data-ticker-label': s.name || s.symbol,
                  'data-ticker-type': 'BR',
                  'data-revenue-mix': mix || '',
                }}
              />
            );
          })}

          {/* Phase S W1 item 3 — FIIs with the DY% in gold */}
          {brSections.fii && (
            <FiiSection
              symbols={fiiSymbols}
              onChangeSymbols={handleFiiChange}
              onTickerClick={onTickerClick}
              openDetail={openDetail}
            />
          )}

          {/* P2 item 3 — ADR premium view (moved here from StockPanel) */}
          {brSections.adr && (
            <AdrPremiumSection batchMap={batchMap} onTickerClick={onTickerClick} openDetail={openDetail} />
          )}
        </div>
      </>)}

      {/* Panel config modal */}
      {configOpen && (
        <PanelConfigModal
          panelId="brazilB3"
          currentTitle={panelTitle}
          currentSymbols={panelSymbols}
          assetClasses={['equity']}
          onSave={({ title, symbols }) => {
            // Preserve the FII list (Phase S W1 item 3) — the config modal
            // only edits the B3 names section.
            updatePanelConfig('brazilB3', { ...panelCfg, title, symbols });
            setConfigOpen(false);
          }}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </PanelShell>
  );
}


export { BrazilPanel };
export default memo(BrazilPanel);
