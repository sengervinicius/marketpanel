import { SectionHeader } from '../common/SectionHeader';
import { PriceRow } from '../common/PriceRow';
import { WORLD_INDEXES } from '../../utils/constants';

const COLS = '60px 1fr 68px 92px 52px';

export function IndexPanel({ stocks, flashes, history }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SectionHeader title="WORLD INDEXES" right="ETF PROXIES" />

      {/* Column labels */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        color: '#444',
        fontSize: 9,
        padding: '1px 0',
        borderBottom: '1px solid #111',
        flexShrink: 0,
      }}>
        <span style={{ paddingLeft: 6 }}>TICKER</span>
        <span>NAME</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>LAST</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>CHG / %</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>TREND</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {WORLD_INDEXES.map((idx) => {
          const d = stocks[idx.symbol] || {};
          return (
            <PriceRow
              key={idx.symbol}
              columns={COLS}
              symbol={idx.symbol}
              name={idx.label}
              symColor="#ff6600"
              price={d.price}
              change={d.change}
              changePct={d.changePct}
              history={history[idx.symbol]}
              flashState={flashes[`stocks-${idx.symbol}`]}
            />
          );
        })}
      </div>
    </div>
  );
}
