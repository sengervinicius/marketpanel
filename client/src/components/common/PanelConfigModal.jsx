/**
 * PanelConfigModal.jsx
 * Modal for editing a panel's title and instrument list with drag-reorder support.
 */

import { useState, useMemo } from 'react';
import { INSTRUMENTS } from '../../utils/constants';

export default function PanelConfigModal({
  panelId,
  currentTitle,
  currentSymbols,
  assetClasses,       // optional filter: ['stock', 'forex', ...]
  onSave,
  onClose,
}) {
  const MAX_INSTRUMENTS = 20;

  const [title,    setTitle]    = useState(currentTitle  || '');
  const [selected, setSelected] = useState([...(currentSymbols || [])]);
  const [search,   setSearch]   = useState('');
  const [draggedItem, setDraggedItem] = useState(null);

  // Group available instruments by assetClass
  const availableGrouped = useMemo(() => {
    const filtered = INSTRUMENTS.filter(ins => {
      if (assetClasses && !assetClasses.includes(ins.assetClass)) return false;
      const q = search.toLowerCase();
      if (!q) return true;
      return (
        ins.symbolKey.toLowerCase().includes(q) ||
        (ins.name || '').toLowerCase().includes(q)
      );
    });

    const groups = {};
    filtered.forEach(ins => {
      const groupKey = ins.group || 'Other';
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(ins);
    });
    return groups;
  }, [assetClasses, search]);

  const available = Object.values(availableGrouped).flat();

  const add    = (sym) => {
    if (selected.length < MAX_INSTRUMENTS) {
      setSelected(s => s.includes(sym) ? s : [...s, sym]);
    }
  };
  const remove = (sym) => setSelected(s => s.filter(x => x !== sym));
  const selectAll = () => {
    const newSelected = [...new Set([...selected, ...available.map(ins => ins.symbolKey)])];
    setSelected(newSelected.slice(0, MAX_INSTRUMENTS));
  };
  const clearAll = () => setSelected([]);

  // Drag and drop handlers
  const handleDragStart = (e, sym) => {
    setDraggedItem(sym);
  };
  const handleDragOver = (e) => {
    e.preventDefault();
  };
  const handleDrop = (e, targetSym) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetSym) {
      setDraggedItem(null);
      return;
    }
    const dragIdx = selected.indexOf(draggedItem);
    const targetIdx = selected.indexOf(targetSym);
    if (dragIdx !== -1 && targetIdx !== -1) {
      const newSelected = [...selected];
      [newSelected[dragIdx], newSelected[targetIdx]] = [newSelected[targetIdx], newSelected[dragIdx]];
      setSelected(newSelected);
    }
    setDraggedItem(null);
  };

  const moveUp = (sym) => {
    const idx = selected.indexOf(sym);
    if (idx > 0) {
      const newSelected = [...selected];
      [newSelected[idx - 1], newSelected[idx]] = [newSelected[idx], newSelected[idx - 1]];
      setSelected(newSelected);
    }
  };
  const moveDown = (sym) => {
    const idx = selected.indexOf(sym);
    if (idx < selected.length - 1) {
      const newSelected = [...selected];
      [newSelected[idx + 1], newSelected[idx]] = [newSelected[idx], newSelected[idx + 1]];
      setSelected(newSelected);
    }
  };

  const save = () => {
    onSave({ title: title.trim() || panelId, symbols: selected });
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const overlay = {
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  const modal = {
    background: '#0d0d0d', border: '1px solid #2a2a2a',
    borderRadius: 6, width: '90%', maxWidth: 560,
    maxHeight: '80vh', display: 'flex', flexDirection: 'column',
    fontFamily: 'var(--font-ui)',
  };

  const header = {
    padding: '14px 18px', borderBottom: '1px solid #1a1a1a',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  };

  const body = {
    flex: 1, display: 'flex', gap: 0, minHeight: 0, overflow: 'hidden',
  };

  const col = {
    flex: 1, display: 'flex', flexDirection: 'column',
    padding: '12px 14px', minHeight: 0,
  };

  const colTitle = {
    color: '#ff6600', fontSize: 9, letterSpacing: '0.2em',
    marginBottom: 8, flexShrink: 0,
  };

  const inp = {
    background: '#080808', border: '1px solid #2a2a2a', color: '#e0e0e0',
    padding: '6px 10px', fontSize: 11, fontFamily: 'inherit',
    outline: 'none', width: '100%', boxSizing: 'border-box', borderRadius: 3,
    marginBottom: 8,
  };

  const list = {
    flex: 1, overflowY: 'auto', fontSize: 10,
  };

  const item = (sel) => ({
    padding: '5px 8px', cursor: 'pointer', display: 'flex',
    justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 3, marginBottom: 2,
    background: sel ? '#1a0900' : 'transparent',
    color: sel ? '#ff6600' : '#888',
  });

  const footer = {
    padding: '12px 18px', borderTop: '1px solid #1a1a1a',
    display: 'flex', gap: 8, justifyContent: 'flex-end',
  };

  const btn = (primary) => ({
    padding: '8px 20px', fontSize: 10, letterSpacing: '0.1em',
    fontFamily: 'inherit', cursor: 'pointer', borderRadius: 3,
    border: `1px solid ${primary ? '#ff6600' : '#2a2a2a'}`,
    background: primary ? '#ff6600' : 'transparent',
    color: primary ? '#000' : '#888', fontWeight: primary ? 'bold' : 'normal',
  });

  return (
    <div
      style={overlay}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div style={modal}>
        <div style={header}>
          <span style={{ color: '#ff6600', fontSize: 12, fontWeight: 'bold' }}>CONFIGURE PANEL</span>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18 }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Panel title input */}
        <div style={{ padding: '12px 18px 0', flexShrink: 0 }}>
          <div style={{ color: '#555', fontSize: 9, letterSpacing: '0.15em', marginBottom: 4 }}>PANEL TITLE</div>
          <input
            style={inp}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Panel title…"
            autoFocus
          />
        </div>

        {/* Two-column instrument picker */}
        <div style={body}>
          {/* Left: available with group headers */}
          <div style={{ ...col, borderRight: '1px solid #1a1a1a' }}>
            <div style={colTitle}>AVAILABLE INSTRUMENTS</div>
            <input
              style={{ ...inp, marginBottom: 8 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
            />
            <div style={list}>
              {Object.keys(availableGrouped).length === 0 ? (
                <div style={{ color: '#2a2a2a', fontSize: 10, padding: 8 }}>No instruments found</div>
              ) : (
                Object.entries(availableGrouped).map(([groupName, instruments]) => (
                  <div key={groupName}>
                    <div style={{
                      color: '#ff6600', fontSize: 8, fontWeight: 700, letterSpacing: '0.5px',
                      padding: '6px 8px 4px', marginTop: 4, marginBottom: 2,
                    }}>
                      {groupName}
                    </div>
                    {instruments.map(ins => (
                      <div key={ins.symbolKey} style={item(selected.includes(ins.symbolKey))}
                        onClick={() => selected.includes(ins.symbolKey) ? remove(ins.symbolKey) : add(ins.symbolKey)}
                      >
                        <span>{ins.symbolKey}</span>
                        <span style={{ color: '#333', fontSize: 9 }}>{ins.name || ins.assetClass}</span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: selected with reordering */}
          <div style={col}>
            <div style={{
              ...colTitle,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>SELECTED ({selected.length}/{MAX_INSTRUMENTS})</div>
              {selected.length > 0 && (
                <div style={{ fontSize: 7, color: '#666', letterSpacing: '0.5px' }}>
                  {selected.length === MAX_INSTRUMENTS && '(max)'}
                </div>
              )}
            </div>
            <div style={{
              display: 'flex',
              gap: 4,
              marginBottom: 8,
              flexShrink: 0,
            }}>
              <button
                onClick={selectAll}
                disabled={selected.length === MAX_INSTRUMENTS}
                style={{
                  flex: 1,
                  padding: '4px 6px', fontSize: 8, letterSpacing: '0.1em',
                  fontFamily: 'inherit', cursor: selected.length === MAX_INSTRUMENTS ? 'default' : 'pointer',
                  border: '1px solid #2a2a2a',
                  background: selected.length === MAX_INSTRUMENTS ? '#0a0a0a' : 'transparent',
                  color: selected.length === MAX_INSTRUMENTS ? '#333' : '#666',
                  borderRadius: 2,
                }}
              >
                SELECT ALL
              </button>
              <button
                onClick={clearAll}
                disabled={selected.length === 0}
                style={{
                  flex: 1,
                  padding: '4px 6px', fontSize: 8, letterSpacing: '0.1em',
                  fontFamily: 'inherit', cursor: selected.length === 0 ? 'default' : 'pointer',
                  border: '1px solid #2a2a2a',
                  background: selected.length === 0 ? '#0a0a0a' : 'transparent',
                  color: selected.length === 0 ? '#333' : '#666',
                  borderRadius: 2,
                }}
              >
                CLEAR ALL
              </button>
            </div>
            <div style={list}>
              {selected.map((sym, idx) => (
                <div
                  key={sym}
                  draggable
                  onDragStart={(e) => handleDragStart(e, sym)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, sym)}
                  style={{
                    ...item(true),
                    justifyContent: 'space-between',
                    opacity: draggedItem === sym ? 0.5 : 1,
                    cursor: 'grab',
                    transition: 'opacity 150ms',
                  }}
                >
                  <span style={{ userSelect: 'none' }}>⋮⋮ {sym}</span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button
                      onClick={() => moveUp(sym)}
                      disabled={idx === 0}
                      title="Move up"
                      style={{
                        background: 'none', border: 'none', color: idx === 0 ? '#222' : '#555',
                        cursor: idx === 0 ? 'default' : 'pointer', fontSize: 12, lineHeight: 1, padding: 2
                      }}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveDown(sym)}
                      disabled={idx === selected.length - 1}
                      title="Move down"
                      style={{
                        background: 'none', border: 'none', color: idx === selected.length - 1 ? '#222' : '#555',
                        cursor: idx === selected.length - 1 ? 'default' : 'pointer', fontSize: 12, lineHeight: 1, padding: 2
                      }}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => remove(sym)}
                      title="Remove"
                      style={{
                        background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, lineHeight: 1
                      }}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              {selected.length === 0 && (
                <div style={{ color: '#2a2a2a', fontSize: 10, padding: 8 }}>No instruments selected</div>
              )}
            </div>
          </div>
        </div>

        <div style={footer}>
          <button style={btn(false)} onClick={onClose}>CANCEL</button>
          <button style={btn(true)}  onClick={save}>SAVE</button>
        </div>
      </div>
    </div>
  );
}
