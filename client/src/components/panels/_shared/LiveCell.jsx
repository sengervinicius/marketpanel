import React, { useEffect, useRef, useState } from 'react';
import './LiveCell.css';

/**
 * Wraps a value with a brief green/red flash when the value changes.
 *
 *   <LiveCell value={price}>{fmtUSD(price)}</LiveCell>
 *
 * Optional props:
 *   - duration: ms before flash decays (default 600)
 *   - direction: explicit 'up'|'down'|'flat' (overrides auto-detect)
 *   - children: rendered output (formatted text, span, etc.)
 *
 * CIO-note (Phase 8.2): use everywhere live values render. Wrapping is
 * cheap; the perceived liveness gain is large.
 */
export function LiveCell({
  value,
  children,
  duration = 600,
  direction,
  className = '',
}) {
  const prevRef = useRef(value);
  const [pulse, setPulse] = useState(null); // 'up' | 'down' | null
  const timer = useRef(null);

  useEffect(() => {
    const prev = prevRef.current;
    let dir = direction;
    if (!dir && Number.isFinite(prev) && Number.isFinite(value) && prev !== value) {
      dir = value > prev ? 'up' : 'down';
    }
    if (dir === 'up' || dir === 'down') {
      setPulse(dir);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setPulse(null), duration);
    }
    prevRef.current = value;
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, direction, duration]);

  const cls = [
    'pp-livecell',
    pulse === 'up' ? 'pp-livecell--up pp-livecell--pulse' : '',
    pulse === 'down' ? 'pp-livecell--down pp-livecell--pulse' : '',
    className,
  ].filter(Boolean).join(' ');

  return <span className={cls}>{children ?? value}</span>;
}

export default LiveCell;
