/**
 * MacroPanel.jsx — Macro Indicators Comparison with AI Insight
 *
 * Phase 7: Select countries, view macro indicators, get AI analysis.
 */
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import './MacroPanel.css';

const INDICATORS = [
  { key: 'policyRate',      label: 'Policy Rate',     fmt: v => v != null ? (v * 100).toFixed(2) + '%' : '--' },
  { key: 'cpiYoY',          label: 'CPI YoY',         fmt: v => v != null ? (v * 100).toFixed(1) + '%' : '--' },
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

  // AI Insight
  const [aiInsight, setAiInsight]       = useState(null);
  const [aiLoading, setAiLoading]       = useState(false);
  const [aiError, setAiError]           = useState(null);

  // Fetch available countries on mount
  useEffect(() => {
    apiFetch('/api/macro/countries')
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
      const res = await apiFetch(`/api/macro/compare?countries=${selected.join(',')}&indicators=${indicators}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.ok) setData(d.data);
      else throw new Error(d.error || 'Unknown error');
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

  const toggleCountry = (code) => {
    setSelected(prev => {
      if (prev.includes(code)) return prev.filter(c => c !== code);
      if (prev.length >= 4) return prev; // max 4
      return [...prev, code];
    });
  };

  const askMacroAI = useCallback(async () => {
    if (!data?.countries?.length) return;
    setAiLoading(true);
    setAiError(null);
    setAiInsight(null);
    try {
      const res = await apiFetch('/api/search/macro-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countries: selected,
          indicators: INDICATORS.map(i => i.key),
          snapshot: data,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.ok) setAiInsight(d);
      else throw new Error(d.error || 'AI error');
    } catch (e) {
      setAiError('Macro insight unavailable');
    } finally {
      setAiLoading(false);
    }
  }, [data, selected]);

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
          <p className="macro-insight-text">{aiInsight.insight}</p>
          <span className="macro-insight-meta">
            {aiInsight.countries?.join(', ')} -- generated {new Date(aiInsight.generatedAt).toLocaleTimeString()}
          </span>
        </div>
      )}
      {aiError && <div className="macro-ai-error">{aiError}</div>}

      {/* Country selector */}
      <div className="macro-countries">
        <label className="macro-label">COUNTRIES (max 4)</label>
        <div className="macro-chips">
          {availableCountries.map(c => (
            <button key={c.code}
              className={`macro-chip${selected.includes(c.code) ? ' macro-chip--active' : ''}`}
              onClick={() => toggleCountry(c.code)}
            >
              {c.code} <span className="macro-chip-name">{c.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Comparison table */}
      {loading && <div className="macro-loading">Loading macro data...</div>}
      {error && <div className="macro-error">{error}</div>}

      {data?.countries?.length > 0 && (
        <div className="macro-table-wrap">
          <table className="macro-table">
            <thead>
              <tr>
                <th className="macro-th">Indicator</th>
                {data.countries.map(c => (
                  <th key={c.country} className="macro-th macro-th--country">{c.name || c.country}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INDICATORS.map(ind => (
                <tr key={ind.key} className="macro-tr">
                  <td className="macro-td macro-td--label">{ind.label}</td>
                  {data.countries.map(c => {
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
      )}

      {/* Mini policy rate bar chart */}
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
        </div>
      )}
    </div>
  );
}
