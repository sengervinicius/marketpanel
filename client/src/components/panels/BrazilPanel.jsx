// BrazilPanel.jsx — B3 stocks via server Yahoo Finance proxy (crumb auth)
import { useState, useEffect, useCallback } from 'react';

const SERVER = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || '';

const fmt    = n => n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = n => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

export default function BrazilPanel({ onTickerClick }) {
  const [stocks, setStocks]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(SERVER + '/api/snapshot/brazil');
      if (!res.ok) throw new Error('server ' + res.status);
      const json = await res.json();
      if (!json.results?.length) throw new Error('no results');
      setStocks(json.results.map(s => ({
        symbol:    s.symbol,
        name:      s.name || s.symbol,
        price:     s.price,
        change:    s.change,
        changePct: s.changePct,
        volume:    s.volume,
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
    const id = setInterval(fetchData, 15_000); // 15s refresh
    return () => clearInterval(id);
  }, [fetchData]);

  const col = { color: '#555', fontSize: 7, letterSpacing: '0.15em', textTransform: 'uppercase' };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{
        padding: '4px 8px', borderBottom: '1px solid #2a2a2a',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0
      }}>
        <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          BRASIL B3
        </span>
        {error
          ? <span style={{ color: '#f44', fontSize: 7 }}>{error}</span>
          : lastUpdate && <span style={{ color: '#444', fontSize: 7 }}>{lastUpdate.toLocaleTimeString()}</span>
        }
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 64px 52px', padding: '3px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        <span style={col}>TICKER</span>
        <span style={col}>NOME</span>
        <span style={{ ...col, textAlign: 'right' }}>PREÇO</span>
        <span style={{ ...col, textAlign: 'right' }}>CHG%</span>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && !stocks.length && (
          <div style={{ padding: 12, color: '#444', fontSize: 8, textAlign: 'center' }}>CARREGANDO...</div>
        )}
        {!loading && !error && !stocks.length && (
          <div style={{ padding: 12, color: '#444', fontSize: 8, textAlign: 'center' }}>SEM DADOS</div>
        )}
        {stocks.map((s, i) => {
          const up  = (s.changePct ?? 0) >= 0;
          const clr = up ? '#00c853' : '#f44336';
          return (
            <div
              key={s.symbol}
              data-ticker={s.symbol + '.SA'}
              data-ticker-label={s.name}
              data-ticker-type="BR"
              draggable
              onDragStart={e => {
                // Pass .SA suffix so ChartPanel routes to Yahoo Finance for B3 historical data
                e.dataTransfer.setData('application/x-ticker',
                  JSON.stringify({ symbol: s.symbol + '.SA', label: s.name || s.symbol }));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onTickerClick?.(s.symbol + '.SA')}
              style={{
                display: 'grid', gridTemplateColumns: '52px 1fr 64px 52px',
                padding: '3px 8px', borderBottom: '1px solid #111',
                alignItems: 'center', cursor: 'grab',
                background: i % 2 === 0 ? 'transparent' : '#070709',
              }}
            >
              <span style={{ color: '#e8a020', fontWeight: 700, fontSize: 9 }}>{s.symbol}</span>
              <span style={{ color: '#666', fontSize: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name}
              </span>
              <span style={{ color: '#ccc', fontSize: 9, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(s.price)}
              </span>
              <span style={{ color: clr, fontSize: 9, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {fmtPct(s.changePct)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
