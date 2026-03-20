import { useState, useRef, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const TYPE_COLOR = {
  EQUITY: '#4fc3f7',
  ETF: '#81c784',
  INDEX: '#ffb74d',
  CURRENCY: '#ce93d8',
  MUTUALFUND: '#80cbc4',
};

export function SearchPanel({ onTickerSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const debounceRef = useRef(null);

  const search = useCallback((q) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    fetch(`${API}/api/search?q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(d => { setResults(d.results || []); setLoading(false); })
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
    // Fetch a quick snapshot
    setQuoteLoading(true);
    fetch(`${API}/api/snapshot/ticker/${encodeURIComponent(item.symbol)}`)
      .then(r => r.json())
      .then(d => { setQuote(d); setQuoteLoading(false); })
      .catch(() => setQuoteLoading(false));
  };

  // Drag handlers â pack ticker data into dataTransfer
  const handleDragStart = (e, item) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-ticker', JSON.stringify({
      symbol: item.symbol,
      name: item.name,
      type: item.type,
    }));
    // Ghost image text
    const ghost = document.createElement('div');
    ghost.style.cssText = 'position:fixed;top:-999px;background:#1a1a1a;color:#ff6600;padding:4px 10px;font-size:12px;font-family:monospace;border:1px solid #ff6600;border-radius:2px;';
    ghost.textContent = item.symbol;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => ghost.remove(), 0);
  };

  const fmt = (n) => n == null ? 'â' : typeof n === 'number' ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n;
  const fmtPct = (n) => n == null ? 'â' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const isPos = (n) => n != null && n >= 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Panel header */}
      <div style={{
        padding: '4px 8px',
        borderBottom: '1px solid #2a2a2a',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#111',
        flexShrink: 0,
      }}>
        <span style={{ color: '#ff6600', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>SEARCH</span>
        <span style={{ color: '#444', fontSize: '9px' }}>drag results to chart</span>
      </div>

      {/* Search input */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid #1e1e1e', flexShrink: 0, position: 'relative' }}>
        <input
          value={query}
          onChange={handleInput}
          placeholder="ticker or company name..."
          style={{
            width: '100%',
            background: '#111',
            border: '1px solid #333',
            color: '#e0e0e0',
            padding: '5px 8px',
            fontSize: '11px',
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={e => e.target.style.borderColor = '#ff6600'}
          onBlur={e => e.target.style.borderColor = '#333'}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#555', fontSize: '9px' }}>
            SEARCHING...
          </span>
        )}
      </div>

      {/* Results list */}
      {results.length > 0 && (
        <div style={{ borderBottom: '1px solid #1e1e1e', flexShrink: 0, maxHeight: '200px', overflowY: 'auto' }}>
          {results.map(item => (
            <div
              key={item.symbol}
              draggable
              onDragStart={(e) => handleDragStart(e, item)}
              onClick={() => handleSelect(item)}
              style={{
                padding: '5px 8px',
                borderBottom: '1px solid #161616',
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                userSelect: 'none',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {/* Drag handle */}
              <span style={{ color: '#333', fontSize: '10px', flexShrink: 0 }}>â ¿</span>
              <span style={{
                color: TYPE_COLOR[item.type] || '#aaa',
                fontSize: '11px',
                fontWeight: 700,
                minWidth: '64px',
                flexShrink: 0,
              }}>
                {item.symbol}
              </span>
              <span style={{ color: '#777', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {item.name}
              </span>
              <span style={{
                color: '#444',
                fontSize: '9px',
                flexShrink: 0,
                border: '1px solid #2a2a2a',
                padding: '1px 4px',
              }}>
                {item.type}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Quote detail */}
      <div style={{ flex: 1, padding: '8px', overflow: 'auto' }}>
        {quoteLoading && <div style={{ color: '#444', fontSize: '10px', textAlign: 'center', paddingTop: 20 }}>LOADING...</div>}
        {quote && !quoteLoading && (
          <div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: '#ff6600', fontSize: '13px', fontWeight: 700 }}>{quote.symbol}</div>
              <div style={{ color: '#888', fontSize: '10px' }}>{quote.name}</div>
            </div>

            <div style={{ fontSize: '22px', fontWeight: 700, color: '#e0e0e0', lineHeight: 1.2 }}>
              {fmt(quote.price)}
            </div>
            <div style={{
              fontSize: '12px',
              color: isPos(quote.changePct) ? '#4caf50' : '#f44336',
              marginBottom: 12,
            }}>
              {isPos(quote.change) ? '+' : ''}{fmt(quote.change)} ({fmtPct(quote.changePct)})
            </div>

            {/* OHLV table */}
            {[
              ['OPEN',   quote.open],
              ['HIGH',   quote.high],
              ['LOW',    quote.low],
              ['VOLUME', quote.volume ? (quote.volume / 1e6).toFixed(1) + 'M' : null],
              ['MCAP',   quote.marketCap ? (quote.marketCap / 1e9).toFixed(1) + 'B' : null],
              ['CCY',    quote.currency],
            ].map(([label, val]) => val != null && (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid #161616' }}>
                <span style={{ color: '#555', fontSize: '9px', letterSpacing: '1px' }}>{label}</span>
                <span style={{ color: '#ccc', fontSize: '10px', fontWeight: 600 }}>{typeof val === 'number' ? fmt(val) : val}</span>
              </div>
            ))}

            <button
              onClick={() => onTickerSelect && onTickerSelect(quote.symbol)}
              style={{
                marginTop: 12,
                width: '100%',
                padding: '6px',
                background: '#ff6600',
                color: '#000',
                border: 'none',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '1px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              OPEN IN CHART â
            </button>
          </div>
        )}
        {!quote && !quoteLoading && results.length === 0 && (
          <div style={{ color: '#333', fontSize: '10px', textAlign: 'center', paddingTop: 30, lineHeight: 2 }}>
            TYPE TO SEARCH<br />
            <span style={{ color: '#ff6600', fontSize: '18px' }}>â ¿</span><br />
            <span style={{ color: '#444' }}>DRAG RESULTS TO CHART</span>
          </div>
        )}
      </div>
    </div>
  );
}
