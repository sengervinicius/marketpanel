/**
 * RiskDashboard.jsx — Portfolio Risk Analytics Visualization
 *
 * Displays:
 * - Correlation heatmap (color-coded matrix)
 * - VaR gauge (95% and 99% confidence levels)
 * - Drawdown chart (historical max drawdown)
 * - Risk contribution pie chart
 * - Sector concentration ring chart
 * - Key metrics cards (Sharpe, Sortino, Beta, Max Drawdown)
 *
 * Terminal-style dark theme matching existing Particle UI.
 */

import React, { useState, useEffect } from 'react';
import { apiJSON, API_BASE } from '../../utils/api';
import './RiskDashboard.css';

export default function RiskDashboard({ portfolioId }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!portfolioId) {
      setLoading(false);
      return;
    }

    async function loadRiskMetrics() {
      try {
        setLoading(true);
        const data = await apiJSON(`/api/risk/portfolio/${portfolioId}`);
        setMetrics(data.metrics);
        setError(null);
      } catch (err) {
        console.error('Failed to load risk metrics:', err);
        setError(err.message || 'Failed to load risk metrics');
        setMetrics(null);
      } finally {
        setLoading(false);
      }
    }

    loadRiskMetrics();
  }, [portfolioId]);

  if (loading) {
    return (
      <div className="risk-dashboard">
        <div className="risk-dashboard-loader">
          <div className="risk-dashboard-spinner"></div>
          <p>Computing risk metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="risk-dashboard">
        <div className="risk-dashboard-error">
          <span className="risk-dashboard-error-icon">!</span>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="risk-dashboard">
        <div className="risk-dashboard-empty">
          <p>No risk data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="risk-dashboard">
      {/* Key Metrics Cards */}
      <div className="risk-cards-grid">
        <MetricCard
          label="Sharpe Ratio"
          value={metrics.sharpeRatio}
          unit=""
          hint="Risk-adjusted return (higher is better)"
        />
        <MetricCard
          label="Sortino Ratio"
          value={metrics.sortinoRatio}
          unit=""
          hint="Downside-adjusted return (higher is better)"
        />
        <MetricCard
          label="Beta (vs SPY)"
          value={metrics.beta}
          unit=""
          hint="Market sensitivity (1.0 = SPY correlation)"
        />
        <MetricCard
          label="Max Drawdown"
          value={metrics.maxDrawdown}
          unit="%"
          hint="Worst peak-to-trough decline"
        />
      </div>

      {/* VaR Analysis */}
      <div className="risk-section risk-section--var">
        <h3 className="risk-section-title">Value at Risk (VaR)</h3>
        <div className="var-gauges">
          <VarGauge
            label="95% Confidence"
            var1Day={metrics.varAnalysis?.var95_1day || 0}
            var10Day={metrics.varAnalysis?.var95_10day || 0}
          />
          <VarGauge
            label="99% Confidence"
            var1Day={metrics.varAnalysis?.var99_1day || 0}
            var10Day={metrics.varAnalysis?.var99_10day || 0}
          />
        </div>
      </div>

      {/* Correlation Heatmap */}
      {metrics.correlation?.matrix?.length > 0 && (
        <div className="risk-section risk-section--correlation">
          <h3 className="risk-section-title">Position Correlation Matrix</h3>
          <CorrelationHeatmap
            symbols={metrics.correlation.symbols}
            matrix={metrics.correlation.matrix}
          />
        </div>
      )}

      {/* Risk Contribution */}
      {metrics.riskContribution?.length > 0 && (
        <div className="risk-section risk-section--contribution">
          <h3 className="risk-section-title">Risk Contribution by Position</h3>
          <RiskContributionChart data={metrics.riskContribution} />
        </div>
      )}

      {/* Sector Concentration */}
      {metrics.sectorConcentration && (
        <div className="risk-section risk-section--concentration">
          <h3 className="risk-section-title">Sector Concentration (HHI)</h3>
          <SectorConcentrationChart data={metrics.sectorConcentration} />
        </div>
      )}
    </div>
  );
}

/**
 * MetricCard — Single metric display
 */
function MetricCard({ label, value, unit, hint }) {
  const formattedValue =
    typeof value === 'number' ? value.toFixed(2) : value || '—';

  return (
    <div className="metric-card">
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value">
        {formattedValue}
        {unit && <span className="metric-card-unit">{unit}</span>}
      </div>
      {hint && <div className="metric-card-hint">{hint}</div>}
    </div>
  );
}

/**
 * VarGauge — VaR visualization for confidence levels
 */
function VarGauge({ label, var1Day, var10Day }) {
  const formatCurrency = (num) => {
    if (!num) return '$0';
    if (Math.abs(num) >= 1000000) {
      return '$' + (num / 1000000).toFixed(1) + 'M';
    }
    if (Math.abs(num) >= 1000) {
      return '$' + (num / 1000).toFixed(1) + 'K';
    }
    return '$' + num.toFixed(0);
  };

  return (
    <div className="var-gauge">
      <div className="var-gauge-label">{label}</div>
      <div className="var-gauge-bars">
        <div className="var-gauge-bar">
          <span className="var-gauge-bar-label">1-Day</span>
          <div className="var-gauge-bar-container">
            <div className="var-gauge-bar-fill"></div>
          </div>
          <span className="var-gauge-bar-value">{formatCurrency(var1Day)}</span>
        </div>
        <div className="var-gauge-bar">
          <span className="var-gauge-bar-label">10-Day</span>
          <div className="var-gauge-bar-container">
            <div className="var-gauge-bar-fill"></div>
          </div>
          <span className="var-gauge-bar-value">{formatCurrency(var10Day)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * CorrelationHeatmap — Color-coded correlation matrix
 */
function CorrelationHeatmap({ symbols, matrix }) {
  const getHeatmapColor = (value) => {
    // value: -1 to 1
    // red (high): 1
    // yellow (medium): 0
    // green (low): -1
    if (value >= 0.7) return '#ff4444'; // red (high correlation)
    if (value >= 0.3) return '#ffaa44'; // orange
    if (value >= 0) return '#ffff44'; // yellow
    if (value >= -0.3) return '#88ff88'; // light green
    return '#00ff88'; // green (low/negative correlation)
  };

  if (!matrix || matrix.length === 0) {
    return <p className="risk-empty">No correlation data available</p>;
  }

  return (
    <div className="correlation-heatmap">
      <div className="correlation-heatmap-grid">
        {/* Header row (asset labels) */}
        <div className="correlation-heatmap-corner"></div>
        {symbols.map((sym, i) => (
          <div key={`header-${i}`} className="correlation-heatmap-header">
            {sym}
          </div>
        ))}

        {/* Matrix rows */}
        {matrix.map((row, i) => (
          <React.Fragment key={`row-${i}`}>
            <div className="correlation-heatmap-row-label">{symbols[i]}</div>
            {row.map((value, j) => (
              <div
                key={`cell-${i}-${j}`}
                className="correlation-heatmap-cell"
                style={{ backgroundColor: getHeatmapColor(value) }}
                title={`${symbols[i]} - ${symbols[j]}: ${value.toFixed(2)}`}
              >
                {Math.abs(value) > 0.1 && <span className="correlation-heatmap-cell-value">
                  {value.toFixed(2)}
                </span>}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>

      {/* Legend */}
      <div className="correlation-legend">
        <div className="correlation-legend-item">
          <div className="correlation-legend-color" style={{ backgroundColor: '#ff4444' }}></div>
          <span>High (+0.7+)</span>
        </div>
        <div className="correlation-legend-item">
          <div className="correlation-legend-color" style={{ backgroundColor: '#ffaa44' }}></div>
          <span>Moderate (+0.3 to +0.7)</span>
        </div>
        <div className="correlation-legend-item">
          <div className="correlation-legend-color" style={{ backgroundColor: '#ffff44' }}></div>
          <span>Low (0 to +0.3)</span>
        </div>
        <div className="correlation-legend-item">
          <div className="correlation-legend-color" style={{ backgroundColor: '#88ff88' }}></div>
          <span>Negative (-0.3 to 0)</span>
        </div>
        <div className="correlation-legend-item">
          <div className="correlation-legend-color" style={{ backgroundColor: '#00ff88' }}></div>
          <span>Strong Negative (-1 to -0.3)</span>
        </div>
      </div>
    </div>
  );
}

/**
 * RiskContributionChart — Pie chart of risk by position
 */
function RiskContributionChart({ data }) {
  const colors = [
    '#00ff88',
    '#ff4444',
    '#ffaa44',
    '#4488ff',
    '#ff88ff',
    '#44ffff',
    '#ffff44',
    '#88ff44',
  ];

  const totalRisk = data.reduce((sum, item) => sum + (item.riskContribution || 0), 0);
  let cumulativePercent = 0;

  return (
    <div className="risk-contribution-chart">
      <div className="risk-contribution-pie">
        <svg viewBox="0 0 200 200" className="risk-contribution-svg">
          {data.map((item, i) => {
            const percentage = totalRisk > 0 ? item.riskContribution / totalRisk : 0;
            const startAngle = cumulativePercent * 360;
            const endAngle = (cumulativePercent + percentage) * 360;
            cumulativePercent += percentage;

            const startRad = (startAngle * Math.PI) / 180;
            const endRad = (endAngle * Math.PI) / 180;

            const x1 = 100 + 80 * Math.cos(startRad);
            const y1 = 100 + 80 * Math.sin(startRad);
            const x2 = 100 + 80 * Math.cos(endRad);
            const y2 = 100 + 80 * Math.sin(endRad);

            const largeArc = endAngle - startAngle > 180 ? 1 : 0;

            const path = `M 100 100 L ${x1} ${y1} A 80 80 0 ${largeArc} 1 ${x2} ${y2} Z`;

            return (
              <path
                key={`slice-${i}`}
                d={path}
                fill={colors[i % colors.length]}
                stroke="#0a0a0f"
                strokeWidth="2"
              />
            );
          })}
        </svg>
      </div>

      <div className="risk-contribution-legend">
        {data.map((item, i) => (
          <div key={`legend-${i}`} className="risk-contribution-legend-item">
            <div
              className="risk-contribution-legend-color"
              style={{ backgroundColor: colors[i % colors.length] }}
            ></div>
            <span className="risk-contribution-legend-label">{item.symbol}</span>
            <span className="risk-contribution-legend-value">
              {((totalRisk > 0 ? item.riskContribution / totalRisk : 0) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * SectorConcentrationChart — HHI visualization
 */
function SectorConcentrationChart({ data }) {
  const { hhi, concentration, bySector } = data;

  const getConcentrationColor = () => {
    if (concentration === 'high') return '#ff4444';
    if (concentration === 'moderate') return '#ffaa44';
    return '#00ff88';
  };

  return (
    <div className="sector-concentration">
      <div className="sector-concentration-hhi">
        <div className="sector-concentration-hhi-label">HHI Index</div>
        <div className="sector-concentration-hhi-value">{hhi.toFixed(0)}</div>
        <div className="sector-concentration-hhi-status" style={{ color: getConcentrationColor() }}>
          {concentration.toUpperCase()}
        </div>
        <div className="sector-concentration-hhi-scale">
          <span className="sector-concentration-hhi-scale-low">0 (Low)</span>
          <span className="sector-concentration-hhi-scale-high">10,000 (High)</span>
        </div>
      </div>

      {bySector && bySector.length > 0 && (
        <div className="sector-concentration-breakdown">
          <h4 className="sector-concentration-breakdown-title">By Sector</h4>
          <div className="sector-concentration-list">
            {bySector.map((item, i) => (
              <div key={`sector-${i}`} className="sector-item">
                <span className="sector-name">{item.sector}</span>
                <span className="sector-weight">{item.weight.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
