// DragContext.jsx — global drag state for ticker drag-and-drop
import { createContext, useContext, useState, useCallback } from 'react';

const DragContext = createContext(null);

export function DragProvider({ children }) {
  const [draggedTicker, setDraggedTicker] = useState(null); // { symbol, name, type }
  const [isDragging, setIsDragging] = useState(false);

  const startDrag = useCallback((ticker) => {
    setDraggedTicker(ticker);
    setIsDragging(true);
  }, []);

  const endDrag = useCallback(() => {
    setDraggedTicker(null);
    setIsDragging(false);
  }, []);

  return (
    <DragContext.Provider value={{ draggedTicker, isDragging, startDrag, endDrag }}>
      {children}
    </DragContext.Provider>
  );
}

export function useDrag() {
  return useContext(DragContext);
}
