/**
 * Formatting utilities — market-style number display
 */

export function fmtPrice(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 10000) return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (Math.abs(n) >= 1000)  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return n.toFixed(decimals);
}

export function fmtChange(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}`;
}

export function fmtPct(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}%`;
}

export function fmtVol(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function colorClass(n) {
  if (n == null || isNaN(n) || n === 0) return 'neutral';
  return n > 0 ? 'up' : 'down';
}

export function decimalsForPrice(price) {
  if (price == null) return 2;
  if (price < 0.01)  return 6;
  if (price < 1)     return 4;
  if (price < 10)    return 3;
  return 2;
}
