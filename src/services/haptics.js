/**
 * Haptic feedback service.
 *
 * Redstring runs on four very different haptic substrates, and they are not
 * interchangeable:
 *
 *   - iPhone (Taptic Engine, iOS 10+). Real transducer with distinct feedback
 *     classes: UISelectionFeedbackGenerator (a crisp, near-silent tick) and
 *     UIImpactFeedbackGenerator (a weighted thud with light/medium/heavy mass).
 *     Both can be *prepared* ahead of use, which is what removes the ~50-100ms
 *     spin-up latency that otherwise desyncs the tap from the visual.
 *   - Android under Capacitor. One eccentric-rotating-mass or LRA motor. The
 *     plugin maps impact styles onto VibrationEffect amplitudes, so intensity
 *     is expressible but "shape" is not — everything reads as a buzz.
 *   - Mobile web with navigator.vibrate (Android browsers). Duration only. No
 *     amplitude, no prepare, requires a prior user gesture.
 *   - Everything else — desktop, iOS Safari (navigator.vibrate is absent and
 *     the Taptic Engine is unreachable from the web), and every iPad, none of
 *     which ship a haptic engine at all.
 *
 * So the module is built as: detect a *tier* once, then route each semantic
 * event through a per-tier recipe. Call sites never name a waveform — they say
 * `haptic('nodeLift')` and this table decides whether that is a selection tick,
 * a 8ms buzz, or nothing.
 *
 * Everything here is fire-and-forget: no call ever throws, awaits, or blocks a
 * drag frame. A haptic that fails is a haptic that didn't happen.
 */

// --- Tiers -----------------------------------------------------------------

export const HapticTier = {
  /** Taptic Engine: separate tick/impact classes, prepare-able, amplitude-aware. */
  TAPTIC: 'taptic',
  /** Single vibration motor: intensity and duration only, no shape. */
  BASIC: 'basic',
  /** No haptic hardware reachable from here. */
  NONE: 'none'
};

// How a tier's recipes get delivered.
const Channel = {
  CAPACITOR: 'capacitor', // @capacitor/haptics native plugin
  VIBRATE: 'vibrate'      // navigator.vibrate
};

let cachedRoute = null;

const detectRoute = () => {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return { tier: HapticTier.NONE, channel: null, reason: 'no-window' };
    }

    const cap = window.Capacitor;
    const isNative = !!cap && (
      (typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() === true)
      || cap.isNative === true
    );
    const platform = cap?.platform
      ?? (typeof cap?.getPlatform === 'function' ? cap.getPlatform() : null);

    const ua = navigator.userAgent || '';
    // iPadOS reports a Macintosh UA in some WKWebView configurations, so the
    // touch-point count is the reliable half of this test.
    const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);

    if (isNative && platform === 'ios') {
      // No iPad ships a Taptic Engine — UIFeedbackGenerator calls are silent
      // no-ops there, so route them away rather than paying the bridge hop.
      if (isIPad) return { tier: HapticTier.NONE, channel: null, reason: 'ipad-no-engine' };
      return { tier: HapticTier.TAPTIC, channel: Channel.CAPACITOR, reason: 'ios-taptic' };
    }

    if (isNative && platform === 'android') {
      // The plugin translates impact styles into VibrationEffect amplitudes,
      // which is more than navigator.vibrate offers but still a single motor.
      return { tier: HapticTier.BASIC, channel: Channel.CAPACITOR, reason: 'android-native' };
    }

    if (typeof navigator.vibrate === 'function') {
      return { tier: HapticTier.BASIC, channel: Channel.VIBRATE, reason: 'web-vibrate' };
    }

    return { tier: HapticTier.NONE, channel: null, reason: 'unsupported' };
  } catch {
    return { tier: HapticTier.NONE, channel: null, reason: 'detect-failed' };
  }
};

/**
 * Resolved route, computed on first use. Not computed at module eval time: the
 * Capacitor bridge injects window.Capacitor before app JS runs, but module
 * evaluation order across the bundle is not something to bet on.
 */
const route = () => {
  if (!cachedRoute) cachedRoute = detectRoute();
  return cachedRoute;
};

export const getHapticTier = () => route().tier;

/** Diagnostics for the Xcode console — mirrors logPlatformDiagnostics(). */
export const describeHaptics = () => ({ ...route(), enabled: areHapticsEnabled() });

// --- User preference -------------------------------------------------------

const PREF_KEY = 'redstring-haptics';
let enabledOverride = null;

export const areHapticsEnabled = () => {
  if (enabledOverride !== null) return enabledOverride;
  try {
    enabledOverride = window.localStorage?.getItem(PREF_KEY) !== 'off';
  } catch {
    enabledOverride = true;
  }
  return enabledOverride;
};

export const setHapticsEnabled = (enabled) => {
  enabledOverride = !!enabled;
  try { window.localStorage?.setItem(PREF_KEY, enabled ? 'on' : 'off'); } catch { /* private mode */ }
  if (!enabled) release();
};

// --- Plugin loading --------------------------------------------------------

let pluginPromise = null;
let plugin = null; // resolved module, cached so the hot path is synchronous

const loadPlugin = () => {
  if (!pluginPromise) {
    pluginPromise = import('@capacitor/haptics')
      .then((mod) => { plugin = mod; return mod; })
      .catch((error) => {
        console.warn('[Haptics] Plugin unavailable, disabling:', error?.message || error);
        cachedRoute = { tier: HapticTier.NONE, channel: null, reason: 'plugin-load-failed' };
        return null;
      });
  }
  return pluginPromise;
};

// --- Event recipes ---------------------------------------------------------

/**
 * Semantic event → per-tier recipe. Keeping the two tiers side by side in one
 * table is the point: it's where the "what does this feel like on a motor that
 * can't do that" question gets answered, once, per event.
 *
 * taptic recipes:
 *   { tick: true }            selection tick (requires a live prepare())
 *   { impact: 'LIGHT'|'MEDIUM'|'HEAVY' }
 *   { prepare: true }         arm the generator, emit nothing
 * basic recipes:
 *   { vibrate: ms }           duration on web; the plugin's impact mapping on
 *                             Android native, chosen by the ms bucket below
 */
const RECIPES = {
  /**
   * Finger lands on a node. Nothing fires — this is the warm-up so the lift
   * tick 500ms later is instant. On a single motor there's no latency to hide,
   * so it stays the short confirmation buzz it has always been.
   */
  nodeTouch: {
    [HapticTier.TAPTIC]: { prepare: true },
    [HapticTier.BASIC]: { vibrate: 8 }
  },
  /**
   * Node leaves the canvas and is now held. A selection tick: the lightest
   * thing the Taptic Engine makes, and crisp enough to read as "it detached"
   * without announcing itself. Deliberately not an impact — impacts imply
   * collision, and lifting is the opposite.
   */
  nodeLift: {
    [HapticTier.TAPTIC]: { tick: true },
    [HapticTier.BASIC]: { vibrate: 18 }
  },
  /**
   * Node lands. A light impact — a soft weighted thud, mirroring the drop
   * animation's shorter, snappier settle. The asymmetry against the lift tick
   * is what makes the pair legible without either being loud.
   */
  nodeDrop: {
    [HapticTier.TAPTIC]: { impact: 'LIGHT' },
    [HapticTier.BASIC]: { vibrate: 12 }
  },
  /** Tap that resolved as a tap, not a drag. Barely there. */
  nodeTap: {
    [HapticTier.TAPTIC]: { tick: true },
    [HapticTier.BASIC]: { vibrate: 5 }
  },
  /**
   * A discrete control commits and something happens — a pie menu button, the
   * plus sign. An impact rather than a tick: this is the class of gesture where
   * the finger causes an effect, and the light weight keeps it from announcing
   * itself on a control you hit dozens of times a session.
   */
  menuSelect: {
    [HapticTier.TAPTIC]: { impact: 'LIGHT' },
    [HapticTier.BASIC]: { vibrate: 10 }
  },
  /**
   * Stepping through a set — the pie menu's ◀/▶ page chevrons. A selection tick
   * is exactly the case UISelectionFeedbackGenerator exists for, and it's the
   * right call for a control that can be tapped repeatedly in quick succession:
   * a run of impacts would read as pounding, a run of ticks as detents.
   */
  menuPage: {
    [HapticTier.TAPTIC]: { tick: true },
    [HapticTier.BASIC]: { vibrate: 8 }
  },
  /**
   * The viewport leaves for somewhere else entirely — Back to Civilization.
   * The one place a medium impact is warranted: the whole canvas moves under
   * you, and unlike a pie button this is a rare, deliberate press, so it can
   * afford the extra weight without becoming background noise.
   */
  viewportJump: {
    [HapticTier.TAPTIC]: { impact: 'MEDIUM' },
    [HapticTier.BASIC]: { vibrate: 16 }
  },
  /**
   * A connection gesture landed on something. A tick, not an impact: the edge
   * appearing is its own loud visual event, and after a run of stretch detents
   * an impact would read as a thud at the end of a texture.
   */
  connectionMade: {
    [HapticTier.TAPTIC]: { tick: true },
    [HapticTier.BASIC]: { vibrate: 12 }
  },
  /**
   * One detent while the connection line stretches — see createDetentTrack.
   *
   * Taptic only, and deliberately so. This is the one event that fires in a
   * stream rather than once, and a stream is exactly what a single vibration
   * motor cannot render: ten 8ms buzzes a second is a continuous rattle, not a
   * texture, and it costs real battery. The absent BASIC entry IS the routing —
   * haptic() finds no recipe for the tier and returns.
   */
  connectionStretch: {
    [HapticTier.TAPTIC]: { tick: true }
  }
};

// --- Rate limiting ---------------------------------------------------------

// Two haptics closer together than this fuse into one indistinct buzz on every
// tier, so the second is dropped rather than muddying the first.
const MIN_INTERVAL_MS = 40;
let lastFireTime = 0;

// The selection generator is a live native object; iOS releases it under memory
// pressure and the plugin drops it on selectionEnd(). Re-prepare if the arm is
// older than this so a long-held press still ticks on time.
const PREPARE_TTL_MS = 30000;
// null (not 0) means "never armed": now() is performance.now(), which is
// relative to page load, so `now() - 0 > TTL` is false for the app's first 30
// seconds — a 0 sentinel would silently skip the very first prepare and
// swallow the tick, since selectionChanged() is inert without it.
let preparedAt = null;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// --- Delivery --------------------------------------------------------------

const deliverTaptic = (recipe) => {
  const fire = (mod) => {
    if (!mod) return;
    const stale = preparedAt === null || now() - preparedAt > PREPARE_TTL_MS;
    if (recipe.prepare || (recipe.tick && stale)) {
      // selectionStart() only prepares the generator; it emits nothing itself.
      mod.Haptics.selectionStart().catch(() => { });
      preparedAt = now();
    }
    if (recipe.tick) {
      // selectionChanged() is a no-op unless selectionStart() armed it first —
      // the prepare above is required, not merely an optimization.
      mod.Haptics.selectionChanged().catch(() => { });
    }
    if (recipe.impact) {
      mod.Haptics.impact({ style: recipe.impact }).catch(() => { });
    }
  };

  if (plugin) fire(plugin);
  else loadPlugin().then(fire);
};

// Android's plugin has no duration input, so the web durations are bucketed
// back onto impact styles — same table, one translation layer.
const impactForDuration = (ms) => (ms <= 8 ? 'LIGHT' : ms <= 15 ? 'MEDIUM' : 'HEAVY');

const deliverBasic = (recipe, channel) => {
  const ms = recipe.vibrate;
  if (!ms) return;

  if (channel === Channel.VIBRATE) {
    try { navigator.vibrate(ms); } catch { /* gesture-gated or denied */ }
    return;
  }

  const fire = (mod) => {
    if (!mod) return;
    mod.Haptics.impact({ style: impactForDuration(ms) }).catch(() => { });
  };
  if (plugin) fire(plugin);
  else loadPlugin().then(fire);
};

/**
 * Play a semantic haptic event. Unknown events, unsupported hardware, disabled
 * preference, and rate-limited repeats all resolve to doing nothing.
 *
 * `force` bypasses the rate limit for a one-shot that must land even if
 * something fired moments ago — a gesture's terminal event arriving on the
 * heels of its own detent stream. Never use it for anything repeating; the
 * rate limit is what keeps a stream from smearing into one buzz.
 */
export const haptic = (event, { force = false } = {}) => {
  const { tier, channel } = route();
  if (tier === HapticTier.NONE || !areHapticsEnabled()) return;

  const recipe = RECIPES[event]?.[tier];
  if (!recipe) return;

  // Prepare is silent, so it neither consumes nor is blocked by the rate limit.
  const isSilent = recipe.prepare && !recipe.tick && !recipe.impact && !recipe.vibrate;
  if (!isSilent) {
    const t = now();
    if (!force && t - lastFireTime < MIN_INTERVAL_MS) return;
    // Stamped even when forced, so a forced event still gates what follows it.
    lastFireTime = t;
  }

  if (tier === HapticTier.TAPTIC) deliverTaptic(recipe);
  else deliverBasic(recipe, channel);
};

/**
 * A detent track: turns a continuously-varying number into a stream of ticks,
 * one per lattice crossing. This is how iOS's own picker wheels and timers
 * feel — UIPickerView emits one selection tick per row boundary crossed. There
 * is no continuous waveform involved, and the illusion of texture comes
 * entirely from the crossing rate tracking how fast you're moving.
 *
 * Ticks land on a fixed lattice anchored at zero rather than accumulating from
 * wherever the last one fired, so the detents stay in the same places for a
 * given value — reversing direction re-crosses the same boundaries, the way a
 * wheel spun backwards clicks through the same stops.
 *
 * Taptic-tier only: the underlying event has no recipe on a vibration motor,
 * so update() degrades to a cheap arithmetic no-op everywhere else.
 *
 *   const track = createDetentTrack('connectionStretch', 44);
 *   track.reset(0);        // seed without ticking
 *   track.update(length);  // call per input event; ticks on each crossing
 */
export const createDetentTrack = (event, quantum) => {
  let lastIndex = null;
  return {
    /** Seed the lattice position without emitting — call at gesture start. */
    reset(value = null) {
      lastIndex = value === null ? null : Math.floor(value / quantum);
    },
    update(value) {
      if (!Number.isFinite(value)) return;
      const index = Math.floor(value / quantum);
      if (lastIndex === null) { lastIndex = index; return; }
      if (index === lastIndex) return;
      lastIndex = index;
      // A single tick per call even if the value jumped several detents: the
      // engine can't render a burst inside one frame anyway, and haptic()'s
      // rate limit would swallow the extras.
      haptic(event);
    }
  };
};

/**
 * Pull the plugin module in ahead of time, at idle.
 *
 * Firing a haptic is otherwise free on the JS thread — it resolves a cached
 * route object and hands a small payload to `webkit.messageHandlers.bridge
 * .postMessage`, which returns immediately. The one exception is the very first
 * call, which triggers the dynamic `import('@capacitor/haptics')`. The import
 * *statement* doesn't block, but the chunk's fetch-and-evaluate lands as a task
 * on the main thread whenever it resolves — and if that's mid-gesture, it
 * competes with the drag's frames. Warming at startup moves it somewhere it
 * can't be felt.
 */
export const warmHaptics = () => {
  const { tier, channel } = route();
  if (tier === HapticTier.NONE || channel !== Channel.CAPACITOR) return;
  // WKWebView has no requestIdleCallback.
  const whenIdle = window.requestIdleCallback || ((fn) => setTimeout(fn, 500));
  try { whenIdle(() => loadPlugin()); } catch { /* warming is best-effort */ }
};

const release = () => {
  if (!plugin || route().tier !== HapticTier.TAPTIC) return;
  preparedAt = null;
  plugin.Haptics.selectionEnd().catch(() => { });
};

/**
 * Release the prepared generator. Worth calling when an interaction sequence is
 * definitively over — iOS keeps the Taptic Engine spun up while a generator is
 * held prepared.
 */
export const releaseHaptics = release;
