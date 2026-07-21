// InstrumentDetailHelpers.js – Pure utility functions and constants for InstrumentDetail

// #241 / P1.1: normalizeTicker / displayTicker now delegate to the shared
// tickerNormalize module (mirrored server-side in server/utils/tickerNormalize.js)
// so ChartPanel, InstrumentDetail, and the server agree on ticker shapes.
import { TOKEN_HEX } from '../../utils/tokenHex';
import { toPolygonWithDefault, toDisplay } from '../../utils/tickerNormalize';

export const ORANGE = TOKEN_HEX.accent;
export const GREEN  = TOKEN_HEX.up;
export const RED    = TOKEN_HEX.down;

export const RANGES = [
  { label: '1D', multiplier: 5,  timespan: 'minute', days: 1    },
  { label: '5D', multiplier: 30, timespan: 'minute', days: 5    },
  { label: '1M', multiplier: 1,  timespan: 'day',    days: 30   },
  { label: '3M', multiplier: 1,  timespan: 'day',    days: 90   },
  { label: '6M', multiplier: 1,  timespan: 'day',    days: 180  },
  { label: '1Y', multiplier: 1,  timespan: 'day',    days: 365  },
  { label: '5Y', multiplier: 1,  timespan: 'week',   days: 1825 },
];

export const normalizeTicker = toPolygonWithDefault;
export const displayTicker = toDisplay;

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

export function fmtLabel(ts, timespan, days = 0) {
  if (!ts) return '';
  const d = new Date(ts);
  if (timespan === 'minute' || timespan === 'hour') {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  // FEAT-1c: ranges longer than ~3 months carry a 2-digit year so the
  // x-axis (and tooltip) can disambiguate — "Jul 14, 26".
  if (days > 92) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * FEAT-1c — compact, readable x-axis ticks for the detail chart.
 * Label-driven (works for preset AND custom ranges):
 *   intraday  "Jul 21, 14:30" → "14:30"
 *   ≤3M       "Jul 14"        → "JUL 14"
 *   >3M       "Jul 14, 26"    → "JUL 26"
 */
export function xAxisTickFormatter(value) {
  const s = String(value ?? '');
  if (!s) return '';
  let m = s.match(/,\s*(\d{1,2}:\d{2})$/);
  if (m) return m[1];
  m = s.match(/^([A-Za-z]{3,})\.?\s+\d{1,2},\s*(\d{2})$/);
  if (m) return `${m[1].slice(0, 3)} ${m[2]}`.toUpperCase();
  return s.toUpperCase();
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
