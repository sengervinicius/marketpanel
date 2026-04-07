/**
 * MiniFinancials.jsx
 * Compact 3-year revenue/net income bar chart.
 */
import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { apiFetch } from '../../../utils/api';

function CustomTooltip({ active, payload }) {
  if (active && payload) {
    return (
      <div style={{
        background: '#0a0a0a',
        border: '1px solid #1e1e1e',
        padding: '6px 8px',
        borderRadius: 3,
        fontSize: 8,
        color: '#e0e0e0',
      }}>
        {payload.map((entry, idx) => (
          <div key={idx} style={{ color: entry.color }}>
            {entry.name}: ${(entry.value / 1e9).toFixed(1)}B
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export function MiniFinancials({ ticker, onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticker) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await apiFetch(`/api/market/td/financials/${ticker}?period=annual`);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();

        // Server returns { ok, data: { income_statement, balance_sheet, cash_flow } }
        const payload = json.data || json || {};
        const incomeData = payload.income_statement || payload;

        // Twelve Data income_statement is an array of annual periods
        let results = [];
        if (Array.isArray(incomeData)) {
          results = incomeData.slice(0, 3).reverse();
        } else if (incomeData?.income_statement && Array.isArray(incomeData.income_statement)) {
          results = incomeData.income_statement.slice(0, 3).reverse();
        } else {
          // Legacy format: { statements: [{type: 'income', results: [...]}] }
          const statements = json.statements || [];
          const incomeStmt = statements.find(s => s.type === 'income') || {};
          results = (incomeStmt.results || []).slice(0, 3).reverse();
        }

        const chartData = results.map(year => ({
          year: year.fiscal_period ? year.fiscal_period.slice(0, 4) : '—',
          revenue: year.revenue || 0,
          netIncome: year.net_income || 0,
        }));

        setData(chartData);
      } catch (err) {
        onError?.(err);
        setData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [ticker, onError]);

  if (loading) {
    return (
      <div style={{ height: 120, padding: 8 }}>
        <div style={{
          height: '100%',
          background: 'linear-gradient(90deg, #1a1a1a 25%, #222 50%, #1a1a1a 75%)',
          backgroundSize: '200% 100%',
          animation: 'ds-shimmer 1.5s infinite',
          borderRadius: 2,
        }} />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div style={{
        height: 120,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#666',
        fontSize: 9,
      }}>
        —
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 20, left: 8 }}>
        <XAxis dataKey="year" style={{ fontSize: 8, fill: '#666' }} />
        <YAxis style={{ fontSize: 8, fill: '#666' }} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="revenue" fill="#4a90d9" stackId="a" radius={[2, 2, 0, 0]}>
          {data.map((entry, idx) => (
            <Cell key={`rev-${idx}`} fill="#4a90d9" />
          ))}
        </Bar>
        <Bar dataKey="netIncome" fill="#4caf50" stackId="a" radius={[2, 2, 0, 0]}>
          {data.map((entry, idx) => (
            <Cell
              key={`ni-${idx}`}
              fill={entry.netIncome >= 0 ? '#4caf50' : '#f44336'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default MiniFinancials;
