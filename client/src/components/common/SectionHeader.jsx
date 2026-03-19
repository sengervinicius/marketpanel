/**
 * SectionHeader — the orange panel header bar
 */

export function SectionHeader({ title, subtitle, right }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      background: '#ff6600',
      color: '#000',
      padding: '2px 6px',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: 1.2,
      flexShrink: 0,
    }}>
      <span>{title}{subtitle && <span style={{ fontWeight: 400, marginLeft: 8 }}>{subtitle}</span>}</span>
      {right && <span style={{ fontWeight: 400, fontSize: 9 }}>{right}</span>}
    </div>
  );
}

export function SubHeader({ cols }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols,
      background: '#111',
      color: '#555',
      fontSize: 9,
      padding: '1px 0',
      borderBottom: '1px solid #1a1a1a',
      flexShrink: 0,
    }}>
      {/* cols is handled by parent */}
    </div>
  );
}
