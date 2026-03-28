import { useState, useEffect, memo } from 'react';

function getMarketState() {
  const now = new Date();
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = ny.getDay();
  const h = ny.getHours();
  const m = ny.getMinutes();
  const mins = h * 60 + m;

  const isWeekday = day >= 1 && day <= 5;
  const preMarket = mins >= 240 && mins < 570;   // 4:00 AM - 9:30 AM ET
  const regular   = mins >= 570 && mins < 960;   // 9:30 AM - 4:00 PM ET
  const afterHours = mins >= 960 && mins < 1200; // 4:00 PM - 8:00 PM ET

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

  useEffect(() => {
    const id = setInterval(() => setState(getMarketState()), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="market-status">
      <span className={`dot ${state.status}`} />
      <span>{state.label}</span>
      {state.countdown && <span style={{ opacity: 0.7 }}>{state.countdown}</span>}
    </div>
  );
}

export default memo(MarketStatus);
