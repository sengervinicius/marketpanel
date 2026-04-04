/**
 * WorkspaceSwitcher.jsx
 * Compact header dropdown for switching workspace templates.
 * Sits between "MARKET TERMINAL" and the world clock.
 */
import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { WORKSPACE_TEMPLATES, getTemplatesGrouped, getTemplate } from '../../config/templates';

function WorkspaceSwitcher() {
  const { settings, applyTemplate } = useSettings();
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(null);
  const [applied, setApplied] = useState(null);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Detect active template
  const activeId = settings?.activeTemplate || null;
  const activeTemplate = activeId ? getTemplate(activeId) : null;
  const activeLabel = activeTemplate ? activeTemplate.label : null;

  // Group templates for the dropdown
  const grouped = useMemo(() => getTemplatesGrouped(null), []);

  const handleApply = async (templateId) => {
    if (applying) return;
    setApplying(templateId);
    try {
      await applyTemplate(templateId, 'full');
      setApplied(templateId);
      setTimeout(() => { setApplied(null); setOpen(false); }, 800);
    } catch (e) {
      console.error('[WorkspaceSwitcher] apply failed:', e.message);
    } finally {
      setApplying(null);
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn"
        onClick={() => setOpen(s => !s)}
        title="Switch workspace"
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 8px',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: open ? '#1a0800' : 'none',
          color: open ? 'var(--accent)' : 'var(--text-faint)',
          fontSize: 8, letterSpacing: '0.6px', fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 100ms ease-out',
        }}
      >
        <span style={{ fontSize: 7, opacity: 0.6 }}>▾</span>
        {activeLabel
          ? activeLabel.toUpperCase()
          : 'WORKSPACE'}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          zIndex: 2500,
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-strong)',
          width: 260,
          maxHeight: 420,
          overflowY: 'auto',
          boxShadow: 'var(--shadow-dropdown)',
        }}>
          {Object.entries(grouped).map(([groupName, templates]) => (
            <div key={groupName}>
              {/* Group header */}
              <div style={{
                padding: '6px 10px 3px',
                color: 'var(--text-faint)',
                fontSize: 7,
                fontWeight: 700,
                letterSpacing: '1px',
                borderBottom: '1px solid var(--border-subtle)',
                background: '#080808',
              }}>
                {groupName.toUpperCase()}
              </div>

              {/* Template items */}
              {templates.map(t => {
                const isActive   = activeId === t.id;
                const isApplying = applying === t.id;
                const wasApplied = applied === t.id;
                return (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleApply(t.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleApply(t.id); } }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '5px 10px',
                      borderBottom: '1px solid #0e0e0e',
                      cursor: isApplying ? 'wait' : 'pointer',
                      outline: 'none',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 8.5,
                        fontWeight: 600,
                        letterSpacing: '0.3px',
                        color: isActive ? 'var(--accent)' : '#ccc',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}>
                        {isActive && <span style={{ fontSize: 7 }}>●</span>}
                        {t.label}
                      </div>
                      <div style={{
                        fontSize: 7,
                        color: '#444',
                        marginTop: 1,
                        letterSpacing: '0.2px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {t.description}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 7,
                      fontWeight: 700,
                      letterSpacing: '0.3px',
                      flexShrink: 0,
                      marginLeft: 8,
                      color: wasApplied ? '#00cc66'
                           : isApplying ? 'var(--accent)'
                           : isActive   ? 'var(--accent)'
                           : '#333',
                    }}>
                      {wasApplied ? '✓' : isApplying ? '...' : isActive ? 'ACTIVE' : 'APPLY'}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(WorkspaceSwitcher);
