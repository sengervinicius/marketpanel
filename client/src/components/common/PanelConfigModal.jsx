/**
 * PanelConfigModal.jsx
 * Modal for editing a panel's title and instrument list.
 */

import { useState } from 'react';
import { INSTRUMENTS } from '../../utils/constants';

export default function PanelConfigModal({
  panelId,
  currentTitle,
  currentSymbols,
  assetClasses,       // optional filter: ['stock', 'forex', ...]
  onSave,
  onClose,
}) {
  const [title,    setTitle]    = useState(currentTitle  || '');
  const [selected, setSelected] = useState([...(currentSymbols || [])]);
  const [search,   setSearch]   = useState('');

  // Filter instruments available for this panel
  const available = INSTRUMENTS.filter(ins => {
    if (assetClasses && !assetClasses.includes(ins.assetClass)) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      ins.symbolKey.toLowerCase().includes(q) ||
      (ins.name || '').toLowerCase().includes(q)
    );
  });

  const add    = (sym) => setSelected(s => s.includes(sym) ? s : [...s, sym]);
  const remove = (sym) => setSelected(s => s.filter(x => x !== sym));

  const save = () => {
    onSave({ title: title.trim() || panelId, symbols: selected });
    onClose();
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
    fontFamily: '"Courier New", monospace',
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
    <div style={overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        <div style={header}>
          <span style={{ color: '#ff6600', fontSize: 12, fontWeight: 'bold' }}>CONFIGURE PANEL</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* Panel title input */}
        <div style={{ padding: '12px 18px 0', flexShrink: 0 }}>
          <div style={{ color: '#555', fontSize: 9, letterSpacing: '0.15em', marginBottom: 4 }}>PANEL TITLE</div>
          <input
            style={inp}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Panel title…"
          />
        </div>

        {/* Two-column instrument picker */}
        <div style={body}>
          {/* Left: available */}
          <div style={{ ...col, borderRight: '1px solid #1a1a1a' }}>
            <div style={colTitle}>AVAILABLE INSTRUMENTS</div>
            <input
              style={{ ...inp, marginBottom: 8 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
            />
            <div style={list}>
              {available.map(ins => (
                <div key={ins.symbolKey} style={item(selected.includes(ins.symbolKey))}
                  onClick={() => selected.includes(ins.symbolKey) ? remove(ins.symbolKey) : add(ins.symbolKey)}
                >
                  <span>{ins.symbolKey}</span>
                  <span style={{ color: '#333', fontSize: 9 }}>{ins.name || ins.assetClass}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: selected */}
          <div style={col}>
            <div style={colTitle}>SELECTED ({selected.length})</div>
            <div style={list}>
              {selected.map(sym => (
                <div key={sym} style={{ ...item(true), justifyContent: 'space-between' }}>
                  <span>{sym}</span>
                  <button onClick={() => remove(sym)}
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                  >×</button>
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
