/**
 * SuggestedScreens.jsx
 * Layout presets available from the Settings drawer.
 * Now reads from the unified WORKSPACE_TEMPLATES registry.
 */

import { useState, useMemo, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { getTemplatesByCategory } from '../../config/templates';
import { PANEL_DEFINITIONS } from '../../config/panels';

// ── Build panel label map for tooltips ──────────────────────────────────────
const PANEL_LABELS = Object.fromEntries(
  Object.values(PANEL_DEFINITIONS).map(d => [d.id, d.label])
);

// ── Memoized screen item to prevent unnecessary re-renders ──────────────────
const ScreenItem = memo(function ScreenItem({ screen, isApplying, wasApplied, isCurrent, onApply }) {
  const panelList = screen.layout?.desktopRows
    ?.flat()
    .filter(Boolean)
    .map(panelId => PANEL_LABELS[panelId] || panelId)
    .join(', ') || '';

  return (
    <div
      role="button"
      tabIndex={0}
      title={`Panels: ${panelList}`}
      onClick={onApply}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onApply(); } }}
      onMouseEnter={e => e.currentTarget.style.background = '#141414'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', borderBottom: '1px solid #141414',
        cursor: isApplying ? 'wait' : 'default',
        outline: 'none',
      }}
    >
      <div>
        <div style={{
          color: isCurrent ? '#ff6600' : '#ccc',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.4px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          {isCurrent && <span title="Currently active layout">●</span>}
          {screen.label}
        </div>
        <div style={{ color: '#444', fontSize: 8, marginTop: 1, letterSpacing: '0.2px' }}>{screen.description}</div>
      </div>
      <button className="btn"
        onClick={(e) => { e.stopPropagation(); onApply(); }}
        disabled={!!isApplying}
        style={{
          background: wasApplied ? '#1a3a1a' : 'none',
          border:  wasApplied ? '1px solid #00cc66' : '1px solid #2a2a2a',
          color:   wasApplied ? '#00cc66' : isApplying ? '#ff6600' : isCurrent ? '#ff6600' : '#555',
          fontSize: 8, padding: '2px 6px', cursor: isApplying ? 'wait' : 'pointer', letterSpacing: '0.3px',
          minWidth: 48, flexShrink: 0,
          transition: 'all 150ms ease-out',
        }}
      >
        {wasApplied ? '✓ APPLIED' : isApplying ? 'LOADING…' : isCurrent ? '✓ ACTIVE' : 'APPLY →'}
      </button>
    </div>
  );
});

// ── Component ─────────────────────────────────────────────────────────────────
export default function SuggestedScreens({ onApply }) {
  const { settings, applyTemplate } = useSettings();
  const [applying, setApplying] = useState(null);
  const [applied,  setApplied]  = useState(null);
  const [error, setError] = useState(null);

  // All non-onboarding templates (trading screens)
  const screens = useMemo(() => getTemplatesByCategory('layout'), []);

  // Detect current active template
  const activeId = settings?.activeTemplate || null;

  const handleApply = async (screen) => {
    if (applying) return;
    setApplying(screen.id);
    setError(null);
    try {
      await applyTemplate(screen.id, 'full');
      setApplied(screen.id);
      setTimeout(() => setApplied(null), 3000);
      onApply?.();
    } catch (e) {
      const errorMsg = e.message || 'Failed to apply screen';
      setError(`Error: ${errorMsg}`);
      console.error('[SuggestedScreens] apply failed:', e.message);
      setTimeout(() => setError(null), 4000);
    } finally {
      setApplying(null);
    }
  };

  return (
    <div>
      {error && (
        <div style={{
          padding: '6px 12px', borderBottom: '1px solid #3a1a1a',
          color: '#ff4444', fontSize: 8, letterSpacing: '0.2px',
          background: '#1a0a0a',
        }}>
          {error}
        </div>
      )}
      {screens.map(screen => (
        <ScreenItem
          key={screen.id}
          screen={screen}
          isApplying={applying === screen.id}
          wasApplied={applied === screen.id}
          isCurrent={activeId === screen.id}
          onApply={() => handleApply(screen)}
        />
      ))}
    </div>
  );
}

// Legacy export for anything still importing SUGGESTED_SCREENS
export const SUGGESTED_SCREENS = getTemplatesByCategory('layout');
