/**
 * InstrumentOptionsPanel.jsx — Options chain, strategy builder, payoff chart.
 *
 * Phase 20: First-pass options feature for the Particle Market Terminal.
 *
 * Props:
 *   symbol:  string (underlying ticker)
 *   spot:    number|null (current underlying price)
 *   isMobile: boolean
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../../utils/api';
import OptionsPayoffChart from './OptionsPayoffChart';
import './InstrumentOptionsPanel.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '--';
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtPct(n) {
  if (n == null) return '--';
  const sign = n >= 0 ? '+' : '';
  return sign + n.toFixed(2) + '%';
}

function fmtIV(n) {
  if (n == null || isNaN(n) || !isFinite(n)) return '--';
  return (n * 100).toFixed(1) + '%';
}

function fmtGreek(n) {
  if (n == null || isNaN(n) || !isFinite(n)) return '--';
  return n.toFixed(4);
}

function fmtCompact(n) {
  if (n == null) return '--';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toLocaleString();
}

// ── Strategy computation helpers ─────────────────────────────────────────────

function coveredCallStrategy(spot, callStrike, callPremium, shares = 100) {
  const maxProfit = (callStrike - spot) * shares + callPremium * shares;
  const maxLoss = (spot - callPremium) * shares; // stock goes to zero
  const breakEven = spot - callPremium;
  return {
    name: 'Covered Call',
    legs: [
      { type: 'long_stock', costBasis: spot, shares },
      { type: 'short_call', strike: callStrike, premium: callPremium, contracts: shares / 100 },
    ],
    spot,
    breakEvens: [breakEven],
    maxProfit: +maxProfit.toFixed(2),
    maxLoss: `-$${maxLoss.toFixed(2)} (stock to $0)`,
    netDebit: callPremium * shares, // credit received
  };
}

function protectivePutStrategy(spot, putStrike, putPremium, shares = 100) {
  const maxLoss = (spot - putStrike + putPremium) * shares;
  const breakEven = spot + putPremium;
  return {
    name: 'Protective Put',
    legs: [
      { type: 'long_stock', costBasis: spot, shares },
      { type: 'long_put', strike: putStrike, premium: putPremium, contracts: shares / 100 },
    ],
    spot,
    breakEvens: [breakEven],
    maxProfit: 'Unlimited',
    maxLoss: `-$${maxLoss.toFixed(2)}`,
    netDebit: -(putPremium * shares), // debit paid
  };
}

function longStraddleStrategy(spot, strike, callPremium, putPremium, contracts = 1) {
  const totalPremium = callPremium + putPremium;
  const maxLoss = totalPremium * contracts * 100;
  const be1 = strike - totalPremium;
  const be2 = strike + totalPremium;
  return {
    name: 'Long Straddle',
    legs: [
      { type: 'long_call', strike, premium: callPremium, contracts },
      { type: 'long_put', strike, premium: putPremium, contracts },
    ],
    spot,
    breakEvens: [be1, be2],
    maxProfit: 'Unlimited',
    maxLoss: `-$${maxLoss.toFixed(2)}`,
    netDebit: -(totalPremium * contracts * 100),
  };
}

// ── Main component ───────────────────────────────────────────────────────────

export default function InstrumentOptionsPanel({ symbol, spot, isMobile }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [expiries, setExpiries]         = useState([]);
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [chain, setChain]               = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [viewMode, setViewMode]         = useState('BOTH'); // CALLS | PUTS | BOTH
  const [nearMoneyOnly, setNearMoneyOnly] = useState(false);
  const [gamEventSent, setGamEventSent] = useState(false);

  // Strategy builder
  const [strategyType, setStrategyType] = useState('covered_call');
  const [stratShares, setStratShares]   = useState(100);
  const [stratContracts, setStratContracts] = useState(1);
  const [selectedCall, setSelectedCall] = useState(null);
  const [selectedPut, setSelectedPut]   = useState(null);
  const [showPayoff, setShowPayoff]     = useState(false);

  // AI strategy suggester
  const [aiOutlook, setAiOutlook]       = useState(null);
  const [aiStrategies, setAiStrategies] = useState([]);
  const [aiLoading, setAiLoading]       = useState(false);
  const [aiError, setAiError]           = useState(null);

  // ── Fetch expiries on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setChain(null);
    setExpiries([]);
    setSelectedExpiry(null);
    setSelectedCall(null);
    setSelectedPut(null);
    setShowPayoff(false);

    apiFetch(`/api/options/expiries?symbol=${encodeURIComponent(symbol)}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(d)))
      .then(data => {
        if (data.ok && data.expiries?.length) {
          setExpiries(data.expiries);
          setSelectedExpiry(data.expiries[0]);
        } else {
          setError('OPTIONS_UNAVAILABLE');
        }
      })
      .catch(e => {
        setError(e?.error || 'OPTIONS_UNAVAILABLE');
      })
      .finally(() => setLoading(false));
  }, [symbol]);

  // ── Fetch chain when expiry changes ────────────────────────────────────────
  useEffect(() => {
    if (!symbol || !selectedExpiry) return;
    setLoading(true);
    setError(null);

    apiFetch(`/api/options/chain?symbol=${encodeURIComponent(symbol)}&expiry=${selectedExpiry}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(d)))
      .then(data => {
        if (data.ok && data.data) {
          setChain(data.data);
        } else {
          setError('Failed to load chain');
        }
      })
      .catch(e => {
        setError(e?.message || 'Failed to load chain');
      })
      .finally(() => setLoading(false));
  }, [symbol, selectedExpiry]);

  // ── Derived data ───────────────────────────────────────────────────────────
  const underlyingPrice = chain?.underlying?.price ?? spot ?? 0;

  const filteredCalls = useMemo(() => {
    if (!chain?.calls) return [];
    if (!nearMoneyOnly) return chain.calls;
    const lo = underlyingPrice * 0.85;
    const hi = underlyingPrice * 1.15;
    return chain.calls.filter(c => c.strike >= lo && c.strike <= hi);
  }, [chain, nearMoneyOnly, underlyingPrice]);

  const filteredPuts = useMemo(() => {
    if (!chain?.puts) return [];
    if (!nearMoneyOnly) return chain.puts;
    const lo = underlyingPrice * 0.85;
    const hi = underlyingPrice * 1.15;
    return chain.puts.filter(c => c.strike >= lo && c.strike <= hi);
  }, [chain, nearMoneyOnly, underlyingPrice]);

  // Find ATM strike
  const atmStrike = useMemo(() => {
    if (!chain?.strikes?.length || !underlyingPrice) return null;
    return chain.strikes.reduce((best, s) =>
      Math.abs(s - underlyingPrice) < Math.abs(best - underlyingPrice) ? s : best
    , chain.strikes[0]);
  }, [chain, underlyingPrice]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleExpiryChange = useCallback((exp) => {
    setSelectedExpiry(exp);
    setSelectedCall(null);
    setSelectedPut(null);
    setShowPayoff(false);
  }, []);

  const handleCallClick = useCallback((contract) => {
    setSelectedCall(contract);
    // For straddle: auto-select matching put
    if (strategyType === 'long_straddle') {
      const matchPut = filteredPuts.find(p => p.strike === contract.strike);
      if (matchPut) setSelectedPut(matchPut);
    }
  }, [strategyType, filteredPuts]);

  const handlePutClick = useCallback((contract) => {
    setSelectedPut(contract);
    // For straddle: auto-select matching call
    if (strategyType === 'long_straddle') {
      const matchCall = filteredCalls.find(c => c.strike === contract.strike);
      if (matchCall) setSelectedCall(matchCall);
    }
  }, [strategyType, filteredCalls]);

  // ── Strategy computation ───────────────────────────────────────────────────
  const currentStrategy = useMemo(() => {
    const sp = underlyingPrice;
    if (!sp) return null;

    if (strategyType === 'covered_call' && selectedCall) {
      return coveredCallStrategy(sp, selectedCall.strike, selectedCall.mid ?? selectedCall.last ?? 0, stratShares);
    }
    if (strategyType === 'protective_put' && selectedPut) {
      return protectivePutStrategy(sp, selectedPut.strike, selectedPut.mid ?? selectedPut.last ?? 0, stratShares);
    }
    if (strategyType === 'long_straddle' && selectedCall && selectedPut) {
      return longStraddleStrategy(
        sp,
        selectedCall.strike,
        selectedCall.mid ?? selectedCall.last ?? 0,
        selectedPut.mid ?? selectedPut.last ?? 0,
        stratContracts,
      );
    }
    return null;
  }, [strategyType, selectedCall, selectedPut, underlyingPrice, stratShares, stratContracts]);

  const handleBuildStrategy = useCallback(() => {
    if (!currentStrategy) return;
    setShowPayoff(true);
  }, [currentStrategy]);

  // Handle AI outlook selection and fetch strategies
  const handleAiOutlookSelect = useCallback(async (outlook) => {
    setAiOutlook(outlook);
    setAiStrategies([]);
    setAiError(null);
    setAiLoading(true);

    try {
      const payload = {
        symbol,
        currentPrice: underlyingPrice,
        outlook,
      };

      // Add IV if available from chain
      if (chain?.underlying?.iv != null) {
        payload.iv = chain.underlying.iv;
      }

      const response = await apiFetch('/api/search/options-strategy', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch AI strategies');
      }

      const result = await response.json();
      setAiStrategies(result.strategies || []);
    } catch (err) {
      setAiError(err?.message || 'Error fetching AI strategies');
    } finally {
      setAiLoading(false);
    }
  }, [symbol, underlyingPrice, chain]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderContractRow = (c, side, onClick) => {
    const isAtm = atmStrike != null && c.strike === atmStrike;
    const isSelected = (side === 'call' && selectedCall?.contractSymbol === c.contractSymbol)
      || (side === 'put' && selectedPut?.contractSymbol === c.contractSymbol);
    const chgColor = (c.changePct ?? 0) >= 0 ? 'var(--price-up)' : 'var(--price-down)';

    return (
      <tr
        key={c.contractSymbol || `${side}-${c.strike}`}
        className={`opt-row${isAtm ? ' opt-row--atm' : ''}${isSelected ? ' opt-row--selected' : ''}`}
        onClick={() => onClick(c)}
      >
        <td className="opt-td opt-td--strike">{c.strike}</td>
        <td className="opt-td opt-td--num">{fmt(c.bid)}</td>
        <td className="opt-td opt-td--num">{fmt(c.ask)}</td>
        {!isMobile && <td className="opt-td opt-td--num">{fmt(c.mid)}</td>}
        {!isMobile && <td className="opt-td opt-td--num">{fmt(c.last)}</td>}
        {!isMobile && <td className="opt-td opt-td--num" style={{ color: chgColor }}>{fmtPct(c.changePct)}</td>}
        <td className="opt-td opt-td--num">{fmtCompact(c.volume)}</td>
        <td className="opt-td opt-td--num">{fmtCompact(c.openInterest)}</td>
        <td className="opt-td opt-td--num">{fmtIV(c.impliedVol)}</td>
        {!isMobile && (
          <>
            <td className="opt-td opt-td--num opt-td--greek">{fmtGreek(c.delta)}</td>
            <td className="opt-td opt-td--num opt-td--greek">{fmtGreek(c.gamma)}</td>
            <td className="opt-td opt-td--num opt-td--greek">{fmtGreek(c.theta)}</td>
            <td className="opt-td opt-td--num opt-td--greek">{fmtGreek(c.vega)}</td>
          </>
        )}
      </tr>
    );
  };

  const renderTableHeader = (side) => (
    <thead>
      <tr>
        <th className="opt-th">Strike</th>
        <th className="opt-th opt-th--num">Bid</th>
        <th className="opt-th opt-th--num">Ask</th>
        {!isMobile && <th className="opt-th opt-th--num">Mid</th>}
        {!isMobile && <th className="opt-th opt-th--num">Last</th>}
        {!isMobile && <th className="opt-th opt-th--num">Chg%</th>}
        <th className="opt-th opt-th--num">Vol</th>
        <th className="opt-th opt-th--num">OI</th>
        <th className="opt-th opt-th--num">IV</th>
        {!isMobile && (
          <>
            <th className="opt-th opt-th--num opt-th--greek">D</th>
            <th className="opt-th opt-th--num opt-th--greek">G</th>
            <th className="opt-th opt-th--num opt-th--greek">T</th>
            <th className="opt-th opt-th--num opt-th--greek">V</th>
          </>
        )}
      </tr>
    </thead>
  );

  // ── Empty / error / loading states ─────────────────────────────────────────
  if (error === 'OPTIONS_UNAVAILABLE') {
    return (
      <div className="opt-panel">
        <div className="opt-empty">Options unavailable for this instrument.</div>
      </div>
    );
  }

  if (loading && !chain) {
    return (
      <div className="opt-panel">
        <div className="opt-loading">Loading options chain...</div>
      </div>
    );
  }

  if (error && !chain) {
    return (
      <div className="opt-panel">
        <div className="opt-error">{error}</div>
        <button className="opt-retry" onClick={() => setSelectedExpiry(prev => prev)}>Retry</button>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="opt-panel">
      {/* ── Underlying summary ──────────────────────────── */}
      <div className="opt-underlying">
        <span className="opt-underlying-sym">{symbol}</span>
        <span className="opt-underlying-price">${fmt(underlyingPrice)}</span>
        {chain?.underlying?.asOf && (
          <span className="opt-underlying-asof">
            as of {new Date(chain.underlying.asOf).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* ── Controls ────────────────────────────────────── */}
      <div className="opt-controls">
        {/* Expiry selector */}
        <div className="opt-expiry-row">
          <span className="opt-ctrl-label">EXPIRY</span>
          <div className="opt-expiry-chips">
            {expiries.slice(0, isMobile ? 6 : 12).map(exp => (
              <button
                key={exp}
                className={`opt-chip${exp === selectedExpiry ? ' opt-chip--active' : ''}`}
                onClick={() => handleExpiryChange(exp)}
              >
                {exp.slice(5)} {/* MM-DD */}
              </button>
            ))}
            {expiries.length > (isMobile ? 6 : 12) && (
              <select
                className="opt-expiry-more"
                value={selectedExpiry || ''}
                onChange={e => handleExpiryChange(e.target.value)}
              >
                {expiries.map(exp => (
                  <option key={exp} value={exp}>{exp}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="opt-view-row">
          {/* View toggle */}
          <div className="opt-view-toggle">
            {['CALLS', 'PUTS', 'BOTH'].map(v => (
              <button
                key={v}
                className={`opt-chip${viewMode === v ? ' opt-chip--active' : ''}`}
                onClick={() => setViewMode(v)}
              >{v}</button>
            ))}
          </div>
          {/* Near-money filter */}
          <label className="opt-near-money">
            <input type="checkbox" checked={nearMoneyOnly} onChange={e => setNearMoneyOnly(e.target.checked)} />
            <span>Near-money</span>
          </label>
        </div>
      </div>

      {loading && <div className="opt-loading opt-loading--inline">Refreshing...</div>}

      {/* ── Chain tables ─────────────────────────────────── */}
      {(viewMode === 'CALLS' || viewMode === 'BOTH') && filteredCalls.length > 0 && (
        <div className="opt-chain-section">
          <div className="opt-chain-label">CALLS</div>
          <div className="opt-table-wrap">
            <table className="opt-table">
              {renderTableHeader('call')}
              <tbody>
                {filteredCalls.map(c => renderContractRow(c, 'call', handleCallClick))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(viewMode === 'PUTS' || viewMode === 'BOTH') && filteredPuts.length > 0 && (
        <div className="opt-chain-section">
          <div className="opt-chain-label">PUTS</div>
          <div className="opt-table-wrap">
            <table className="opt-table">
              {renderTableHeader('put')}
              <tbody>
                {filteredPuts.map(c => renderContractRow(c, 'put', handlePutClick))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && filteredCalls.length === 0 && filteredPuts.length === 0 && chain && (
        <div className="opt-empty">No contracts for this expiry. Try a different date.</div>
      )}

      {/* ── AI Strategy Suggester ───────────────────────────────── */}
      <div className="op-ai-section">
        <div className="opt-strategy-header">
          <span className="opt-strategy-title">AI STRATEGY SUGGESTER</span>
        </div>

        <div className="op-ai-outlook-btns">
          {['bullish', 'bearish', 'neutral'].map(outlook => (
            <button
              key={outlook}
              className={`op-ai-outlook-btn${aiOutlook === outlook ? ' op-ai-outlook-btn--active' : ''}`}
              onClick={() => handleAiOutlookSelect(outlook)}
              disabled={aiLoading}
            >
              {outlook.toUpperCase()}
            </button>
          ))}
        </div>

        {aiLoading && (
          <div className="opt-loading opt-loading--inline">Analyzing strategies...</div>
        )}

        {aiError && (
          <div className="opt-error">{aiError}</div>
        )}

        {aiStrategies.length > 0 && (
          <div className="op-ai-strategies">
            {aiStrategies.map((strat, idx) => (
              <div key={idx} className="op-ai-strategy-card">
                <div className="op-ai-strategy-name">{strat.name}</div>
                {strat.legs && strat.legs.length > 0 && (
                  <div className="op-ai-strategy-legs">
                    {strat.legs.map((leg, legIdx) => (
                      <div key={legIdx} className="op-ai-strategy-leg">
                        {leg.action && <span>{leg.action}</span>}
                        {leg.type && <span>{leg.type}</span>}
                        {leg.strike && <span>${leg.strike}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {strat.rationale && (
                  <div className="op-ai-strategy-rationale">{strat.rationale}</div>
                )}
                {(strat.riskReward || strat.idealCondition) && (
                  <div className="op-ai-strategy-meta">
                    {strat.riskReward && <span className="op-ai-risk-reward">{strat.riskReward}</span>}
                    {strat.idealCondition && <span className="op-ai-ideal-condition">{strat.idealCondition}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Strategy builder ──────────────────────────────── */}
      <div className="opt-strategy">
        <div className="opt-strategy-header">
          <span className="opt-strategy-title">STRATEGY BUILDER</span>
        </div>

        <div className="opt-strategy-selector">
          <span className="opt-ctrl-label">STRATEGY</span>
          <div className="opt-strategy-chips">
            {[
              { id: 'covered_call', label: 'Covered Call' },
              { id: 'protective_put', label: 'Protective Put' },
              { id: 'long_straddle', label: 'Long Straddle' },
            ].map(s => (
              <button
                key={s.id}
                className={`opt-chip${strategyType === s.id ? ' opt-chip--active' : ''}`}
                onClick={() => { setStrategyType(s.id); setShowPayoff(false); }}
              >{s.label}</button>
            ))}
          </div>
        </div>

        {/* Strategy inputs */}
        <div className="opt-strategy-inputs">
          {strategyType !== 'long_straddle' && (
            <div className="opt-strat-field">
              <label className="opt-ctrl-label">SHARES</label>
              <input
                type="number"
                className="opt-strat-input"
                value={stratShares}
                onChange={e => setStratShares(parseInt(e.target.value) || 100)}
                min={1}
                step={100}
              />
            </div>
          )}
          {strategyType === 'long_straddle' && (
            <div className="opt-strat-field">
              <label className="opt-ctrl-label">CONTRACTS</label>
              <input
                type="number"
                className="opt-strat-input"
                value={stratContracts}
                onChange={e => setStratContracts(parseInt(e.target.value) || 1)}
                min={1}
              />
            </div>
          )}

          {/* Selected legs display */}
          {(strategyType === 'covered_call' || strategyType === 'long_straddle') && (
            <div className="opt-strat-leg">
              <span className="opt-leg-label">Call:</span>
              {selectedCall ? (
                <span className="opt-leg-detail">
                  Strike ${selectedCall.strike} | Mid ${fmt(selectedCall.mid)} | IV {fmtIV(selectedCall.impliedVol)}
                </span>
              ) : (
                <span className="opt-leg-hint">Click a call row above</span>
              )}
            </div>
          )}

          {(strategyType === 'protective_put' || strategyType === 'long_straddle') && (
            <div className="opt-strat-leg">
              <span className="opt-leg-label">Put:</span>
              {selectedPut ? (
                <span className="opt-leg-detail">
                  Strike ${selectedPut.strike} | Mid ${fmt(selectedPut.mid)} | IV {fmtIV(selectedPut.impliedVol)}
                </span>
              ) : (
                <span className="opt-leg-hint">Click a put row above</span>
              )}
            </div>
          )}
        </div>

        {/* Build button */}
        <button
          className="opt-build-btn"
          onClick={handleBuildStrategy}
          disabled={!currentStrategy}
        >
          BUILD PAYOFF
        </button>

        {/* Strategy summary card */}
        {showPayoff && currentStrategy && (
          <div className="opt-strategy-card">
            <OptionsPayoffChart strategy={currentStrategy} />
          </div>
        )}
      </div>
    </div>
  );
}
