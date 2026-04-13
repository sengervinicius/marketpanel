/**
 * AnalysisCard.jsx — Renders structured deep analysis (portfolio autopsy, counter-thesis, scenario analysis)
 * as terminal-style cards matching the Particle aesthetic.
 */
import React from 'react';
import './AnalysisCard.css';

export default function AnalysisCard({ data }) {
  if (!data) return null;

  const { type } = data;

  switch (type) {
    case 'portfolio_autopsy':
      return <PortfolioAutopsyCard data={data} />;
    case 'counter_thesis':
      return <CounterThesisCard data={data} />;
    case 'scenario_analysis':
      return <ScenarioAnalysisCard data={data} />;
    default:
      return null;
  }
}

// ── Portfolio Autopsy Card ──────────────────────────────────────────────────
function PortfolioAutopsyCard({ data }) {
  const {
    sentiment = 'neutral',
    headline = '',
    metrics = {},
    strengths = [],
    weaknesses = [],
    recommendations = [],
    bottomLine = '',
  } = data;

  return (
    <div className={`analysis-card analysis-card--autopsy analysis-card--${sentiment}`}>
      {/* Header */}
      <div className="analysis-card-header">
        <div className="analysis-card-title-group">
          <span className={`analysis-card-sentiment analysis-card-sentiment--${sentiment}`}>
            {sentiment.toUpperCase()}
          </span>
          <h3 className="analysis-card-headline">{headline}</h3>
        </div>
      </div>

      {/* Metrics Grid */}
      {Object.keys(metrics).length > 0 && (
        <div className="analysis-card-section">
          <h4 className="analysis-card-section-title">Metrics</h4>
          <div className="analysis-card-metrics-grid">
            {Object.entries(metrics).map(([key, value]) => (
              <div key={key} className="analysis-card-metric-item">
                <span className="analysis-card-metric-label">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </span>
                <span className="analysis-card-metric-value">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strengths and Weaknesses in columns */}
      <div className="analysis-card-two-column">
        {strengths.length > 0 && (
          <div className="analysis-card-section">
            <h4 className="analysis-card-section-title analysis-card-section-title--positive">
              Strengths
            </h4>
            <ul className="analysis-card-list">
              {strengths.map((item, i) => (
                <li key={i} className="analysis-card-list-item">
                  <span className="analysis-card-list-bullet">+</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {weaknesses.length > 0 && (
          <div className="analysis-card-section">
            <h4 className="analysis-card-section-title analysis-card-section-title--negative">
              Weaknesses
            </h4>
            <ul className="analysis-card-list">
              {weaknesses.map((item, i) => (
                <li key={i} className="analysis-card-list-item">
                  <span className="analysis-card-list-bullet">−</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="analysis-card-section">
          <h4 className="analysis-card-section-title">Recommendations</h4>
          <div className="analysis-card-recommendations">
            {recommendations.map((rec, i) => (
              <div key={i} className={`analysis-card-rec-item analysis-card-rec-item--${rec.action}`}>
                <span className="analysis-card-rec-action">{rec.action}</span>
                <span className="analysis-card-rec-ticker">{rec.ticker}</span>
                <span className="analysis-card-rec-reason">{rec.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Line */}
      {bottomLine && (
        <div className="analysis-card-bottom-line">
          <span className="analysis-card-bottom-line-label">BOTTOM LINE</span>
          <span className="analysis-card-bottom-line-text">{bottomLine}</span>
        </div>
      )}
    </div>
  );
}

// ── Counter-Thesis Card ─────────────────────────────────────────────────────
function CounterThesisCard({ data }) {
  const {
    sentiment = 'neutral',
    originalThesis = '',
    counterArguments = [],
    riskFactors = [],
    probabilityAssessment = '',
    bottomLine = '',
  } = data;

  return (
    <div className={`analysis-card analysis-card--counter analysis-card--${sentiment}`}>
      {/* Header */}
      <div className="analysis-card-header">
        <div className="analysis-card-title-group">
          <span className={`analysis-card-sentiment analysis-card-sentiment--${sentiment}`}>
            {sentiment.toUpperCase()}
          </span>
          <h3 className="analysis-card-headline">Counter-Thesis</h3>
        </div>
        {originalThesis && (
          <p className="analysis-card-original-thesis">
            Your view: <em>{originalThesis}</em>
          </p>
        )}
      </div>

      {/* Counter Arguments */}
      {counterArguments.length > 0 && (
        <div className="analysis-card-section">
          <h4 className="analysis-card-section-title">Counter Arguments</h4>
          <div className="analysis-card-arguments">
            {counterArguments.map((arg, i) => (
              <div
                key={i}
                className={`analysis-card-argument analysis-card-argument--${arg.severity}`}
              >
                <div className="analysis-card-argument-point">{arg.point}</div>
                {arg.evidence && (
                  <div className="analysis-card-argument-evidence">{arg.evidence}</div>
                )}
                {arg.severity && (
                  <span className="analysis-card-argument-severity">{arg.severity}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risk Factors */}
      {riskFactors.length > 0 && (
        <div className="analysis-card-section">
          <h4 className="analysis-card-section-title analysis-card-section-title--negative">
            Risk Factors
          </h4>
          <ul className="analysis-card-list">
            {riskFactors.map((risk, i) => (
              <li key={i} className="analysis-card-list-item">
                <span className="analysis-card-list-bullet">!</span>
                {risk}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Probability Assessment */}
      {probabilityAssessment && (
        <div className="analysis-card-assessment">
          <span className="analysis-card-assessment-label">Probability</span>
          <span className="analysis-card-assessment-value">{probabilityAssessment}</span>
        </div>
      )}

      {/* Bottom Line */}
      {bottomLine && (
        <div className="analysis-card-bottom-line">
          <span className="analysis-card-bottom-line-label">BOTTOM LINE</span>
          <span className="analysis-card-bottom-line-text">{bottomLine}</span>
        </div>
      )}
    </div>
  );
}

// ── Scenario Analysis Card ──────────────────────────────────────────────────
function ScenarioAnalysisCard({ data }) {
  const { scenarios = [], bottomLine = '' } = data;

  // Determine which scenarios are present and their layout
  const bullCase = scenarios.find(s => s.name.toLowerCase().includes('bull'));
  const baseCase = scenarios.find(s => s.name.toLowerCase().includes('base'));
  const bearCase = scenarios.find(s => s.name.toLowerCase().includes('bear'));

  return (
    <div className="analysis-card analysis-card--scenario">
      {/* Header */}
      <div className="analysis-card-header">
        <h3 className="analysis-card-headline">Scenario Analysis</h3>
      </div>

      {/* Three-column scenario layout */}
      <div className="analysis-card-scenarios">
        {bullCase && <ScenarioColumn scenario={bullCase} mood="bull" />}
        {baseCase && <ScenarioColumn scenario={baseCase} mood="neutral" />}
        {bearCase && <ScenarioColumn scenario={bearCase} mood="bear" />}
      </div>

      {/* Bottom Line */}
      {bottomLine && (
        <div className="analysis-card-bottom-line">
          <span className="analysis-card-bottom-line-label">BOTTOM LINE</span>
          <span className="analysis-card-bottom-line-text">{bottomLine}</span>
        </div>
      )}
    </div>
  );
}

function ScenarioColumn({ scenario, mood }) {
  const { name = '', probability = '', outcome = '', keyDrivers = [], targetLevel = '' } = scenario;

  return (
    <div className={`analysis-card-scenario analysis-card-scenario--${mood}`}>
      <div className="analysis-card-scenario-header">
        <h4 className="analysis-card-scenario-name">{name}</h4>
        {probability && (
          <span className={`analysis-card-scenario-prob analysis-card-scenario-prob--${mood}`}>
            {probability}
          </span>
        )}
      </div>

      {outcome && <p className="analysis-card-scenario-outcome">{outcome}</p>}

      {keyDrivers.length > 0 && (
        <div className="analysis-card-scenario-drivers">
          <span className="analysis-card-scenario-drivers-label">Drivers</span>
          <ul className="analysis-card-scenario-drivers-list">
            {keyDrivers.map((driver, i) => (
              <li key={i}>{driver}</li>
            ))}
          </ul>
        </div>
      )}

      {targetLevel && (
        <div className="analysis-card-scenario-target">
          <span className="analysis-card-scenario-target-label">Target</span>
          <span className="analysis-card-scenario-target-value">{targetLevel}</span>
        </div>
      )}
    </div>
  );
}
