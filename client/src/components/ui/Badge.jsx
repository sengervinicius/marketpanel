import { memo } from 'react';
import './Badge.css';

/**
 * Badge — Small pill-shaped status indicator
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Badge content
 * @param {'neutral'|'success'|'warning'|'error'|'accent'} props.variant - Visual variant
 * @param {'sm'|'xs'} props.size - Size variant
 * @param {string} [props.className] - Additional CSS classes
 */
function Badge({ children, variant = 'neutral', size = 'sm', className = '' }) {
  return (
    <span className={`badge badge--${variant} badge--${size} ${className}`.trim()}>
      {children}
    </span>
  );
}

export default memo(Badge);
