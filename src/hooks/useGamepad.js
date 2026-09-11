import { useCallback, useEffect, useRef, useState } from 'react';
import useGraphStore from '../store/graphStore.js';
import { isInsideNode } from '../utils/canvas/geometryUtils.js';
import { getNodeDimensions } from '../utils.js';
import { walkMenu } from '../utils/gamepadMenuNav.js';

/**
 * useGamepad — game controller support for the canvas.
 *
 * CONTROLLER MODE IS DISCRETE. A mouse moves a pointer over a still world; a
 * controller moves the world under a still pointer. The "pointer" here is a
 * crosshair pinned to the centre of the usable viewport, and the left stick
 * pans the canvas beneath it. That single inversion is what makes the rest of
 * the scheme fall out: "the node under the cursor" becomes "the node under the
 * centre of the screen", and picking one up needs no aiming gesture at all.
 *
 * WHY THERE IS NO rAF LOOP IN HERE. Pan and zoom are owned by refs in
 * useCanvasTransform and written straight to the SVG transform attribute; the
 * codebase is emphatic that there is exactly ONE writer per frame (see the
 * header note in useCanvasTransform.js). useCanvasKeyboard already owns a
 * permanent, dependency-free rAF that does the clamping, the label
 * suppression, the drag re-projection and the settle bookkeeping. So this hook
 * does not schedule frames — it exposes `gamepadTickRef`, which that loop calls
 * once per frame, and returns pan/zoom deltas for it to fold in alongside the
 * keyboard's. Everything downstream is inherited for free.
 *
 * WHY THE CROSSHAIR IS WRITTEN INTO mousePositionRef. Several systems already
 * ask "where is the pointer?" — the drag re-projection that keeps a held node
 * under the cursor while the canvas moves, the connection-draw endpoint, the
 * paste target. Rather than teaching each of them about a second cursor, the
 * tick writes the crosshair's client coords into the same ref the mouse writes
 * to. The crosshair IS the cursor, so they all follow it without knowing.
 *
 * MODES. Buttons are contextual, because a controller has no equivalent of
 * "click somewhere else to dismiss". Each mode re-points the sticks and the
 * shoulder buttons at whatever is currently on screen; see MODE below.
 */

// Standard Gamepad API mapping. Xbox, DualSense and Switch Pro all report
// `mapping === 'standard'`, which normalises them to these indices — the
// FACE-BUTTON LABELS differ on Nintendo hardware (its physical A/B and X/Y are
// swapped relative to Xbox) but the positions do not, so one table serves all
// three. A label-remap setting is deliberately deferred.
export const BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5,
  LT: 6, RT: 7,
  SELECT: 8, START: 9,
  L3: 10, R3: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
  GUIDE: 16,
};

export const AXIS = { LX: 0, LY: 1, RX: 2, RY: 3 };

export const MODE = {
  CANVAS: 'canvas',
  NODE: 'node',
  HEADER: 'header',
  LEFT_PANEL: 'leftPanel',
  RIGHT_PANEL: 'rightPanel',
  MENU: 'menu',
  ACTIONS: 'actions',
};

// Radial deadzone. Applied to the stick VECTOR, not per-axis: a per-axis
// deadzone leaves a cross-shaped dead region that makes slow diagonal pans
// snap to the cardinals.
const STICK_DEADZONE = 0.18;

// Response curve past the deadzone. >1 buys fine control near centre while
// keeping full speed at full deflection, which matters because the same stick
// both nudges a node into place and crosses the canvas.
const STICK_RESPONSE_EXP = 1.6;

// Analog triggers rest near 0 and are noisy; this is the press threshold that
// turns them into booleans for edge detection.
const TRIGGER_THRESHOLD = 0.5;

// Pan speed at full deflection, in canvas px per 60fps frame. Sits a little
// above KEYBOARD_PAN_SPEED (14.25) because a stick is expected to feel faster
// than a key, and unlike a key it can be feathered.
const GAMEPAD_PAN_SPEED = 16.0;

// Per-frame zoom factor at full stick deflection, matching the keyboard loop's
// 1.1 base so the two agree on what "a zoom" feels like.
const GAMEPAD_ZOOM_BASE = 1.1;

// The stick must be pushed at least this far before it counts as aiming the
// pie menu. Below it the previous focus is held rather than cleared, so easing
// off the stick doesn't drop the selection right before you press A.
const PIE_AIM_THRESHOLD = 0.5;

// AUTO-AIM. When the stick returns to neutral over a node, the camera drifts
// that node's centre onto the crosshair. The dwell is deliberately just longer
// than HOVER_ENTER_DELAY_MS (180ms) in NodeCanvas, so the hover preview has
// already committed by the time the drift starts — the two read as one gesture
// rather than two competing ones.
const AUTO_AIM_DWELL_MS = 200;
const AUTO_AIM_DURATION_MS = 180;
// Below this the node is close enough to centred that drifting would read as
// drift rather than as aim.
const AUTO_AIM_MIN_DISTANCE_PX = 8;

// Held-direction repeat for list navigation (header tabs, menu rows). Discrete
// actions like web-switching stay edge-only; only the walkers repeat.
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 120;

// How long to wait before trusting drawingConnectionFromRef to report whether
// a draw is still live. It is written from a React effect, so it lags the
// trigger press by a commit; anything shorter than a few frames would read the
// lag as an abandoned gesture.
const CONNECT_SYNC_GRACE_MS = 150;

// Panel scroll speed at full deflection, px per 60fps frame.
const PANEL_SCROLL_SPEED = 14;

// The circular pie layout: 8 fixed slots, slot 0 due North, stepping clockwise.
// Mirrors NUM_FIXED_POSITIONS / START_ANGLE_OFFSET / FIXED_ANGLE_STEP in
// PieMenu.jsx — if those change, this must change with them.
const PIE_SLOTS = 8;
const PIE_START_ANGLE = -Math.PI / 2;
const PIE_ANGLE_STEP = (2 * Math.PI) / PIE_SLOTS;

const ZERO_TICK = { panDx: 0, panDy: 0, zoomMultiplier: 1 };

/**
 * Radial deadzone plus response curve. Returns a vector whose magnitude is 0
 * at the deadzone edge and 1 at full deflection, preserving direction.
 *
 * @param {number} x raw axis value, [-1, 1]
 * @param {number} y raw axis value, [-1, 1]
 * @returns {{x: number, y: number, magnitude: number}}
 */
export const applyStickDeadzone = (x, y) => {
  const raw = Math.hypot(x, y);
  if (!Number.isFinite(raw) || raw <= STICK_DEADZONE) return { x: 0, y: 0, magnitude: 0 };
  // Rescale [deadzone, 1] onto [0, 1] so there is no jump at the boundary.
  const normalized = Math.min(1, (raw - STICK_DEADZONE) / (1 - STICK_DEADZONE));
  const curved = normalized ** STICK_RESPONSE_EXP;
  return { x: (x / raw) * curved, y: (y / raw) * curved, magnitude: curved };
};

/**
 * Maps a stick direction onto a pie-menu button index.
 *
 * Screen coords: +x right, +y down — the same convention as both the SVG and
 * the gamepad's Y axis (up is -1), so the stick vector can be used directly
 * with no flip.
 *
 * Mirrors PieMenu's one special case: a lone button is drawn in slot 1 (NE)
 * rather than slot 0, so with one button there is nothing to choose and index 0
 * is always the answer.
 *
 * @param {number} x deadzoned stick x
 * @param {number} y deadzoned stick y
 * @param {number} buttonCount number of buttons on the current page
 * @returns {number} index into the button array, or -1 if there is nothing to aim at
 */
export const pieButtonIndexForStick = (x, y, buttonCount) => {
  if (!buttonCount || buttonCount < 1) return -1;
  if (buttonCount === 1) return 0;

  const angle = Math.atan2(y, x);
  let bestIndex = 0;
  let bestDelta = Infinity;

  const slots = Math.min(buttonCount, PIE_SLOTS);
  for (let i = 0; i < slots; i++) {
    const slotAngle = PIE_START_ANGLE + i * PIE_ANGLE_STEP;
    // Shortest angular distance, correct across the ±PI wrap.
    let delta = Math.abs(angle - slotAngle) % (2 * Math.PI);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }
  return bestIndex;
};

/**
 * Per-frame button edge detection.
 *
 * Returns the same three arrays every frame (mutated in place) rather than
 * allocating — this runs at 60Hz for the life of the session.
 */
const makeButtonState = () => ({
  pressed: new Array(17).fill(false),
  justPressed: new Array(17).fill(false),
  justReleased: new Array(17).fill(false),
});

const readButtons = (gamepad, state) => {
  const buttons = gamepad.buttons || [];
  for (let i = 0; i < state.pressed.length; i++) {
    const b = buttons[i];
    // Triggers are analog; everything else reports a clean boolean.
    const down = b
      ? (i === BTN.LT || i === BTN.RT ? (b.value ?? 0) > TRIGGER_THRESHOLD : !!b.pressed)
      : false;
    const was = state.pressed[i];
    state.justPressed[i] = down && !was;
    state.justReleased[i] = !down && was;
    state.pressed[i] = down;
  }
};

const anyJust = (state) => state.justPressed.some(Boolean);

export const useGamepad = ({
  // --- Canvas geometry (all refs; read per frame) ---
  containerRef,
  viewportBoundsRef,
  panOffsetRef,
  zoomLevelRef,
  canvasSizeRef,
  // The shared "where is the pointer" ref. Overwritten with the crosshair while
  // controller mode is active — see the header note.
  mousePositionRef,
  nodesRef,
  visibleNodeIdsRef,

  // --- Node drag ---
  startDragForNodeRef,
  draggingNodeInfoRef,
  dragPhaseRef,
  // NodeCanvas's handleMouseUp, via a ref. Called with a synthetic
  // `{clientX, clientY}` so the drop reuses the real release path — group-drop
  // detection, save signalling and all — instead of reimplementing it.
  releasePointerRef,
  // Starts a connection draw from a node, as the left trigger does. Returns
  // true if a draw actually began.
  startConnectionFromNodeRef,
  // Non-null while a connection draw is in flight.
  drawingConnectionFromRef,

  // --- Selection ---
  setSelectedInstanceIds,

  // --- Hover ---
  commitHoverTarget,
  clearHoverImmediate,

  // --- Pie menu ---
  pieMenuButtonsRef,
  pieMenuPageCountRef,
  // The instance id the open pie menu belongs to. Pie actions take it as their
  // first argument, exactly as PieMenu passes `node?.id` on a click.
  pieMenuNodeIdRef,
  setPieMenuPage,
  onPieMenuHoverChange,

  // --- Camera ---
  animateCanvasView,
  // Abandons an in-flight animateCanvasView. The auto-aim drift and a live
  // stick pan both write panOffsetRef, so the drift has to be dropped the
  // moment the stick moves rather than allowed to pull the view back.
  cancelCanvasViewAnimation,

  // --- Gating ---
  isPausedRef,
  activeGraphIdRef,
  minZoom,
  maxZoom,
}) => {
  // Controller mode is on. React state because the crosshair has to mount; it
  // flips at most twice per input-device switch, never per frame.
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState(MODE.CANVAS);
  const [pieFocusedIndex, setPieFocusedIndex] = useState(-1);
  const [headerFocusedGraphId, setHeaderFocusedGraphId] = useState(null);

  // Ref mirrors so the tick can read current values without being rebuilt.
  const activeRef = useRef(false);
  const modeRef = useRef(MODE.CANVAS);
  const pieFocusedIndexRef = useRef(-1);

  const buttonStateRef = useRef(makeButtonState());
  const carryingRef = useRef(false);
  const connectingRef = useRef(false);
  // When the current draw started. drawingConnectionFromRef is populated by a
  // React effect, so it is still null for a commit or two after the trigger
  // goes down — the abandon check below has to outlast that window or it would
  // cancel every draw on the frame after it began.
  const connectStartedAtRef = useRef(0);

  // Auto-aim bookkeeping: when the stick went neutral, and whether this dwell
  // has already fired. Reset on any stick movement.
  const neutralSinceRef = useRef(0);
  const autoAimFiredRef = useRef(false);

  // Held-direction repeat for the list walkers.
  const repeatRef = useRef({ button: -1, nextAt: 0 });

  // DOM focus walker state for MENU / ACTIONS modes.
  const menuWalkerRef = useRef(null);

  // Cached container rect. getBoundingClientRect() forces a synchronous layout,
  // and this runs every frame right after the loop has written a new transform
  // — so asking fresh each tick would reflow 60 times a second, exactly what
  // the wheel handler caches its own rect to avoid. The rect only moves when
  // the panels or the window do, and viewportBounds is a useMemo that produces
  // a new object on precisely those events, so its identity is a free and
  // exact invalidation signal.
  const rectCacheRef = useRef({ boundsIdentity: null, rect: null });

  const paramsRef = useRef(null);
  paramsRef.current = {
    containerRef, viewportBoundsRef, panOffsetRef, zoomLevelRef, canvasSizeRef,
    mousePositionRef, nodesRef, visibleNodeIdsRef,
    startDragForNodeRef, draggingNodeInfoRef, dragPhaseRef, releasePointerRef,
    startConnectionFromNodeRef, drawingConnectionFromRef,
    setSelectedInstanceIds, commitHoverTarget, clearHoverImmediate,
    pieMenuButtonsRef, pieMenuPageCountRef, pieMenuNodeIdRef, setPieMenuPage, onPieMenuHoverChange,
    animateCanvasView, cancelCanvasViewAnimation, isPausedRef, activeGraphIdRef, minZoom, maxZoom,
  };

  const setModeBoth = useCallback((next) => {
    if (modeRef.current === next) return;
    modeRef.current = next;
    setMode(next);
  }, []);

  const setPieFocusBoth = useCallback((next) => {
    if (pieFocusedIndexRef.current === next) return;
    pieFocusedIndexRef.current = next;
    setPieFocusedIndex(next);
  }, []);

  const deactivate = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    setModeBoth(MODE.CANVAS);
    setPieFocusBoth(-1);
    setHeaderFocusedGraphId(null);
    menuWalkerRef.current?.dispose?.();
    menuWalkerRef.current = null;
    // The crosshair's hover belongs to the crosshair; leaving controller mode
    // must not strand a preview the mouse never raised.
    paramsRef.current?.clearHoverImmediate?.();
    // Hand the modality back only if we are the ones holding it — a touch
    // interaction may have claimed it in the meantime.
    const store = useGraphStore.getState();
    if (store.inputMode === 'gamepad') store.setInputMode?.('mouse');
  }, [setModeBoth, setPieFocusBoth]);

  // Any real mouse or keyboard activity hands control back.
  //
  // "Real" is load-bearing for mousemove. Browsers also fire it when the
  // content under a STATIONARY cursor moves — which the menu walker's
  // scrollIntoView does on every step, and which would therefore drop the user
  // out of controller mode the moment they navigated a menu. So the pointer
  // has to have actually travelled. A couple of pixels of slack also absorbs
  // the sub-pixel jitter a resting optical mouse emits.
  useEffect(() => {
    const last = { x: null, y: null };
    const MOVE_SLACK_PX = 3;

    const onMouseMove = (e) => {
      if (last.x !== null && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= MOVE_SLACK_PX) {
        return;
      }
      last.x = e.clientX;
      last.y = e.clientY;
      deactivate();
    };
    // A deliberate press needs no threshold. Our own synthetic activations use
    // element.click(), which raises `click` only — never pointerdown — so this
    // cannot fire on the walker's own doing.
    const onPointerDown = () => deactivate();
    const onKey = () => deactivate();

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [deactivate]);

  // Two cursors on screen at once is one too many — and the mouse pointer is
  // the misleading one, since in controller mode it points at nothing and
  // clicks nowhere. It comes straight back on the mousemove that hands control
  // over, which is also the gesture that makes it relevant again.
  useEffect(() => {
    const cls = 'gamepad-cursor-hidden';
    document.body.classList.toggle(cls, active);
    return () => document.body.classList.remove(cls);
  }, [active]);

  // A pad going away mid-session must not leave the crosshair on screen.
  useEffect(() => {
    const onDisconnect = () => {
      const pads = navigator.getGamepads?.() || [];
      if (!Array.from(pads).some(Boolean)) deactivate();
    };
    window.addEventListener('gamepaddisconnected', onDisconnect);
    return () => window.removeEventListener('gamepaddisconnected', onDisconnect);
  }, [deactivate]);

  /**
   * Crosshair position in CLIENT coords — the centre of the usable viewport,
   * not of the window. Panels, the header and the TypeList all eat into the
   * canvas, and viewportBounds already accounts for all three, so the reticle
   * stays centred in what the user can actually see as panels open and close.
   */
  const getCrosshair = useCallback(() => {
    const b = paramsRef.current.viewportBoundsRef?.current;
    if (!b) return null;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, []);

  /**
   * The canvas container's client rect, recomputed only when the layout that
   * determines it actually changed. See rectCacheRef.
   */
  const getContainerRect = useCallback(() => {
    const p = paramsRef.current;
    const bounds = p.viewportBoundsRef?.current ?? null;
    const cache = rectCacheRef.current;
    if (cache.rect && cache.boundsIdentity === bounds) return cache.rect;
    const rect = p.containerRef?.current?.getBoundingClientRect() ?? null;
    cache.boundsIdentity = bounds;
    cache.rect = rect;
    return rect;
  }, []);

  /**
   * The node under the crosshair, using the same hit test and the same
   * visibility filter the mouse hover pipeline uses.
   */
  const getNodeUnderCrosshair = useCallback(() => {
    const p = paramsRef.current;
    const cross = getCrosshair();
    if (!cross) return null;
    const list = p.nodesRef?.current;
    if (!list || !list.length) return null;
    const rect = getContainerRect();
    if (!rect) return null;
    const visible = p.visibleNodeIdsRef?.current;
    const pan = p.panOffsetRef?.current;
    const zoom = p.zoomLevelRef?.current;
    const cs = p.canvasSizeRef?.current;
    return list.find(n => (
      (!visible || visible.has(n.id))
      && !n.isGroupAnchor
      && isInsideNode(n, cross.x, cross.y, rect, pan, zoom, cs)
    )) || null;
  }, [getCrosshair, getContainerRect]);

  const tick = useCallback((deltaTime, frameRatio) => {
    const p = paramsRef.current;
    const pads = navigator.getGamepads?.();
    if (!pads) return ZERO_TICK;

    let gamepad = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected !== false) { gamepad = pads[i]; break; }
    }
    if (!gamepad) {
      if (activeRef.current) deactivate();
      return ZERO_TICK;
    }

    const buttons = buttonStateRef.current;
    readButtons(gamepad, buttons);

    const axes = gamepad.axes || [];
    const left = applyStickDeadzone(axes[AXIS.LX] ?? 0, axes[AXIS.LY] ?? 0);
    const right = applyStickDeadzone(axes[AXIS.RX] ?? 0, axes[AXIS.RY] ?? 0);

    // Engage on real input only. Resting-stick noise is already below the
    // deadzone, so magnitude is a safe test.
    const hasInput = anyJust(buttons) || left.magnitude > 0 || right.magnitude > 0;
    if (!activeRef.current) {
      if (!hasInput) return ZERO_TICK;
      activeRef.current = true;
      setActive(true);
      useGraphStore.getState().setInputMode?.('gamepad');
    }

    if (p.isPausedRef?.current || !p.activeGraphIdRef?.current) return ZERO_TICK;

    const cross = getCrosshair();
    if (!cross) return ZERO_TICK;

    // The crosshair IS the cursor — publish it so the drag re-projection and
    // every other pointer consumer follows it. See the header note.
    if (p.mousePositionRef) p.mousePositionRef.current = { x: cross.x, y: cross.y };

    const now = performance.now();
    const currentMode = modeRef.current;

    // ---- Held-direction repeat ------------------------------------------
    // Returns true when a direction should act this frame: on the press edge,
    // then again after a delay, then at a steady interval.
    const repeats = (buttonIndex) => {
      if (buttons.justPressed[buttonIndex]) {
        repeatRef.current = { button: buttonIndex, nextAt: now + REPEAT_DELAY_MS };
        return true;
      }
      if (!buttons.pressed[buttonIndex]) {
        if (repeatRef.current.button === buttonIndex) repeatRef.current.button = -1;
        return false;
      }
      if (repeatRef.current.button !== buttonIndex) return false;
      if (now < repeatRef.current.nextAt) return false;
      repeatRef.current.nextAt = now + REPEAT_INTERVAL_MS;
      return true;
    };

    const store = useGraphStore.getState();

    // ---- MENU / ACTIONS: a DOM focus walker over hand-written markup -----
    if (currentMode === MODE.MENU || currentMode === MODE.ACTIONS) {
      const walker = menuWalkerRef.current;
      if (!walker || !walker.isAlive()) {
        menuWalkerRef.current?.dispose?.();
        menuWalkerRef.current = null;
        setModeBoth(MODE.CANVAS);
        return ZERO_TICK;
      }
      walker.sync();
      if (repeats(BTN.DPAD_DOWN)) walker.move(1);
      else if (repeats(BTN.DPAD_UP)) walker.move(-1);
      else if (buttons.justPressed[BTN.DPAD_RIGHT]) walker.enter();
      else if (buttons.justPressed[BTN.DPAD_LEFT]) walker.back();
      else if (buttons.justPressed[BTN.A]) walker.activate();
      else if (buttons.justPressed[BTN.B]
        || buttons.justPressed[BTN.START]
        || buttons.justPressed[BTN.SELECT]) {
        walker.dispose();
        menuWalkerRef.current = null;
        setModeBoth(MODE.CANVAS);
      }
      return ZERO_TICK;
    }

    // ---- HEADER: outline walks the open-web tabs, A commits --------------
    if (currentMode === MODE.HEADER) {
      const openIds = store.openGraphIds || [];
      const focused = headerFocusedGraphId ?? store.activeGraphId;
      const idx = Math.max(0, openIds.indexOf(focused));

      if (repeats(BTN.DPAD_LEFT)) {
        if (idx > 0) setHeaderFocusedGraphId(openIds[idx - 1]);
      } else if (repeats(BTN.DPAD_RIGHT)) {
        if (idx < openIds.length - 1) setHeaderFocusedGraphId(openIds[idx + 1]);
      } else if (buttons.justPressed[BTN.DPAD_UP]) {
        // Already here; swallow so it doesn't fall through to "exit".
      } else if (buttons.justPressed[BTN.A]) {
        const target = openIds[idx];
        if (target) store.setActiveGraph?.(target);
        setHeaderFocusedGraphId(null);
        setModeBoth(MODE.CANVAS);
      } else if (anyJust(buttons)) {
        // "Any other button leaves that mode" — the press is consumed by the
        // exit rather than also firing its canvas action, so leaving is never
        // a surprise.
        setHeaderFocusedGraphId(null);
        setModeBoth(MODE.CANVAS);
      }
      return ZERO_TICK;
    }

    // ---- PANEL MODES: tabs on the shoulders, scroll on the stick ---------
    if (currentMode === MODE.LEFT_PANEL || currentMode === MODE.RIGHT_PANEL) {
      const isLeft = currentMode === MODE.LEFT_PANEL;
      const exitButton = isLeft ? BTN.L3 : BTN.R3;

      if (buttons.justPressed[exitButton] || buttons.justPressed[BTN.B]) {
        setModeBoth(MODE.CANVAS);
        return ZERO_TICK;
      }

      // Tab stepping. Only the right panel has a tab strip to step through;
      // index 0 is always the home/info tab, so "info tab stays leftmost"
      // falls out of the existing indexing with nothing extra to enforce.
      if (!isLeft) {
        const tabs = store.rightPanelTabs || [];
        const activeIdx = Math.max(0, tabs.findIndex(t => t.isActive));
        const back = buttons.justPressed[BTN.LB] || buttons.justPressed[BTN.LT];
        const fwd = buttons.justPressed[BTN.RB] || buttons.justPressed[BTN.RT];
        if (back && activeIdx > 0) store.activateRightPanelTab?.(activeIdx - 1);
        else if (fwd && activeIdx < tabs.length - 1) store.activateRightPanelTab?.(activeIdx + 1);
      }

      // Scroll the panel body with the stick that owns this mode.
      const stick = isLeft ? left : right;
      if (stick.magnitude > 0) {
        const el = document.querySelector(`.panel-container.${isLeft ? 'left' : 'right'} .panel-content`);
        if (el) el.scrollTop += stick.y * PANEL_SCROLL_SPEED * frameRatio;
      }
      return ZERO_TICK;
    }

    // ---- CANVAS and NODE modes ------------------------------------------
    const inNodeMode = currentMode === MODE.NODE;

    // While a trigger gesture is in flight — carrying a node, or drawing a
    // connection out of one — the only thing the other buttons could do is yank
    // the ground out from under it: selecting something else, opening a panel
    // over the drop point, switching webs mid-carry. The trigger owns the pad
    // until it is released. The sticks stay live, because moving the canvas is
    // how you aim both gestures.
    const carrying = carryingRef.current || connectingRef.current;

    // Mode entries that are available from both canvas and node mode.
    if (!carrying && buttons.justPressed[BTN.START]) {
      const walker = walkMenu('menu');
      if (walker) { menuWalkerRef.current = walker; setModeBoth(MODE.MENU); return ZERO_TICK; }
    }
    if (!carrying && buttons.justPressed[BTN.SELECT]) {
      const walker = walkMenu('actions');
      if (walker) { menuWalkerRef.current = walker; setModeBoth(MODE.ACTIONS); return ZERO_TICK; }
    }
    if (!carrying && buttons.justPressed[BTN.L3]) { setModeBoth(MODE.LEFT_PANEL); return ZERO_TICK; }
    if (!carrying && buttons.justPressed[BTN.R3]) { setModeBoth(MODE.RIGHT_PANEL); return ZERO_TICK; }
    if (!carrying && buttons.justPressed[BTN.DPAD_UP]) {
      setHeaderFocusedGraphId(store.activeGraphId ?? null);
      setModeBoth(MODE.HEADER);
      return ZERO_TICK;
    }
    if (!carrying && buttons.justPressed[BTN.DPAD_DOWN]) {
      const order = ['connection', 'node', 'component', 'closed'];
      const cur = store.typeListMode || 'closed';
      const next = order[(order.indexOf(cur) + 1) % order.length];
      store.setTypeListMode?.(next);
    }

    const nodeUnderCrosshair = getNodeUnderCrosshair();

    // ---- Right trigger: pick up / put down -------------------------------
    // Zero delay, by design. The long-press timer exists to tell a click from a
    // drag with one button; a trigger is not that button, so there is nothing
    // to disambiguate. This path never touches nodeLiftDelay — that setting
    // still governs the mouse and only the mouse.
    if (!inNodeMode) {
      if (buttons.justPressed[BTN.RT] && nodeUnderCrosshair && !carryingRef.current) {
        p.startDragForNodeRef?.current?.(nodeUnderCrosshair, cross.x, cross.y);
        carryingRef.current = true;
      } else if (buttons.justReleased[BTN.RT] && carryingRef.current) {
        carryingRef.current = false;
        // Reuse the real release path so group-drop detection and the save
        // signalling behave exactly as they do for a mouse drop.
        p.releasePointerRef?.current?.({ clientX: cross.x, clientY: cross.y });
      }

      // ---- Left trigger: draw a connection ------------------------------
      // Press over the source, pan until the target sits under the crosshair,
      // release. The line's free end is re-projected onto the crosshair every
      // frame the canvas moves — the host loop already does that for any draw
      // in flight, and the crosshair is what it reads as the pointer.
      if (buttons.justPressed[BTN.LT] && nodeUnderCrosshair && !connectingRef.current && !carryingRef.current) {
        connectingRef.current = !!p.startConnectionFromNodeRef?.current?.(
          nodeUnderCrosshair.id, cross.x, cross.y
        );
        connectStartedAtRef.current = now;
      } else if (buttons.justReleased[BTN.LT] && connectingRef.current) {
        connectingRef.current = false;
        // Same release path as the drop: it is the one that decides whether the
        // gesture landed on a node, makes the edge, and discards the draw if it
        // did not.
        p.releasePointerRef?.current?.({ clientX: cross.x, clientY: cross.y });
      }

      // A draw can also end from outside this hook (Escape, an abandon path).
      // Re-sync so the pad doesn't stay locked to a gesture that is over —
      // but only once the ref has had time to catch up. See connectStartedAtRef.
      if (connectingRef.current
        && now - connectStartedAtRef.current > CONNECT_SYNC_GRACE_MS
        && !p.drawingConnectionFromRef?.current) {
        connectingRef.current = false;
      }
    }

    // ---- Face buttons ----------------------------------------------------
    if (!carrying && buttons.justPressed[BTN.A]) {
      if (inNodeMode) {
        const list = p.pieMenuButtonsRef?.current || [];
        const focused = list[pieFocusedIndexRef.current];
        if (focused && !focused.hidden) {
          focused.action?.(p.pieMenuNodeIdRef?.current ?? null, { x: cross.x, y: cross.y });
        }
      } else if (nodeUnderCrosshair) {
        p.setSelectedInstanceIds?.(new Set([nodeUnderCrosshair.id]));
        // Land on slot 0 rather than on nothing. A menu where A does nothing
        // until you have aimed reads as broken, and always having a focused
        // option is what makes a double-tap of A mean "do the first thing".
        setPieFocusBoth(0);
        setModeBoth(MODE.NODE);
      }
    }

    if (!carrying && buttons.justPressed[BTN.B]) {
      p.setSelectedInstanceIds?.(new Set());
      p.onPieMenuHoverChange?.(null);
      setPieFocusBoth(-1);
      setModeBoth(MODE.CANVAS);
    }

    if (!carrying && buttons.justPressed[BTN.X] && nodeUnderCrosshair) {
      store.openRightPanelNodeTab?.(nodeUnderCrosshair.prototypeId, nodeUnderCrosshair.name);
      store.setRightPanelExpanded?.(true);
    }

    if (!carrying && buttons.justPressed[BTN.Y] && nodeUnderCrosshair) {
      // The up-arrow-with-a-dot: run the pie menu's own Expand action so the
      // definition-graph creation, repair and hurtle animation all stay in one
      // place rather than being reimplemented here.
      const list = p.pieMenuButtonsRef?.current || [];
      const expand = list.find(b => b.id === 'expand-tab');
      if (expand) expand.action?.(nodeUnderCrosshair.id, { x: cross.x, y: cross.y });
    }

    // ---- Shoulders: panels in canvas mode, pie pages in node mode --------
    if (carrying) {
      // Shoulders are inert mid-carry; see the note above.
    } else if (inNodeMode) {
      const pageCount = p.pieMenuPageCountRef?.current ?? 1;
      if (pageCount > 1) {
        const back = buttons.justPressed[BTN.LB] || buttons.justPressed[BTN.LT];
        const fwd = buttons.justPressed[BTN.RB] || buttons.justPressed[BTN.RT];
        if (back || fwd) {
          p.setPieMenuPage?.(prev => (prev + (back ? -1 : 1) + pageCount) % pageCount);
          // The new page is a different array, possibly a shorter one, so the
          // old index could dangle past its end. Start over at slot 0.
          setPieFocusBoth(0);
        }
      }
    } else {
      if (buttons.justPressed[BTN.LB]) store.toggleLeftPanel?.();
      if (buttons.justPressed[BTN.RB]) store.toggleRightPanel?.();
      // D-pad left/right switch open webs, matching Tab+Q/E.
      const openIds = store.openGraphIds || [];
      const curIdx = openIds.indexOf(store.activeGraphId);
      if (buttons.justPressed[BTN.DPAD_LEFT] && curIdx > 0) {
        store.setActiveGraphTab?.(openIds[curIdx - 1]);
      } else if (buttons.justPressed[BTN.DPAD_RIGHT] && curIdx >= 0 && curIdx < openIds.length - 1) {
        store.setActiveGraphTab?.(openIds[curIdx + 1]);
      }
    }

    // ---- Left stick: pie aiming in node mode, pan otherwise --------------
    let panDx = 0;
    let panDy = 0;

    if (inNodeMode) {
      // Deliberate lockout: with a node selected the left stick belongs to the
      // pie menu, and B is how you get panning back. Holding the previous
      // focus below the aim threshold means easing off the stick before
      // pressing A doesn't drop the selection.
      if (left.magnitude >= PIE_AIM_THRESHOLD) {
        const list = p.pieMenuButtonsRef?.current || [];
        const idx = pieButtonIndexForStick(left.x, left.y, list.length);
        // Only the index is set here. The label chip is raised by an effect in
        // NodeCanvas that watches this index AND the button array, because the
        // array is rebuilt a commit later than the selection that opened the
        // menu — reading it here would chip the previous node's buttons.
        if (idx >= 0) setPieFocusBoth(idx);
      }
    } else if (left.magnitude > 0) {
      // Pan moves the WORLD, so the canvas travels opposite the stick.
      panDx = -left.x * GAMEPAD_PAN_SPEED * frameRatio;
      panDy = -left.y * GAMEPAD_PAN_SPEED * frameRatio;
    }

    // ---- Right stick Y: zoom, anchored at the crosshair ------------------
    // The host loop zooms about the viewport centre, which IS the crosshair, so
    // returning a plain multiplier keeps the reticle pinned with no extra math.
    let zoomMultiplier = 1;
    const zoomInput = -right.y; // stick up (negative axis) means zoom in
    if (Math.abs(zoomInput) > 0) {
      zoomMultiplier = (GAMEPAD_ZOOM_BASE ** zoomInput) ** frameRatio;
    }

    // ---- Hover + auto-aim ------------------------------------------------
    if (!inNodeMode) {
      // Both branches go through commitHoverTarget rather than one of them
      // calling clearHoverImmediate: this runs every frame, and only
      // commitHoverTarget carries the "already showing this" guard that keeps a
      // steady crosshair from re-setting the same state 60 times a second.
      p.commitHoverTarget?.(nodeUnderCrosshair
        ? { kind: 'node', id: nodeUnderCrosshair.id, node: nodeUnderCrosshair }
        : { kind: 'none' });

      const moving = left.magnitude > 0 || Math.abs(zoomInput) > 0
        || carryingRef.current || connectingRef.current;
      if (moving) {
        // Hand the view straight back to the stick. Without this the drift
        // keeps interpolating toward a target captured before the nudge and
        // visibly pulls against it for the rest of its duration.
        if (autoAimFiredRef.current) p.cancelCanvasViewAnimation?.();
        neutralSinceRef.current = 0;
        autoAimFiredRef.current = false;
      } else {
        if (neutralSinceRef.current === 0) neutralSinceRef.current = now;
        const dwelled = now - neutralSinceRef.current >= AUTO_AIM_DWELL_MS;
        if (dwelled && !autoAimFiredRef.current && nodeUnderCrosshair) {
          autoAimFiredRef.current = true;
          const zoom = p.zoomLevelRef.current;
          const cs = p.canvasSizeRef.current;
          const rect = getContainerRect();
          if (rect && cs) {
            // Node records carry position, not size — dimensions are derived,
            // because they depend on the text that has to fit inside.
            const dims = getNodeDimensions(nodeUnderCrosshair, false, null);
            // Where the node's centre would have to sit, in pan space, for it
            // to land under the crosshair.
            const centerCanvasX = nodeUnderCrosshair.x + dims.currentWidth / 2;
            const centerCanvasY = nodeUnderCrosshair.y + dims.currentHeight / 2;
            const targetPanX = (cross.x - rect.left) - (centerCanvasX - cs.offsetX) * zoom;
            const targetPanY = (cross.y - rect.top) - (centerCanvasY - cs.offsetY) * zoom;
            const cur = p.panOffsetRef.current;
            if (Math.hypot(targetPanX - cur.x, targetPanY - cur.y) > AUTO_AIM_MIN_DISTANCE_PX) {
              p.animateCanvasView?.({ x: targetPanX, y: targetPanY }, zoom, AUTO_AIM_DURATION_MS);
            }
          }
        }
      }
    }

    return { panDx, panDy, zoomMultiplier };
  }, [deactivate, getCrosshair, getContainerRect, getNodeUnderCrosshair, setModeBoth, setPieFocusBoth, headerFocusedGraphId]);

  // The host rAF loop calls through this ref, so it never has to re-subscribe
  // when `tick` is rebuilt.
  const gamepadTickRef = useRef(tick);
  gamepadTickRef.current = tick;

  return {
    gamepadTickRef,
    gamepadActive: active,
    gamepadMode: mode,
    pieFocusedIndex,
    headerFocusedGraphId,
  };
};

export default useGamepad;
