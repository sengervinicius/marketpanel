/**
 * SectionHeader.jsx
 * Shared section divider for panels — the thin labeled row that separates
 * subsections (e.g., "US EQUITIES", "FX PAIRS", "CRYPTO").
 * Uses design tokens for consistent styling across all panels.
 */
import { memo } from 'react';

function SectionHeader({ label, color = 'var(--text-muted)' }) {
  return (
    <div style={{
      padding: '2px 8px',
      background: 'var(--bg-surface)',
      borderTop: '1px solid var(--border-default)',
      borderBottom: '1px solid var(--border-default)',
    }}>
      <span style={{
        color,
        fontSize: 'var(--font-xs)',
        fontWeight: 700,
        letterSpacing: '0.12em',
      }}>
        —— {label} ————————————————————————
      </span>
    </div>
  );
}

export { SectionHeader };
export default memo(SectionHeader);
