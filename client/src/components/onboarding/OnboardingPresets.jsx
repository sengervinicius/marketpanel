/**
 * OnboardingPresets.jsx
 * First-login workspace picker. Clean, minimal — 3 options, pick one, go.
 */

import { useState } from 'react';
import { useSettings } from '../../context/SettingsContext';

const OPTIONS = [
  {
    key: 'brazilianInvestor',
    title: 'Brazil Focus',
    sub: 'B3 stocks, BRL pairs, DI curve, Ibovespa',
  },
  {
    key: 'globalInvestor',
    title: 'Global Markets',
    sub: 'US equities, world indices, major FX, commodities',
  },
  {
    key: 'cryptoInvestor',
    title: 'Crypto & Digital Assets',
    sub: 'BTC, ETH, SOL and top altcoins',
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
      fontFamily: '"IBM Plex Mono","Courier New",monospace',
      padding: '24px 16px',
    }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ color: '#ff6600', fontSize: 11, letterSpacing: '0.3em', fontWeight: 700, marginBottom: 12 }}>
          SENGER
        </div>
        <div style={{ color: '#e8e8e8', fontSize: 20, fontWeight: 700, marginBottom: 8, letterSpacing: '0.04em' }}>
          Choose your starting view
        </div>
        <div style={{ color: '#444', fontSize: 10, letterSpacing: '0.1em' }}>
          You can change everything later.
        </div>
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 380 }}>
        {OPTIONS.map(({ key, title, sub }) => {
          const active = selected === key;
          return (
            <button
              key={key}
              onClick={() => pick(key)}
              disabled={loading}
              style={{
                background:    active ? '#1a0800' : '#0d0d0d',
                border:        `1px solid ${active ? '#ff6600' : '#222'}`,
                borderRadius:  4,
                padding:       '16px 20px',
                cursor:        loading ? 'wait' : 'pointer',
                textAlign:     'left',
                display:       'flex',
                alignItems:    'center',
                justifyContent:'space-between',
                gap:           12,
                transition:    'border-color 0.12s',
              }}
            >
              <div>
                <div style={{ color: active ? '#ff6600' : '#e0e0e0', fontSize: 13, fontWeight: 700, marginBottom: 4, fontFamily: 'inherit' }}>
                  {title}
                </div>
                <div style={{ color: '#555', fontSize: 9, letterSpacing: '0.05em', fontFamily: 'inherit' }}>
                  {sub}
                </div>
              </div>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${active ? '#ff6600' : '#2a2a2a'}`,
                background: active ? '#ff6600' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {active && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#000' }} />}
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
          marginTop: 28,
          background: 'none', border: 'none',
          color: '#333', fontSize: 9,
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
