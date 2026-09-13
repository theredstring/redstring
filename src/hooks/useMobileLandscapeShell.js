import { useEffect, useState } from 'react';
import { isCapacitor } from '../utils/capacitorAdapter.js';

/**
 * "Fullscreen shell" mode: a phone-sized Capacitor build held in landscape.
 *
 * Landscape on a phone leaves so little vertical room that the header bar and
 * the TypeList footer together eat a third of the screen, so in this one mode
 * the app drops both and hands the whole box to the canvas. The panels stay
 * (they're the only navigation left) and slide over the canvas from the edges,
 * starting at y=0 rather than below a header that no longer exists.
 *
 * The safe-area treatment changes with it — see the `.rs-fullscreen-landscape`
 * rule in App.css. Every inset is released, notch side included, so the canvas
 * runs to the physical edges on all four sides.
 *
 * Deliberately narrow: Capacitor only (a desktop browser resized to a landscape
 * strip should keep its chrome), and phones only. An iPad's short side is 744pt
 * (mini) or more, so the threshold below keeps tablets — which have plenty of
 * height in landscape — on the normal layout.
 *
 * HANDHELDS ARE THE EXCEPTION, AND A CONTROLLER IS HOW WE KNOW.
 *
 * An Android handheld (Retroid Pocket, Ayn Odin, Anbernic et al.) is a phone by
 * every measurement the web can take. The Retroid Pocket 6 reports a natural
 * orientation of PORTRAIT rotated 90° — framework-identical to a phone held
 * sideways — a smallest-width of 468dp (phone class; tablets start at 600dp),
 * and it does not declare `android.hardware.gamepad` despite having sticks. The
 * screen-size test and the rotation-angle test both fire exactly as they do on a
 * phone, so neither can tell the two apart.
 *
 * What DOES separate them is a controller being used. That is also the signal
 * that matters, rather than a proxy for one: the shell mode's whole trade is to
 * drop the header and the TypeList and leave edge-swiped panels as the only
 * navigation, which is a touch-first bargain. A device driving a d-pad through
 * useGamepad's chrome navigation wants that chrome to exist.
 *
 * So under 'adaptive' the shell yields to a controller — and the clearing rule
 * is asymmetric on purpose. Touch does NOT hand the mode back, because a
 * handheld's screen is still a touchscreen and tapping it says nothing about
 * the device class. A real mouse does, because no handheld has one. See
 * setControllerPresent.
 */
export const MOBILE_SHELL_SHORT_SIDE_MAX = 600;

/** localStorage key for the user's Off / On / Adaptive choice. */
export const SHELL_PREF_KEY = 'redstring_landscape_shell_mode';

/** localStorage key for the sticky "a controller has been used here" hint. */
export const SHELL_CONTROLLER_KEY = 'redstring_controller_present';

export const SHELL_MODES = ['adaptive', 'on', 'off'];

/**
 * Fired on <window> whenever the shell decision's *non-geometric* inputs move —
 * the preference or the controller flag. Geometry already has resize and
 * orientationchange; this covers the rest without polling.
 */
export const SHELL_CHANGE_EVENT = 'rs-shell-mode-change';

const readPreference = () => {
  try {
    const raw = localStorage.getItem(SHELL_PREF_KEY);
    return SHELL_MODES.includes(raw) ? raw : 'adaptive';
  } catch {
    return 'adaptive';
  }
};

const readControllerPresent = () => {
  try {
    return localStorage.getItem(SHELL_CONTROLLER_KEY) === 'true';
  } catch {
    return false;
  }
};

let shellPreference = readPreference();
let controllerPresent = readControllerPresent();

const isLandscape = () => {
  if (typeof window === 'undefined') return false;
  // Raw window dims, not getAppViewportSize(): this decides what the safe-area
  // padding should be, so it must not be measured through that padding.
  return window.innerWidth > window.innerHeight;
};

/**
 * The original size-and-platform test, unchanged — now only one input to the
 * decision rather than the whole of it.
 */
const geometryWantsShell = () => {
  if (typeof window === 'undefined') return false;
  try {
    if (!isCapacitor()) return false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!(w > h)) return false;
    return Math.min(w, h) <= MOBILE_SHELL_SHORT_SIDE_MAX;
  } catch {
    return false;
  }
};

export const isMobileLandscapeShell = () => {
  if (typeof window === 'undefined') return false;
  // 'on' is honoured on any platform at any size — someone who asks for the
  // full-bleed canvas in a landscape window has said what they want, and the
  // panels it leaves behind are enough to reach this setting again. It still
  // requires landscape: the mode is about vertical scarcity, and in portrait
  // there is nothing for it to buy.
  if (shellPreference === 'on') return isLandscape();
  if (shellPreference === 'off') return false;
  return geometryWantsShell() && !controllerPresent;
};

export const SHELL_BODY_CLASS = 'rs-fullscreen-landscape';

/**
 * Keep <body>'s safe-area padding in step with the mode — see the
 * `.rs-fullscreen-landscape` rule in App.css.
 *
 * This deliberately runs from a module-level listener rather than a React
 * effect. The padding changes the size of #root, and #root is what
 * getAppViewportSize() measures, so every consumer that re-measures on `resize`
 * (useViewportBounds, NodeCanvas's viewportSize) must see the NEW padding.
 * React effects run child-first, so a toggle inside App's effect would land
 * after those consumers had already measured the old box and would leave the
 * canvas short by the inset until the next resize. A listener registered at
 * import time — before any component mounts — runs ahead of all of them.
 *
 * The preference and the controller flag live at module scope for the same
 * reason: reading them from the store would put the decision behind React, and
 * this function has to be correct before React exists.
 */
const syncShellClass = () => {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.classList.toggle(SHELL_BODY_CLASS, isMobileLandscapeShell());
};

const notifyShellChange = () => {
  syncShellClass();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SHELL_CHANGE_EVENT));
  }
};

export const getShellPreference = () => shellPreference;

export const setShellPreference = (mode) => {
  if (!SHELL_MODES.includes(mode) || mode === shellPreference) return;
  shellPreference = mode;
  try { localStorage.setItem(SHELL_PREF_KEY, mode); } catch { }
  notifyShellChange();
};

export const isControllerPresent = () => controllerPresent;

/**
 * Record whether a controller is driving this device.
 *
 * Called true by useGamepad the moment a pad is actually used, and false from
 * exactly two places: a real mouse pointerdown (NodeCanvas's modality listener)
 * and `gamepaddisconnected` once no pads remain. Touch and pen are deliberately
 * not among them — see the class note above.
 *
 * PERSISTED, because the Gamepad API hides a pad until its first button press.
 * Without a sticky hint a handheld would start every launch in the shell, drop
 * out of it the instant the user pressed anything, and reflow the whole app in
 * front of them — once per launch, forever. The disconnect rule is what keeps
 * the hint honest for the other case: a phone that was paired to a pad and then
 * unpaired clears it on the disconnect and returns to the shell.
 */
export const setControllerPresent = (present) => {
  const next = !!present;
  if (next === controllerPresent) return;
  controllerPresent = next;
  try { localStorage.setItem(SHELL_CONTROLLER_KEY, String(next)); } catch { }
  notifyShellChange();
};

if (typeof window !== 'undefined') {
  syncShellClass();
  window.addEventListener('resize', syncShellClass);
  window.addEventListener('orientationchange', syncShellClass);
}

/**
 * Reactive form of isMobileLandscapeShell(). Every consumer calls this directly
 * rather than receiving it as a prop — the value is derived from the window, so
 * threading it through the tree would only add a way for the copies to disagree.
 */
export const useMobileLandscapeShell = () => {
  const [active, setActive] = useState(isMobileLandscapeShell);

  useEffect(() => {
    let frameId = null;
    const update = () => {
      syncShellClass();
      setActive(isMobileLandscapeShell());
      // iOS fires orientationchange before innerWidth/innerHeight have swapped,
      // so re-read once the rotation has actually committed.
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        syncShellClass();
        setActive(isMobileLandscapeShell());
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener(SHELL_CHANGE_EVENT, update);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener(SHELL_CHANGE_EVENT, update);
    };
  }, []);

  return active;
};

/**
 * Reactive form of getShellPreference(), for the Settings control.
 */
export const useShellPreference = () => {
  const [pref, setPref] = useState(getShellPreference);

  useEffect(() => {
    const update = () => setPref(getShellPreference());
    window.addEventListener(SHELL_CHANGE_EVENT, update);
    return () => window.removeEventListener(SHELL_CHANGE_EVENT, update);
  }, []);

  return pref;
};

export default useMobileLandscapeShell;
