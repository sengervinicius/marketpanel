/**
 * OptionsPayoffChart.jsx — At-expiry P&L diagram for options strategies.
 *
 * Uses Recharts (already in stack). Renders a clean terminal-style
 * payoff line chart with zero-line, spot marker, and break-even markers.
 *
 * Props:
 *   strategy: { name, legs, spot, breakEvens, maxProfit, maxLoss, netDebit }
 *   where legs is an array of:
 *     { type: 'long_call'|'short_call'|'long_put'|'short_put'|'long_stock',
 *       strike, premium, contracts, shares }
 */
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ReferenceLine, ResponsiveContainer, Tooltip,
} from 'recharts';

const ORANGE = '#F97316';
const GREEN  = '#4caf50';
const RED    = '#f44336';
const GRID   = 'rgba(255,255,255,0.06)';
const ZERO   = 'rgba(255,255,255,0.2)';
const SPOT   = 'rgba(255,102,0,0.4)';

function fmt(n) {
  if (n == null) return '--';
  return n >= 0 ? `+$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`;
}

function fmtLabel(n) {
  if (n == null || n === 'Unlimited') return n || '--';
  if (typeof n === 'number') return fmt(n);
  return n;
}

/**
 * Compute P&L at a given expiry price for a set of legs.
 */
function computePayoff(expiryPrice, legs) {
  let pnl = 0;
  for (const leg of legs) {
    const { type, strike = 0, premium = 0, contracts = 1, shares = 100 } = leg;
    const mult = contracts * 100; // 1 contract = 100 shares

    switch (type) {
      case 'long_call':
        pnl += (Math.max(0, expiryPrice - strike) - premium) * mult;
        break;
      case 'short_call':
        pnl += (premium - Math.max(0, expiryPrice - strike)) * mult;
        break;
      case 'long_put':
        pnl += (Math.max(0, strike - expiryPrice) - premium) * mult;
        break;
      case 'short_put':
        pnl += (premium - Math.max(0, strike - expiryPrice)) * mult;
        break;
      case 'long_stock':
        pnl += (expiryPrice - (leg.costBasis ?? strike)) * shares;
        break;
      default:
        break;
    }
  }
  return +pnl.toFixed(2);
}

export default function OptionsPayoffChart({ strategy }) {
  if (!strategy || !strategy.legs || strategy.legs.length === 0) return null;

  const { legs, spot = 100, breakEvens = [], maxProfit, maxLoss, netDebit, name } = strategy;

  // Generate X range: spot * 0.7 to spot * 1.3 with ~51 points
  const lo = Math.floor(spot * 0.7);
  const hi = Math.ceil(spot * 1.3);
  const step = Math.max(0.5, (hi - lo) / 50);
  const data = [];
  for (let p = lo; p <= hi; p += step) {
    const price = +p.toFixed(2);
    data.push({ price, pnl: computePayoff(price, legs) });
  }

  // Ensure exact spot is in data
  if (!data.find(d => Math.abs(d.price - spot) < step * 0.5)) {
    data.push({ price: spot, pnl: computePayoff(spot, legs) });
    data.sort((a, b) => a.price - b.price);
  }

  return (
    <div className="opt-payoff">
      {/* Summary labels */}
      <div className="opt-payoff-summary">
        <span className="opt-payoff-name">{name || 'Strategy'}</span>
        <div className="opt-payoff-metrics">
          <span className="opt-metric">
            <span className="opt-metric-label">Max Profit</span>
            <span className="opt-metric-value" style={{ color: GREEN }}>{fmtLabel(maxProfit)}</span>
          </span>
          <span className="opt-metric">
            <span className="opt-metric-label">Max Loss</span>
            <span className="opt-metric-value" style={{ color: RED }}>{fmtLabel(maxLoss)}</span>
          </span>
          {breakEvens.length > 0 && (
            <span className="opt-metric">
              <span className="opt-metric-label">Break-even</span>
              <span className="opt-metric-value">{breakEvens.map(b => `$${b.toFixed(2)}`).join(', ')}</span>
            </span>
          )}
          {netDebit != null && (
            <span className="opt-metric">
              <span className="opt-metric-label">{netDebit >= 0 ? 'Net Credit' : 'Net Debit'}</span>
              <span className="opt-metric-value">${Math.abs(netDebit).toFixed(2)}</span>
            </span>
          )}
        </div>
      </div>

      <div className="opt-payoff-chart">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis
              dataKey="price"
              type="number"
              domain={[lo, hi]}
              tick={{ fontSize: 10, fill: '#888' }}
              tickFormatter={v => `$${v}`}
              stroke="rgba(255,255,255,0.1)"
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#888' }}
              tickFormatter={v => v >= 0 ? `+${v}` : v}
              stroke="rgba(255,255,255,0.1)"
              width={55}
            />
            <Tooltip
              contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 11, borderRadius: 4 }}
              labelFormatter={v => `Price: $${v}`}
              formatter={v => [fmt(v), 'P&L']}
            />
            {/* Zero line */}
            <ReferenceLine y={0} stroke={ZERO} strokeDasharray="4 4" />
            {/* Current spot */}
            <ReferenceLine x={spot} stroke={SPOT} strokeDasharray="3 3" label={{ value: 'Spot', fill: ORANGE, fontSize: 9, position: 'top' }} />
            {/* Break-even markers */}
            {breakEvens.map((be, i) => (
              <ReferenceLine key={i} x={be} stroke="rgba(255,255,255,0.3)" strokeDasharray="2 4" />
            ))}
            {/* Payoff line */}
            <Line
              type="linear"
              dataKey="pnl"
              stroke={ORANGE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, fill: ORANGE }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Export compute function for reuse
export { computePayoff };
