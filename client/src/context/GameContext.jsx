/**
 * GameContext.jsx — Virtual investing game state provider.
 *
 * Provides:
 *   gameProfile   — current game profile (cash, equity, positions, etc.)
 *   refreshGame() — refetch GET /api/game/profile
 *   executeTrade({ symbol, side, quantity }) — POST /api/game/trade
 *   tradeLoading  — boolean
 *   tradeError    — string | null
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { apiFetch, apiJSON } from '../utils/api';

const GameContext = createContext(null);

export function GameProvider({ children }) {
  const [gameProfile, setGameProfile] = useState(null);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeError, setTradeError] = useState(null);

  const refreshGame = useCallback(async () => {
    try {
      const data = await apiJSON('/api/game/profile');
      setGameProfile(data);
    } catch (e) {
      // Silently fail — profile will be null until loaded
      console.warn('[GameContext] Failed to load game profile:', e.message);
    }
  }, []);

  const executeTrade = useCallback(async ({ symbol, side, quantity }) => {
    setTradeLoading(true);
    setTradeError(null);
    try {
      const data = await apiJSON('/api/game/trade', {
        method: 'POST',
        body: JSON.stringify({ symbol, side, quantity }),
      });
      setGameProfile(data.gameProfile);
      return data;
    } catch (e) {
      const msg = e.message || 'Trade failed';
      setTradeError(msg);
      throw e;
    } finally {
      setTradeLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshGame();
  }, [refreshGame]);

  return (
    <GameContext.Provider value={{ gameProfile, refreshGame, executeTrade, tradeLoading, tradeError }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  return useContext(GameContext);
}
