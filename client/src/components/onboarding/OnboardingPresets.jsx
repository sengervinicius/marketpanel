/**
 * OnboardingPresets.jsx
 * First-login workspace picker. Professional 6-card grid.
 * Only shown once (settings.onboardingCompleted = false).
 */

import { useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import './OnboardingPresets.css';

const OPTIONS = [
  {
    key: 'brazilianInvestor',
    title: 'Brazil Focus',
    description: 'B3 equities, DI curve, BRL FX pairs, Ibovespa.',
    includes: 'VALE3, PETR4, ITUB4, USD/BRL, DI Curve',
  },
  {
    key: 'globalInvestor',
    title: 'Global Markets',
    description: 'US large-cap equities, global indexes, major FX, cross-asset overview.',
    includes: 'SPY, QQQ, EUR/USD, GLD, EEM, EFA',
  },
  {
    key: 'debtInvestor',
    title: 'Debt & Fixed Income',
    description: 'Sovereign yield curves, credit spreads, rate-sensitive ETFs.',
    includes: 'US10Y, IG/HY OAS, TLT, HYG, LQD, EMB',
  },
  {
    key: 'cryptoInvestor',
    title: 'Crypto & Digital Assets',
    description: 'Bitcoin, Ethereum, altcoins, and macro correlations.',
    includes: 'BTC, ETH, SOL, XRP, MSTR, COIN',
  },
  {
    key: 'commoditiesInvestor',
    title: 'Commodities',
    description: 'Energy, metals, agriculture, and commodity producers.',
    includes: 'GLD, WTI, Copper, Corn, Wheat, Vale, XOM',
  },
  {
    key: 'custom',
    title: 'Custom Workspace',
    description: 'Balanced defaults — configure everything to your preferences.',
    includes: 'SPY, BTC, EUR/USD, GLD — minimal starting point',
  },
];

export default function OnboardingPresets() {
  const { applyPreset, completeOnboarding } = useSettings();
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);

  const pick = async (key) => {
    if (loading) return;
    setSelected(key);
    setLoading(true);
    try { await applyPreset(key); } catch {}
    setLoading(false);
  };

  const skip = async () => {
    if (loading) return;
    setLoading(true);
    try { await completeOnboarding(); } catch {}
    setLoading(false);
  };

  return (
    <div className="obp-container">

      {/* Header */}
      <div className="obp-header">
        <div className="obp-header-label">
          SENGER MARKET TERMINAL
        </div>
        <div className="obp-header-title">
          Choose your starting workspace
        </div>
        <div className="obp-header-subtitle">
          You can customize everything later.
        </div>
      </div>

      {/* Cards — 2 columns on desktop, 1 on mobile */}
      <div className="obp-grid">
        {OPTIONS.map(({ key, title, description, includes }) => {
          const active = selected === key;
          return (
            <button
              key={key}
              onClick={() => pick(key)}
              disabled={loading}
              className={`obp-card ${active ? 'obp-card-active' : ''}`}
            >
              <div className="obp-card-header">
                <div className="obp-card-title">
                  {title}
                </div>
                <div className="obp-card-radio">
                  {active && <div className="obp-card-radio-inner" />}
                </div>
              </div>
              <div className="obp-card-description">
                {description}
              </div>
              <div className="obp-card-includes">
                INCLUDES: {includes}
              </div>
            </button>
          );
        })}
      </div>

      {/* Skip */}
      <button
        onClick={skip}
        disabled={loading}
        className="obp-skip-btn"
      >
        {loading ? 'SETTING UP...' : 'SKIP — USE DEFAULTS'}
      </button>

    </div>
  );
}
