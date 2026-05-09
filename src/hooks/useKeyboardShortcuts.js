import { useRef, useEffect } from 'react';

/**
 * Custom hook to track currently pressed keys.
 */
export const useKeyboardShortcuts = () => {
  const keysPressed = useRef({});

  useEffect(() => {
    // Keys that drive the canvas pan/zoom loop. macOS suppresses keyup for
    // non-modifier keys while Meta is held, so a RAF loop reading these would
    // see them as "still down" after the user let go. We work around that with
    // a per-key heartbeat timer below.
    const MOVEMENT_KEYS = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
    const clearMovementKeys = () => {
      for (const k of MOVEMENT_KEYS) keysPressed.current[k] = false;
    };

    // Heartbeat timers for movement keys held while Meta/Ctrl is down.
    // macOS suppresses keyup for non-modifier keys during a Meta-hold, so we
    // detect release by watching for the absence of keydown auto-repeat. The
    // OS has a long initial repeat delay (~400ms by default) followed by a
    // fast repeat rate (~30ms). A single timeout can't cover both: short
    // enough to feel responsive on release, but long enough to survive the
    // initial pre-repeat gap. So we use two stages:
    //   - INITIAL: 700ms — covers OS initial-repeat-delay before first repeat
    //   - REPEAT: 150ms — fast release detection once we've seen a repeat
    const HEARTBEAT_INITIAL_MS = 700;
    const HEARTBEAT_REPEAT_MS = 150;
    const heartbeatTimers = {};
    const refreshHeartbeat = (key, isRepeat) => {
      if (heartbeatTimers[key]) clearTimeout(heartbeatTimers[key]);
      const ms = isRepeat ? HEARTBEAT_REPEAT_MS : HEARTBEAT_INITIAL_MS;
      heartbeatTimers[key] = setTimeout(() => {
        keysPressed.current[key] = false;
        delete heartbeatTimers[key];
      }, ms);
    };
    const cancelHeartbeat = (key) => {
      if (heartbeatTimers[key]) {
        clearTimeout(heartbeatTimers[key]);
        delete heartbeatTimers[key];
      }
    };
    const cancelAllHeartbeats = () => {
      for (const k of Object.keys(heartbeatTimers)) cancelHeartbeat(k);
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

        // When Meta/Ctrl goes down, start heartbeats for any movement keys
        // already held — those keys' original keydowns fired without the
        // modifier, so they have no heartbeat yet, and their keyup will be
        // suppressed if the user releases them while the modifier is held.
        // Use the long timeout: we don't know when the next OS repeat will
        // arrive, and we want to survive the initial-repeat-delay gap.
        if (key === 'Meta' || key === 'Control') {
          for (const k of MOVEMENT_KEYS) {
            if (keysPressed.current[k]) refreshHeartbeat(k, false);
          }
        }

        // While Meta/Ctrl is held, keyup will not fire for this movement key
        // when the user releases it. Use OS auto-repeat as a heartbeat: each
        // repeat refreshes the timer, and if it expires we know the key has
        // actually been released. e.repeat tells us whether this is the
        // initial press (long timeout) or an OS auto-repeat (short timeout).
        if ((e.metaKey || e.ctrlKey) && MOVEMENT_KEYS.includes(key)) {
          refreshHeartbeat(key, e.repeat === true);
        }

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
      cancelHeartbeat(key);
      // On Meta/Control release, force-release movement keys. macOS suppresses
      // keyup for other keys while Cmd is held, so any w/a/s/d/arrow that was
      // released during the shortcut never fired keyup. Shift is excluded
      // because it's used here as a zoom modifier and releasing it should not
      // disturb a still-held movement key.
      if (key === 'Meta' || key === 'Control') {
        cancelAllHeartbeats();
        clearMovementKeys();
      }
    };

    const handleWindowBlur = () => {
      // Clear all keys when window loses focus to prevent stuck keys
      keysPressed.current = {};
      cancelAllHeartbeats();
    };

    const handleVisibilityChange = () => {
      // Screenshot overlays and app-switcher don't always fire blur on the
      // browser window, but they do flip visibility. Clear on hide as a backup.
      if (document.hidden) {
        keysPressed.current = {};
        cancelAllHeartbeats();
      }
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
      cancelAllHeartbeats();
      keysPressed.current = {}; // Reset keys on unmount
    };
  }, []); // Empty dependency array ensures this runs only once on mount/unmount

  return keysPressed; // Return the ref so components can access the keys
}; 