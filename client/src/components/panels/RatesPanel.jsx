/**
 * RatesPanel — US Treasury yields + key sovereign rates.
 * Data from Yahoo Finance via server proxy.
 */
import { useState, useEffect } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

const LABEL_MAP = {
  '^IRX': { name: 'US  3M', flag: 'us' },
  '^FVX': { name: 'US  5Y', flag: 'us' },
  '^TNX': { name: 'US 10Y', flag: 'us' },
  '^TYX': { name: 'US 30Y', flag: 'us' },
};

// Static reference rates (updated periodically — these are approximate)
const STATIC_RATES = [
  { name: 'FED FUNDS', value: '4.33', note: 'TARGET RATE' },
  { name: 'ECB DEPO',  value: '2.50', note: 'TARGET RATE' },
  { name: 'BOE BASE',  value: '4.50', note: 'TARGET RATE' },
  { name: 'BOJ RATE',  value: '0.50', note: 'TARGET RATE' },
  { name: 'SELIC',     value: '13.75',note: 'BRAZIL'      },
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

export function RatesPanel() {
  const [rates, setRates]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [ts, setTs]           = useState('');

  async function load() {
    try {
      setLoading(true);
      const res  = await fetch(SERVER_URL + '/api/snapshot/rates');
      const json = await res.json();
      setRates(json.results || []);
      setTs(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      console.warn('Rates load error:', e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 120000); // refresh every 2 min
    return () => clearInterval(iv);
  }, []);

  const ROW = ({ label, value, change, note }) => (
    <div style={{
      display: 'grid', gridTemplateColumns: '70px 52px 52px 1fr',
      alignItems: 'center', padding: '2px 6px', borderBottom: '1px solid #0d0d0d',
    }}>
      <span style={{ color: '#888', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.03em' }}>{label}</span>
      <span style={{ color: '#e8e8e8', fontSize: 10, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", textAlign: 'right' }}>
        {value != null ? value.toFixed(2) + '%' : '-'}
      </span>
      <span style={{ textAlign: 'right' }}><PctChange v={change} /></span>
      <span style={{ color: '#2a2a2a', fontSize: 7.5, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", paddingRight: 2 }}>
        {note || ''}
      </span>
    </div>
  );

  const STATIC_ROW = ({ name, value, note }) => (
    <div style={{
      display: 'grid', gridTemplateColumns: '70px 52px 52px 1fr',
      alignItems: 'center', padding: '2px 6px', borderBottom: '1px solid #0d0d0d',
    }}>
      <span style={{ color: '#555', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" }}>{name}</span>
      <span style={{ color: '#777', fontSize: 10, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", textAlign: 'right' }}>
        {value}%
      </span>
      <span style={{ textAlign: 'right', color: '#2a2a2a', fontSize: 8 }}>-</span>
      <span style={{ color: '#1e1e1e', fontSize: 7.5, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", paddingRight: 2 }}>
        {note}
      </span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #1a1a1a', padding: '0 6px', height: 22, flexShrink: 0, background: '#070707',
      }}>
        <span style={{ color: '#e55a00', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', fontFamily: "'IBM Plex Mono', monospace" }}>
          RATES
        </span>
        <span style={{ color: '#1e1e1e', fontSize: 7.5, fontFamily: "'IBM Plex Mono', monospace" }}>
          {loading ? 'LOADING...' : ts}
        </span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '70px 52px 52px 1fr',
        padding: '1px 6px', background: '#070707', borderBottom: '1px solid #111',
      }}>
        {['TENOR', 'YIELD', 'CHG', ''].map(h => (
          <span key={h} style={{ color: '#2a2a2a', fontSize: 7, fontFamily: "'IBM Plex Mono', monospace", textAlign: h === 'YIELD' || h === 'CHG' ? 'right' : 'left' }}>
            {h}
          </span>
        ))}
      </div>

      {/* Treasury yields (live) */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '2px 6px 1px', background: '#060606' }}>
          <span style={{ color: '#1e1e1e', fontSize: 7, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em' }}>
            US TREASURIES
          </span>
        </div>

        {rates.length === 0 && !loading && (
          <div style={{ padding: '6px', color: '#2a2a2a', fontSize: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
            NO DATA
          </div>
        )}

        {rates.map(r => {
          const meta = LABEL_MAP[r.symbol] || { name: r.name || r.symbol };
          return (
            <ROW
              key={r.symbol}
              label={meta.name}
              value={r.price}
              change={r.change}
              note=""
            />
          );
        })}

        {/* Divider */}
        <div style={{ height: 6, background: '#060606', borderBottom: '1px solid #111', marginTop: 2 }} />

        {/* Central bank rates (static) */}
        <div style={{ padding: '2px 6px 1px', background: '#060606' }}>
          <span style={{ color: '#1e1e1e', fontSize: 7, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em' }}>
            CENTRAL BANKS
          </span>
        </div>

        {STATIC_RATES.map(r => <STATIC_ROW key={r.name} {...r} />)}

        <div style={{ padding: '4px 6px', marginTop: 2 }}>
          <span style={{ color: '#141414', fontSize: 7, fontFamily: "'IBM Plex Mono', monospace" }}>
            CB RATES ARE INDICATIVE
          </span>
        </div>
      </div>
    </div>
  );
}
