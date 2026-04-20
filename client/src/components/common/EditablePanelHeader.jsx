/**
 * EditablePanelHeader.jsx
 * Bloomberg-style panel header with inline title editing, subsection labels,
 * search filter, config button, and drag-drop ticker support.
 * Now supports custom subsection CRUD (add, rename, delete).
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useDrag } from '../../context/DragContext';
import SubsectionContextMenu from './SubsectionContextMenu';
import FreshnessDot from '../panels/_shared/FreshnessDot';
import './EditablePanelHeader.css';

export default function EditablePanelHeader({
  title,
  subsections = [],
  availableSubsections = [],
  hiddenSubsections = [],
  customSubsections = [],
  subsectionLabels = {},
  onToggleSubsection,
  onTitleChange,
  onSubsectionChange,
  onAddSubsection,
  onRenameSubsection,
  onDeleteSubsection,
  onConfigOpen,
  onDropTicker,
  onSearchChange,
  feedBadge,
  // Phase 2: Last updated timestamp (ISO string or Date)
  lastUpdated = null,
  // Phase 9.1: upstream data source label (e.g., "Yahoo", "BCB", "Binance")
  source = null,
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
    if ((availableSubsections && availableSubsections.length > 0) || customSubsections.length > 0 || onConfigOpen || onAddSubsection) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
  };

  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    let ticker = null;
    const xTicker = e.dataTransfer?.getData('application/x-ticker');
    if (xTicker) {
      try {
        const parsed = JSON.parse(xTicker);
        ticker = parsed.symbol || parsed.name;
      } catch { ticker = xTicker; }
    }
    if (!ticker) ticker = e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('ticker');
    if (!ticker && draggedTicker) ticker = draggedTicker.symbol || draggedTicker;
    if (ticker) { onDropTicker?.(ticker); endDrag?.(); }
  };


  return (
    <>
      <div className={`eph-header ${dragOver ? 'eph-drag-over' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onContextMenu={handleContextMenu} ref={headerRef}>
        {dragOver && (<div className="eph-drop-overlay"><span className="eph-drop-text">+ DROP TICKER HERE</span></div>)}
        <div className="eph-row">
        {editingTitle ? (
          <input ref={titleRef} className="eph-title-input" value={titleVal} onChange={e => setTitleVal(e.target.value)} onBlur={saveTitle} onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }} maxLength={50} />
        ) : (
          <span className="eph-title" onClick={() => { setEditingTitle(true); setTitleVal(title); }} title="Click to rename · Right-click for sections">{title}</span>
        )}
        {subsections.map((sub, i) => (
          <span key={i}>
            <span className="eph-divider">·</span>
            {editingSub === i ? (
              <input ref={subRef} className="eph-sub-input" value={subVal} onChange={e => setSubVal(e.target.value)} onBlur={() => saveSub(i)} onKeyDown={e => { if (e.key === 'Enter') saveSub(i); if (e.key === 'Escape') setEditingSub(null); }} maxLength={40} />
            ) : (
              <span className="eph-sub" onClick={() => { setEditingSub(i); setSubVal(sub); }} title="Click to rename">{sub}</span>
            )}
          </span>
        ))}
        {onConfigOpen && (<button className="eph-icon-btn" onClick={(e) => {
          // If subsections are available, open the subsection menu; otherwise open config modal
          if ((availableSubsections && availableSubsections.length > 0) || customSubsections.length > 0 || onAddSubsection) {
            const rect = e.currentTarget.getBoundingClientRect();
            setContextMenu({ x: rect.left, y: rect.bottom + 4 });
          } else {
            onConfigOpen();
          }
        }} title="Configure panel sections"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>)}
        {feedBadge && (<span className="eph-badge" style={{ background: feedBadge.bg, color: feedBadge.color, border: `1px solid ${feedBadge.color}33` }}>{feedBadge.text}</span>)}
        {lastUpdated && (
          <FreshnessDot updatedAt={lastUpdated} source={source} />
        )}
        <div className="eph-spacer" />
        {children}
        {onSearchChange && (
          <button className="eph-icon-btn" style={{ color: showSearch ? 'var(--accent)' : 'var(--text-faint)' }} onClick={() => { const next = !showSearch; setShowSearch(next); if (!next) { setSearchQ(''); onSearchChange(''); } }} title="Search in panel">⌕</button>
        )}
      </div>
      {showSearch && (
        <div className="eph-search-row">
          <input ref={searchRef} className="eph-search-input" value={searchQ} onChange={e => { setSearchQ(e.target.value); onSearchChange?.(e.target.value); }} onKeyDown={e => { if (e.key === 'Escape') { setShowSearch(false); setSearchQ(''); onSearchChange?.(''); } }} placeholder="Filter by ticker or name…" />
          <button className="eph-search-close" onClick={() => { setShowSearch(false); setSearchQ(''); onSearchChange?.(''); }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      )}
    </div>

    {contextMenu && (
      <SubsectionContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        availableSubsections={availableSubsections}
        hiddenSubsections={hiddenSubsections}
        customSubsections={customSubsections}
        subsectionLabels={subsectionLabels}
        onToggleSubsection={(key) => {
          onToggleSubsection?.(key);
        }}
        onAddSubsection={(section) => {
          onAddSubsection?.(section);
        }}
        onRenameSubsection={(key, newLabel) => {
          onRenameSubsection?.(key, newLabel);
        }}
        onDeleteSubsection={(key) => {
          onDeleteSubsection?.(key);
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
