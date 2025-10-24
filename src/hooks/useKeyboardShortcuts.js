import { useRef, useEffect } from 'react';

/**
 * Custom hook to track currently pressed keys.
 */
export const useKeyboardShortcuts = () => {
  const keysPressed = useRef({});

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check if focus is on a text input to prevent conflicts
      const activeElement = document.activeElement;
      const isTextInput = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.contentEditable === 'true' ||
        activeElement.type === 'text' ||
        activeElement.type === 'search' ||
        activeElement.type === 'password' ||
        activeElement.type === 'email' ||
        activeElement.type === 'number'
      );
      
      // Only track keys if not in a text input
      if (!isTextInput) {
        // Normalize single-character keys to lowercase so Shift+W stores as 'w'
        const key = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
        keysPressed.current[key] = true;
        
        // Prevent default behavior for navigation keys to avoid page scrolling
        if (key === ' ' || key === 'Shift' || key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
          e.preventDefault();
        }
      }
    };
    
    const handleKeyUp = (e) => {
      // Always track key releases to prevent stuck keys
      const key = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keysPressed.current[key] = false;
      // Do NOT clear other keys on modifier release; this breaks combos like Shift+W
    };

    const handleWindowBlur = () => {
      // Clear all keys when window loses focus to prevent stuck keys
      keysPressed.current = {};
    };

    console.log('[useKeyboardShortcuts] Adding key listeners');
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    // Cleanup listeners on unmount
    return () => {
      console.log('[useKeyboardShortcuts] Removing key listeners');
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      keysPressed.current = {}; // Reset keys on unmount
    };
  }, []); // Empty dependency array ensures this runs only once on mount/unmount

  return keysPressed; // Return the ref so components can access the keys
}; 