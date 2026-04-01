/**
 * RatesPanel — US Treasury yields + key sovereign/central bank rates.
 * Live data: US Treasuries via Yahoo Finance + Selic via BCB (server proxy)
 * Static data: ECB, BOE, BOJ (rarely change, updated manually)
 */
import { useState, useEffect, memo } from 'react';
import { apiFetch } from '../../utils/api';
import './RatesPanel.css';

// Static central bank rates not available from free APIs (update manually)
const STATIC_CB_RATES = [
  { symbol: 'ECB',  name: 'ECB DEPO', price: 2.50, note: 'TARGET RATE' },
  { symbol: 'BOE',  name: 'BOE BASE', price: 4.50, note: 'TARGET RATE' },
  { symbol: 'BOJ',  name: 'BOJ RATE', price: 0.50, note: 'TARGET RATE' },
];

function PctChange({ v }) {
  if (v == null) return <span className="rp-row-change rp-row-change.static">-</span>;
  const up = v >= 0;
  return (
    <span className={`rp-row-change ${up ? 'rp-row-change.live' : 'rp-row-change.negative'}`}>
      {up ? '+' : ''}{v.toFixed(2)}
    </span>
  );
}

function RatesPanel() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ts, setTs] = useState('');

  async function load() {
    try {
      setLoading(true);
      const res  = await apiFetch('/api/snapshot/rates');
      const json = await res.json();
      setResults(json.results || []);
      setTs(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      console.warn('Rates load error:', e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000); // refresh every 60s
    return () => clearInterval(iv);
  }, []);

  // Split results by type
  const treasuryRates = results.filter(r => r.type === 'treasury');
  const policyRates   = results.filter(r => r.type === 'policy');

  const ROW = ({ label, value, change, note, live = true }) => (
    <div className="rp-row">
      <span className={`rp-row-label ${live ? 'rp-row-label.live' : 'rp-row-label.static'}`}>
        {label}
      </span>
      <span className={`rp-row-value ${live ? 'rp-row-value.live' : 'rp-row-value.static'}`}>
        {value != null ? value.toFixed(2) + '%' : '-'}
      </span>
      <span>
        {live ? <PctChange v={change} /> : <span className="rp-row-change rp-row-change.static">—</span>}
      </span>
      <span className="rp-row-note">
        {note || ''}
      </span>
    </div>
  );

  const SectionLabel = ({ text }) => (
    <div className="rp-section-label">
      <span className="rp-section-label-text">
        {text}
      </span>
    </div>
  );

  return (
    <div className="flex-col rp-container">
      {/* Header */}
      <div className="flex-row rp-header">
        <span className="rp-header-title">
          RATES
        </span>
        <span className="rp-header-time">
          {loading ? 'LOADING...' : ts}
        </span>
      </div>

      {/* Column headers */}
      <div className="rp-col-header">
        {['TENOR', 'YIELD', 'CHG', ''].map(h => (
          <span key={h} className={`rp-col-header-cell ${h === 'YIELD' || h === 'CHG' ? 'rp-col-header-cell.right-align' : ''}`}>
            {h}
          </span>
        ))}
      </div>

      <div className="rp-content">
        {/* US Treasuries — live from Yahoo Finance */}
        <SectionLabel text="US TREASURIES" />
        {treasuryRates.length === 0 && !loading && (
          <div style={{ padding: '6px', color: '#2a2a2a', fontSize: 8, fontFamily: 'var(--font-mono)' }}>NO DATA</div>
        )}
        {treasuryRates.map(r => (
          <ROW key={r.symbol} label={r.name} value={r.price} change={r.change} note="" live={true} />
        ))}

        {/* Policy rates — live SELIC + FEDFUNDS from server */}
        <div style={{ height: 4 }} />
        <SectionLabel text="POLICY RATES" />
        {policyRates.map(r => (
          <ROW key={r.symbol} label={r.name} value={r.price} change={null} note={r.note} live={true} />
        ))}

        {/* Static CB rates */}
        <div style={{ height: 4 }} />
        <SectionLabel text="CENTRAL BANKS" />
        {STATIC_CB_RATES.map(r => (
          <ROW key={r.symbol} label={r.name} value={r.price} change={null} note={r.note} live={false} />
        ))}

        <div className="rp-footer">
          <span className="rp-footer-text">
            CB RATES INDICATIVE · SELIC LIVE VIA BCB
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(RatesPanel);
