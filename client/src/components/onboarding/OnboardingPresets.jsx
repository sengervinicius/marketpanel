/**
 * OnboardingPresets.jsx
 * Full-screen onboarding overlay — shown on first login.
 * User picks an investor preset which seeds their settings.
 */

import { useState } from 'react';
import { SCREEN_PRESETS } from '../../config/presets';
import { useSettings } from '../../context/SettingsContext';

export default function OnboardingPresets() {
  const { applyPreset } = useSettings();
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  const presetKeys = Object.keys(SCREEN_PRESETS);

  const handleSelect = async (key) => {
    setSelected(key);
    setLoading(true);
    try {
      await applyPreset(key);
      // After applyPreset completes, settings.onboardingCompleted becomes true
      // and this overlay will unmount automatically
    } catch {}
    setLoading(false);
  };

  const handleSkip = async () => {
    setLoading(true);
    try {
      await applyPreset('default');
    } catch {}
    setLoading(false);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9998,
      background: '#0a0a0a',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      fontFamily: '"Courier New", monospace',
      overflowY: 'auto',
      padding: '48px 16px 48px',
    }}>
      {/* Header */}
      <div style={{
        textAlign: 'center',
        marginBottom: 48,
      }}>
        <div style={{
          color: '#ff6600',
          fontSize: 14,
          letterSpacing: '0.1em',
          fontWeight: 'bold',
          marginBottom: 12,
        }}>
          SENGER
        </div>
        <div style={{
          color: '#e8e8e8',
          fontSize: 24,
          fontWeight: 'bold',
          marginBottom: 12,
          letterSpacing: '0.05em',
        }}>
          CHOOSE YOUR STARTING WORKSPACE
        </div>
        <div style={{
          color: '#666',
          fontSize: 11,
          lineHeight: 1.6,
          maxWidth: 400,
        }}>
          Select the profile that best matches your focus. You can customize everything later.
        </div>
      </div>

      {/* Preset grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 20,
        maxWidth: 1000,
        width: '100%',
      }}>
        {presetKeys.map(key => {
          const p = SCREEN_PRESETS[key];
          const active = selected === key;
          const watchlistSymbols = (p.watchlist || []).slice(0, 5);

          return (
            <div
              key={key}
              onClick={() => !loading && handleSelect(key)}
              style={{
                background: active ? '#130800' : '#0d0d0d',
                border: `1px solid ${active ? '#ff6600' : '#1e1e1e'}`,
                borderRadius: 4,
                padding: 20,
                cursor: loading ? 'wait' : 'pointer',
                transition: 'all 0.15s ease-out',
                position: 'relative',
                minHeight: 200,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Title */}
              <div style={{
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 'bold',
                marginBottom: 8,
              }}>
                {p.label}
              </div>

              {/* Description */}
              <div style={{
                color: '#666',
                fontSize: 10,
                lineHeight: 1.5,
                marginBottom: 12,
              }}>
                {p.description}
              </div>

              {/* Focus section */}
              <div style={{
                marginBottom: 12,
              }}>
                <div style={{
                  color: '#666',
                  fontSize: 8,
                  letterSpacing: '0.1em',
                  marginBottom: 4,
                }}>
                  FOCUS
                </div>
                <div style={{
                  color: '#ff6600',
                  fontSize: 9,
                  fontFamily: 'monospace',
                  fontWeight: 'normal',
                  letterSpacing: '0.05em',
                }}>
                  {p.focus}
                </div>
              </div>

              {/* Watchlist chips */}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginTop: 'auto',
              }}>
                {watchlistSymbols.map(sym => (
                  <span
                    key={sym}
                    style={{
                      background: '#0a0a0a',
                      border: '1px solid #2a2a2a',
                      borderRadius: 2,
                      padding: '2px 6px',
                      fontSize: 8,
                      color: '#ff6600',
                      fontFamily: 'monospace',
                    }}
                  >
                    {sym}
                  </span>
                ))}
              </div>

              {/* Selected checkmark */}
              {active && (
                <div style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#ff6600',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  color: '#000',
                  fontWeight: 'bold',
                }}>
                  ✓
                </div>
              )}

              {/* Loading overlay */}
              {loading && selected === key && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0, 0, 0, 0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 4,
                  fontSize: 10,
                  color: '#ff6600',
                }}>
                  APPLYING...
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Skip button */}
      <button
        onClick={handleSkip}
        disabled={loading}
        style={{
          marginTop: 48,
          background: 'none',
          border: '1px solid #2a2a2a',
          color: '#444',
          padding: '10px 24px',
          cursor: loading ? 'wait' : 'pointer',
          fontFamily: 'inherit',
          fontSize: 10,
          letterSpacing: '0.1em',
          fontWeight: 'normal',
          borderRadius: 3,
          transition: 'all 0.15s ease-out',
        }}
      >
        SKIP — USE DEFAULT SETTINGS
      </button>
    </div>
  );
}
