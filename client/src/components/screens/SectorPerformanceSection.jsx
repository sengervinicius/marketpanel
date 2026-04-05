/**
 * SectorPerformanceSection.jsx — S4.3.B
 * Reusable performance ranking section for sector screens.
 * Fetches /api/market/sector-metrics and renders a sortable table.
 */
import { memo, useState, useMemo } from 'react';
import useSectionData from '../../hooks/useSectionData';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { DeepSkeleton, DeepError } from './DeepScreenBase';
import { apiFetch } from '../../utils/api';

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

function SectorPerformanceSection({ tickers = [], title }) {
  const openDetail = useOpenDetail();
  const [sortKey, setSortKey] = useState('changePct1d');
  const [sortAsc, setSortAsc] = useState(false);

  const tickerStr = tickers.join(',');
  const { data, loading, error } = useSectionData({
    cacheKey: `sector-perf:${tickerStr}`,
    fetcher: async () => {
      if (!tickers.length) return null;
      const res = await apiFetch(`/api/market/sector-metrics?tickers=${encodeURIComponent(tickerStr)}`);
      return res.ok ? await res.json() : null;
    },
    refreshMs: 120000, // 2-minute refresh
  });

  const rows = useMemo(() => {
    if (!data?.data) return [];
    return tickers
      .map(sym => ({ symbol: sym, ...data.data[sym] }))
      .filter(r => r.price != null)
      .sort((a, b) => {
        const aVal = a[sortKey] ?? -Infinity;
        const bVal = b[sortKey] ?? -Infinity;
        return sortAsc ? aVal - bVal : bVal - aVal;
      });
  }, [data, tickers, sortKey, sortAsc]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const sortArrow = (key) => sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '';

  if (loading && !data) return <DeepSkeleton rows={tickers.length} />;
  if (error) return <DeepError message={error} />;
  if (!rows.length) return null;

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Ticker</th>
          <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('price')}>Price{sortArrow('price')}</th>
          <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('changePct1d')}>1D %{sortArrow('changePct1d')}</th>
          <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('volumeRatio')}>Vol Ratio{sortArrow('volumeRatio')}</th>
          <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('distFrom52wHigh')}>vs 52w High{sortArrow('distFrom52wHigh')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.symbol} className="ds-row-clickable" onClick={() => openDetail(r.symbol)}>
            <td className="ds-ticker-col">{r.symbol}</td>
            <td>{fmt(r.price)}</td>
            <td className={r.changePct1d != null && r.changePct1d >= 0 ? 'ds-up' : 'ds-down'}>
              {fmtPct(r.changePct1d)}
            </td>
            <td style={{ color: r.volumeRatio > 1.5 ? '#ff9800' : r.volumeRatio > 1 ? '#66bb6a' : '#888' }}>
              {r.volumeRatio != null ? r.volumeRatio.toFixed(2) + 'x' : '—'}
            </td>
            <td style={{ color: r.distFrom52wHigh != null && r.distFrom52wHigh > -0.05 ? '#66bb6a' : '#ef5350' }}>
              {r.distFrom52wHigh != null ? fmtPct(r.distFrom52wHigh * 100) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default memo(SectorPerformanceSection);
