/**
 * PanelConfigModal.jsx
 * Modal for editing a panel's title and instrument list with drag-reorder support.
 */

import { useState, useMemo } from 'react';
import { INSTRUMENTS } from '../../utils/constants';
import './PanelConfigModal.css';

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
      // Standard match on symbolKey and name
      if (ins.symbolKey.toLowerCase().includes(q) || (ins.name || '').toLowerCase().includes(q)) return true;
      // FX reverse pair match: "brlgbp" → finds GBPBRL, "brlusd" → finds USDBRL
      if (ins.assetClass === 'forex' && ins.baseCurrency && ins.quoteCurrency) {
        const reversed = (ins.quoteCurrency + ins.baseCurrency).toLowerCase();
        if (reversed.includes(q)) return true;
        // Also match partial currency names (e.g., "brl" finds all BRL pairs)
        if (ins.baseCurrency.toLowerCase().includes(q) || ins.quoteCurrency.toLowerCase().includes(q)) return true;
      }
      return false;
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


  return (
    <div
      className="pcm-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="pcm-modal">
        <div className="pcm-header">
          <span className="pcm-header-title">CONFIGURE PANEL</span>
          <button className="btn pcm-header-close"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Panel title input */}
        <div className="pcm-title-section">
          <div className="pcm-title-label">PANEL TITLE</div>
          <input
            className="pcm-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Panel title…"
            autoFocus
          />
        </div>

        {/* Two-column instrument picker */}
        <div className="pcm-body">
          {/* Left: available with group headers */}
          <div className="pcm-col pcm-col-left">
            <div className="pcm-col-title">AVAILABLE INSTRUMENTS</div>
            <input
              className="pcm-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
            />
            <div className="pcm-list">
              {Object.keys(availableGrouped).length === 0 ? (
                <div className="pcm-empty-message">No instruments found</div>
              ) : (
                Object.entries(availableGrouped).map(([groupName, instruments]) => (
                  <div key={groupName}>
                    <div className="pcm-group-header">
                      {groupName}
                    </div>
                    {instruments.map(ins => (
                      <div key={ins.symbolKey} className={`pcm-item ${selected.includes(ins.symbolKey) ? 'pcm-item-selected' : 'pcm-item-unselected'}`}
                        onClick={() => selected.includes(ins.symbolKey) ? remove(ins.symbolKey) : add(ins.symbolKey)}
                      >
                        <span>{ins.symbolKey}</span>
                        <span className="pcm-item-name">{ins.name || ins.assetClass}</span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: selected with reordering */}
          <div className="pcm-col">
            <div className="pcm-col-title pcm-col-title-selected">
              <div>SELECTED ({selected.length}/{MAX_INSTRUMENTS})</div>
              {selected.length > 0 && (
                <div className="pcm-col-title-maxIndicator">
                  {selected.length === MAX_INSTRUMENTS && '(max)'}
                </div>
              )}
            </div>
            <div className="pcm-button-row">
              <button className="btn pcm-button-selectall"
                onClick={selectAll}
                disabled={selected.length === MAX_INSTRUMENTS}
              >
                SELECT ALL
              </button>
              <button className="btn pcm-button-clearall"
                onClick={clearAll}
                disabled={selected.length === 0}
              >
                CLEAR ALL
              </button>
            </div>
            <div className="pcm-list">
              {selected.map((sym, idx) => (
                <div
                  key={sym}
                  draggable
                  onDragStart={(e) => handleDragStart(e, sym)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, sym)}
                  className={`pcm-item pcm-item-selected pcm-item-dragging`}
                  style={{
                    opacity: draggedItem === sym ? 0.5 : 1,
                  }}
                >
                  <span className="pcm-item-draggable">⋮⋮ {sym}</span>
                  <div className="flex-row" style={{ gap: 4 }}>
                    <button className="btn pcm-button-moveup"
                      onClick={() => moveUp(sym)}
                      disabled={idx === 0}
                      title="Move up"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button className="btn pcm-button-movedown"
                      onClick={() => moveDown(sym)}
                      disabled={idx === selected.length - 1}
                      title="Move down"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button className="btn pcm-button-remove"
                      onClick={() => remove(sym)}
                      title="Remove"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              {selected.length === 0 && (
                <div className="pcm-empty-message">No instruments selected</div>
              )}
            </div>
          </div>
        </div>

        <div className="pcm-footer">
          <button className="btn pcm-button-secondary" onClick={onClose}>CANCEL</button>
          <button className="btn pcm-button-primary" onClick={save}>SAVE</button>
        </div>
      </div>
    </div>
  );
}
