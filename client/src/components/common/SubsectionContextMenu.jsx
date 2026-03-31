/**
 * SubsectionContextMenu.jsx
 * Enhanced context menu for managing panel subsections.
 * Supports: visibility toggling, renaming, adding custom sections,
 * deleting custom sections, and accessing the config modal.
 * Appears on right-click of panel headers.
 */

import { useState, useEffect, useRef } from 'react';

const SECTION_COLORS = ['#ff6600', '#00bcd4', '#ce93d8', '#ffd54f', '#81c784', '#f48fb1', '#90caf9', '#ffb74d', '#ef5350', '#26a69a'];

export default function SubsectionContextMenu({
  x,
  y,
  availableSubsections = [],
  hiddenSubsections = [],
  customSubsections = [],
  subsectionLabels = {},
  onToggleSubsection,
  onAddSubsection,
  onRenameSubsection,
  onDeleteSubsection,
  onConfigOpen,
  onClose,
}) {
  const menuRef = useRef(null);
  const [addMode, setAddMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingKey, setRenamingKey] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const addRef = useRef(null);
  const renameRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    if (addMode && addRef.current) addRef.current.focus();
  }, [addMode]);

  useEffect(() => {
    if (renamingKey && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingKey]);

  // Adjust menu position to stay within viewport
  const menuStyle = (() => {
    const style = { position: 'fixed', top: y, left: x };
    if (typeof window !== 'undefined') {
      if (x + 220 > window.innerWidth) style.left = window.innerWidth - 230;
      if (y + 400 > window.innerHeight) style.top = Math.max(10, window.innerHeight - 410);
    }
    return style;
  })();

  const handleAdd = () => {
    const name = newName.trim();
    if (name) {
      const colorIdx = customSubsections.length % SECTION_COLORS.length;
      onAddSubsection?.({ label: name, color: SECTION_COLORS[colorIdx] });
      setNewName('');
      setAddMode(false);
    }
  };

  const handleRename = (key) => {
    const name = renameVal.trim();
    if (name) {
      onRenameSubsection?.(key, name);
    }
    setRenamingKey(null);
    setRenameVal('');
  };

  const startRename = (key, currentLabel) => {
    setRenamingKey(key);
    setRenameVal(currentLabel);
  };

  const S = {
    overlay: { position: 'fixed', inset: 0, zIndex: 1000 },
    menu: {
      ...menuStyle,
      background: '#111',
      border: '1px solid #2a2a2a',
      borderRadius: 3,
      zIndex: 1001,
      minWidth: 200,
      maxWidth: 260,
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
      padding: '5px 8px',
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
    label: {
      flex: 1,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    iconBtn: {
      width: 16,
      height: 16,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#444',
      fontSize: 10,
      cursor: 'pointer',
      borderRadius: 2,
      transition: 'color 0.1s, background-color 0.1s',
      flexShrink: 0,
      background: 'none',
      border: 'none',
      padding: 0,
    },
    renameInput: {
      flex: 1,
      background: '#080808',
      border: '1px solid #ff6600',
      color: '#e0e0e0',
      fontSize: 10,
      padding: '1px 4px',
      fontFamily: '"Courier New", monospace',
      outline: 'none',
      borderRadius: 2,
      minWidth: 0,
    },
    divider: { height: '1px', background: '#1a1a1a', margin: '4px 0' },
    addButton: {
      padding: '6px 8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      cursor: 'pointer',
      color: '#4caf50',
      fontSize: 10,
      fontWeight: 500,
      transition: 'background-color 0.1s',
      userSelect: 'none',
    },
    addInput: {
      flex: 1,
      background: '#080808',
      border: '1px solid #4caf50',
      color: '#e0e0e0',
      fontSize: 10,
      padding: '3px 6px',
      fontFamily: '"Courier New", monospace',
      outline: 'none',
      borderRadius: 2,
    },
    addRow: {
      padding: '5px 8px',
      display: 'flex',
      alignItems: 'center',
      gap: 4,
    },
    manageButton: {
      padding: '6px 8px',
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
    customTag: {
      fontSize: 7,
      color: '#333',
      letterSpacing: '0.06em',
      marginLeft: 2,
    },
  };

  const hoverProps = {
    onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = '#1a1a1a'; },
    onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; },
  };

  const iconHoverProps = {
    onMouseEnter: (e) => { e.currentTarget.style.color = '#e0e0e0'; e.currentTarget.style.backgroundColor = '#222'; },
    onMouseLeave: (e) => { e.currentTarget.style.color = '#444'; e.currentTarget.style.backgroundColor = 'transparent'; },
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.menu} ref={menuRef} onClick={e => e.stopPropagation()}>
        <div style={S.title}>SECTIONS</div>

        {/* Built-in subsections */}
        {availableSubsections.map((sub) => {
          const isVisible = !hiddenSubsections.includes(sub.key);
          const displayLabel = subsectionLabels[sub.key] || sub.label;
          const isRenaming = renamingKey === sub.key;

          return (
            <div key={sub.key} style={S.itemRow} {...hoverProps}>
              {/* Visibility toggle */}
              <div
                style={{ ...S.checkbox, background: isVisible ? '#00bcd4' : 'transparent' }}
                onClick={() => onToggleSubsection?.(sub.key)}
                title={isVisible ? 'Hide section' : 'Show section'}
              >
                {isVisible ? '✓' : ''}
              </div>

              {/* Label or rename input */}
              {isRenaming ? (
                <input
                  ref={renameRef}
                  style={S.renameInput}
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={() => handleRename(sub.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(sub.key);
                    if (e.key === 'Escape') { setRenamingKey(null); setRenameVal(''); }
                  }}
                  maxLength={30}
                />
              ) : (
                <span
                  style={S.label}
                  onDoubleClick={() => startRename(sub.key, displayLabel)}
                  title="Double-click to rename"
                >
                  {displayLabel}
                </span>
              )}

              {/* Rename button */}
              {!isRenaming && (
                <button
                  style={S.iconBtn}
                  onClick={() => startRename(sub.key, displayLabel)}
                  title="Rename section"
                  {...iconHoverProps}
                >✎</button>
              )}
            </div>
          );
        })}

        {/* Custom subsections */}
        {customSubsections.length > 0 && (
          <>
            <div style={S.divider} />
            <div style={{ ...S.title, color: '#333', borderBottom: 'none', padding: '4px 8px 2px' }}>CUSTOM SECTIONS</div>
          </>
        )}
        {customSubsections.map((sub) => {
          const isVisible = !hiddenSubsections.includes(sub.key);
          const isRenaming = renamingKey === sub.key;

          return (
            <div key={sub.key} style={S.itemRow} {...hoverProps}>
              {/* Visibility toggle */}
              <div
                style={{ ...S.checkbox, background: isVisible ? (sub.color || '#ff6600') : 'transparent', borderColor: sub.color || '#444' }}
                onClick={() => onToggleSubsection?.(sub.key)}
                title={isVisible ? 'Hide section' : 'Show section'}
              >
                {isVisible ? '✓' : ''}
              </div>

              {/* Label or rename input */}
              {isRenaming ? (
                <input
                  ref={renameRef}
                  style={S.renameInput}
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={() => handleRename(sub.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(sub.key);
                    if (e.key === 'Escape') { setRenamingKey(null); setRenameVal(''); }
                  }}
                  maxLength={30}
                />
              ) : (
                <span
                  style={{ ...S.label, color: sub.color || '#ff6600' }}
                  onDoubleClick={() => startRename(sub.key, sub.label)}
                  title="Double-click to rename"
                >
                  {sub.label}
                  <span style={S.customTag}> ({sub.symbols?.length || 0})</span>
                </span>
              )}

              {/* Rename button */}
              {!isRenaming && (
                <button
                  style={S.iconBtn}
                  onClick={() => startRename(sub.key, sub.label)}
                  title="Rename section"
                  {...iconHoverProps}
                >✎</button>
              )}

              {/* Delete button */}
              <button
                style={{ ...S.iconBtn, color: '#555' }}
                onClick={() => {
                  if (sub.symbols?.length > 0) {
                    if (window.confirm(`Delete "${sub.label}" section and its ${sub.symbols.length} ticker(s)?`)) {
                      onDeleteSubsection?.(sub.key);
                    }
                  } else {
                    onDeleteSubsection?.(sub.key);
                  }
                }}
                title="Delete section"
                onMouseEnter={(e) => { e.currentTarget.style.color = '#f44336'; e.currentTarget.style.backgroundColor = '#1a0000'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#555'; e.currentTarget.style.backgroundColor = 'transparent'; }}
              >×</button>
            </div>
          );
        })}

        <div style={S.divider} />

        {/* Add new section */}
        {addMode ? (
          <div style={S.addRow}>
            <input
              ref={addRef}
              style={S.addInput}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') { setAddMode(false); setNewName(''); }
              }}
              placeholder="Section name…"
              maxLength={30}
            />
            <button
              style={{ ...S.iconBtn, color: '#4caf50', fontSize: 12 }}
              onClick={handleAdd}
              title="Confirm"
              onMouseEnter={(e) => { e.currentTarget.style.color = '#81c784'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#4caf50'; }}
            >✓</button>
            <button
              style={{ ...S.iconBtn, color: '#555', fontSize: 12 }}
              onClick={() => { setAddMode(false); setNewName(''); }}
              title="Cancel"
            >×</button>
          </div>
        ) : (
          <div
            style={S.addButton}
            onClick={() => setAddMode(true)}
            {...hoverProps}
          >
            <span>+ ADD SECTION</span>
          </div>
        )}

        {/* Manage tickers */}
        {onConfigOpen && (
          <>
            <div style={S.divider} />
            <div
              style={S.manageButton}
              onClick={() => { onConfigOpen?.(); onClose?.(); }}
              {...hoverProps}
            >
              <span>✎ MANAGE TICKERS</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
