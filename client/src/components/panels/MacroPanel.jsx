/**
 * MacroPanel.jsx — Macro Indicators Comparison with AI Insight
 *
 * Phase 7: Select countries, view macro indicators, get AI analysis.
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAIInsight } from '../../hooks/useAIInsight';
import './MacroPanel.css';

const shimmerStyle = `
  @keyframes macro-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;

const INDICATORS = [
  { key: 'policyRate',      label: 'Policy Rate',     fmt: v => v != null ? (v * 100).toFixed(2) + '%' : '--' },
  { key: 'cpiYoY',          label: 'CPI YoY',         fmt: v => v != null ? (v * 100).toFixed(1) + '%' : '--' },
  { key: 'realRate',        label: 'Real Rate',        fmt: v => v != null ? (v * 100).toFixed(1) + '%' : '--', derived: true },
  { key: 'gdpGrowthYoY',    label: 'GDP Growth',      fmt: v => v != null ? (v * 100).toFixed(1) + '%' : '--' },
  { key: 'unemploymentRate', label: 'Unemployment',    fmt: v => v != null ? (v * 100).toFixed(1) + '%' : '--' },
  { key: 'debtGDP',         label: 'Debt/GDP',         fmt: v => v != null ? (v * 100).toFixed(0) + '%' : '--' },
  { key: 'currentAcctGDP',  label: 'Curr Acct/GDP',    fmt: v => v != null ? (v * 100).toFixed(1) + '%' : '--' },
];

export default function MacroPanel() {
  const [availableCountries, setAvailableCountries] = useState([]);
  const [selected, setSelected] = useState(['US', 'BR', 'EU']);
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  // AI Insight using useAIInsight hook
  const aiContext = useMemo(() => ({
    countries: selected,
    indicators: INDICATORS.map(i => i.key),
    snapshot: data,
  }), [selected, data]);

  const { insight: aiInsight, loading: aiLoading, error: aiError, refresh: askMacroAI } = useAIInsight({
    type: 'macro',
    context: aiContext,
    cacheKey: `macro:${selected.join(',')}`,
    ttlMs: 300000,
    autoFetch: false,
  });

  // Fetch available countries on mount
  useEffect(() => {
    fetch('/api/macro/countries')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.ok && d.data?.countries) {
          setAvailableCountries(d.data.countries);
        }
      })
      .catch(() => {});
  }, []);

  const fetchComparison = useCallback(async () => {
    if (selected.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const indicators = INDICATORS.map(i => i.key).join(',');
      const res = await fetch(`/api/macro/compare?countries=${selected.join(',')}&indicators=${indicators}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.ok) {
        // Server returns { data: { indicators, countries: [...], asOf, stub } }
        const countries = d.data?.countries || d.data;
        setData({ ...d.data, countries: Array.isArray(countries) ? countries : [] });
      } else {
        throw new Error(d.error || 'Unknown error');
      }
    } catch (e) {
      setError(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  // Auto-fetch on mount and when selection changes
  useEffect(() => {
    fetchComparison();
  }, [fetchComparison]);

  const [maxWarning, setMaxWarning] = useState(false);

  const toggleCountry = (code) => {
    setSelected(prev => {
      if (prev.includes(code)) return prev.filter(c => c !== code);
      if (prev.length >= 6) {
        setMaxWarning(true);
        setTimeout(() => setMaxWarning(false), 3000);
        return prev; // max 4
      }
      setMaxWarning(false);
      return [...prev, code];
    });
  };


  return (
    <div className="macro-panel">
      <div className="macro-header">
        <span className="macro-title">MACRO INDICATORS</span>
        <button
          className="macro-ai-btn"
          onClick={askMacroAI}
          disabled={aiLoading || !data?.countries?.length}
        >{aiLoading ? 'ANALYZING...' : 'AI INSIGHT'}</button>
      </div>

      {/* AI Insight box */}
      {aiInsight && (
        <div className="macro-insight">
          <span className="macro-insight-badge">AI MACRO INSIGHT</span>
          <p className="macro-insight-text">{aiInsight.body}</p>
          <span className="macro-insight-meta">
            {selected.join(', ')} -- generated {new Date(aiInsight.generatedAt).toLocaleTimeString()}
          </span>
        </div>
      )}
      {aiError && <div className="macro-ai-error">{aiError}</div>}

      {/* Country selector */}
      <div className="macro-countries">
        <label className="macro-label">
          COUNTRIES (max 6)
          {maxWarning && <span style={{ color: '#f44336', marginLeft: 8, fontSize: '0.85em' }}>Maximum 6 countries selected</span>}
        </label>
        <div className="macro-chips">
          {availableCountries.map(c => {
            const isSelected = selected.includes(c.code);
            const isDisabled = !isSelected && selected.length >= 6;
            return (
              <button key={c.code}
                className={`macro-chip${isSelected ? ' macro-chip--active' : ''}${isDisabled ? ' macro-chip--disabled' : ''}`}
                onClick={() => toggleCountry(c.code)}
                disabled={isDisabled}
                style={isDisabled ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
              >
                {c.code} <span className="macro-chip-name">{c.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Comparison table */}
      {loading && (
        <>
          <style>{shimmerStyle}</style>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '8px 0' }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ height: 48, borderRadius: 3, background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)', backgroundSize: '200% 100%', animation: 'macro-shimmer 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        </>
      )}
      {error && <div className="macro-error">{error}</div>}

      {data?.countries?.length > 0 && (() => {
        // Derive real rate = policy rate - CPI
        const enriched = data.countries.map(c => ({
          ...c,
          realRate: (c.policyRate != null && c.cpiYoY != null) ? c.policyRate - c.cpiYoY : null,
        }));
        return (
        <div className="macro-table-wrap">
          <table className="macro-table">
            <thead>
              <tr>
                <th className="macro-th">Indicator</th>
                {enriched.map(c => (
                  <th key={c.country} className="macro-th macro-th--country">{c.name || c.country}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INDICATORS.map(ind => (
                <tr key={ind.key} className="macro-tr">
                  <td className="macro-td macro-td--label">{ind.label}</td>
                  {enriched.map(c => {
                    const val = c[ind.key];
                    // Color policy rate and CPI for visual emphasis
                    let color = 'var(--text-secondary)';
                    if (ind.key === 'policyRate' && val != null) {
                      color = val > 0.05 ? 'var(--accent)' : 'var(--text-secondary)';
                    }
                    if (ind.key === 'cpiYoY' && val != null) {
                      color = val > 0.04 ? 'var(--price-down)' : val < 0.02 ? 'var(--price-up)' : 'var(--text-secondary)';
                    }
                    if (ind.key === 'gdpGrowthYoY' && val != null) {
                      color = val >= 0.03 ? 'var(--price-up)' : val < 0.01 ? 'var(--price-down)' : 'var(--text-secondary)';
                    }
                    if (ind.key === 'realRate' && val != null) {
                      color = val > 0 ? 'var(--price-up)' : 'var(--price-down)';
                    }
                    return (
                      <td key={c.country} className="macro-td macro-td--value" style={{ color }}>
                        {ind.fmt(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {data.stub && <div className="macro-source">Source: stub data (FRED / ECB / BCB)</div>}
        </div>
        );
      })()}

      {/* Mini policy rate + CPI bar chart */}
      {data?.countries?.length > 0 && (
        <div className="macro-mini-chart">
          <label className="macro-label">POLICY RATE COMPARISON</label>
          <div className="macro-bars">
            {data.countries.map(c => {
              const rate = c.policyRate != null ? c.policyRate * 100 : 0;
              const maxRate = 15; // scale bar to 15%
              const width = Math.min(100, (rate / maxRate) * 100);
              return (
                <div key={c.country} className="macro-bar-row">
                  <span className="macro-bar-label">{c.country}</span>
                  <div className="macro-bar-track">
                    <div className="macro-bar-fill" style={{ width: `${width}%` }} />
                  </div>
                  <span className="macro-bar-value">{rate.toFixed(2)}%</span>
                </div>
              );
            })}
          </div>
          <label className="macro-label" style={{ marginTop: 12 }}>CPI YoY COMPARISON</label>
          <div className="macro-bars">
            {data.countries.map(c => {
              const cpi = c.cpiYoY != null ? c.cpiYoY * 100 : 0;
              const maxCpi = 12;
              const width = Math.min(100, (Math.abs(cpi) / maxCpi) * 100);
              const color = cpi > 4 ? '#d32f2f' : cpi > 2 ? '#f57c00' : '#388e3c';
              return (
                <div key={c.country} className="macro-bar-row">
                  <span className="macro-bar-label">{c.country}</span>
                  <div className="macro-bar-track">
                    <div className="macro-bar-fill" style={{ width: `${width}%`, background: color }} />
                  </div>
                  <span className="macro-bar-value">{cpi.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
