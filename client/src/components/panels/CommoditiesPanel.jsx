import { SectionHeader } from '../common/SectionHeader';
import { PriceRow } from '../common/PriceRow';
import { COMMODITIES } from '../../utils/constants';

const COLS = '56px 1fr 68px 92px 52px';

export function CommoditiesPanel({ stocks, flashes, history }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SectionHeader title="COMMODITIES" right="ETF PROXIES" />

      <div style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        color: '#444',
        fontSize: 9,
        padding: '1px 0',
        borderBottom: '1px solid #111',
        flexShrink: 0,
      }}>
        <span style={{ paddingLeft: 6 }}>SYM</span>
        <span>NAME</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>LAST</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>CHG / %</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>TREND</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {COMMODITIES.map((c) => {
          const d = stocks[c.symbol] || {};
          return (
            <PriceRow
              key={c.symbol}
              columns={COLS}
              symbol={c.symbol}
              name={`${c.label} (${c.unit})`}
              symColor="#ffd54f"
              price={d.price}
              change={d.change}
              changePct={d.changePct}
              history={history[c.symbol]}
              flashState={flashes[`stocks-${c.symbol}`]}
            />
          );
        })}
      </div>
    </div>
  );
}
