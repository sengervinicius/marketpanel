/**
 * EditablePanelHeader.jsx
 * Bloomberg-style panel header with inline title editing, subsection labels,
 * search filter, config button, and drag-drop ticker support.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useDrag } from '../../context/DragContext';
import SubsectionContextMenu from './SubsectionContextMenu';

export default function EditablePanelHeader({
  title,
  subsections = [],
  availableSubsections = [],
  hiddenSubsections = [],
  onToggleSubsection,
  onTitleChange,
  onSubsectionChange,
  onConfigOpen,
  onDropTicker,
  onSearchChange,
  feedBadge,
  children,
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(title);
  const [editingSub, setEditingSub] = useState(null);
  const [subVal, setSubVal] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);

  const titleRef = useRef(null);
  const subRef = useRef(null);
  const searchRef = useRef(null);
  const headerRef = useRef(null);
  const { isDragging, draggedTicker, endDrag } = useDrag();

  useEffect(() => { if (editingTitle && titleRef.current) { titleRef.current.focus(); titleRef.current.select(); } }, [editingTitle]);
  useEffect(() => { if (editingSub !== null && subRef.current) { subRef.current.focus(); subRef.current.select(); } }, [editingSub]);
  useEffect(() => { if (showSearch && searchRef.current) searchRef.current.focus(); }, [showSearch]);
  useEffect(() => { if (!editingTitle) setTitleVal(title); }, [title, editingTitle]);

  const saveTitle = useCallback(() => {
    const v = titleVal.trim();
    if (v && v !== title) onTitleChange?.(v);
    setEditingTitle(false);
  }, [titleVal, title, onTitleChange]);

  const saveSub = useCallback((idx) => {
    const v = subVal.trim();
    if (v && v !== subsections[idx]) onSubsectionChange?.(idx, v);
    setEditingSub(null);
  }, [subVal, subsections, onSubsectionChange]);

  const handleContextMenu = (e) => {
    if ((availableSubsections && availableSubsections.length > 0) || onConfigOpen) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
  };

  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    // Try application/x-ticker first (used by SearchPanel, CommoditiesPanel, etc.)
    let ticker = null;
    const xTicker = e.dataTransfer?.getData('application/x-ticker');
    if (xTicker) {
      try {
        const parsed = JSON.parse(xTicker);
        ticker = parsed.symbol || parsed.name;
      } catch { ticker = xTicker; }
    }
    // Fallback to text/plain or ticker MIME types
    if (!ticker) ticker = e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('ticker');
    // Last resort: DragContext
    if (!ticker && draggedTicker) ticker = draggedTicker.symbol || draggedTicker;
    if (ticker) { onDropTicker?.(ticker); endDrag?.(); }
  };

  const S = {
    header: { borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0, position: 'relative', transition: 'border-color 0.2s', borderColor: dragOver ? '#ff6600' : '#2a2a2a' },
    row: { padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, fontFamily: '"Courier New", monospace' },
    title: { color: '#00bcd4', fontSize: 10, fontWeight: 700, letterSpacing: '1px', cursor: 'pointer', userSelect: 'none', lineHeight: 1 },
    titleInput: { background: '#080808', border: '1px solid #00bcd4', color: '#00bcd4', fontSize: 10, fontWeight: 700, letterSpacing: '1px', padding: '1px 4px', fontFamily: '"Courier New", monospace', outline: 'none', borderRadius: 2, width: 120 },
    sub: { color: '#555', fontSize: 8, cursor: 'pointer', userSelect: 'none', padding: '0 3px', borderRadius: 2, transition: 'color 0.15s' },
    subInput: { background: '#080808', border: '1px solid #333', color: '#888', fontSize: 8, padding: '0 3px', fontFamily: '"Courier New", monospace', outline: 'none', borderRadius: 2, width: 80 },
    iconBtn: { background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 9, padding: '0 2px', lineHeight: 1, display: 'flex', alignItems: 'center' },
    badge: { fontSize: 7, fontWeight: 700, letterSpacing: '0.08em', padding: '1px 4px', borderRadius: 2, marginLeft: 4 },
    dropOverlay: { position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(255,102,0,0.08)', border: '1px dashed #ff6600', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', borderRadius: 2 },
    dropText: { color: '#ff6600', fontSize: 9, fontWeight: 700, letterSpacing: '0.15em' },
    searchRow: { padding: '2px 8px 4px', display: 'flex', gap: 4, alignItems: 'center' },
    searchInput: { flex: 1, background: '#080808', border: '1px solid #2a2a2a', color: '#e0e0e0', fontSize: 9, padding: '2px 6px', fontFamily: '"Courier New", monospace', outline: 'none', borderRadius: 2 },
    searchClose: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 10, padding: 0, lineHeight: 1 },
  };

  return (
    <>
      <div style={S.header} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onContextMenu={handleContextMenu} ref={headerRef}>
        {dragOver && (<div style={S.dropOverlay}><span style={S.dropText}>+ DROP TICKER HERE</span></div>)}
        <div style={S.row}>
        {editingTitle ? (
          <input ref={titleRef} style={S.titleInput} value={titleVal} onChange={e => setTitleVal(e.target.value)} onBlur={saveTitle} onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }} maxLength={50} />
        ) : (
          <span style={S.title} onClick={() => { setEditingTitle(true); setTitleVal(title); }} title="Click to rename">{title}</span>
        )}
        {subsections.map((sub, i) => (
          <span key={i}>
            <span style={{ color: '#222', fontSize: 8 }}>·</span>
            {editingSub === i ? (
              <input ref={subRef} style={S.subInput} value={subVal} onChange={e => setSubVal(e.target.value)} onBlur={() => saveSub(i)} onKeyDown={e => { if (e.key === 'Enter') saveSub(i); if (e.key === 'Escape') setEditingSub(null); }} maxLength={40} />
            ) : (
              <span style={S.sub} onClick={() => { setEditingSub(i); setSubVal(sub); }} title="Click to rename" onMouseEnter={e => e.target.style.color = '#888'} onMouseLeave={e => e.target.style.color = '#555'}>{sub}</span>
            )}
          </span>
        ))}
        {onConfigOpen && (<button style={S.iconBtn} onClick={onConfigOpen} title="Configure panel">✎</button>)}
        {feedBadge && (<span style={{ ...S.badge, background: feedBadge.bg, color: feedBadge.color, border: `1px solid ${feedBadge.color}33` }}>{feedBadge.text}</span>)}
        <div style={{ flex: 1 }} />
        {children}
        {onSearchChange && (
          <button style={{ ...S.iconBtn, color: showSearch ? '#ff6600' : '#444' }} onClick={() => { const next = !showSearch; setShowSearch(next); if (!next) { setSearchQ(''); onSearchChange(''); } }} title="Search in panel">⌕</button>
        )}
      </div>
      {showSearch && (
        <div style={S.searchRow}>
          <input ref={searchRef} style={S.searchInput} value={searchQ} onChange={e => { setSearchQ(e.target.value); onSearchChange?.(e.target.value); }} onKeyDown={e => { if (e.key === 'Escape') { setShowSearch(false); setSearchQ(''); onSearchChange?.(''); } }} placeholder="Filter by ticker or name…" />
          <button style={S.searchClose} onClick={() => { setShowSearch(false); setSearchQ(''); onSearchChange?.(''); }}>✕</button>
        </div>
      )}
    </div>

    {contextMenu && (
      <SubsectionContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        availableSubsections={availableSubsections}
        hiddenSubsections={hiddenSubsections}
        onToggleSubsection={(key) => {
          onToggleSubsection?.(key);
          setContextMenu(null);
        }}
        onConfigOpen={() => {
          setContextMenu(null);
          onConfigOpen?.();
        }}
        onClose={() => setContextMenu(null)}
      />
    )}
    </>
  );
}
