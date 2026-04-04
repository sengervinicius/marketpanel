/**
 * TradeModal.jsx — Quick game trade modal.
 *
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   defaultSymbol: string (pre-filled symbol)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useGame } from '../../context/GameContext';

function fmtUSD(v) {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TradeModal({ isOpen, onClose, defaultSymbol = '' }) {
  const { executeTrade, tradeLoading, gameProfile } = useGame() || {};
  const [symbol, setSymbol] = useState(defaultSymbol.toUpperCase());
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen && defaultSymbol) {
      setSymbol(defaultSymbol.toUpperCase());
    }
  }, [isOpen, defaultSymbol]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccess(null);
      // Focus quantity if symbol pre-filled, else symbol
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleTrade = useCallback(async (side) => {
    setError(null);
    setSuccess(null);

    const sym = symbol.trim().toUpperCase();
    const qty = parseInt(quantity);

    if (!sym) { setError('Enter a symbol'); return; }
    if (!qty || qty <= 0) { setError('Enter a valid quantity'); return; }

    try {
      const result = await executeTrade({ symbol: sym, side, quantity: qty });
      setSuccess(`${side} ${qty} ${sym} @ ${fmtUSD(result.trade.price)}`);
      setQuantity('');
      // Auto-close after success
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      setError(e.message || 'Trade failed');
    }
  }, [symbol, quantity, executeTrade, onClose]);

  if (!isOpen) return null;

  return (
    <div className="trade-modal-overlay" onClick={onClose}>
      <div className="trade-modal" onClick={e => e.stopPropagation()}>
        <div className="trade-modal-header">
          <span className="trade-modal-title">Game Trade</span>
          <button className="trade-modal-close" onClick={onClose}>&times;</button>
        </div>

        {gameProfile && (
          <div className="trade-modal-balance">
            Cash available: {fmtUSD(gameProfile.cash)}
          </div>
        )}

        <div className="trade-modal-body">
          <label className="trade-modal-label">
            Symbol
            <input
              ref={defaultSymbol ? undefined : inputRef}
              className="trade-modal-input"
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="AAPL"
              maxLength={20}
            />
          </label>

          <label className="trade-modal-label">
            Quantity
            <input
              ref={defaultSymbol ? inputRef : undefined}
              className="trade-modal-input"
              type="number"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="100"
              min={1}
              max={1000000}
            />
          </label>

          <div className="trade-modal-actions">
            <button
              className="trade-modal-btn trade-modal-btn--buy"
              onClick={() => handleTrade('BUY')}
              disabled={tradeLoading}
            >
              {tradeLoading ? 'Executing...' : 'Buy'}
            </button>
            <button
              className="trade-modal-btn trade-modal-btn--sell"
              onClick={() => handleTrade('SELL')}
              disabled={tradeLoading}
            >
              {tradeLoading ? 'Executing...' : 'Sell'}
            </button>
          </div>

          {error && <div className="trade-modal-error">{error}</div>}
          {success && <div className="trade-modal-success">{success}</div>}
        </div>
      </div>

      <style>{`
        .trade-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 16px;
        }
        .trade-modal {
          background: var(--bg-surface);
          border: 1px solid var(--border-strong);
          border-radius: 12px;
          width: 100%;
          max-width: 360px;
          overflow: hidden;
        }
        .trade-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .trade-modal-title {
          font-weight: 700;
          font-size: 15px;
          color: var(--text-primary);
        }
        .trade-modal-close {
          background: none;
          border: none;
          font-size: 20px;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          line-height: 1;
        }
        .trade-modal-balance {
          padding: 8px 16px;
          font-size: 12px;
          color: var(--text-muted);
          border-bottom: 1px solid var(--border-subtle);
        }
        .trade-modal-body {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .trade-modal-label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .trade-modal-input {
          padding: 8px 10px;
          border-radius: 6px;
          border: 1px solid var(--border-strong);
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: 14px;
          outline: none;
        }
        .trade-modal-input:focus {
          border-color: var(--accent);
        }
        .trade-modal-actions {
          display: flex;
          gap: 8px;
        }
        .trade-modal-btn {
          flex: 1;
          padding: 10px 0;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          min-height: 44px;
        }
        .trade-modal-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .trade-modal-btn--buy {
          background: var(--green);
          color: #fff;
        }
        .trade-modal-btn--sell {
          background: var(--red);
          color: #fff;
        }
        .trade-modal-error {
          font-size: 12px;
          color: var(--red);
          text-align: center;
        }
        .trade-modal-success {
          font-size: 12px;
          color: var(--green);
          text-align: center;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
