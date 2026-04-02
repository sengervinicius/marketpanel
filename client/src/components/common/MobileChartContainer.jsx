/**
 * MobileChartContainer.jsx
 *
 * Solves the mobile chart 0-height problem: measures its own bounding box
 * via ResizeObserver and passes explicit pixel dimensions to children,
 * so Recharts <ResponsiveContainer> never collapses to 0.
 *
 * Usage:
 *   <MobileChartContainer>
 *     {({ width, priceHeight, volumeHeight }) => (
 *       <>
 *         <ResponsiveContainer width={width} height={priceHeight}>…</ResponsiveContainer>
 *         <ResponsiveContainer width={width} height={volumeHeight}>…</ResponsiveContainer>
 *       </>
 *     )}
 *   </MobileChartContainer>
 */
import { useState, useEffect, useRef, memo } from 'react';

const PRICE_RATIO = 0.78;   // price chart gets ~78 % of available height
const MIN_HEIGHT  = 120;     // never go below 120 px total

function MobileChartContainer({ children, style }) {
  const ref = useRef(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setDims(prev =>
        prev.width === Math.round(width) && prev.height === Math.round(height)
          ? prev
          : { width: Math.round(width), height: Math.round(Math.max(height, MIN_HEIGHT)) }
      );
    };

    // Initial measure
    update();

    // Watch for resize
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    } else {
      window.addEventListener('resize', update);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', update);
    };
  }, []);

  const priceHeight  = Math.round(dims.height * PRICE_RATIO);
  const volumeHeight = dims.height - priceHeight;

  return (
    <div
      ref={ref}
      style={{
        display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0,
        ...style,
      }}
    >
      {dims.width > 0 && dims.height > 0 && typeof children === 'function'
        ? children({ width: dims.width, priceHeight, volumeHeight })
        : null}
    </div>
  );
}

export default memo(MobileChartContainer);
