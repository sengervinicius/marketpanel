/**
 * OnboardingPresets.jsx
 * First-login workspace picker. Professional 6-card grid.
 * Only shown once (settings.onboardingCompleted = false).
 */

import { useState } from 'react';
import { useSettings } from '../../context/SettingsContext';

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
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: '#080808',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-ui)',
      padding: '24px 16px',
      overflowY: 'auto',
    }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 32, flexShrink: 0 }}>
        <div style={{ color: '#ff6600', fontSize: 11, letterSpacing: '0.3em', fontWeight: 700, marginBottom: 10 }}>
          SENGER MARKET TERMINAL
        </div>
        <div style={{ color: '#e8e8e8', fontSize: 18, fontWeight: 700, marginBottom: 6, letterSpacing: '0.03em' }}>
          Choose your starting workspace
        </div>
        <div style={{ color: '#444', fontSize: 10, letterSpacing: '0.1em' }}>
          You can customize everything later.
        </div>
      </div>

      {/* Cards — 2 columns on desktop, 1 on mobile */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 10,
        width: '100%',
        maxWidth: 640,
        marginBottom: 28,
      }}>
        {OPTIONS.map(({ key, title, description, includes }) => {
          const active = selected === key;
          return (
            <button
              key={key}
              onClick={() => pick(key)}
              disabled={loading}
              style={{
                background:    active ? '#100900' : '#0d0d0d',
                border:        `1px solid ${active ? '#ff6600' : '#1e1e1e'}`,
                borderRadius:  4,
                padding:       '14px 16px',
                cursor:        loading ? 'wait' : 'pointer',
                textAlign:     'left',
                display:       'flex',
                flexDirection: 'column',
                gap:           6,
                transition:    'border-color 0.12s',
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 2,
              }}>
                <div style={{ color: active ? '#ff6600' : '#e0e0e0', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}>
                  {title}
                </div>
                <div style={{
                  width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                  border: `1.5px solid ${active ? '#ff6600' : '#2a2a2a'}`,
                  background: active ? '#ff6600' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {active && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#000' }} />}
                </div>
              </div>
              <div style={{ color: '#555', fontSize: 9, lineHeight: 1.5, fontFamily: 'inherit' }}>
                {description}
              </div>
              <div style={{ color: '#333', fontSize: 8, letterSpacing: '0.03em', marginTop: 2, fontFamily: 'inherit' }}>
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
        style={{
          flexShrink: 0,
          background: 'none', border: 'none',
          color: '#2a2a2a', fontSize: 9,
          cursor: loading ? 'wait' : 'pointer',
          fontFamily: 'inherit', letterSpacing: '0.12em',
          padding: '6px 12px',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
        }}
      >
        {loading ? 'SETTING UP...' : 'SKIP — USE DEFAULTS'}
      </button>

    </div>
  );
}
