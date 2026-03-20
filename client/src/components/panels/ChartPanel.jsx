/**
 * ChartPanel — drag-and-drop multi-chart area with BBG-style timeframe toggles.
 * Drop any ticker from any panel. Max 16 charts (FIFO queue).
 */
import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { fmtPrice, fmtPct } from '../../utils/format';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const MAX_CHARTS = 16;

const TIMEFRAMES = [
  { label: '1D',  multiplier: 5,  timespan: 'minute', days: 1,    xFmt: 'time'  },
  { label: '3D',  multiplier: 15, timespan: 'minute', days: 3,    xFmt: 'time'  },
  { label: '1M',  multiplier: 1,  timespan: 'day',    days: 30,   xFmt: 'date'  },
  { label: '6M',  multiplier: 1,  timespan: 'day',    days: 182,  xFmt: 'date'  },
  { label: 'YTD', multiplier: 1,  timespan: 'day',    days: null, xFmt: 'date'  },
  { label: '1Y',  multiplier: 1,  timespan: 'week',   days: 365,  xFmt: 'date'  },
  { label: '5Y',  multiplier: 1,  timespan: 'month',  days: 1825, xFmt: 'month' },
  { label: 'MAX', multiplier: 1,  timespan: 'month',  days: 3650, xFmt: 'year'  },
];

function getDateRange(tf) {
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  let from;
  if (tf.label === 'YTD') {
    from = now.getFullYear() + '-01-01';
  } else {
    const d = new Date(now);
    d.setDate(d.getDate() - tf.days);
    from = d.toISOString().split('T')[0];
  }
  return { from, to };
}

function fmtVol(v) {
  if (!v) return '-';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
}

function MiniChart({ symbol, label, currentPrice, changePct, onRemove, timeframe }) {
  const [data, setData]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats]   = useState({ open: 0, high: 0, low: Infinity, vol: 0 });
  const up    = (changePct ?? 0) >= 0;
  const color = up ? '#00cc44' : '#cc2200';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const { from, to } = getDateRange(timeframe);
        const res = await fetch(
          SERVER_URL + '/api/chart/' + symbol +
          '?from=' + from + '&to=' + to +
          '&multiplier=' + timeframe.multiplier +
          '&timespan=' + timeframe.timespan
        );
        const json = await res.json();
        const bars = json.results || [];
        if (cancelled) return;
        const results = bars.map(bar => ({
          t: timeframe.xFmt === 'time'
            ? new Date(bar.t).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
            : new Date(bar.t).toISOString().split('T')[0],
          c: bar.c, o: bar.o, h: bar.h, l: bar.l, v: bar.v,
        }));
        setData(results);
        if (bars.length > 0) {
          setStats({
            open: bars[0].o,
            high: Math.max(...bars.map(b => b.h)),
            low:  Math.min(...bars.map(b => b.l)),
            vol:  bars.reduce((s, b) => s + (b.v || 0), 0),
          });
        }
      } catch (e) {
        console.warn('Chart load failed:', symbol, e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = timeframe.xFmt === 'time' ? setInterval(load, 60000) : null;
    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [symbol, timeframe]);

  const hi = stats.high === -Infinity ? 0 : stats.high;
  const lo = stats.low  ===  Infinity ? 0 : stats.low;

  return (
    <div style={{
      background: '#050505', border: '1px solid #1a1a1a', padding: '4px 6px',
      flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {onRemove && (
        <button onClick={onRemove} title="Remove" style={{
          position: 'absolute', top: 3, right: 3, background: 'none', border: 'none',
          color: '#2a2a2a', cursor: 'pointer', fontSize: 10, lineHeight: 1,
          padding: '1px 3px', fontFamily: "'IBM Plex Mono', monospace", zIndex: 1,
        }}
          onMouseEnter={e => e.target.style.color = '#cc2200'}
          onMouseLeave={e => e.target.style.color = '#2a2a2a'}
        >x</button>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1, paddingRight: 14 }}>
        <span style={{ color: '#ff6600', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em' }}>{symbol}</span>
        <span style={{ color: '#444', fontSize: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{label}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
        <span style={{ color: '#e8e8e8', fontSize: 13, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: "'IBM Plex Mono', monospace" }}>
          {fmtPrice(currentPrice)}
        </span>
        <span style={{ color, fontSize: 10, fontWeight: 600 }}>{fmtPct(changePct)}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
        {[['O', fmtPrice(stats.open)], ['H', fmtPrice(hi)], ['L', fmtPrice(lo)], ['V', fmtVol(stats.vol)]].map(([lbl, val]) => (
          <span key={lbl} style={{ fontSize: 7.5 }}>
            <span style={{ color: '#2a2a2a' }}>{lbl} </span>
            <span style={{ color: '#666' }}>{val}</span>
          </span>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 36 }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#252525', fontSize: 8 }}>LOADING...</div>
        ) : data.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#252525', fontSize: 8 }}>NO DATA</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
              {stats.open > 0 && <ReferenceLine y={stats.open} stroke="#252525" strokeDasharray="2 2" />}
              <Line type="monotone" dataKey="c" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <YAxis domain={['auto', 'auto']} hide />
              <XAxis dataKey="t" hide />
              <Tooltip
                contentStyle={{ background: '#0a0a0a', border: '1px solid #2a2a2a', fontSize: 8, color: '#aaa', padding: '3px 6px' }}
                formatter={(v) => [fmtPrice(v), 'Price']}
                labelStyle={{ color: '#666' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export function ChartPanel({ stocks }) {
  const [queue,    setQueue]    = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [tfIdx,    setTfIdx]    = useState(0);

  const handleDragOver  = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); };
  const handleDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); };
  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const payload = JSON.parse(raw);
      if (!payload.symbol) return;
      setQueue(prev => {
        const filtered = prev.filter(t => t.symbol !== payload.symbol);
        const next = [...filtered, { symbol: payload.symbol, label: payload.label || payload.symbol }];
        return next.length > MAX_CHARTS ? next.slice(next.length - MAX_CHARTS) : next;
      });
    } catch (err) { console.warn('Drop parse error:', err); }
  };
  const handleRemove = (symbol) => setQueue(prev => prev.filter(t => t.symbol !== symbol));

  const count = queue.length;
  const cols  = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const tf    = TIMEFRAMES[tfIdx];

  const TfBar = (
    <div style={{ display: 'flex', marginLeft: 8 }}>
      {TIMEFRAMES.map((t, i) => (
        <button key={t.label} onClick={() => setTfIdx(i)} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '0 5px', height: 20,
          color: i === tfIdx ? '#e55a00' : '#333',
          fontSize: 8, fontFamily: "'IBM Plex Mono', monospace", fontWeight: i === tfIdx ? 700 : 400,
          borderBottom: i === tfIdx ? '1px solid #e55a00' : '1px solid transparent',
          transition: 'color 0.1s',
        }}
          onMouseEnter={e => { if (i !== tfIdx) e.currentTarget.style.color = '#888'; }}
          onMouseLeave={e => { if (i !== tfIdx) e.currentTarget.style.color = '#333'; }}
        >{t.label}</button>
      ))}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
    >
      <div style={{
        display: 'flex', alignItems: 'center', borderBottom: '1px solid #1a1a1a',
        padding: '0 6px', height: 22, flexShrink: 0, background: '#070707',
      }}>
        <span style={{ color: '#e55a00', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', fontFamily: "'IBM Plex Mono', monospace" }}>
          CHARTS
        </span>
        {count > 0 && (
          <span style={{ color: '#2a2a2a', fontSize: 8, marginLeft: 5, fontFamily: "'IBM Plex Mono', monospace" }}>
            {count}/{MAX_CHARTS}
          </span>
        )}
        {count === 0
          ? <span style={{ color: '#1e1e1e', fontSize: 8, marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace" }}>DRAG TICKERS HERE</span>
          : TfBar
        }
      </div>

      {count === 0 ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          border: dragOver ? '2px dashed #e55a00' : '2px dashed #151515', margin: 4,
          background: dragOver ? 'rgba(229,90,0,0.04)' : 'transparent', borderRadius: 2, transition: 'all 0.2s',
        }}>
          <div style={{ fontSize: 24, color: dragOver ? '#e55a00' : '#1a1a1a', marginBottom: 8 }}>+</div>
          <div style={{ color: dragOver ? '#e55a00' : '#1e1e1e', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em' }}>
            DROP TICKERS TO ADD CHARTS
          </div>
          <div style={{ color: '#141414', fontSize: 8, marginTop: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
            UP TO 16 SIMULTANEOUS
          </div>
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'grid', gridTemplateColumns: 'repeat(' + cols + ', 1fr)',
          gap: 2, padding: 2, overflow: 'auto',
          outline: dragOver ? '2px dashed #e55a00' : '2px dashed transparent',
          outlineOffset: -2, transition: 'outline-color 0.2s',
        }}>
          {queue.map(({ symbol, label }) => {
            const d = stocks[symbol] || {};
            return (
              <MiniChart
                key={symbol + '-' + tfIdx}
                symbol={symbol} label={label}
                currentPrice={d.price} changePct={d.changePct}
                onRemove={() => handleRemove(symbol)}
                timeframe={tf}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
