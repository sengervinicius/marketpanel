import { useState, useEffect, memo } from 'react';

const EXCHANGES = [
  { code: 'NYSE',  label: 'US',  tz: 'America/New_York',  open: 570,  close: 960  }, // 9:30-16:00
  { code: 'LSE',   label: 'LDN', tz: 'Europe/London',     open: 480,  close: 990  }, // 8:00-16:30
  { code: 'XETR',  label: 'FRA', tz: 'Europe/Berlin',     open: 540,  close: 1050 }, // 9:00-17:30
  { code: 'TSE',   label: 'TKY', tz: 'Asia/Tokyo',        open: 540,  close: 930  }, // 9:00-15:30
  { code: 'HKEX',  label: 'HKG', tz: 'Asia/Hong_Kong',    open: 570,  close: 960  }, // 9:30-16:00
  { code: 'KRX',   label: 'KRX', tz: 'Asia/Seoul',        open: 540,  close: 930  }, // 9:00-15:30
  { code: 'TWSE',  label: 'TWN', tz: 'Asia/Taipei',       open: 540,  close: 810  }, // 9:00-13:30
  { code: 'B3',    label: 'B3',  tz: 'America/Sao_Paulo', open: 600,  close: 1075 }, // 10:00-17:55
];

// US pre-market / after-hours boundaries (in minutes from midnight, NY time)
const US_PREMARKET_START = 240;  // 4:00 AM
const US_OPEN = 570;             // 9:30 AM
const US_CLOSE = 960;            // 4:00 PM
const US_AFTERHOURS_END = 1200;  // 8:00 PM

function getExchangeMinutes(tz) {
  try {
    const now = new Date();
    const h = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10);
    const m = parseInt(now.toLocaleString('en-US', { timeZone: tz, minute: 'numeric' }), 10);
    const dayStr = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
    if (isNaN(h) || isNaN(m)) return null;
    return { mins: h * 60 + m, isWeekday: dayStr !== 'Sat' && dayStr !== 'Sun' };
  } catch {
    return null;
  }
}

function isExchangeOpen(tz, openMin, closeMin) {
  const t = getExchangeMinutes(tz);
  if (!t || !t.isWeekday) return false;
  return t.mins >= openMin && t.mins < closeMin;
}

/**
 * Get the exchange status closest/most relevant to the user's local timezone.
 * Priority: show an OPEN exchange near the user, or the next one to open.
 */
function getSmartMarketState() {
  const now = new Date();
  const userTzOffset = -now.getTimezoneOffset(); // user offset in minutes from UTC (e.g., London BST = +60)

  // Compute state for each exchange
  const states = EXCHANGES.map(ex => {
    const t = getExchangeMinutes(ex.tz);
    if (!t) return { ...ex, isOpen: false, minsToOpen: Infinity, minsToClose: 0, tzDiff: Infinity };

    const isOpen = t.isWeekday && t.mins >= ex.open && t.mins < ex.close;
    const minsToClose = isOpen ? ex.close - t.mins : 0;
    const minsToOpen = (!isOpen && t.isWeekday && t.mins < ex.open) ? ex.open - t.mins : Infinity;

    // Compute how close this exchange's timezone is to user's timezone
    // Get exchange UTC offset
    const exOffset = getTimezoneOffset(ex.tz);
    const tzDiff = Math.abs(userTzOffset - exOffset);

    return { ...ex, isOpen, minsToOpen, minsToClose, tzDiff, mins: t.mins, isWeekday: t.isWeekday };
  });

  // 1. Find open exchanges
  const openExchanges = states.filter(s => s.isOpen);

  // 2. Smart priority: local exchange → US → other major → rest
  //    "Local" = within 2h of user's timezone; US always gets priority over smaller markets
  if (openExchanges.length > 0) {
    // Global importance ranking (lower = more important)
    const importance = { NYSE: 0, LSE: 1, XETR: 2, TSE: 3, HKEX: 4, KRX: 5, TWSE: 6, B3: 7 };

    // User's local exchange (closest timezone)
    const local = openExchanges.filter(e => e.tzDiff <= 120).sort((a, b) =>
      a.tzDiff - b.tzDiff || (importance[a.code] ?? 99) - (importance[b.code] ?? 99)
    );

    // Pick: local if available, else US if open, else most important open exchange
    const best = local[0]
      || openExchanges.find(e => e.code === 'NYSE')
      || openExchanges.sort((a, b) => (importance[a.code] ?? 99) - (importance[b.code] ?? 99))[0];

    const ch = Math.floor(best.minsToClose / 60);
    const cm = best.minsToClose % 60;
    return {
      status: 'open',
      label: `${best.label} Open`,
      countdown: `Closes in ${ch}h ${cm}m`,
      exchange: best.code,
    };
  }

  // 3. Check US pre-market / after-hours (special case since US is the dominant market)
  const usState = states.find(s => s.code === 'NYSE');
  if (usState && usState.isWeekday) {
    const nyMins = usState.mins;
    if (nyMins >= US_PREMARKET_START && nyMins < US_OPEN) {
      const openIn = US_OPEN - nyMins;
      const oh = Math.floor(openIn / 60);
      const om = openIn % 60;
      return { status: 'pre', label: 'US Pre-Market', countdown: `Opens in ${oh}h ${om}m`, exchange: 'NYSE' };
    }
    if (nyMins >= US_CLOSE && nyMins < US_AFTERHOURS_END) {
      return { status: 'after', label: 'US After Hours', countdown: null, exchange: 'NYSE' };
    }
  }

  // 4. Find the next exchange to open (closest by time), preferring importance
  const importance2 = { NYSE: 0, LSE: 1, XETR: 2, TSE: 3, HKEX: 4, KRX: 5, TWSE: 6, B3: 7 };
  const upcoming = states
    .filter(s => s.minsToOpen < Infinity)
    .sort((a, b) => a.minsToOpen - b.minsToOpen || (importance2[a.code] ?? 99) - (importance2[b.code] ?? 99));

  if (upcoming.length > 0) {
    const next = upcoming[0];
    const oh = Math.floor(next.minsToOpen / 60);
    const om = next.minsToOpen % 60;
    return {
      status: 'closed',
      label: `${next.label} Next`,
      countdown: `Opens in ${oh}h ${om}m`,
      exchange: next.code,
    };
  }

  // 5. Weekend / all closed
  return { status: 'closed', label: 'Markets Closed', countdown: null, exchange: null };
}

/**
 * Get UTC offset in minutes for a timezone (positive = east of UTC)
 */
function getTimezoneOffset(tz) {
  try {
    const now = new Date();
    // Create a formatted date string in the target timezone and parse it
    const parts = now.toLocaleString('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const tzDate = new Date(parts);
    const utcDate = new Date(now.toLocaleString('en-US', {
      timeZone: 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }));
    return Math.round((tzDate - utcDate) / 60000);
  } catch {
    return 0;
  }
}

function MarketStatus() {
  const [state, setState] = useState(() => getSmartMarketState());
  const [exchanges, setExchanges] = useState([]);

  useEffect(() => {
    const update = () => {
      setState(getSmartMarketState());
      setExchanges(EXCHANGES.map(ex => ({
        ...ex,
        isOpen: isExchangeOpen(ex.tz, ex.open, ex.close),
      })));
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, []);

  const dotClass = state.status === 'open' ? 'open'
    : state.status === 'pre' || state.status === 'after' ? 'pre'
    : 'closed';

  return (
    <div className="market-status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Primary status — smart: shows nearest open exchange */}
      <span className={`dot ${dotClass}`} />
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

// Export for server-side AI context — still returns US market state
function getMarketState() {
  const now = new Date();
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = ny.getDay();
  const h = ny.getHours();
  const m = ny.getMinutes();
  const mins = h * 60 + m;
  const isWeekday = day >= 1 && day <= 5;
  if (!isWeekday) return { status: 'closed', label: 'Market Closed', countdown: null };
  if (mins >= 570 && mins < 960) return { status: 'open', label: 'Market Open', countdown: null };
  if (mins >= 240 && mins < 570) return { status: 'pre', label: 'Pre-Market', countdown: null };
  if (mins >= 960 && mins < 1200) return { status: 'pre', label: 'After Hours', countdown: null };
  return { status: 'closed', label: 'Market Closed', countdown: null };
}

export { getMarketState };
export default memo(MarketStatus);
