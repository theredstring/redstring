/**
 * Haptics tier routing.
 *
 * The whole value of the service is that one semantic event resolves to a
 * different physical recipe per device class — so these tests pin the routing
 * table, not the feel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const Haptics = {
  impact: vi.fn(() => Promise.resolve()),
  selectionStart: vi.fn(() => Promise.resolve()),
  selectionChanged: vi.fn(() => Promise.resolve()),
  selectionEnd: vi.fn(() => Promise.resolve())
};

vi.mock('@capacitor/haptics', () => ({ Haptics }));

/** Fresh module instance — the route is cached on first use by design. */
const loadHaptics = async () => {
  vi.resetModules();
  return import('../../src/services/haptics.js');
};

const setPlatform = ({ native = false, platform = null, userAgent, maxTouchPoints = 0, vibrate = false }) => {
  if (native || platform) {
    window.Capacitor = { isNativePlatform: () => native, platform, getPlatform: () => platform };
  } else {
    delete window.Capacitor;
  }
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
  if (vibrate) window.navigator.vibrate = vi.fn(() => true);
  else delete window.navigator.vibrate;
};

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';

/** The service is fire-and-forget; its bridge calls land a microtask later. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('haptics tier detection', () => {
  beforeEach(() => {
    Object.values(Haptics).forEach((fn) => fn.mockClear());
    try { window.localStorage.clear(); } catch { /* not available */ }
  });

  afterEach(() => {
    delete window.Capacitor;
    delete window.navigator.vibrate;
  });

  it('routes native iPhone to the Taptic tier', async () => {
    setPlatform({ native: true, platform: 'ios', userAgent: IPHONE_UA, maxTouchPoints: 5 });
    const { getHapticTier, HapticTier } = await loadHaptics();
    expect(getHapticTier()).toBe(HapticTier.TAPTIC);
  });

  it('routes iPad to no tier — no iPad ships a haptic engine', async () => {
    setPlatform({ native: true, platform: 'ios', userAgent: IPAD_UA, maxTouchPoints: 5 });
    const { getHapticTier, HapticTier } = await loadHaptics();
    expect(getHapticTier()).toBe(HapticTier.NONE);
  });

  it('detects iPad even when iPadOS reports a Macintosh UA', async () => {
    setPlatform({ native: true, platform: 'ios', userAgent: DESKTOP_UA, maxTouchPoints: 5 });
    const { getHapticTier, HapticTier } = await loadHaptics();
    expect(getHapticTier()).toBe(HapticTier.NONE);
  });

  it('routes native Android to the basic tier', async () => {
    setPlatform({ native: true, platform: 'android', userAgent: ANDROID_UA, maxTouchPoints: 5 });
    const { getHapticTier, HapticTier } = await loadHaptics();
    expect(getHapticTier()).toBe(HapticTier.BASIC);
  });

  it('routes mobile web with navigator.vibrate to the basic tier', async () => {
    setPlatform({ userAgent: ANDROID_UA, maxTouchPoints: 5, vibrate: true });
    const { getHapticTier, HapticTier } = await loadHaptics();
    expect(getHapticTier()).toBe(HapticTier.BASIC);
  });

  it('routes desktop and iOS Safari to no tier', async () => {
    setPlatform({ userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    const { getHapticTier, HapticTier } = await loadHaptics();
    expect(getHapticTier()).toBe(HapticTier.NONE);
  });
});

describe('haptics recipes', () => {
  beforeEach(() => {
    Object.values(Haptics).forEach((fn) => fn.mockClear());
    try { window.localStorage.clear(); } catch { /* not available */ }
  });

  afterEach(() => {
    delete window.Capacitor;
    delete window.navigator.vibrate;
  });

  it('arms the selection generator on touch without emitting anything', async () => {
    setPlatform({ native: true, platform: 'ios', userAgent: IPHONE_UA, maxTouchPoints: 5 });
    const { haptic } = await loadHaptics();
    haptic('nodeTouch');
    await settle();
    expect(Haptics.selectionStart).toHaveBeenCalled();
    expect(Haptics.selectionChanged).not.toHaveBeenCalled();
    expect(Haptics.impact).not.toHaveBeenCalled();
  });

  it('lifts with a selection tick and drops with a light impact', async () => {
    setPlatform({ native: true, platform: 'ios', userAgent: IPHONE_UA, maxTouchPoints: 5 });
    const { haptic } = await loadHaptics();

    haptic('nodeTouch');
    await settle();
    haptic('nodeLift');
    await settle();
    expect(Haptics.selectionChanged).toHaveBeenCalledTimes(1);
    // Already armed by nodeTouch — the lift must not re-prepare.
    expect(Haptics.selectionStart).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 50)); // clear the rate limit
    haptic('nodeDrop');
    await settle();
    expect(Haptics.impact).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('prepares on demand when a lift arrives without a prior touch', async () => {
    setPlatform({ native: true, platform: 'ios', userAgent: IPHONE_UA, maxTouchPoints: 5 });
    const { haptic } = await loadHaptics();
    haptic('nodeLift');
    await settle();
    expect(Haptics.selectionStart).toHaveBeenCalledTimes(1);
    expect(Haptics.selectionChanged).toHaveBeenCalledTimes(1);
  });

  it('translates recipes to durations on mobile web', async () => {
    setPlatform({ userAgent: ANDROID_UA, maxTouchPoints: 5, vibrate: true });
    const { haptic } = await loadHaptics();
    haptic('nodeLift');
    expect(window.navigator.vibrate).toHaveBeenCalledWith(18);
    expect(Haptics.selectionChanged).not.toHaveBeenCalled();
  });

  it('translates durations to impact styles on native Android', async () => {
    setPlatform({ native: true, platform: 'android', userAgent: ANDROID_UA, maxTouchPoints: 5 });
    const { haptic } = await loadHaptics();
    haptic('nodeDrop');
    await settle();
    expect(Haptics.impact).toHaveBeenCalledWith({ style: 'MEDIUM' });
  });

  it('does nothing at all on an untiered device', async () => {
    setPlatform({ userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    const { haptic } = await loadHaptics();
    haptic('nodeLift');
    haptic('nodeDrop');
    await settle();
    expect(Haptics.impact).not.toHaveBeenCalled();
    expect(Haptics.selectionChanged).not.toHaveBeenCalled();
  });

  it('drops repeats that would fuse into one buzz', async () => {
    setPlatform({ userAgent: ANDROID_UA, maxTouchPoints: 5, vibrate: true });
    const { haptic } = await loadHaptics();
    haptic('nodeLift');
    haptic('nodeLift');
    haptic('nodeLift');
    expect(window.navigator.vibrate).toHaveBeenCalledTimes(1);
  });

  it('honours the user preference', async () => {
    setPlatform({ userAgent: ANDROID_UA, maxTouchPoints: 5, vibrate: true });
    const { haptic, setHapticsEnabled, areHapticsEnabled } = await loadHaptics();
    setHapticsEnabled(false);
    expect(areHapticsEnabled()).toBe(false);
    haptic('nodeLift');
    expect(window.navigator.vibrate).not.toHaveBeenCalled();

    setHapticsEnabled(true);
    haptic('nodeLift');
    expect(window.navigator.vibrate).toHaveBeenCalledTimes(1);
  });
});
