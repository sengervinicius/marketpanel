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

const MARKET_BADGE = {
  BVSP: { bg: '#1a2800', color: '#8bc34a', label: 'B3'     },
  SAO:  { bg: '#1a2800', color: '#8bc34a', label: 'B3'     },
  NYQ:  { bg: '#001a2e', color: '#4fc3f7', label: 'NYSE'   },
  NMS:  { bg: '#001a2e', color: '#4fc3f7', label: 'NASDAQ' },
};

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

export function SearchPanel({ onTickerSelect, onOpenDetail }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [quote, setQuote]     = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const debounceRef = useRef(null);

  const search = useCallback((q) => {
    if (!q.trim()) { setResults([]); return; }
    const local = localSearch(q);
    setResults(local);
    setLoading(true);
    fetch(`${API}/api/search?q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(d => {
        const remote = (d.results || []).filter(r => !local.some(l => l.symbol === (r.ticker || r.symbol)));
        const merged = [
          ...local,
          ...remote.map(r => ({ symbol: r.ticker || r.symbol, name: r.name, type: r.type, market: r.market })),
        ].slice(0, 14);
        setResults(merged);
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
    setQuote(null);
    setQuoteLoading(true);
    fetch(`${API}/api/quote/${encodeURIComponent(item.symbol)}`)
      .then(r => r.json())
      .then(d => { setQuote(d); setQuoteLoading(false); })
      .catch(() => setQuoteLoading(false));
  };

  const handleDragStart = (e, item) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-ticker', JSON.stringify({
      symbol: item.symbol, name: item.name, type: item.type,
    }));
  };

  const fmtNum = (n) => n == null ? '\u2014' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n) => n == null ? '\u2014' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const fmtVol = (n) => n == null ? '\u2014' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a', fontFamily: 'inherit' }}>
      <div style={{ padding: '12px 10px', borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
        <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 12, letterSpacing: '0.2em' }}>SEARCH</span>
        <span style={{ color: '#333', fontSize: 7, marginLeft: 8 }}>DRAG RESULTS TO CHART</span>
      </div>
      <div style={{ position: 'relative', padding: '6px 8px', flexShrink: 0 }}>
        <input
          value={query}
          onChange={handleInput}
          placeholder="ticker or company name..."
          style={{
            width: '100%', background: '#0f0f0f',
            border: '1px solid #2a2a2a', color: '#ccc',
            fontSize: 16, padding: '10px 8px',
            fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
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
      {results.length > 0 && (
        <div style={{ borderBottom: '1px solid #1e1e1e', flexShrink: 0, maxHeight: '55vh', overflowY: 'auto' }}>
          {results.map(item => {
            const badge = MARKET_BADGE[item.market?.toUpperCase()];
            const isBrazilian = item.symbol?.endsWith('.SA');
            return (
              <div
                key={item.symbol}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                onClick={() => handleSelect(item)}
                onDoubleClick={() => onOpenDetail?.(item.symbol)}
                style={{
                  padding: '10px 10px', borderBottom: '1px solid #161616',
                  cursor: 'grab', display: 'flex', alignItems: 'center',
                  gap: 6, userSelect: 'none', transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ color: '#2a2a2a', fontSize: 13, flexShrink: 0 }}>|:|</span>
                <span style={{
                  color: isBrazilian ? '#8bc34a' : (TYPE_COLOR[item.type] || '#aaa'),
                  fontSize: 13, fontWeight: 700, minWidth: '70px', flexShrink: 0,
                }}>
                  {isBrazilian ? item.symbol.replace('.SA', '') : item.symbol}
                </span>
                <span style={{ color: '#777', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {item.name}
                </span>
                {badge ? (
                  <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 2, background: badge.bg, color: badge.color, flexShrink: 0 }}>
                    {badge.label}
                  </span>
                ) : (
                  <span style={{ color: '#444', fontSize: 8, flexShrink: 0 }}>{item.type}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!results.length && !query && (
        <div style={{ padding: '12px 8px', color: '#222', fontSize: 8, textAlign: 'center' }}>
          TYPE TO SEARCH \u2014 DRAG RESULTS TO CHART
        </div>
      )}
      {(quote || quoteLoading) && (
        <div style={{ padding: '10px 8px', flex: 1, overflow: 'auto' }}>
          {quoteLoading && <div style={{ color: '#444', fontSize: 8 }}>LOADING QUOTE...</div>}
          {quote && !quoteLoading && quote.price != null && (() => {
            const up = (quote.changePct ?? 0) >= 0;
            const isBR = quote.currency === 'BRL' || quote.ticker?.endsWith('.SA');
            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                  <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 12 }}>
                    {isBR ? quote.ticker?.replace('.SA', '') : quote.ticker}
                  </span>
                  {isBR && (
                    <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 2, background: '#1a2800', color: '#8bc34a' }}>B3</span>
                  )}
                  <span style={{ color: '#333', fontSize: 8, marginLeft: 'auto' }}>{quote.currency}</span>
                </div>
                <div style={{ color: '#ccc', fontSize: 20, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {fmtNum(quote.price)}
                </div>
                <div style={{ color: up ? '#00c853' : '#f44336', fontSize: 13, marginTop: 2 }}>
                  {(up ? '+' : '')}{fmtNum(quote.change)} ({fmtPct(quote.changePct)})
                </div>
                {quote.name && quote.name !== quote.ticker && (
                  <div style={{ color: '#444', fontSize: 9, marginTop: 4, fontStyle: 'italic' }}>{quote.name}</div>
                )}
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {[['OPEN', quote.open], ['HIGH', quote.high], ['LOW', quote.low], ['VOLUME', fmtVol(quote.volume)]].map(([lbl, val]) => (
                    <div key={lbl}>
                      <div style={{ color: '#555', fontSize: 7 }}>{lbl}</div>
                      <div style={{ color: '#999', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                        {typeof val === 'number' ? fmtNum(val) : (val || '\u2014')}
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
