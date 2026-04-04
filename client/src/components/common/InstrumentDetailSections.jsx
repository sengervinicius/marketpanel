// InstrumentDetailSections.jsx – Sub-components for InstrumentDetail

// ── Shared sub-components ───────────────────────────────────────────────────
export function Section({ title, children }) {
  return (
    <div className="id-section">
      <div className="id-section-title">{title}</div>
      {children}
    </div>
  );
}

export function StatRow({ label, value, color, big }) {
  return (
    <div className="id-stat-row">
      <span className="id-stat-label">{label}</span>
      <span
        className={`id-stat-value${big ? ' id-stat-value--big' : ''}`}
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
