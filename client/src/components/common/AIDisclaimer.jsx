/**
 * AIDisclaimer.jsx
 *
 * W0.4 — Persistent, compact disclaimer rendered on every surface that
 * presents AI-generated or AI-assisted output. Required for CVM Resolução
 * 19 posture: Particle outputs are information, not investment advice.
 *
 * Two variants:
 *   - <AIDisclaimer />               inline banner (default)
 *   - <AIDisclaimer variant="foot" /> muted footer line for dense UIs
 *
 * Always visible — do not hide behind tooltip or collapse.
 */
import React from 'react';

const BASE_STYLE = {
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  fontSize: 10,
  letterSpacing: '0.3px',
  lineHeight: 1.4,
};

const MESSAGE =
  'AI-generated content for information and analysis only — not investment advice. Verify against primary sources before acting.';

export default function AIDisclaimer({ variant = 'banner', style, className }) {
  if (variant === 'foot') {
    return (
      <div
        role="note"
        aria-label="AI disclaimer"
        className={className}
        style={{
          ...BASE_STYLE,
          padding: '6px 8px',
          color: 'rgba(255,255,255,0.45)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          ...style,
        }}
      >
        {MESSAGE}
      </div>
    );
  }

  // Default: compact banner variant
  return (
    <div
      role="note"
      aria-label="AI disclaimer"
      className={className}
      style={{
        ...BASE_STYLE,
        padding: '6px 10px',
        margin: '4px 0',
        color: 'rgba(249,115,22,0.85)',
        background: 'rgba(249,115,22,0.06)',
        borderLeft: '2px solid rgba(249,115,22,0.7)',
        borderRadius: 2,
        ...style,
      }}
    >
      {MESSAGE}
    </div>
  );
}
