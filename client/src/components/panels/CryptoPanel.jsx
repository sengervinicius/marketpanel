import { SectionHeader } from '../common/SectionHeader';
import { PriceRow } from '../common/PriceRow';
import { CRYPTO_PAIRS } from '../../utils/constants';

const COLS = '56px 1fr 80px 96px 52px';

export function CryptoPanel({ crypto, flashes, history }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <SectionHeader title="CRYPTO" right="USD" />

      <div style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        color: '#444',
        fontSize: 9,
        padding: '1px 0',
        borderBottom: '1px solid #111',
        flexShrink: 0,
      }}>
        <span style={{ paddingLeft: 6 }}>COIN</span>
        <span>NAME</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>LAST</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>CHG / %</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>TREND</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {CRYPTO_PAIRS.map((c) => {
          const d = crypto[c.symbol] || {};
          return (
            <PriceRow
              key={c.symbol}
              columns={COLS}
              symbol={c.symbol.replace('USD', '')}
              name={c.label}
              symColor="#f48fb1"
              price={d.price}
              change={d.change}
              changePct={d.changePct}
              history={history[c.symbol]}
              flashState={flashes[`crypto-${c.symbol}`]}
            />
          );
        })}
      </div>
    </div>
  );
}
