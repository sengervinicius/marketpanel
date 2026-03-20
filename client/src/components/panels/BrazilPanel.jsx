import { useState, useEffect } from 'react';
import { SectionHeader } from '../common/SectionHeader';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

export default function BrazilPanel() {
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/snapshot/brazil`);
      const data = await res.json();
      if (data.results) setStocks(data.results);
      setError(null);
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const fmtPrice = p => p == null ? '—' : p.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  const fmtPct = p => p == null ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
  const color = p => !p ? '#888' : p >= 0 ? '#00c853' : '#f44336';

  const panelStyle = {background:'#0d0d14', display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:"'IBM Plex Mono', monospace", fontSize:10};
  const headerStyle = {display:'grid', gridTemplateColumns:'52px 1fr 60px 52px', padding:'2px 6px', borderBottom:'1px solid #1a1a2e', color:'#555', fontSize:7, letterSpacing:'0.08em', textTransform:'uppercase'};
  const rowStyle = (i) => ({display:'grid', gridTemplateColumns:'52px 1fr 60px 52px', padding:'2px 6px', borderBottom:'1px solid #0f0f1a', background: i%2===0?'transparent':'#060608', cursor:'grab'});

  return (
    <div style={panelStyle}>
      <SectionHeader title="B3 BRASIL" subtitle="BRL" right={loading ? 'Loading...' : `${stocks.length} ativos`} />
      <div style={headerStyle}><span>TICKER</span><span>NOME</span><span style={{textAlign:'right'}}>PREÇO</span><span style={{textAlign:'right'}}>DIA%</span></div>
      <div style={{overflowY:'auto', flex:1}}>
        {error && <div style={{color:'#f44336', padding:'8px 6px', fontSize:9}}>Error: {error}</div>}
        {stocks.map((s, i) => (
          <div
            key={s.symbol}
            style={rowStyle(i)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/json', JSON.stringify({ symbol: s.symbol, label: s.name || s.symbol }));
              e.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <span style={{color:'#e8a020', fontWeight:500}}>{s.symbol}</span>
            <span style={{color:'#777', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{s.name}</span>
            <span style={{textAlign:'right', color:'#ccc'}}>{fmtPrice(s.price)}</span>
            <span style={{textAlign:'right', color:color(s.changePct), fontWeight:500}}>{fmtPct(s.changePct)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
