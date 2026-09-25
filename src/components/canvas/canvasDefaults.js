/**
 * Fallbacks for the canvas's settings selectors (moved from NodeCanvas, P4.06),
 * at module scope so their identity is fixed for the life of the process. Shared
 * by NodeCanvas and the input hooks that subscribe to the same settings.
 *
 * These were object literals written inline in the selector
 * (`state.touchSettings || { ... }`). A literal there is allocated afresh on
 * EVERY store notification, so whenever the backing field is missing the
 * selector returns a new object each time, Zustand's Object.is check never
 * matches, and NodeCanvas re-renders on every action taken anywhere in the
 * store. The store does define all of these today, so nothing is currently
 * hitting the fallback path — this is to keep it that way if one ever goes
 * undefined.
 */

export const DEFAULT_DRAG_ZOOM_SETTINGS = { enabled: true, zoomAmount: 0.45 };
export const DEFAULT_KEYBOARD_SETTINGS = { zoomSensitivity: 0.5 };
export const DEFAULT_TOUCH_SETTINGS = { zoomSensitivity: 0.7, panSensitivity: 0.5 };
export const DEFAULT_FORCE_TUNER_SETTINGS = { layoutScale: 'balanced', layoutScaleMultiplier: 1, layoutIterations: 'balanced' };
