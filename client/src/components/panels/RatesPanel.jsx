/**
 * RatesPanel — US Treasury yields + key sovereign/central bank rates.
 * Live data: US Treasuries via Yahoo Finance + Selic via BCB (server proxy)
 * Static data: ECB, BOE, BOJ (rarely change, updated manually)
 */
import { useState, useEffect, memo } from 'react';
import { apiFetch } from '../../utils/api';

// Static central bank rates not available from free APIs (update manually)
const STATIC_CB_RATES = [
  { symbol: 'ECB',  name: 'ECB DEPO', price: 2.50, note: 'TARGET RATE' },
  { symbol: 'BOE',  name: 'BOE BASE', price: 4.50, note: 'TARGET RATE' },
  { symbol: 'BOJ',  name: 'BOJ RATE', price: 0.50, note: 'TARGET RATE' },
];

function PctChange({ v }) {
  if (v == null) return <span style={{ color: '#333', fontSize: 9 }}>-</span>;
  const up = v >= 0;
  return (
    <span style={{ color: up ? '#00cc44' : '#cc2200', fontSize: 9, fontWeight: 600 }}>
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
    <div style={{
      display: 'grid', gridTemplateColumns: '70px 52px 44px 1fr',
      alignItems: 'center', padding: '2px 6px',
      borderBottom: '1px solid #0d0d0d',
    }}>
      <span style={{ color: live ? '#888' : '#555', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.03em' }}>
        {label}
      </span>
      <span style={{ color: live ? '#e8e8e8' : '#666', fontSize: 10, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", textAlign: 'right' }}>
        {value != null ? value.toFixed(2) + '%' : '-'}
      </span>
      <span style={{ textAlign: 'right' }}>
        {live ? <PctChange v={change} /> : <span style={{ color: '#2a2a2a', fontSize: 8 }}>—</span>}
      </span>
      <span style={{ color: '#2a2a2a', fontSize: 7.5, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", paddingRight: 2 }}>
        {note || ''}
      </span>
    </div>
  );

  const SectionLabel = ({ text }) => (
    <div style={{ padding: '3px 6px 1px', background: '#060606', borderBottom: '1px solid #111' }}>
      <span style={{ color: '#2a2a2a', fontSize: 7, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em' }}>
        {text}
      </span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #1a1a1a', padding: '0 6px', height: 22,
        flexShrink: 0, background: '#070707',
      }}>
        <span style={{ color: '#e55a00', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', fontFamily: "'IBM Plex Mono', monospace" }}>
          RATES
        </span>
        <span style={{ color: '#1e1e1e', fontSize: 7.5, fontFamily: "'IBM Plex Mono', monospace" }}>
          {loading ? 'LOADING...' : ts}
        </span>
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '70px 52px 44px 1fr', padding: '1px 6px', background: '#070707', borderBottom: '1px solid #111' }}>
        {['TENOR', 'YIELD', 'CHG', ''].map(h => (
          <span key={h} style={{ color: '#2a2a2a', fontSize: 7, fontFamily: "'IBM Plex Mono', monospace", textAlign: h === 'YIELD' || h === 'CHG' ? 'right' : 'left' }}>
            {h}
          </span>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* US Treasuries — live from Yahoo Finance */}
        <SectionLabel text="US TREASURIES" />
        {treasuryRates.length === 0 && !loading && (
          <div style={{ padding: '6px', color: '#2a2a2a', fontSize: 8, fontFamily: "'IBM Plex Mono', monospace" }}>NO DATA</div>
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

        <div style={{ padding: '4px 6px', marginTop: 2 }}>
          <span style={{ color: '#141414', fontSize: 7, fontFamily: "'IBM Plex Mono', monospace" }}>
            CB RATES INDICATIVE · SELIC LIVE VIA BCB
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(RatesPanel);
