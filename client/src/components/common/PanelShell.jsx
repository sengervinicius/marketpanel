/**
 * PanelShell.jsx
 * Shared outer container for desktop data panels.
 * Provides: consistent background, flex column layout, drag-over handling, scroll area.
 * Does NOT replace EditablePanelHeader — panels still compose their own headers inside.
 */
import { memo, useState, useCallback } from 'react';
import { handlePanelDragOver, makePanelDropHandler } from '../../utils/dropHelper';

function PanelShell({ children, onDropTicker, style }) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e) => {
    handlePanelDragOver(e);
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback((e) => {
    setIsDragOver(false);
    makePanelDropHandler(onDropTicker)(e);
  }, [onDropTicker]);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        border: isDragOver ? '2px solid var(--accent, #ff6600)' : '2px solid transparent',
        boxShadow: isDragOver ? '0 0 12px var(--accent, #ff6600)66' : 'none',
        transition: 'border 0.15s, box-shadow 0.15s',
        ...style,
      }}
      onDragOver={onDropTicker ? handleDragOver : undefined}
      onDragLeave={onDropTicker ? handleDragLeave : undefined}
      onDrop={onDropTicker ? handleDrop : undefined}
    >
      {children}
    </div>
  );
}

export default memo(PanelShell);
