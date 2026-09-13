import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The shell decision is a small pure rule with an asymmetry that is easy to
 * "tidy" into a bug, so it is pinned here rather than left to inspection.
 *
 * The asymmetry: under 'adaptive' a controller stands the shell down, a mouse
 * brings it back, and TOUCH DOES NEITHER. That is the whole point — an Android
 * handheld is indistinguishable from a phone by every measurement the web can
 * take (see the class note in the hook), so a controller is the only signal
 * left, and a handheld's screen is still a touchscreen. Anything that lets
 * touch clear the flag re-breaks handhelds.
 *
 * The viewport numbers below are the Retroid Pocket 6's real ones, read off the
 * device: 833x396 CSS px, which is `sw468dp` — squarely phone class, which is
 * exactly why the size test alone cannot tell them apart.
 */

const PREF_KEY = 'redstring_landscape_shell_mode';
const CONTROLLER_KEY = 'redstring_controller_present';

const RP6 = { w: 833, h: 396 };        // handheld, landscape
const PHONE_LANDSCAPE = { w: 844, h: 390 };
const PHONE_PORTRAIT = { w: 390, h: 844 };
const TABLET_LANDSCAPE = { w: 1133, h: 744 };  // iPad mini short side is 744

/**
 * The module caches the preference and the controller hint at import time (it
 * has to be correct before React mounts), so every case needs a fresh module
 * registry rather than a setter call.
 */
const loadShell = async ({
  capacitor = true,
  size = RP6,
  pref = null,
  controller = null,
} = {}) => {
  vi.resetModules();
  localStorage.clear();
  if (pref !== null) localStorage.setItem(PREF_KEY, pref);
  if (controller !== null) localStorage.setItem(CONTROLLER_KEY, String(controller));

  Object.defineProperty(window, 'innerWidth', { value: size.w, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: size.h, configurable: true, writable: true });
  document.body.className = '';

  vi.doMock('../../src/utils/capacitorAdapter.js', () => ({
    isCapacitor: () => capacitor,
  }));

  return import('../../src/hooks/useMobileLandscapeShell.js');
};

afterEach(() => {
  vi.doUnmock('../../src/utils/capacitorAdapter.js');
  localStorage.clear();
});

describe('adaptive — the geometry rule it started as', () => {
  it('takes the shell on a phone-sized Capacitor build in landscape', async () => {
    const { isMobileLandscapeShell } = await loadShell({ size: PHONE_LANDSCAPE });
    expect(isMobileLandscapeShell()).toBe(true);
  });

  it('leaves portrait alone — the mode buys nothing there', async () => {
    const { isMobileLandscapeShell } = await loadShell({ size: PHONE_PORTRAIT });
    expect(isMobileLandscapeShell()).toBe(false);
  });

  it('leaves tablets alone — they have the height', async () => {
    const { isMobileLandscapeShell } = await loadShell({ size: TABLET_LANDSCAPE });
    expect(isMobileLandscapeShell()).toBe(false);
  });

  it('leaves a desktop browser alone even at landscape-strip proportions', async () => {
    const { isMobileLandscapeShell } = await loadShell({ capacitor: false, size: RP6 });
    expect(isMobileLandscapeShell()).toBe(false);
  });
});

describe('adaptive — the controller exception', () => {
  it('stands the shell down while a controller is present', async () => {
    const { isMobileLandscapeShell, setControllerPresent } = await loadShell({ size: RP6 });
    expect(isMobileLandscapeShell()).toBe(true);

    setControllerPresent(true);
    expect(isMobileLandscapeShell()).toBe(false);
  });

  it('brings it back when the controller is retired', async () => {
    const { isMobileLandscapeShell, setControllerPresent } = await loadShell({ size: RP6 });
    setControllerPresent(true);
    setControllerPresent(false);
    expect(isMobileLandscapeShell()).toBe(true);
  });

  it('remembers the controller across launches, so a handheld does not reflow on first button press', async () => {
    const { isMobileLandscapeShell, setControllerPresent } = await loadShell({ size: RP6 });
    setControllerPresent(true);
    expect(localStorage.getItem(CONTROLLER_KEY)).toBe('true');

    // Relaunch: the Gamepad API hides the pad until its first button press, so
    // without this hint the app would start in the shell and jump out of it.
    const relaunched = await loadShell({ size: RP6, controller: true });
    expect(relaunched.isMobileLandscapeShell()).toBe(false);
  });

  it('does not apply the controller exception outside adaptive', async () => {
    const forcedOn = await loadShell({ size: RP6, pref: 'on', controller: true });
    expect(forcedOn.isMobileLandscapeShell()).toBe(true);

    const forcedOff = await loadShell({ size: RP6, pref: 'off', controller: false });
    expect(forcedOff.isMobileLandscapeShell()).toBe(false);
  });
});

describe('explicit preferences override the geometry', () => {
  it("'off' refuses the shell where adaptive would take it", async () => {
    const { isMobileLandscapeShell } = await loadShell({ size: RP6, pref: 'off' });
    expect(isMobileLandscapeShell()).toBe(false);
  });

  it("'on' takes the shell in landscape on any platform and size", async () => {
    const { isMobileLandscapeShell } = await loadShell({
      capacitor: false, size: TABLET_LANDSCAPE, pref: 'on',
    });
    expect(isMobileLandscapeShell()).toBe(true);
  });

  it("'on' still declines in portrait", async () => {
    const { isMobileLandscapeShell } = await loadShell({ size: PHONE_PORTRAIT, pref: 'on' });
    expect(isMobileLandscapeShell()).toBe(false);
  });

  it('persists the choice and ignores a junk value', async () => {
    const { setShellPreference, getShellPreference } = await loadShell({ size: RP6 });
    setShellPreference('off');
    expect(localStorage.getItem(PREF_KEY)).toBe('off');

    setShellPreference('sideways');
    expect(getShellPreference()).toBe('off');

    const relaunched = await loadShell({ size: RP6, pref: 'nonsense' });
    expect(relaunched.getShellPreference()).toBe('adaptive');
  });
});

describe('body class', () => {
  it('tracks the decision, so the safe-area padding follows it', async () => {
    const { setControllerPresent, SHELL_BODY_CLASS } = await loadShell({ size: RP6 });
    expect(document.body.classList.contains(SHELL_BODY_CLASS)).toBe(true);

    setControllerPresent(true);
    expect(document.body.classList.contains(SHELL_BODY_CLASS)).toBe(false);
  });

  it('announces non-geometric changes, which resize and orientationchange miss', async () => {
    const { setShellPreference, SHELL_CHANGE_EVENT } = await loadShell({ size: RP6 });
    const seen = vi.fn();
    window.addEventListener(SHELL_CHANGE_EVENT, seen);

    setShellPreference('off');
    expect(seen).toHaveBeenCalledTimes(1);

    // No-op writes must stay silent or every consumer re-renders for nothing.
    setShellPreference('off');
    expect(seen).toHaveBeenCalledTimes(1);

    window.removeEventListener(SHELL_CHANGE_EVENT, seen);
  });
});
