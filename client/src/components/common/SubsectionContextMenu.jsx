/**
 * SubsectionContextMenu.jsx
 * Enhanced context menu for managing panel subsections.
 * Supports: visibility toggling, renaming, adding custom sections,
 * deleting custom sections, and accessing the config modal.
 * Appears on right-click of panel headers.
 */

import { useState, useEffect, useRef } from 'react';
import './SubsectionContextMenu.css';

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


  return (
    <div className="scm-overlay" onClick={onClose}>
      <div className="scm-menu" style={menuStyle} ref={menuRef} onClick={e => e.stopPropagation()}>
        <div className="scm-title">SECTIONS</div>

        {/* Built-in subsections */}
        {availableSubsections.map((sub) => {
          const isVisible = !hiddenSubsections.includes(sub.key);
          const displayLabel = subsectionLabels[sub.key] || sub.label;
          const isRenaming = renamingKey === sub.key;

          return (
            <div key={sub.key} className="scm-item-row"
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1a1a1a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {/* Visibility toggle */}
              <div
                className="scm-checkbox"
                style={{ background: isVisible ? '#00bcd4' : 'transparent' }}
                onClick={() => onToggleSubsection?.(sub.key)}
                title={isVisible ? 'Hide section' : 'Show section'}
              >
                {isVisible ? '✓' : ''}
              </div>

              {/* Label or rename input */}
              {isRenaming ? (
                <input
                  ref={renameRef}
                  className="scm-rename-input"
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
                  className="scm-label"
                  onDoubleClick={() => startRename(sub.key, displayLabel)}
                  title="Double-click to rename"
                >
                  {displayLabel}
                </span>
              )}

              {/* Rename button */}
              {!isRenaming && (
                <button className="scm-icon-btn"
                  onClick={() => startRename(sub.key, displayLabel)}
                  title="Rename section"
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; e.currentTarget.style.backgroundColor = '#222'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#444'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                >✎</button>
              )}
            </div>
          );
        })}

        {/* Custom subsections */}
        {customSubsections.length > 0 && (
          <>
            <div className="scm-divider" />
            <div className="scm-title" style={{ color: '#333', borderBottom: 'none', padding: '4px 8px 2px' }}>CUSTOM SECTIONS</div>
          </>
        )}
        {customSubsections.map((sub) => {
          const isVisible = !hiddenSubsections.includes(sub.key);
          const isRenaming = renamingKey === sub.key;

          return (
            <div key={sub.key} className="scm-item-row"
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1a1a1a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {/* Visibility toggle */}
              <div
                className="scm-checkbox"
                style={{ background: isVisible ? (sub.color || '#ff6600') : 'transparent', borderColor: sub.color || '#444' }}
                onClick={() => onToggleSubsection?.(sub.key)}
                title={isVisible ? 'Hide section' : 'Show section'}
              >
                {isVisible ? '✓' : ''}
              </div>

              {/* Label or rename input */}
              {isRenaming ? (
                <input
                  ref={renameRef}
                  className="scm-rename-input"
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
                  className="scm-label"
                  style={{ color: sub.color || '#ff6600' }}
                  onDoubleClick={() => startRename(sub.key, sub.label)}
                  title="Double-click to rename"
                >
                  {sub.label}
                  <span className="scm-custom-tag"> ({sub.symbols?.length || 0})</span>
                </span>
              )}

              {/* Rename button */}
              {!isRenaming && (
                <button className="scm-icon-btn"
                  onClick={() => startRename(sub.key, sub.label)}
                  title="Rename section"
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; e.currentTarget.style.backgroundColor = '#222'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#444'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                >✎</button>
              )}

              {/* Delete button */}
              <button className="scm-icon-btn scm-delete-btn"
                style={{ color: '#555' }}
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

        <div className="scm-divider" />

        {/* Add new section */}
        {addMode ? (
          <div className="scm-add-row">
            <input
              ref={addRef}
              className="scm-add-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') { setAddMode(false); setNewName(''); }
              }}
              placeholder="Section name…"
              maxLength={30}
            />
            <button className="scm-icon-btn"
              style={{ color: '#4caf50', fontSize: 12 }}
              onClick={handleAdd}
              title="Confirm"
              onMouseEnter={(e) => { e.currentTarget.style.color = '#81c784'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#4caf50'; }}
            >✓</button>
            <button className="scm-icon-btn"
              style={{ color: '#555', fontSize: 12 }}
              onClick={() => { setAddMode(false); setNewName(''); }}
              title="Cancel"
            >×</button>
          </div>
        ) : (
          <div
            className="scm-add-button"
            onClick={() => setAddMode(true)}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1a1a1a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <span>+ ADD SECTION</span>
          </div>
        )}

        {/* Manage tickers */}
        {onConfigOpen && (
          <>
            <div className="scm-divider" />
            <div
              className="scm-manage-button"
              onClick={() => { onConfigOpen?.(); onClose?.(); }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1a1a1a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span>✎ MANAGE TICKERS</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
