/**
 * FeedStatusContext.jsx
 * Shares Polygon WebSocket feed health (live / degraded / error / connecting)
 * with every panel without prop drilling.
 *
 * Usage:
 *   // wrap at App level: <FeedStatusProvider status={feedStatus}>
 *   // consume in panel:  const { getStatus } = useFeedStatus();
 *                         const level = getStatus('stocks'); // 'live' | 'degraded' | 'error' | 'connecting'
 */

import { createContext, useContext } from 'react';

const FeedStatusContext = createContext({ stocks: 'connecting', forex: 'connecting', crypto: 'connecting' });

export function FeedStatusProvider({ status, children }) {
  return (
    <FeedStatusContext.Provider value={status}>
      {children}
    </FeedStatusContext.Provider>
  );
}

export function useFeedStatus() {
  const status = useContext(FeedStatusContext);
  const getStatus  = (feed) => status?.[feed] ?? 'connecting';
  const getColor   = (feed) => {
    const lvl = getStatus(feed);
    if (lvl === 'live')     return '#00cc66';
    if (lvl === 'degraded') return '#ff9900';
    if (lvl === 'error')    return '#ff3333';
    return '#444'; // connecting
  };
  const getBadge = (feed) => {
    const lvl = getStatus(feed);
    if (lvl === 'live')     return { text: 'L1 REAL-TIME', color: '#00cc66', bg: '#001a0d' };
    if (lvl === 'degraded') return { text: 'DEGRADED',    color: '#ff9900', bg: '#1a0e00' };
    if (lvl === 'error')    return { text: 'FEED DOWN',   color: '#ff3333', bg: '#1a0000' };
    return                          { text: 'CONNECTING', color: '#444',    bg: '#111' };
  };
  return { status, getStatus, getColor, getBadge };
}
