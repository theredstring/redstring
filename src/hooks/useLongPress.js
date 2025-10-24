import { useRef, useCallback } from 'react';

/**
 * Custom hook to manage long press detection logic.
 *
 * @param {function} onLongPress - Callback function to execute when long press is detected.
 * @param {function} [onClick] - Optional callback for short clicks.
 * @param {object} [options] - Configuration options.
 * @param {number} [options.duration=500] - Duration in ms to qualify as long press.
 * @param {number} [options.movementThreshold=5] - Pixels allowed to move before cancelling press.
 */
export const useLongPress = (
  onLongPress,
  onClick,
  { duration = 500, movementThreshold = 5 } = {}
) => {
  const timerRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);

  const start = useCallback((event) => {
    // Prevent multi-touch issues
    if (event.touches && event.touches.length > 1) return;

    const posX = event.touches ? event.touches[0].clientX : event.clientX;
    const posY = event.touches ? event.touches[0].clientY : event.clientY;

    startPosRef.current = { x: posX, y: posY };
    movedRef.current = false;

    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Start the timer
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) {
        // Timer completed without significant movement -> Long Press!
        onLongPress(event);
        timerRef.current = null; // Clear ref after firing
      }
    }, duration);
  }, [duration, onLongPress]);

  const cancel = useCallback((event, wasMoved = false) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Check if it was a click (no long press, minimal movement)
    if (onClick && !wasMoved && !movedRef.current) {
       // It might be slightly better to check movement threshold again here if needed,
       // but relying on movedRef set in move handler is usually sufficient.
       onClick(event);
    }
  }, [onClick]);

  const move = useCallback((event) => {
    if (timerRef.current && !movedRef.current) {
       const posX = event.touches ? event.touches[0].clientX : event.clientX;
       const posY = event.touches ? event.touches[0].clientY : event.clientY;
       const deltaX = Math.abs(posX - startPosRef.current.x);
       const deltaY = Math.abs(posY - startPosRef.current.y);

       if (deltaX > movementThreshold || deltaY > movementThreshold) {
         // Moved too much, cancel the long press timer
         movedRef.current = true;
         clearTimeout(timerRef.current);
         timerRef.current = null;
       }
    }
  }, [movementThreshold]);

  return {
    onMouseDown: (e) => start(e),
    onTouchStart: (e) => start(e),
    onMouseUp: (e) => cancel(e),
    onTouchEnd: (e) => cancel(e),
    onMouseMove: (e) => move(e),
    onTouchMove: (e) => move(e),
    // Expose a manual cancel function if needed outside event handlers
    cancelManually: () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }
  };
}; 