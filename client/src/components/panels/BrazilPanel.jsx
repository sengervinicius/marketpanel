// BrazilPanel.jsx â uses brapi.dev free Brazilian stocks API
import { useState, useEffect, useCallback } from 'react';

const TICKERS = ['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'ABEV3', 'WEGE3', 'B3SA3', 'RENT3', 'RADL3', 'SUZB3'];
const BRAPI = 'https://brapi.dev/api/quote/';

const fmt = (n) => n == null ? 'â' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? 'â' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

export default function BrazilPanel() {
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const url = `${BRAPI}${TICKERS.join(',')}?fundamental=false&dividends=false`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`brapi ${res.status}`);
      const json = await res.json();
      if (!json.results) throw new Error('no results');
      setStocks(json.results.map(s => ({
        symbol:    s.symbol,
        name:      s.shortName || s.longName || s.symbol,
        price:     s.regularMarketPrice,
        change:    s.regularMarketChange,
        changePct: s.regularMarketChangePercent,
        volume:    s.regularMarketVolume,
      })));
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{
        padding: '4px 8px',
        borderBottom: '1px solid #2a2a2a',
        display: 'flex',
        alignItems: 'center',
        background: '#111',
        flexShrink: 0,
      }}>
        <span style={{ color: '#4caf50', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>BRASIL B3</span>
        <span style={{ color: '#444', fontSize: '9px', marginLeft: 'auto' }}>
          {lastUpdate ? lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
        </span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '72px 1fr 64px 64px',
        padding: '3px 8px',
        borderBottom: '1px solid #1a1a1a',
        flexShrink: 0,
      }}>
        {['TICKER', 'NOME', 'PREÃO', '%'].map(h => (
          <span key={h} style={{ color: '#444', fontSize: '8px', fontWeight: 700, letterSpacing: '1px' }}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '10px' }}>LOADING...</div>
        )}
        {error && (
          <div style={{ padding: '12px 8px', color: '#f44336', fontSize: '9px' }}>
            ERR: {error}
          </div>
        )}
        {!loading && !error && stocks.map(s => {
          const pos = s.changePct >= 0;
          return (
            <div
              key={s.symbol}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('application/x-ticker', JSON.stringify({ symbol: s.symbol, name: s.name, type: 'EQUITY' }));
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: '72px 1fr 64px 64px',
                padding: '4px 8px',
                borderBottom: '1px solid #141414',
                alignItems: 'center',
                cursor: 'grab',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#141414'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: '#e0e0e0', fontSize: '10px', fontWeight: 700 }}>{s.symbol}</span>
              <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 4 }}>{s.name}</span>
              <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt(s.price)}</span>
              <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', fontWeight: 600, textAlign: 'right' }}>
                {fmtPct(s.changePct)}
              </span>
            </div>
          );
        })}
      </div>

      {lastUpdate && (
        <div style={{ padding: '3px 8px', borderTop: '1px solid #1a1a1a', color: '#333', fontSize: '8px', flexShrink: 0 }}>
          via brapi.dev Â· atualizado {lastUpdate.toLocaleTimeString('pt-BR')}
        </div>
      )}
    </div>
  );
}
