import { SectionHeader } from '../common/SectionHeader';
import { PriceRow } from '../common/PriceRow';
import { FOREX_PAIRS } from '../../utils/constants';

const COLS = '72px 1fr 76px 96px 52px';

export function ForexPanel({ forex, flashes, history }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SectionHeader title="FX / FOREX" right="MID RATES" />

      <div style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        color: '#444',
        fontSize: 9,
        padding: '1px 0',
        borderBottom: '1px solid #111',
        flexShrink: 0,
      }}>
        <span style={{ paddingLeft: 6 }}>PAIR</span>
        <span>NAME</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>RATE</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>CHG / %</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>TREND</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {FOREX_PAIRS.map((pair) => {
          const d = forex[pair.symbol] || {};
          const price = d.mid || d.ask || d.price;
          return (
            <PriceRow
              key={pair.symbol}
              columns={COLS}
              symbol={pair.label}
              name=""
              symColor="#ce93d8"
              price={price}
              change={d.change}
              changePct={d.changePct}
              history={history[pair.symbol]}
              flashState={flashes[`forex-${pair.symbol}`]}
            />
          );
        })}
      </div>
    </div>
  );
}
