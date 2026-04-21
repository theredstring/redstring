import { useRef, useEffect } from 'react';

/**
 * Custom hook to track currently pressed keys.
 */
export const useKeyboardShortcuts = () => {
  const keysPressed = useRef({});

  useEffect(() => {
    // Keys that drive the canvas pan/zoom loop. When a system shortcut (Cmd+Shift+4,
    // Cmd+Tab, etc.) hijacks the keyboard, these are what get stuck — macOS
    // suppresses keyup for non-modifier keys while Meta is held, so the RAF loop
    // keeps reading them as "still down" long after the user let go.
    const MOVEMENT_KEYS = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
    const clearMovementKeys = () => {
      for (const k of MOVEMENT_KEYS) keysPressed.current[k] = false;
    };

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
      // On Meta/Control release, force-release movement keys. macOS suppresses
      // keyup for other keys while Cmd is held, so any w/a/s/d/arrow that was
      // released during the shortcut never fired keyup. Shift is excluded
      // because it's used here as a zoom modifier and releasing it should not
      // disturb a still-held movement key.
      if (key === 'Meta' || key === 'Control') {
        clearMovementKeys();
      }
    };

    const handleWindowBlur = () => {
      // Clear all keys when window loses focus to prevent stuck keys
      keysPressed.current = {};
    };

    const handleVisibilityChange = () => {
      // Screenshot overlays and app-switcher don't always fire blur on the
      // browser window, but they do flip visibility. Clear on hide as a backup.
      if (document.hidden) keysPressed.current = {};
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup listeners on unmount
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      keysPressed.current = {}; // Reset keys on unmount
    };
  }, []); // Empty dependency array ensures this runs only once on mount/unmount

  return keysPressed; // Return the ref so components can access the keys
}; 