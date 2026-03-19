/**
 * SectionHeader — the orange panel header bar
 */

export function SectionHeader({ title, subtitle, right }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a0800, #2a1000)',
      borderBottom: '1px solid #e55a00',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '3px 6px'
    }}>
      <div style={{display:'flex', alignItems:'center', gap:6}}>
        <span style={{color:'#e55a00', fontFamily:"'IBM Plex Mono', 'Courier New', monospace", fontSize:9, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase'}}>{title}</span>
        {subtitle && <span style={{color:'#666', fontSize:7, letterSpacing:'0.1em'}}>{subtitle}</span>}
      </div>
      {right && <span style={{color:'#888', fontSize:7}}>{right}</span>}
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
