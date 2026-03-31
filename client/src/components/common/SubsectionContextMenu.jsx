/**
 * SubsectionContextMenu.jsx
 * Enhanced context menu for managing panel subsections.
 * Supports visibility toggling, removing subsections, and accessing the config modal.
 * Appears on right-click of panel headers.
 */

import { useEffect, useRef } from 'react';

export default function SubsectionContextMenu({
  x,
  y,
  availableSubsections = [],
  hiddenSubsections = [],
  onToggleSubsection,
  onConfigOpen,
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
      minWidth: 180,
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
    itemRow: {
      padding: '6px 8px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      cursor: 'pointer',
      color: '#888',
      fontSize: 10,
      borderBottom: '1px solid #0f0f0f',
      transition: 'background-color 0.1s',
      justifyContent: 'space-between',
    },
    itemContent: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flex: 1,
      minWidth: 0,
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
    closeButton: {
      width: 16,
      height: 16,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#666',
      fontSize: 11,
      cursor: 'pointer',
      borderRadius: 2,
      transition: 'color 0.1s, background-color 0.1s',
      flexShrink: 0,
    },
    divider: {
      height: '1px',
      background: '#1a1a1a',
      margin: '4px 0',
    },
    manageButton: {
      padding: '8px 8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      cursor: 'pointer',
      color: '#ff6600',
      fontSize: 10,
      fontWeight: 500,
      transition: 'background-color 0.1s',
      userSelect: 'none',
    },
  };

  const handleManageTickers = () => {
    onConfigOpen?.();
    onClose?.();
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
              style={S.itemRow}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#1a1a1a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <div
                style={S.itemContent}
                onClick={() => {
                  onToggleSubsection?.(sub.key);
                }}
              >
                <div style={{ ...S.checkbox, background: isVisible ? '#00bcd4' : 'transparent' }}>
                  {isVisible ? '✓' : ''}
                </div>
                <span>{sub.label}</span>
              </div>
              <div
                style={S.closeButton}
                onClick={() => {
                  onToggleSubsection?.(sub.key);
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#999';
                  e.currentTarget.style.backgroundColor = '#1a1a1a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#666';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                title="Hide subsection"
              >
                ×
              </div>
            </div>
          );
        })}
        <div style={S.divider} />
        <div
          style={S.manageButton}
          onClick={handleManageTickers}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#1a1a1a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <span>✎ MANAGE TICKERS</span>
        </div>
      </div>
    </div>
  );
}
