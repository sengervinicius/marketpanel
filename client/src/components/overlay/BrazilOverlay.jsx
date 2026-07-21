/**
 * BrazilOverlay — the Brazil deep view (Phase S design review §4).
 *
 * MARKETS tab: the approved 6-cell grid —
 *   B3 MOVERS · DI CURVE · FX & FLOWS · ADR PREMIUM BOARD ·
 *   FOCUS CONSENSUS · CVM FILINGS (YOUR NAMES)
 * RATES tab:   the DI/Tesouro curve rendered large + Tesouro table.
 * FILINGS tab: the full CVM IPE list for the user's B3 names.
 *
 * Every cell is an existing server data source; cells with no source
 * (CDS 5Y, B3 foreign flow) render an honest "—  NO SOURCE" rather than
 * a fabricated number. Mockup note 1: "every cell is an existing data
 * source, finally in one Brazil room."
 */
import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../utils/api';
import { swallow } from '../../utils/swallow';
import { useSettings } from '../../context/SettingsContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { ADR_PAIRS, computeAdrPremium } from '../../utils/adrPremium';
import CurveChart from './CurveChart';

const ADR_PREMIUM_HIGHLIGHT_PCT = 1.5; // same threshold as BrazilPanel (mockup note 3)
const DEFAULT_BR_SYMBOLS = ['VALE3.SA', 'PETR4.SA', 'ITUB4.SA', 'BBDC4.SA', 'ABEV3.SA', 'WEGE3.SA', 'RENT3.SA'];

const fmt2 = (n) => (n == null || !Number.isFinite(n))
  ? '—'
  : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => (n == null || !Number.isFinite(n)) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const pctClass = (n) => (n == null ? 'ol-dim' : n >= 0 ? 'ol-up' : 'ol-down');

/** Small JSON fetch hook: { data, error, loading }. */
function useJson(url) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    setState({ data: null, error: null, loading: true });
    apiFetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(j => { if (alive) setState({ data: j, error: null, loading: false }); })
      .catch(e => { if (alive) setState({ data: null, error: e.message, loading: false }); });
    return () => { alive = false; };
  }, [url]);
  return state;
}

/** The user's B3 names (BrazilPanel config), bare tickers. */
function useBrazilSymbols() {
  const { settings } = useSettings();
  return useMemo(() => {
    const syms = settings?.panels?.brazilB3?.symbols || DEFAULT_BR_SYMBOLS;
    return [...new Set(syms.map(s => s.replace(/\.SA$/i, '').toUpperCase()))];
  }, [settings]);
}

function Cell({ title, note, children }) {
  return (
    <div className="ol-cell">
      <div className="ol-cell-h">{title}{note ? <span className="ol-cell-note">{note}</span> : null}</div>
      {children}
    </div>
  );
}

/* ── MARKETS cells ──────────────────────────────────────────────────── */

function MoversCell() {
  const gain = useJson('/api/market/movers?tab=gainers&exchange=BR&limit=4');
  const lose = useJson('/api/market/movers?tab=losers&exchange=BR&limit=4');
  const openDetail = useOpenDetail();
  const rows = [
    ...(gain.data?.data || []),
    ...(lose.data?.data || []),
  ];
  return (
    <Cell title="B3 MOVERS" note="quality-filtered">
      {gain.loading && lose.loading ? <div className="ol-placeholder">LOADING…</div>
        : rows.length === 0 ? <div className="ol-placeholder">— B3 movers unavailable</div>
        : rows.map(m => (
          <div key={m.symbol} className="ol-row" style={{ cursor: 'pointer' }}
            onClick={() => openDetail(m.symbol.endsWith('.SA') ? m.symbol : m.symbol + '.SA')}>
            <span className="sym">{m.symbol.replace(/\.SA$/, '')}</span>
            <span>
              <span className="num">{fmt2(m.price)}</span>{' '}
              <span className={pctClass(m.changePct)}>{fmtPct(m.changePct)}</span>
            </span>
          </div>
        ))}
    </Cell>
  );
}

function DiCurveCell({ curves }) {
  const br = curves?.BR;
  return (
    <Cell title="DI CURVE" note={br?.source ? `· ${br.source}` : null}>
      {!br?.curve?.length ? <div className="ol-placeholder">— curve unavailable</div> : (
        <>
          <CurveChart
            compact
            height={110}
            series={[{ id: 'BR', label: 'BR', color: 'var(--accent)', points: br.curve }]}
          />
          {/* Honest note: the server has no stored BR curve history, so a
              Δ1D/1M ghost line cannot be drawn (US-only today). */}
          <div className="ol-placeholder">Δ1D ghost n/a — no BR curve history source (today's Tesouro/DI curve only)</div>
        </>
      )}
    </Cell>
  );
}

function FxFlowsCell() {
  const usdbrl = useTickerPrice('C:USDBRL');
  const ptax = useJson('/api/market/fx-ptax');
  const mid = ptax.data?.ptax?.mid ?? null;
  const bulletin = ptax.data?.ptax?.bulletin || null;
  return (
    <Cell title="FX & FLOWS">
      <div className="ol-mini">
        <div className="ol-row">
          <span className="sym">USDBRL</span>
          <span><span className="num">{fmt2(usdbrl?.price)}</span> <span className={pctClass(usdbrl?.changePct)}>{fmtPct(usdbrl?.changePct)}</span></span>
        </div>
        <div className="ol-row">
          <span className="sym">PTAX<span className="nm">{bulletin ? bulletin.toUpperCase() : 'BCB'}</span></span>
          <span className="num">{fmt2(mid)}</span>
        </div>
        <div className="ol-row">
          <span className="sym">CDS 5Y</span>
          <span className="ol-dim">— NO SOURCE</span>
        </div>
        <div className="ol-row">
          <span className="sym">B3 FOREIGN FLOW</span>
          <span className="ol-dim">— NO SOURCE</span>
        </div>
        <div className="ol-placeholder">CDS + B3 flow have no wired provider yet — shown as gaps, not guesses.</div>
      </div>
    </Cell>
  );
}

function AdrRow({ pair }) {
  const adrQuote = useTickerPrice(pair.adr);
  const localQuote = useTickerPrice(pair.local + '.SA');
  const usdbrl = useTickerPrice('C:USDBRL');
  const premium = computeAdrPremium(adrQuote?.price ?? null, localQuote?.price ?? null, pair.ratio, usdbrl?.price ?? null);
  const premColor = premium == null ? 'var(--text-faint)'
    : Math.abs(premium) >= ADR_PREMIUM_HIGHLIGHT_PCT ? 'var(--accent)'
    : premium >= 0 ? 'var(--color-up)' : 'var(--color-down)';
  return (
    <div className="ol-row" title={`1 ${pair.adr} = ${pair.ratio} × ${pair.local}`}>
      <span className="sym">{pair.adr}<span className="nm">{pair.ratio}×{pair.local}</span></span>
      <span>
        <span className="num">{fmt2(adrQuote?.price)}</span>{' '}
        <span style={{ color: premColor, fontWeight: 600 }}>{premium == null ? '—' : fmtPct(premium)}</span>
      </span>
    </div>
  );
}

function AdrBoardCell() {
  return (
    <Cell title="ADR PREMIUM BOARD" note={`accent ≥ ${ADR_PREMIUM_HIGHLIGHT_PCT}%`}>
      {ADR_PAIRS.map(p => <AdrRow key={p.adr} pair={p} />)}
    </Cell>
  );
}

function FocusCell() {
  const { data, loading } = useJson('/api/market/brazil-focus');
  const years = data?.ok && data.years ? Object.keys(data.years).sort() : [];
  const fmtF = (v, dp = 2) => (v == null ? '—' : Number(v).toFixed(dp));
  return (
    <Cell title="FOCUS CONSENSUS" note={data?.referenceDate ? `· BCB ${data.referenceDate}` : '· BCB'}>
      {loading ? <div className="ol-placeholder">LOADING…</div>
        : !years.length ? <div className="ol-placeholder">— Focus survey unavailable</div>
        : (
          <table className="ol-table">
            <thead>
              <tr><th> </th>{years.map(y => <th key={y}>{y}YE</th>)}</tr>
            </thead>
            <tbody>
              {[['SELIC', 'selic'], ['IPCA', 'ipca'], ['PIB', 'pib'], ['FX', 'fx']].map(([label, k]) => (
                <tr key={k}>
                  <td className="strong">{label}</td>
                  {years.map(y => <td key={y}>{fmtF(data.years[y]?.[k])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Cell>
  );
}

function CvmCell({ setTab }) {
  const symbols = useBrazilSymbols();
  const { data, loading } = useJson(`/api/market/cvm-filings?symbols=${encodeURIComponent(symbols.join(','))}&limit=3`);
  const filings = (data?.ok && data.filings) || [];
  return (
    <Cell title="CVM FILINGS · YOUR NAMES" note="· IPE · 1h cache">
      {loading ? <div className="ol-placeholder">LOADING…</div>
        : !filings.length ? <div className="ol-placeholder">— no recent filings for your names{data?.error ? ` (${data.error})` : ''}</div>
        : filings.slice(0, 6).map((f, i) => (
          <div key={i} className="ol-row">
            <span className="sym">{f.ticker}<span className="nm">{f.type || f.category}</span></span>
            <span className="ol-dim num">{f.date}</span>
          </div>
        ))}
      <button
        type="button"
        className="ol-chip"
        style={{ marginTop: 6 }}
        onClick={() => setTab?.('FILINGS')}
      >FULL LIST →</button>
    </Cell>
  );
}

/* ── Tabs ───────────────────────────────────────────────────────────── */

function MarketsTab({ curves, setTab }) {
  return (
    <div className="ol-grid">
      <MoversCell />
      <DiCurveCell curves={curves} />
      <FxFlowsCell />
      <AdrBoardCell />
      <FocusCell />
      <CvmCell setTab={setTab} />
    </div>
  );
}

function RatesTab({ curves }) {
  const br = curves?.BR;
  const points = br?.curve || [];
  return (
    <div>
      <div className="ol-sechead">DI / TESOURO PREFIXADO CURVE{br?.source ? ` · ${br.source.toUpperCase()}` : ''}</div>
      {points.length ? (
        <CurveChart height={260} series={[{ id: 'BR', label: 'BRAZIL', color: 'var(--accent)', points }]} />
      ) : <div className="ol-placeholder">— curve unavailable</div>}

      <div className="ol-sechead">TESOURO DIRETO · PREFIXADO LADDER</div>
      {points.length ? (
        <table className="ol-table" style={{ maxWidth: 560 }}>
          <thead>
            <tr><th>TENOR</th><th>MATURITY</th><th>RATE % A.A.</th></tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <td className="strong">{p.tenor}</td>
                <td>{p.maturity || (p.tenor === 'DI' ? 'O/N (SELIC META)' : '—')}</td>
                <td className="strong">{Number.isFinite(p.rate) ? p.rate.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="ol-placeholder">— Tesouro data unavailable</div>}
    </div>
  );
}

function FilingsTab() {
  const symbols = useBrazilSymbols();
  const { data, loading } = useJson(`/api/market/cvm-filings?symbols=${encodeURIComponent(symbols.join(','))}&limit=15`);
  const filings = (data?.ok && data.filings) || [];
  return (
    <div>
      <div className="ol-sechead">CVM IPE FILINGS · {symbols.join(' · ')}</div>
      {data?.note ? <div className="ol-placeholder">{data.note}</div> : null}
      {loading ? <div className="ol-placeholder">LOADING…</div>
        : !filings.length ? <div className="ol-placeholder">— no filings found for your names{data?.error ? ` (${data.error})` : ''}</div>
        : (
          <table className="ol-table">
            <thead>
              <tr><th>DATE</th><th>TICKER</th><th>CATEGORY</th><th style={{ textAlign: 'left' }}>SUBJECT</th></tr>
            </thead>
            <tbody>
              {filings.map((f, i) => (
                <tr key={i}>
                  <td>{f.date}</td>
                  <td className="strong">{f.ticker}</td>
                  <td>{f.category || f.type || '—'}</td>
                  <td style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                    {f.link
                      ? <a href={f.link} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{f.subject || '(no subject)'}</a>
                      : (f.subject || '(no subject)')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {data?.unresolved?.length ? (
        <div className="ol-placeholder">Not in the CVM ticker table (no CNPJ mapping): {data.unresolved.join(', ')}</div>
      ) : null}
    </div>
  );
}

export default function BrazilOverlay({ tab, setTab }) {
  // Yield curves are shared by the MARKETS DI cell and the RATES tab —
  // fetch once at the overlay root (server caches; 10min client refresh
  // is unnecessary for an ephemeral room).
  const [curves, setCurves] = useState(null);
  useEffect(() => {
    let alive = true;
    apiFetch('/api/yield-curves')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j && !j.error) setCurves(j); })
      .catch(e => swallow(e, 'overlay.brazil.curves'));
    return () => { alive = false; };
  }, []);

  if (tab === 'RATES')   return <RatesTab curves={curves} />;
  if (tab === 'FILINGS') return <FilingsTab />;
  return <MarketsTab curves={curves} setTab={setTab} />;
}
