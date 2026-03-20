/**
 * ChartPanel drag-and-drop intraday chart area.
 * Drop any ticker from any panel here. Max 16 charts (FIFO queue).
 */

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { SectionHeader } from '../common/SectionHeader';
import { fmtPrice, fmtPct } from '../../utils/format';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const MAX_CHARTS = 16;

function MiniChart({ symbol, label, currentPrice, changePct, onRemove }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const up = (changePct ?? 0) >= 0;

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const res = await fetch(SERVER_URL + '/api/chart/' + symbol + '?from=' + yesterday + '&to=' + today + '&multiplier=5&timespan=minute');
        const json = await res.json();
        const results = (json.results || []).map((bar) => ({
          t: new Date(bar.t).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
          c: bar.c,
          o: bar.o,
        }));
        setData(results);
      } catch (e) {
        console.warn('Chart load failed for ' + symbol + ':', e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [symbol]);

  const open = data[0]?.c || 0;
  const color = up ? '#00cc44' : '#cc2200';

  return (
    <div style={{ background: '#050505', border: '1px solid #1a1a1a', padding: '4px 6px', flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
      {onRemove && (
        <button onClick={onRemove} title="Remove chart"
          style={{ position: 'absolute', top: 3, right: 3, background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: '1px 3px', fontFamily: "'IBM Plex Mono', monospace" }}
          onMouseEnter={e => e.target.style.color = '#cc2200'}
          onMouseLeave={e => e.target.style.color = '#333'}
        >✕</button>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, paddingRight: 14 }}>
        <span style={{ color: '#ff6600', fontWeight: 700, fontSize: 10 }}>{symbol}</span>
        <span style={{ color: '#555', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ color: '#e8e8e8', fontSize: 12, fontWeight: 700 }}>{fmtPrice(currentPrice)}</span>
        <span style={{ color, fontSize: 10 }}>{fmtPct(changePct)}</span>
      </div>
      {loading ? (
        <div style={{ height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 9 }}>LOADING...</div>
      ) : data.length === 0 ? (
        <div style={{ height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 9 }}>NO DATA</div>
      ) : (
        <ResponsiveContainer width="100%" height={50}>
          <LineChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
            {open > 0 && <ReferenceLine y={open} stroke="#333" strokeDasharray="2 2" />}
            <Line type="monotone" dataKey="c" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <YAxis domain={['auto', 'auto']} hide />
            <XAxis dataKey="t" hide />
            <Tooltip contentStyle={{ background: '#0a0a0a', border: '1px solid #333', fontSize: 9, color: '#ccc' }} formatter={(v) => [fmtPrice(v), 'Price']} labelStyle={{ color: '#888' }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function ChartPanel({ stocks }) {
  const [queue, setQueue] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); };
  const handleDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); };
  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data.symbol) return;
      setQueue(prev => {
        const filtered = prev.filter(t => t.symbol !== data.symbol);
        const next = [...filtered, { symbol: data.symbol, label: data.label || data.symbol }];
        return next.length > MAX_CHARTS ? next.slice(next.length - MAX_CHARTS) : next;
      });
    } catch (err) { console.warn('Drop parse error:', err); }
  };
  const handleRemove = (symbol) => setQueue(prev => prev.filter(t => t.symbol !== symbol));

  const count = queue.length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <SectionHeader title="CHARTS" subtitle={count > 0 ? count + '/' + MAX_CHARTS : undefined} right={count === 0 ? '← DRAG TICKERS HERE' : '5-MIN BARS'} />
      {count === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          border: dragOver ? '2px dashed #e55a00' : '2px dashed #1a1a1a', margin: 4,
          transition: 'border-color 0.2s, background 0.2s', background: dragOver ? 'rgba(229,90,0,0.04)' : 'transparent', borderRadius: 2 }}>
          <div style={{ fontSize: 22, color: dragOver ? '#e55a00' : '#222', marginBottom: 8, transition: 'color 0.2s' }}>⊕</div>
          <div style={{ color: dragOver ? '#e55a00' : '#2a2a2a', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em', transition: 'color 0.2s' }}>DROP TICKERS TO ADD CHARTS</div>
          <div style={{ color: '#1a1a1a', fontSize: 8, marginTop: 4, fontFamily: "'IBM Plex Mono', monospace" }}>UP TO 16 SIMULTANEOUS</div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(' + cols + ', 1fr)', gap: 2, padding: 2, overflow: 'auto',
          outline: dragOver ? '2px dashed #e55a00' : '2px dashed transparent', outlineOffset: -2, transition: 'outline-color 0.2s' }}>
          {queue.map(({ symbol, label }) => {
            const d = stocks[symbol] || {};
            return <MiniChart key={symbol} symbol={symbol} label={label} currentPrice={d.price} changePct={d.changePct} onRemove={() => handleRemove(symbol)} />;
          })}
        </div>
      )}
    </div>
  );
}

