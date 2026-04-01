/**
 * PanelShell.jsx
 * Shared outer container for desktop data panels.
 * Provides: consistent background, flex column layout, drag-over handling, scroll area.
 * Does NOT replace EditablePanelHeader — panels still compose their own headers inside.
 */
import { memo } from 'react';
import { handlePanelDragOver, makePanelDropHandler } from '../../utils/dropHelper';

function PanelShell({ children, onDropTicker, style }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        ...style,
      }}
      onDragOver={onDropTicker ? handlePanelDragOver : undefined}
      onDrop={onDropTicker ? makePanelDropHandler(onDropTicker) : undefined}
    >
      {children}
    </div>
  );
}

export default memo(PanelShell);
