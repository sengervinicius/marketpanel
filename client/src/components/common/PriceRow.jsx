/**
 * PriceRow — a single row in any market data table.
 * Handles flash animation, color coding, sparkline.
 */

import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { fmtPrice, fmtChange, fmtPct, colorClass, decimalsForPrice } from '../../utils/format';

const STYLES = {
  row: {
    display: 'grid',
    alignItems: 'center',
    borderBottom: '1px solid #0f0f0f',
    padding: '1px 0',
    transition: 'background 0.5s ease',
    cursor: 'grab',
  },
  sym: {
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: 0.5,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    paddingLeft: 6,
  },
  name: {
    color: '#666',
    fontSize: 10,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  price: {
    textAlign: 'right',
    fontWeight: 600,
    fontSize: 11,
    paddingRight: 4,
    fontVariantNumeric: 'tabular-nums',
  },
  chg: {
    textAlign: 'right',
    fontSize: 10,
    paddingRight: 4,
    fontVariantNumeric: 'tabular-nums',
  },
  spark: {
    paddingRight: 4,
  },
};

function Spark({ data, up }) {
  if (!data || data.length < 3) return <div style={{ width: 55 }} />;
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width={55} height={18}>
      <LineChart data={chartData}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={up ? '#00cc44' : '#cc2200'}
          strokeWidth={1.2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PriceRow({ columns, symbol, name, symColor, price, change, changePct, history, flashState, showSpark = true }) {
  const up = (changePct ?? change ?? 0) >= 0;
  const cc = colorClass(changePct ?? change);
  const dec = decimalsForPrice(price);
  const flashBg = flashState === 'up' ? 'rgba(0,204,68,0.12)' : flashState === 'down' ? 'rgba(204,34,0,0.12)' : 'transparent';

  const gridColumns = showSpark
    ? columns || '65px 1fr 70px 90px 50px'
    : columns || '65px 1fr 70px 90px';

  const handleDragStart = (e) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ symbol, label: name || symbol }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      style={{ ...STYLES.row, gridTemplateColumns: gridColumns, background: flashBg }}
    >
      <span style={{ ...STYLES.sym, color: symColor || '#ff6600' }}>{symbol}</span>
      <span style={STYLES.name}>{name}</span>
      <span style={{ ...STYLES.price, color: '#e8e8e8' }}>
        {fmtPrice(price, dec)}
      </span>
      <span style={{ ...STYLES.chg, color: cc === 'up' ? '#00cc44' : cc === 'down' ? '#cc2200' : '#888' }}>
        {fmtChange(change, dec > 2 ? dec : 2)} / {fmtPct(changePct)}
      </span>
      {showSpark && (
        <div style={STYLES.spark}>
          <Spark data={history} up={up} />
        </div>
      )}
    </div>
  );
}
