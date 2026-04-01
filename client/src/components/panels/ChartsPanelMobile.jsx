/**
 * ChartsPanelMobile.jsx
 * Mobile charts view — delegates to ChartPanel in mobile mode.
 * ChartPanel handles server sync, grid rendering, and ticker management.
 */
import { memo } from 'react';
import ChartPanel from './ChartPanel';

function ChartsPanelMobile({ onOpenDetail }) {
  return (
    <div style={{ height: '100%', background: '#0a0a0a' }}>
      <ChartPanel mobile={true} onOpenDetail={onOpenDetail} />
    </div>
  );
}

export default memo(ChartsPanelMobile);
