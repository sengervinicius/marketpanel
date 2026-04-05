/**
 * GamePortfolioPanel.jsx — Virtual investing game panel.
 *
 * Shows:
 *   - Account summary (equity, return %, MoC, cash)
 *   - Trade form (symbol, quantity, buy/sell)
 *   - Positions list with P&L
 *   - Recent trades history
 */

import { useState, useCallback, useEffect } from 'react';
import { useGame } from '../../context/GameContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { apiJSON } from '../../utils/api';
import EquityCurveChart from '../EquityCurveChart';
import './GamePortfolioPanel.css';

// ── Formatting helpers ──────────────────────────────────────────────────────

function fmtUSD(v) {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtUSD2(v) {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v) {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(2)}%`;
}

function fmtMoC(v) {
  if (v == null) return '—';
  return `${v.toFixed(3)}x`;
}

function returnClass(v) {
  if (v == null || v === 0) return 'gp-return--flat';
  return v > 0 ? 'gp-return--pos' : 'gp-return--neg';
}

function pnlClass(v) {
  if (v == null || v === 0) return '';
  return v > 0 ? 'gp-pos-pnl--pos' : 'gp-pos-pnl--neg';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Component ───────────────────────────────────────────────────────────────

export default function GamePortfolioPanel({ mobile = false }) {
  const openDetail = useOpenDetail();
  const { gameProfile, executeTrade, tradeLoading, tradeError, refreshGame } = useGame() || {};

  const [tab, setTab] = useState('positions');   // positions | trades
  const [symbol, setSymbol] = useState('');
  const [quantity, setQuantity] = useState('');
  const [lastTrade, setLastTrade] = useState(null);
  const [localError, setLocalError] = useState(null);
  const [trades, setTrades] = useState([]);
  const [tradesLoaded, setTradesLoaded] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);

  // Load equity curve snapshots
  useEffect(() => {
    apiJSON('/api/game/snapshots')
      .then(data => setSnapshots(data.snapshots || []))
      .catch(() => setSnapshots([]))
      .finally(() => setSnapshotsLoading(false));
  }, []);

  // Load trades when tab switches
  useEffect(() => {
    if (tab === 'trades' && !tradesLoaded) {
      apiJSON('/api/game/trades?limit=50')
        .then(data => {
          setTrades(data.trades || []);
          setTradesLoaded(true);
        })
        .catch(() => {});
    }
  }, [tab, tradesLoaded]);

  const handleTrade = useCallback(async (side) => {
    setLocalError(null);
    setLastTrade(null);

    const sym = symbol.trim().toUpperCase();
    const qty = parseInt(quantity);

    if (!sym) { setLocalError('Enter a symbol'); return; }
    if (!qty || qty <= 0) { setLocalError('Enter a valid quantity'); return; }

    try {
      const result = await executeTrade({ symbol: sym, side, quantity: qty });
      setLastTrade(result.trade);
      setSymbol('');
      setQuantity('');
      setTradesLoaded(false); // reload trades on next tab switch
    } catch (e) {
      setLocalError(e.message || 'Trade failed');
    }
  }, [symbol, quantity, executeTrade]);

  // ── Loading / no profile ──────────────────────────────────────
  if (!gameProfile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="gp-empty">
          <div className="gp-empty-title">Loading game...</div>
        </div>
      </div>
    );
  }

  const positions = gameProfile.positions || [];
  const error = localError || tradeError;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Summary strip ────────────────────────────────────────── */}
      <div className="gp-summary">
        <div className="gp-balance-row">
          <span className="gp-equity">{fmtUSD(gameProfile.equity)}</span>
          <span className={`gp-return ${returnClass(gameProfile.totalReturnPct)}`}>
            {fmtPct(gameProfile.totalReturnPct)}
          </span>
        </div>
        <div className="gp-metrics">
          <div className="gp-metric">
            <span className="gp-metric-label">Cash</span>
            <span className="gp-metric-value">{fmtUSD(gameProfile.cash)}</span>
          </div>
          <div className="gp-metric">
            <span className="gp-metric-label">MoC</span>
            <span className="gp-metric-value">{fmtMoC(gameProfile.cashMultiple)}</span>
          </div>
          <div className="gp-metric">
            <span className="gp-metric-label">Realized P&L</span>
            <span className={`gp-metric-value ${returnClass(gameProfile.realizedPnl)}`}>
              {fmtUSD2(gameProfile.realizedPnl)}
            </span>
          </div>
          <div className="gp-metric">
            <span className="gp-metric-label">Positions</span>
            <span className="gp-metric-value">{positions.length}</span>
          </div>
        </div>
      </div>

      {/* ── Equity curve ─────────────────────────────────────────── */}
      <div className="gp-equity-curve">
        <div className="gp-section-label">EQUITY CURVE</div>
        <EquityCurveChart
          snapshots={snapshots}
          height={mobile ? 100 : 120}
          startBalance={gameProfile.startBalance}
          loading={snapshotsLoading}
        />
      </div>

      {/* ── Trade form ────────────────────────────────────────────── */}
      <div className="gp-trade-form">
        <div className="gp-trade-row">
          <input
            className="gp-trade-input gp-trade-input--symbol"
            type="text"
            placeholder="AAPL"
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            maxLength={20}
          />
          <input
            className="gp-trade-input gp-trade-input--qty"
            type="number"
            placeholder="Qty"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            min={1}
            max={1000000}
          />
          <button
            className="gp-trade-btn gp-trade-btn--buy"
            onClick={() => handleTrade('BUY')}
            disabled={tradeLoading}
          >
            {tradeLoading ? '...' : 'Buy'}
          </button>
          <button
            className="gp-trade-btn gp-trade-btn--sell"
            onClick={() => handleTrade('SELL')}
            disabled={tradeLoading}
          >
            {tradeLoading ? '...' : 'Sell'}
          </button>
        </div>
        {error && <div className="gp-trade-error">{error}</div>}
        {lastTrade && !error && (
          <div className="gp-trade-success">
            {lastTrade.side} {lastTrade.quantity} {lastTrade.symbol} @ {fmtUSD2(lastTrade.price)}
          </div>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <div className="gp-tabs">
        <button
          className={`gp-tab ${tab === 'positions' ? 'gp-tab--active' : ''}`}
          onClick={() => setTab('positions')}
        >
          Positions ({positions.length})
        </button>
        <button
          className={`gp-tab ${tab === 'trades' ? 'gp-tab--active' : ''}`}
          onClick={() => setTab('trades')}
        >
          Trades
        </button>
      </div>

      {/* ── Content ───────────────────────────────────────────────── */}
      <div className="gp-positions">
        {tab === 'positions' && (
          positions.length === 0 ? (
            <div className="gp-empty">
              <div className="gp-empty-title">No positions yet</div>
              <div>Buy your first stock above to start investing!</div>
            </div>
          ) : (
            positions.map(pos => (
              <div
                key={pos.symbol}
                className="gp-position-row"
                onClick={() => openDetail(pos.symbol)}
              >
                <div className="gp-pos-left">
                  <span className="gp-pos-symbol">{pos.symbol}</span>
                  <span className="gp-pos-detail">
                    {pos.quantity} shares @ {fmtUSD2(pos.avgPrice)}
                  </span>
                </div>
                <div className="gp-pos-right">
                  <span className="gp-pos-value">{fmtUSD(pos.marketValue)}</span>
                  <span className={`gp-pos-pnl ${pnlClass(pos.unrealizedPnl)}`}>
                    {fmtUSD2(pos.unrealizedPnl)} ({fmtPct(pos.avgPrice > 0 ? (pos.lastPrice - pos.avgPrice) / pos.avgPrice : 0)})
                  </span>
                </div>
              </div>
            ))
          )
        )}

        {tab === 'trades' && (
          trades.length === 0 ? (
            <div className="gp-empty">
              <div className="gp-empty-title">No trades yet</div>
              <div>Your trade history will appear here.</div>
            </div>
          ) : (
            trades.map((t, i) => (
              <div key={`${t.createdAt}-${i}`} className="gp-trade-row-item">
                <span className={`gp-trade-side gp-trade-side--${t.side}`}>{t.side}</span>
                <div className="gp-trade-info">
                  <span className="gp-trade-symbol">{t.symbol}</span>
                  <span className="gp-trade-detail">{t.quantity} @ {fmtUSD2(t.price)} · {fmtDate(t.createdAt)}</span>
                </div>
                <span className="gp-trade-amount">{fmtUSD(t.notional)}</span>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}
