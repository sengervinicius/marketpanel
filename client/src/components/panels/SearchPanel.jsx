import { useState, useRef, useCallback } from 'react';
import { FOREX_PAIRS, CRYPTO_PAIRS } from '../../utils/constants';

const API = import.meta.env.VITE_API_URL || '';

const TYPE_COLOR = {
  EQUITY:     '#4fc3f7',
  ETF:        '#81c784',
  INDEX:      '#ffb74d',
  CURRENCY:   '#ce93d8',
  CRYPTO:     '#f48fb1',
  MUTUALFUND: '#80cbc4',
};

// Local search for FX pairs and crypto — returns results instantly without API call
function localSearch(q) {
  if (!q || q.trim().length < 2) return [];
  const uq = q.toUpperCase().replace(/[\s\/\-]/g, '');
  const fxResults = FOREX_PAIRS
    .filter(p => p.symbol.includes(uq) || p.label.replace('/', '').includes(uq))
    .map(p => ({ symbol: p.symbol + '=X', name: p.label + ' Exchange Rate', type: 'CURRENCY', local: true }));
  const cryptoResults = CRYPTO_PAIRS
    .filter(c => c.symbol.toUpperCase().includes(uq) || c.label.toUpperCase().includes(q.trim().toUpperCase()))
    .map(c => ({ symbol: 'X:' + c.symbol, name: c.label + ' / USD', type: 'CRYPTO', local: true }));
  return [...fxResults, ...cryptoResults];
}

export function SearchPanel({ onTickerSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const debounceRef = useRef(null);

  const search = useCallback((q) => {
    if (!q.trim()) { setResults([]); return; }
    // Show local FX/crypto matches immediately (no latency)
    const local = localSearch(q);
    setResults(local);
    setLoading(true);
    fetch(`${API}/api/search?q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(d => {
        // Merge local results at top, deduplicate by symbol
        const remote = (d.results || []).filter(r => !local.some(l => l.symbol === r.symbol));
        setResults([...local, ...remote].slice(0, 12));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleInput = (e) => {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 280);
  };

  const handleSelect = (item) => {
    setQuery(item.symbol);
    setResults([]);
    if (onTickerSelect) onTickerSelect(item.symbol);
    setQuoteLoading(true);
    fetch(`${API}/api/snapshot/ticker/${encodeURIComponent(item.symbol)}`)
      .then(r => r.json())
      .then(d => { setQuote(d); setQuoteLoading(false); })
      .catch(() => setQuoteLoading(false));
  };

  // Drag handlers — pack ticker data into dataTransfer
  const handleDragStart = (e, item) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-ticker', JSON.stringify({
      symbol: item.symbol,
      name:   item.name,
      type:   item.type,
    }));
  };

  const fmtNum = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ padding: '12px 10px', borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
        <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 12, letterSpacing: '0.2em' }}>SEARCH</span>
        <span style={{ color: '#333', fontSize: 7, marginLeft: 8 }}>DRAG RESULTS TO CHART</span>
      </div>

      {/* Input */}
      <div style={{ position: 'relative', padding: '6px 8px', flexShrink: 0 }}>
        <input
          value={query}
          onChange={handleInput}
          placeholder="ticker or company name..."
          style={{
            width: '100%',
            background: '#0f0f0f',
            border: '1px solid #2a2a2a',
            color: '#ccc',
            fontSize: 12,
            padding: '10px 8px', fontSize: 16,
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={e => e.target.style.borderColor = '#ff6600'}
          onBlur={e => e.target.style.borderColor = '#2a2a2a'}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#555', fontSize: 7 }}>
            SEARCHING...
          </span>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div style={{ borderBottom: '1px solid #1e1e1e', flexShrink: 0, maxHeight: '55vh', overflowY: 'auto' }}>
          {results.map(item => (
            <div
              key={item.symbol}
              draggable
              onDragStart={(e) => handleDragStart(e, item)}
              onClick={() => handleSelect(item)}
              style={{
                padding: '12px 10px',
                borderBottom: '1px solid #161616',
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                userSelect: 'none',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#141414'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {/* Drag indicator */}
              <span style={{ color: '#2a2a2a', fontSize: 13, flexShrink: 0 }}>|:|</span>
              <span style={{
                color: TYPE_COLOR[item.type] || '#aaa',
                fontSize: 13,
                fontWeight: 700,
                minWidth: '60px',
                flexShrink: 0,
              }}>
                {item.symbol}
              </span>
              <span style={{ color: '#777', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {item.name}
              </span>
              <span style={{
                color: '#444',
                fontSize: 8,
                flexShrink: 0,
              }}>
                {item.type}
              </span>
            </div>
          ))}
        </div>
      )}

      {!results.length && !query && (
        <div style={{ padding: '12px 8px', color: '#222', fontSize: 8, textAlign: 'center' }}>
          TYPE TO SEARCH — DRAG RESULTS TO CHART
        </div>
      )}

      {/* Quick quote */}
      {(quote || quoteLoading) && (
        <div style={{ padding: '8px', flex: 1, overflow: 'auto' }}>
          {quoteLoading && <div style={{ color: '#444', fontSize: 8 }}>LOADING QUOTE...</div>}
          {quote && !quoteLoading && (() => {
            const t = quote.ticker || quote.results?.[0];
            if (!t) return null;
            const d = t.day || {};
            const pct = t.todaysChangePerc;
            const up = (pct ?? 0) >= 0;
            return (
              <div>
                <div style={{ color: '#e8a020', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{t.ticker}</div>
                <div style={{ color: '#ccc', fontSize: 18, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {fmtNum(d.c ?? t.min?.c)}
                </div>
                <div style={{ color: up ? '#00c853' : '#f44336', fontSize: 13, marginTop: 2 }}>
                  {(up ? '+' : '')}{fmtNum(t.todaysChange)} ({fmtPct(pct)})
                </div>
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {[['OPEN', d.o], ['HIGH', d.h], ['LOW', d.l], ['VOL', d.v ? (d.v / 1e6).toFixed(1) + 'M' : '—']].map(([lbl, val]) => (
                    <div key={lbl}>
                      <div style={{ color: '#555', fontSize: 7 }}>{lbl}</div>
                      <div style={{ color: '#999', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                        {typeof val === 'number' ? fmtNum(val) : (val || '—')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
