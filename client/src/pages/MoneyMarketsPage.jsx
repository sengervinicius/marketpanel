/**
 * MoneyMarketsPage.jsx — Treasury & Money Markets, one country per window.
 * Route: /money/:cc  (opened from the Rates & Credit panel: double-click a
 * country row, or the ⤢ MONEY MKTS control; also /?money=BR).
 *
 * The layout is the desk layout: dense mono blocks, label | value | chg,
 * one block per market segment, releases table underneath. Every block
 * prints its source and cadence; a block without a licensed feed prints
 * what would unlock it instead of a guess.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import './MoneyMarketsPage.css';

const COUNTRIES = ['BR', 'US', 'EU', 'GB', 'JP', 'MX'];
const REFRESH_MS = 60_000;

const fmtVal = (v, unit) => {
  if (v == null || v === '') return '—';
  if (typeof v === 'string') return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (unit === 'bp') return n.toFixed(0);
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return n.toFixed(unit === '%' ? 2 : (Math.abs(n) < 10 ? 4 : 2));
};
const fmtChg = (c, unit) => {
  if (c == null || !Number.isFinite(Number(c))) return '';
  const n = Number(c);
  const s = unit === 'bp' ? n.toFixed(0) : n.toFixed(2);
  return (n > 0 ? '+' : '') + s;
};
const fmtDate = (d) => {
  if (!d) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d.slice(0, 5);
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return String(d).slice(0, 10);
  return `${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}`;
};
const fmtRel = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
};
const fmtWhen = (iso) => {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  return `${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
};

function statusTag(status) {
  const s = String(status || '');
  if (s.startsWith('needs:')) return { cls: 'mm-tag--needs', text: 'NEEDS KEY' };
  if (s === 'unavailable') return { cls: 'mm-tag--off', text: 'NO FEED' };
  return { cls: 'mm-tag--on', text: s.toUpperCase() };
}

function Block({ block, wide }) {
  if (!block) return null;
  const tag = statusTag(block.status);
  const rows = block.rows || [];
  const needs = block.needs || (String(block.status).startsWith('needs:') ? block.status.slice(6) : null);
  return (
    <section className={`mm-block${wide ? ' mm-block--wide' : ''}`}>
      <header className="mm-block-h">
        <span className="mm-block-title">{block.title}</span>
        <span className={`mm-tag ${tag.cls}`}>{tag.text}</span>
      </header>
      {rows.length ? (
        <table className="mm-table">
          <tbody>
            {rows.map((r, i) => {
              const chgNum = Number(r.chg);
              const cls = !Number.isFinite(chgNum) || chgNum === 0 ? '' : chgNum > 0 ? 'mm-up' : 'mm-down';
              return (
                <tr key={r.label + i} title={r.note || ''}>
                  <td className="mm-l">{r.label}</td>
                  <td className="mm-v">{fmtVal(r.value, r.unit)}{r.value != null && r.unit === '%' ? '' : ''}</td>
                  <td className={`mm-c ${cls}`}>{fmtChg(r.chg, r.unit)}</td>
                  <td className="mm-d">{fmtDate(r.date)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="mm-empty">
          {needs ? <><span className="mm-empty-k">UNLOCK →</span> {needs}</> : (block.error || block.note || 'No licensed source for this block yet.')}
        </div>
      )}
      <footer className="mm-block-f">
        {block.source ? <span>{block.source}</span> : <span>no source</span>}
        {block.note && rows.length ? <span className="mm-block-note"> · {block.note}</span> : null}
      </footer>
    </section>
  );
}

function Releases({ block }) {
  if (!block) return null;
  const tag = statusTag(block.status);
  const rows = block.rows || [];
  return (
    <section className="mm-block mm-block--releases">
      <header className="mm-block-h">
        <span className="mm-block-title">{block.title}</span>
        <span className={`mm-tag ${tag.cls}`}>{tag.text}</span>
        <span className="mm-block-sub">±1W · LOCAL TIME</span>
      </header>
      {rows.length ? (
        <table className="mm-table mm-table--rel">
          <thead>
            <tr><th>DATE TIME</th><th>EVENT</th><th>PERIOD</th><th>SURV</th><th>ACTUAL</th><th>PRIOR</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const past = r.actual != null;
              const beat = past && r.consensus != null ? (r.actual > r.consensus ? 'mm-up' : r.actual < r.consensus ? 'mm-down' : '') : '';
              return (
                <tr key={r.name + i} className={past ? 'mm-rel--past' : ''}>
                  <td className="mm-d">{fmtWhen(r.when)}</td>
                  <td className="mm-l mm-l--ev">{r.name}</td>
                  <td className="mm-d">{r.period || ''}</td>
                  <td className="mm-v">{fmtRel(r.consensus)}</td>
                  <td className={`mm-v ${beat}`}>{fmtRel(r.actual)}</td>
                  <td className="mm-v mm-v--dim">{fmtRel(r.previous)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="mm-empty">{String(block.status).startsWith('needs:') ? `UNLOCK → ${block.status.slice(6)}` : (block.error || 'No releases in the window.')}</div>
      )}
      <footer className="mm-block-f">{block.source || 'no source'}</footer>
    </section>
  );
}

export default function MoneyMarketsPage() {
  const { cc: ccParam } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const cc = String(ccParam || 'BR').toUpperCase();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/debt/money-markets/${encodeURIComponent(cc)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setData(j);
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [cc]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => { document.title = `${cc} · Treasury & Money Markets — Particle`; }, [cc]);

  const b = data?.blocks || {};
  const needs = data?.needs || [];
  const clock = useMemo(() => updatedAt ? updatedAt.toLocaleTimeString('en-GB') : '', [updatedAt]);

  return (
    <div className="mm-page">
      <div className="mm-chrome">
        <span className="mm-logo">PARTICLE</span>
        <span className="mm-chrome-label">TREASURY &amp; MONEY MARKETS</span>
        <div className="mm-countries" role="tablist">
          {COUNTRIES.map(c => (
            <button key={c} role="tab" aria-selected={c === cc} className={`mm-cbtn${c === cc ? ' mm-cbtn--on' : ''}`} onClick={() => navigate(`/money/${c}`)}>{c}</button>
          ))}
        </div>
        <span className="mm-chrome-spacer" />
        <span className="mm-clock">{clock}</span>
        <span className="mm-chrome-user">{user?.username || ''}</span>
        <button className="mm-close" onClick={() => window.close()} title="Close window">×</button>
      </div>

      <div className="mm-head">
        <span className="mm-head-flag">{data?.flag || ''}</span>
        <span className="mm-head-name">{data?.name || cc}</span>
        <span className="mm-head-ccy">{data?.ccy || ''}</span>
        {error && <span className="mm-head-err">FEED ERROR — {error}</span>}
        {loading && !data && <span className="mm-head-sub">assembling…</span>}
      </div>

      {data && (
        <>
          <div className="mm-grid">
            <Block block={b.policy} />
            <Block block={b.curve} />
            <Block block={b.rateFutures} />
            <Block block={b.fx} />
            <Block block={b.risk} />
            <Block block={b.bonds} />
            <Block block={b.markets} />
          </div>
          <Releases block={b.releases} />
          {needs.length > 0 && (
            <div className="mm-needs">
              <span className="mm-needs-k">TO COMPLETE THIS SCREEN</span>
              <ul>{needs.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
