import { SectionHeader } from '../common/SectionHeader';
import { PriceRow } from '../common/PriceRow';
import { US_STOCKS, LATAM_STOCKS } from '../../utils/constants';

const COLS = '60px 1fr 68px 92px 52px';

export function StockPanel({ stocks, flashes, history }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SectionHeader title="US EQUITIES" />

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
        {US_STOCKS.map((s) => {
          const d = stocks[s.symbol] || {};
          return (
            <PriceRow
              key={s.symbol}
              columns={COLS}
              symbol={s.symbol}
              name={s.label}
              symColor="#00bcd4"
              price={d.price}
              change={d.change}
              changePct={d.changePct}
              history={history[s.symbol]}
              flashState={flashes[`stocks-${s.symbol}`]}
            />
          );
        })}

        {/* LatAm divider */}
        <div style={{ background: '#111', color: '#555', fontSize: 9, padding: '2px 6px', letterSpacing: 1, marginTop: 2 }}>
          ◆ LATAM ADRs
        </div>

        {LATAM_STOCKS.map((s) => {
          const d = stocks[s.symbol] || {};
          return (
            <PriceRow
              key={s.symbol}
              columns={COLS}
              symbol={s.symbol}
              name={s.label}
              symColor="#4db6ac"
              price={d.price}
              change={d.change}
              changePct={d.changePct}
              history={history[s.symbol]}
              flashState={flashes[`stocks-${s.symbol}`]}
            />
          );
        })}
      </div>
    </div>
  );
}
