import { useState, useEffect, memo } from 'react';

const EXCHANGES = [
  { code: 'NYSE',  label: 'US',  tz: 'America/New_York',  open: 570,  close: 960  }, // 9:30-16:00
  { code: 'B3',    label: 'B3',  tz: 'America/Sao_Paulo', open: 600,  close: 1020 }, // 10:00-17:00
  { code: 'LSE',   label: 'LDN', tz: 'Europe/London',     open: 480,  close: 990  }, // 8:00-16:30
  { code: 'XETR',  label: 'FRA', tz: 'Europe/Berlin',     open: 540,  close: 1050 }, // 9:00-17:30
  { code: 'HKEX',  label: 'HKG', tz: 'Asia/Hong_Kong',    open: 570,  close: 960  }, // 9:30-16:00
  { code: 'TSE',   label: 'TKY', tz: 'Asia/Tokyo',        open: 540,  close: 900  }, // 9:00-15:00
];

function isExchangeOpen(tz, openMin, closeMin) {
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const parts = timeStr.split(', ');
  const dayStr = parts[0];
  if (dayStr === 'Sat' || dayStr === 'Sun') return false;
  const [h, m] = parts[1].split(':').map(Number);
  const mins = h * 60 + m;
  return mins >= openMin && mins < closeMin;
}

function getMarketState() {
  const now = new Date();
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = ny.getDay();
  const h = ny.getHours();
  const m = ny.getMinutes();
  const mins = h * 60 + m;

  const isWeekday = day >= 1 && day <= 5;
  const preMarket = mins >= 240 && mins < 570;
  const regular   = mins >= 570 && mins < 960;
  const afterHours = mins >= 960 && mins < 1200;

  if (!isWeekday) return { status: 'closed', label: 'Market Closed', countdown: null };

  if (regular) {
    const closeMin = 960 - mins;
    const ch = Math.floor(closeMin / 60);
    const cm = closeMin % 60;
    return { status: 'open', label: 'Market Open', countdown: `Closes in ${ch}h ${cm}m` };
  }
  if (preMarket) {
    const openMin = 570 - mins;
    const oh = Math.floor(openMin / 60);
    const om = openMin % 60;
    return { status: 'pre', label: 'Pre-Market', countdown: `Opens in ${oh}h ${om}m` };
  }
  if (afterHours) return { status: 'pre', label: 'After Hours', countdown: null };
  return { status: 'closed', label: 'Market Closed', countdown: null };
}

function MarketStatus() {
  const [state, setState] = useState(getMarketState);
  const [exchanges, setExchanges] = useState([]);

  useEffect(() => {
    const update = () => {
      setState(getMarketState());
      setExchanges(EXCHANGES.map(ex => ({
        ...ex,
        isOpen: isExchangeOpen(ex.tz, ex.open, ex.close),
      })));
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="market-status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* US primary status */}
      <span className={`dot ${state.status}`} />
      <span>{state.label}</span>
      {state.countdown && <span style={{ opacity: 0.7 }}>{state.countdown}</span>}

      {/* Global exchange dots */}
      <span style={{ color: '#333', margin: '0 2px' }}>|</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {exchanges.map(ex => (
          <span key={ex.code} title={`${ex.label}: ${ex.isOpen ? 'Open' : 'Closed'}`} style={{
            display: 'flex', alignItems: 'center', gap: 2,
            fontSize: 8, letterSpacing: '0.3px', fontFamily: 'var(--font-mono, monospace)',
            color: ex.isOpen ? '#4caf50' : '#444',
          }}>
            <span style={{
              width: 4, height: 4, borderRadius: '50%',
              background: ex.isOpen ? '#4caf50' : '#2a2a2a',
              boxShadow: ex.isOpen ? '0 0 3px #4caf50' : 'none',
              display: 'inline-block',
            }} />
            {ex.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export { getMarketState };
export default memo(MarketStatus);
