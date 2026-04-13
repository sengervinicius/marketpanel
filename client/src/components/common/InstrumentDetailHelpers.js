// InstrumentDetailHelpers.js – Pure utility functions and constants for InstrumentDetail

export const ORANGE = '#F97316';
export const GREEN  = '#4caf50';
export const RED    = '#f44336';

export const RANGES = [
  { label: '1D', multiplier: 5,  timespan: 'minute', days: 1    },
  { label: '5D', multiplier: 30, timespan: 'minute', days: 5    },
  { label: '1M', multiplier: 1,  timespan: 'day',    days: 30   },
  { label: '3M', multiplier: 1,  timespan: 'day',    days: 90   },
  { label: '6M', multiplier: 1,  timespan: 'day',    days: 180  },
  { label: '1Y', multiplier: 1,  timespan: 'day',    days: 365  },
  { label: '5Y', multiplier: 1,  timespan: 'week',   days: 1825 },
];

export function normalizeTicker(raw) {
  if (!raw) return 'SPY';
  if (/^[A-Z]:/.test(raw)) return raw;
  if (/^[A-Z]{6}$/.test(raw)) return 'C:' + raw;
  return raw;
}

export function displayTicker(norm) {
  if (norm.startsWith('C:')) return norm.slice(2, 5) + '/' + norm.slice(5);
  if (norm.startsWith('X:')) return norm.slice(2, 5) + '/' + norm.slice(5);
  if (norm.endsWith('.SA')) return norm.slice(0, -3);
  if (norm.includes('=F')) return norm.replace('=F', '');  // CL=F → CL, BZ=F → BZ
  return norm;
}

export function getFromDate(range) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - range.days);
  return from.toISOString().split('T')[0];
}

export function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '--';
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (Math.abs(n) >= 1e9)  return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function fmtLabel(ts, timespan) {
  if (!ts) return '';
  const d = new Date(ts);
  if (timespan === 'minute') {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function timeAgo(utc) {
  if (!utc) return '';
  const diff = (Date.now() - new Date(utc).getTime()) / 1000;
  if (diff < 60)    return 'now';
  if (diff < 3600)  return Math.round(diff / 60) + 'm';
  if (diff < 86400) return Math.round(diff / 3600) + 'h';
  return Math.round(diff / 86400) + 'd';
}

export function pct(v, dec = 1) {
  if (v == null) return '--';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(dec) + '%';
}

// ── Export chart data as CSV ────────────────────────────────────────────────
export function exportToCSV(bars, ticker, rangeLabel) {
  if (!bars.length) return;
  const disp = displayTicker(normalizeTicker(ticker));
  const header = 'Date,Open,High,Low,Close,Volume';
  const rows = bars.map(b => {
    const date = b.t ? new Date(b.t).toISOString().split('T')[0] : b.label;
    return [date, b.open ?? '', b.high ?? '', b.low ?? '', b.close ?? '', b.volume ?? ''].join(',');
  });
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${disp}_${rangeLabel}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
