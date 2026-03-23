import { useState, useEffect } from 'react';
import { SectionHeader } from '../common/SectionHeader';

const SERVER_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || '';

const REGIONS = {
  AMERICAS: { label: 'AMERICAS',  tickers: ['SPY','QQQ','DIA','EWZ','EWW','EWC'] },
  EMEA:     { label: 'EMEA',      tickers: ['EZU','EWU','EWG','EWQ','EWP','EWI','EWL','EWD'] },
  ASIA:     { label: 'ASIA-PAC',  tickers: ['EWJ','EWH','EWY','EWA','MCHI','EWT','EWS','INDA'] },
};

const NAMES = {
  SPY:'S&P 500', QQQ:'NASDAQ 100', DIA:'DOW JONES', EWZ:'BRAZIL', EWW:'MEXICO', EWC:'CANADA',
  EZU:'EURO STOXX', EWU:'UK FTSE', EWG:'GERMANY DAX', EWQ:'FRANCE CAC', EWP:'SPAIN IBEX',
  EWI:'ITALY MIB', EWL:'SWITZERLAND', EWD:'SWEDEN',
  EWJ:'JAPAN NIKKEI', EWH:'HONG KONG', EWY:'KOREA KOSPI', EWA:'AUSTRALIA ASX',
  MCHI:'CHINA', EWT:'TAIWAN', EWS:'SINGAPORE', INDA:'INDIA',
};

export default function GlobalIndicesPanel({ onTickerClick }) {
  const [data, setData]       = useState({});
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res  = await fetch(`${SERVER_URL}/api/snapshot/global-indices`);
      const json = await res.json();
      const map  = {};
      (json.tickers || []).forEach(t => {
        // Prefer min.c (live minute close) — day.c is 0 during market hours
        const price = (t.min?.c > 0 ? t.min.c : null)
          ?? (t.day?.c > 0 ? t.day.c : null)
          ?? (t.prevDay?.c && t.todaysChange != null ? t.prevDay.c + t.todaysChange : null)
          ?? t.prevDay?.c
          ?? 0;
        map[t.ticker] = { price, changePct: t.todaysChangePerc ?? 0, change: t.todaysChange ?? 0 };
      });
      setData(map);
    } catch (e) {
      console.error('[GlobalIndices]', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 15_000); // refresh every 15s
    return () => clearInterval(t);
  }, []);

  const fmtPrice = p => (!p || p === 0) ? '—'
    : p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct   = p => (!p && p !== 0) ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
  const color    = p => !p ? '#888' : p >= 0 ? '#00c853' : '#f44336';

  const panelStyle = {
    background: '#0d0d14', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10,
  };
  const regionHeader = {
    color: '#e55a00', fontSize: 7, fontWeight: 600, letterSpacing: '0.1em',
    padding: '3px 6px 2px', background: '#111118',
    borderBottom: '1px solid #1a1a2e', textTransform: 'uppercase',
  };
  const rowStyle = i => ({
    display: 'grid', gridTemplateColumns: '44px 1fr 56px 52px',
    padding: '2px 6px', borderBottom: '1px solid #0f0f1a',
    background: i % 2 === 0 ? 'transparent' : '#060608',
    cursor: 'grab',
  });

  return (
    <div style={panelStyle}>
      <SectionHeader title="GLOBAL EQUITY INDICES" right={loading ? 'Loading...' : null} />
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {Object.entries(REGIONS).map(([key, region]) => (
          <div key={key}>
            <div style={regionHeader}>{region.label}</div>
            {region.tickers.map((ticker, i) => {
              const d = data[ticker] || {};
              return (
                <div
                  key={ticker}
                  style={rowStyle(i)}
                  draggable
                  onDragStart={e => {
                    // Use application/x-ticker so ChartPanel can receive it
                    e.dataTransfer.setData('application/x-ticker',
                      JSON.stringify({ symbol: ticker, label: NAMES[ticker] || ticker }));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onTickerClick?.({ symbol: ticker, label: NAMES[ticker] || ticker })}
                >
                  <span style={{ color: '#e8a020', fontWeight: 500, fontSize: 9 }}>{ticker}</span>
                  <span style={{ color: '#777', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {NAMES[ticker]}
                  </span>
                  <span style={{ textAlign: 'right', color: '#ccc' }}>{fmtPrice(d.price)}</span>
                  <span style={{ textAlign: 'right', color: color(d.changePct), fontWeight: 500 }}>
                    {fmtPct(d.changePct)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
