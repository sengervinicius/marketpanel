/**
 * OnboardingPresets.jsx
 * Full-screen onboarding overlay — shown on first login.
 * User picks an investor preset which seeds their settings.
 */

import { useState } from 'react';
import { SCREEN_PRESETS } from '../../config/presets';
import { useSettings } from '../../context/SettingsContext';

export default function OnboardingPresets() {
  const { applyPreset, completeOnboarding } = useSettings();
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);

  const presetKeys = Object.keys(SCREEN_PRESETS);

  const handleSelect = async (key) => {
    setSelected(key);
    setLoading(true);
    try {
      await applyPreset(key);
    } catch {}
    setLoading(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: '#0a0a0a',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'flex-start',
      fontFamily: '"Courier New", monospace',
      overflowY: 'auto',
      padding: '32px 16px 48px',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ color: '#ff6600', fontSize: 10, letterSpacing: '0.4em', marginBottom: 8 }}>ARC CAPITAL</div>
        <div style={{ color: '#e0e0e0', fontSize: 22, fontWeight: 'bold', marginBottom: 8 }}>
          CHOOSE YOUR SCREEN
        </div>
        <div style={{ color: '#555', fontSize: 11 }}>
          Select the profile that best matches your focus. You can customize everything later.
        </div>
      </div>

      {/* Preset grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 16,
        maxWidth: 900, width: '100%',
      }}>
        {presetKeys.map(key => {
          const p      = SCREEN_PRESETS[key];
          const active = selected === key;
          return (
            <div
              key={key}
              onClick={() => !loading && handleSelect(key)}
              style={{
                background:    active ? '#1a0900' : '#0d0d0d',
                border:        `1px solid ${active ? '#ff6600' : '#1e1e1e'}`,
                borderRadius:  6,
                padding:       24,
                cursor:        loading ? 'wait' : 'pointer',
                transition:    'border-color 0.15s',
                position:      'relative',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>{p.emoji}</div>
              <div style={{ color: '#e0e0e0', fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>
                {p.label}
              </div>
              <div style={{ color: '#555', fontSize: 10, lineHeight: 1.6 }}>
                {p.description}
              </div>
              {/* Watchlist preview */}
              <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {(p.watchlist || []).slice(0, 6).map(sym => (
                  <span key={sym} style={{
                    background: '#161616', border: '1px solid #2a2a2a',
                    borderRadius: 2, padding: '1px 5px', fontSize: 9, color: '#ff6600',
                  }}>{sym}</span>
                ))}
              </div>
              {active && (
                <div style={{
                  position: 'absolute', top: 10, right: 10,
                  width: 20, height: 20, borderRadius: '50%',
                  background: '#ff6600', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: '#000', fontWeight: 'bold',
                }}>✓</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Skip */}
      <button
        onClick={() => completeOnboarding()}
        style={{
          marginTop: 40, background: 'none', border: '1px solid #2a2a2a',
          color: '#444', padding: '8px 24px', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.2em',
          borderRadius: 3,
        }}
      >
        SKIP — USE DEFAULT SETTINGS
      </button>
    </div>
  );
}
