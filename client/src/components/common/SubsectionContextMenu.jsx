/**
 * SubsectionContextMenu.jsx
 * Context menu for toggling panel subsections visibility.
 * Appears on right-click of panel headers.
 */

import { useEffect, useRef } from 'react';

export default function SubsectionContextMenu({
  x,
  y,
  availableSubsections = [],
  hiddenSubsections = [],
  onToggleSubsection,
  onClose,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const S = {
    overlay: {
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
    },
    menu: {
      position: 'fixed',
      top: y,
      left: x,
      background: '#111',
      border: '1px solid #2a2a2a',
      borderRadius: 3,
      zIndex: 1001,
      minWidth: 140,
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    },
    title: {
      padding: '6px 8px',
      borderBottom: '1px solid #1a1a1a',
      color: '#444',
      fontSize: 7,
      fontWeight: 700,
      letterSpacing: '0.12em',
      textAlign: 'center',
    },
    item: {
      padding: '6px 8px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      cursor: 'pointer',
      color: '#888',
      fontSize: 10,
      borderBottom: '1px solid #0f0f0f',
      transition: 'background-color 0.1s',
    },
    checkbox: {
      width: 12,
      height: 12,
      border: '1px solid #444',
      borderRadius: 2,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 9,
      color: '#00bcd4',
      flexShrink: 0,
    },
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.menu} ref={menuRef}>
        <div style={S.title}>SECTIONS</div>
        {availableSubsections.map((sub) => {
          const isVisible = !hiddenSubsections.includes(sub.key);
          return (
            <div
              key={sub.key}
              style={S.item}
              onClick={() => {
                onToggleSubsection?.(sub.key);
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#1a1a1a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <div style={{ ...S.checkbox, background: isVisible ? '#00bcd4' : 'transparent' }}>
                {isVisible ? '✓' : ''}
              </div>
              <span>{sub.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
