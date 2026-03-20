/**
 * SearchPanel — ticker search with live Polygon results.
 * Results can be dragged into ChartPanel or clicked to show snapshot data.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { fmtPrice, fmtPct } from '../../utils/format';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function SearchPanel() {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [snapLoading, setSnapLoading] = useState(false);
  const inputRef = useRef(null);

  const search = useCallback(debounce(async (q) => {
    if (!q || q.trim().length < 1) { setResults([]); return; }
    try {
      setLoading(true);
      const res  = await fetch(SERVER_URL + '/api/search?q=' + encodeURIComponent(q.trim()) + '&limit=10');
      const json = await res.json();
      setResults(json.results || []);
    } catch (e) {
      console.warn('Search error:', e.message);
    } finally {
      setLoading(false);
    }
  }, 350), []);

  useEffect(() => { search(query); }, [query, search]);

  async function loadSnapshot(ticker) {
    try {
      setSnapLoading(true);
      setSnapshot(null);
      const res  = await fetch(SERVER_URL + '/api/snapshot/ticker/' + ticker);
      const json = await res.json();
      const t = json.ticker;
      if (t) {
        const prevClose = t.prevDay?.c || 0;
        const price =
          t.lastTrade?.p ||
          (t.day?.c && t.day.c !== 0 ? t.day.c : null) ||
          (prevClose && t.todaysChange != null ? prevClose + t.todaysChange : 0);
        setSnapshot({
          ticker: t.ticker,
          price,
          change: t.todaysChange ?? 0,
          changePct: t.todaysChangePerc ?? 0,
          open:   t.day?.o || 0,
          high:   t.day?.h || 0,
          low:    t.day?.l || 0,
          vol:    t.day?.v || 0,
          prevClose,
        });
      }
    } catch (e) {
      console.warn('Snapshot error:', e.message);
    } finally {
      setSnapLoading(false);
    }
  }

  function handleDragStart(e, ticker, name) {
    e.dataTransfer.setData('application/json', JSON.stringify({ symbol: ticker, label: name || ticker }));
    e.dataTransfer.effectAllowed = 'copy';
  }

  function fmtVol(v) {
    if (!v) return '-';
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return String(v);
  }

  const up = (snapshot?.changePct ?? 0) >= 0;
  const color = up ? '#00cc44' : '#cc2200';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#050505' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', borderBottom: '1px solid #1a1a1a',
        padding: '0 6px', height: 22, flexShrink: 0, background: '#070707',
      }}>
        <span style={{ color: '#e55a00', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', fontFamily: "'IBM Plex Mono', monospace" }}>
          SEARCH
        </span>
        <span style={{ color: '#2a2a2a', fontSize: 8, marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
          STOCKS, ETFs, CRYPTO
        </span>
      </div>

      {/* Search input */}
      <div style={{ padding: '4px 6px', borderBottom: '1px solid #111', flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value.toUpperCase())}
          placeholder="TYPE TICKER OR NAME..."
          style={{
            width: '100%', background: '#0a0a0a', border: '1px solid #222',
            color: '#e8e8e8', fontSize: 10, padding: '3px 6px', outline: 'none',
            fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.04em', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Body: results + snapshot */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Snapshot strip (when a ticker is selected) */}
        {snapshot && (
          <div style={{ padding: '4px 6px', borderBottom: '1px solid #111', flexShrink: 0, background: '#080808' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
              <span style={{ color: '#ff6600', fontWeight: 700, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
                {snapshot.ticker}
              </span>
              <span style={{ color: color, fontSize: 10, fontWeight: 600 }}>{fmtPct(snapshot.changePct)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#e8e8e8', fontSize: 14, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>
                {fmtPrice(snapshot.price)}
              </span>
              <span style={{ color: color, fontSize: 9 }}>{snapshot.change >= 0 ? '+' : ''}{fmtPrice(snapshot.change)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                ['O', fmtPrice(snapshot.open)],
                ['H', fmtPrice(snapshot.high)],
                ['L', fmtPrice(snapshot.low)],
                ['V', fmtVol(snapshot.vol)],
                ['PC', fmtPrice(snapshot.prevClose)],
              ].map(([lbl, val]) => (
                <span key={lbl} style={{ fontSize: 8 }}>
                  <span style={{ color: '#333' }}>{lbl} </span>
                  <span style={{ color: '#888' }}>{val}</span>
                </span>
              ))}
            </div>
            <div style={{ marginTop: 3 }}>
              <span style={{ color: '#2a2a2a', fontSize: 7.5, fontFamily: "'IBM Plex Mono', monospace" }}>
                DRAG TO CHARTS PANEL TO ADD CHART
              </span>
            </div>
          </div>
        )}
        {snapLoading && (
          <div style={{ padding: '6px', color: '#333', fontSize: 8, fontFamily: "'IBM Plex Mono', monospace", borderBottom: '1px solid #111' }}>
            LOADING SNAPSHOT...
          </div>
        )}

        {/* Search results list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && query && (
            <div style={{ padding: '6px 8px', color: '#333', fontSize: 8, fontFamily: "'IBM Plex Mono', monospace" }}>SEARCHING...</div>
          )}
          {!loading && query && results.length === 0 && (
            <div style={{ padding: '6px 8px', color: '#2a2a2a', fontSize: 8, fontFamily: "'IBM Plex Mono', monospace" }}>NO RESULTS</div>
          )}
          {results.map((r, i) => (
            <div
              key={r.ticker + i}
              draggable
              onDragStart={e => handleDragStart(e, r.ticker, r.name)}
              onClick={() => loadSnapshot(r.ticker)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 8px', borderBottom: '1px solid #0d0d0d', cursor: 'pointer',
                background: snapshot?.ticker === r.ticker ? '#0e0e0e' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#0d0d0d'}
              onMouseLeave={e => e.currentTarget.style.background = snapshot?.ticker === r.ticker ? '#0e0e0e' : 'transparent'}
            >
              <div>
                <span style={{ color: '#ff6600', fontSize: 10, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", marginRight: 8 }}>
                  {r.ticker}
                </span>
                <span style={{ color: '#444', fontSize: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {(r.name || '').substring(0, 24)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: '#2a2a2a', fontSize: 7, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {r.market || r.type || ''}
                </span>
                <span style={{ color: '#1a1a1a', fontSize: 8 }}>⠿</span>
              </div>
            </div>
          ))}
          {!query && (
            <div style={{ padding: '12px 8px', color: '#1a1a1a', fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", textAlign: 'center', marginTop: 8 }}>
              SEARCH FOR ANY TICKER<br />
              <span style={{ fontSize: 7, color: '#141414' }}>DRAG RESULTS INTO CHARTS PANEL</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
