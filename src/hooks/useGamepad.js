import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import useGraphStore from '../store/graphStore.js';
import { isInsideNode } from '../utils/canvas/geometryUtils.js';
import { getNodeDimensions } from '../utils.js';
import { walkMenu, detectOpenSelector, isColorPickerOpen } from '../utils/gamepadMenuNav.js';
import { createPanelNavigator } from '../utils/gamepadPanelNav.js';
import { lineModeLayout } from '../utils/pieMenuLayout.js';
import { nearestPointOnSegment, panToPlacePointAt, createDriftController } from '../utils/gamepadAim.js';

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
  // A connection is selected and its menu is open. Separate from NODE because
  // that menu is a row laid along the edge, not a ring, so the stick aims it by
  // position instead of by angle — see stepLineFocus.
  EDGE: 'edge',
  // A bottom control panel is up — raised either by selecting a group or by
  // box-selecting several nodes. Like EDGE it is a ROW rather than a ring, so
  // the stick steps it.
  BOTTOM: 'bottom',
  // There is deliberately no panel or header mode. The d-pad navigates the
  // chrome while the sticks fly the canvas, both at once — see navigate() and
  // the header note in gamepadPanelNav.js. A mode there would have meant the
  // pad going quiet on the canvas every time the user glanced at a list.
  MENU: 'menu',
  ACTIONS: 'actions',
  // A unified selector or node-selection grid is on screen. Entered and left
  // automatically: these open as the RESULT of some other action (Swap, node
  // creation, typing), so a controller that waited to be told would strand the
  // user in front of a dialog it could not touch.
  SELECTOR: 'selector',
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

// Held-direction repeat for list navigation (header tabs, menu rows, selector
// grids). Discrete actions like web-switching stay edge-only; only the walkers
// and the stepped menus repeat.
//
// Tuned for stepping a menu of five, not for scrolling a long list: the first
// step is instant, and the hold-to-repeat delay only has to be long enough that
// a deliberate single flick doesn't double-fire. Note that a flick back to
// neutral cancels the delay outright (see stickStep), so this governs HOLDING
// a direction, not tapping one.
const REPEAT_DELAY_MS = 260;
const REPEAT_INTERVAL_MS = 90;

// How long to wait before trusting drawingConnectionFromRef to report whether
// a draw is still live. It is written from a React effect, so it lags the
// trigger press by a commit; anything shorter than a few frames would read the
// lag as an abandoned gesture.
const CONNECT_SYNC_GRACE_MS = 150;

// Same idea for the menu modes: selection reaches the store (edges) or the
// pie-menu target (nodes) a commit or two after the press, so re-deriving the
// mode from it has to wait that out.
const MODE_SYNC_GRACE_MS = 200;

/**
 * Hold-to-repeat for directional input, shared by every stepped surface.
 *
 * Extracted and exported because the inline version had a bug worth pinning
 * down: releasing a stick left the last direction latched, so a SECOND flick
 * inside the delay window was swallowed entirely and the menu felt like it had
 * a long cooldown after every step. `releasePrefix` is the fix — a return to
 * neutral ends the gesture outright, so the next flick is instant.
 *
 * @param {{delayMs: number, intervalMs: number}} opts
 */
export const createRepeater = ({ delayMs, intervalMs }) => {
  let key = null;
  let nextAt = 0;
  return {
    /** True on the frame this direction should act. */
    held(k, isDown, now) {
      if (!isDown) {
        if (key === k) key = null;
        return false;
      }
      if (key !== k) {
        key = k;
        nextAt = now + delayMs;
        return true;
      }
      if (now < nextAt) return false;
      nextAt = now + intervalMs;
      return true;
    },
    /** End any gesture whose key starts with `prefix` (a stick going neutral). */
    releasePrefix(prefix) {
      if (typeof key === 'string' && key.startsWith(prefix)) key = null;
    },
  };
};

// Analog slider drive: portion of a slider's full range covered per 60fps frame
// at full stick deflection. ~1/75 crosses the whole range in a little over a
// second, which is quick enough for a 0-360 hue sweep without making precise
// values unreachable — the carry in nudgeSlider keeps small deflections usable
// for those.
const SLIDER_RATE_PER_FRAME = 1 / 75;

// One d-pad press moves a slider this portion of its range: a coarse notch for
// getting close, where the stick is for sweeping and holding is for fine work.
const SLIDER_STEP_FRACTION = 0.02;

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
 * Is the drag system currently flying the camera itself?
 *
 * This matters far more to a controller than to a mouse, and the reason is
 * worth spelling out. Both drag-zoom animations (the zoom-out on lift and the
 * restore on drop, 250ms each) own pan ABSOLUTELY: every frame they recompute
 * pan from a snapshot taken when the animation began and write the result. A
 * second writer adding a delta in between is not merged with them — it is
 * overwritten on the very next frame. Two writers don't average, they
 * alternate, and that alternation is the stutter.
 *
 * With a mouse this never comes up: you release the button and your hand is
 * still, so nothing else is writing pan. With a pad you are almost certainly
 * still leaning on the stick at the moment you release the trigger, because
 * leaning on the stick is how you flew the node into place. So the pad hits
 * this on essentially every drop.
 *
 * The keyboard loop already yields ZOOM to these animations for exactly this
 * reason (see the isAnimatingZoomRef guard around its zoom block). Pan was
 * never given the same treatment because no one holds WASD through a drop.
 *
 * `finalizing` covers the sliver between the drag ending and its restore
 * animation starting, so there is no frame where neither guard is up.
 *
 * @param {boolean} isAnimatingZoom the drag system's shared camera-animation flag
 * @param {string|null|undefined} dragPhase 'idle' | 'dragging' | 'finalizing' | 'restoring'
 * @returns {boolean} true when the pad must keep its hands off pan and zoom
 */
export const cameraHeldElsewhere = (isAnimatingZoom, dragPhase) => (
  isAnimatingZoom === true || dragPhase === 'finalizing' || dragPhase === 'restoring'
);

/**
 * Run a gesture transition the way a mouse button would run it: committed to
 * the DOM before the next paint.
 *
 * THIS IS THE DROP FLICKER. A drag hands the node between two renderers — the
 * drag writes an inline transform every frame, and the release clears that
 * transform and flushes the final position into the store for React to render.
 * Those two steps have to land in the same frame or the node paints for a
 * moment at neither position: transform gone, new position not committed yet,
 * so it snaps back to where it was picked up and then jumps to where it was
 * dropped. It always LANDS correctly; it just shows the seam on the way.
 *
 * A mouse never shows it, and not by luck. `mouseup` is a discrete event, so
 * React 18 flushes anything it schedules synchronously before the browser
 * paints. The pad's release is dispatched from inside the rAF loop, which
 * React cannot know is discrete input — the update gets ordinary priority, the
 * scheduler is free to yield, and on a big graph the re-render is exactly the
 * kind of work it yields on. Hence one to five frames, and hence "occasional":
 * it depends on how much React had to do that frame.
 *
 * flushSync says explicitly what the event system infers for a mouse. It is
 * used ONLY for the handful of gesture edges that cross this seam — a lift, a
 * drop, the start and end of a connection — never per frame. Selection and
 * menu changes deliberately do not use it: a frame of latency there is
 * invisible, and a synchronous render on every button would be real cost for
 * no gain.
 */
const asDiscreteInput = (fn) => {
  let result;
  flushSync(() => { result = fn(); });
  return result;
};

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

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The stick as a d-pad: the dominant axis past a threshold, or null.
 *
 * Used where a surface is a LIST or a GRID rather than something to aim at —
 * menus, selectors, and the connection menu's rows. Absolute aiming is right
 * for a ring, where every option has its own direction; it is wrong for a row
 * of five, where it would give each option a fifth of the stick's throw and
 * make the whole menu twitchy. Stepping is what a row wants.
 */
export const stickDirection = (x, y, threshold = 0.5) => {
  if (Math.hypot(x, y) < threshold) return null;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
};

/**
 * Steps focus through a LINE-MODE menu as a grid of rows.
 *
 * The connection menu is a row of bubbles laid along the edge, wrapping into
 * further rows stacked toward its upward side — so it behaves like two (or
 * more) linear rows, and is navigated like them: left/right walks the row,
 * up/down changes row keeping roughly the same position along it.
 *
 * Row structure comes from lineModeLayout, the same function PieMenu lays the
 * bubbles out with, so the navigation can never disagree with the drawing.
 *
 * Movement CLAMPS rather than wraps: on a short menu, wrapping off the end of a
 * row lands somewhere visually unrelated, which reads as a glitch rather than
 * as a cycle.
 *
 * @param {number} current index of the focused button, or -1
 * @param {'left'|'right'|'up'|'down'} dir
 * @param {number} count number of buttons in the menu
 * @returns {number} the new index
 */
export const stepLineFocus = (current, dir, count) => {
  if (!count || count < 1) return -1;
  if (count === 1) return 0;
  const slots = lineModeLayout({ count, angle: 0, step: 1, perpOffset: 0, rowGap: 1 });
  if (!slots.length) return -1;

  const from = slots[current] ? current : 0;
  const { row, col } = slots[from];

  if (dir === 'left' || dir === 'right') {
    const delta = dir === 'right' ? 1 : -1;
    const found = slots.findIndex(sl => sl.row === row && sl.col === col + delta);
    return found >= 0 ? found : from;
  }

  // Rows stack toward the edge's upward side, so "up" is row + 1.
  const targetRow = row + (dir === 'up' ? 1 : -1);
  const inTarget = slots.map((sl, i) => ({ sl, i })).filter(({ sl }) => sl.row === targetRow);
  if (!inTarget.length) return from;
  // Keep the position along the row: rows can differ in length, so match on the
  // nearest column rather than assuming the same index exists.
  return inTarget.reduce((best, cand) => (
    Math.abs(cand.sl.col - col) < Math.abs(best.sl.col - col) ? cand : best
  ), inTarget[0]).i;
};

/**
 * Where a connection "wants" the crosshair to sit: the point on it nearest the
 * crosshair, so the drift is a small correction ONTO the line rather than a
 * yank to its midpoint (which on a long connection is routinely off-screen).
 *
 * The nearest point is computed against the straight chord between the two
 * endpoints, because the real geometry has six routing variants — self-loops,
 * clean polylines, Lombardi arcs, Manhattan runs, Bézier fans, plain lines —
 * and the hit test that knows all six returns only a DISTANCE, not a point.
 * Re-deriving the point per style here would fork geometry that is deliberately
 * centralised, and would drift out of sync the first time routing changed.
 *
 * So the chord is used as a guess and then VERIFIED: if moving the crosshair
 * there would no longer land on this same connection, the guess was wrong for
 * this routing style and the drift is simply skipped. One extra hit test buys
 * correctness for every style, including ones added later, without duplicating
 * a line of routing maths.
 *
 * @returns {{x: number, y: number} | null} canvas-space aim point, or null to
 *   decline to drift toward this connection.
 */
const edgeAimPoint = (p, hit, cross, rect, pan, zoom, canvasSize) => {
  const nodes = p.nodesRef?.current;
  if (!nodes || !canvasSize) return null;

  const a = nodes.find(n => n.id === hit.connection?.source?.id);
  const b = nodes.find(n => n.id === hit.connection?.target?.id);
  // A self-loop has no chord to project onto, and its geometry is a lobe off
  // one node — nothing a segment approximates usefully.
  if (!a || !b || a.id === b.id) return null;

  const da = getNodeDimensions(a, false, null);
  const db = getNodeDimensions(b, false, null);
  const near = nearestPointOnSegment(
    (cross.x - rect.left - pan.x) / zoom + canvasSize.offsetX,
    (cross.y - rect.top - pan.y) / zoom + canvasSize.offsetY,
    a.x + da.currentWidth / 2, a.y + da.currentHeight / 2,
    b.x + db.currentWidth / 2, b.y + db.currentHeight / 2,
  );

  // Verify against the real geometry: where would that point sit on screen, and
  // is this same connection still what the crosshair would be over there?
  const candidatePan = panToPlacePointAt(near.x, near.y, cross.x, cross.y, rect, pan, zoom, canvasSize);
  const clientX = (near.x - canvasSize.offsetX) * zoom + candidatePan.x + rect.left;
  const clientY = (near.y - canvasSize.offsetY) * zoom + candidatePan.y + rect.top;
  const check = p.findEdgeAtClientPointRef?.current?.(clientX, clientY, 'mouse');
  if (!check || check.edgeId !== hit.edgeId) return null;

  return { x: near.x, y: near.y };
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
  // The plus sign and the things A and B can do to it: `{ sign, halfHit,
  // create, activate, dismiss }`. See NodeCanvas.
  plusSignControlRef,
  // Groups, as the controller sees them: `{ findAt, select, dismiss,
  // selectedId, startDrag }`. See NodeCanvas.
  groupControlRef,
  // The selection box: `{ begin, update, end }`. See NodeCanvas.
  marqueeControlRef,

  // --- Selection ---
  setSelectedInstanceIds,
  // The live instance selection, read per frame to tell whether the bottom
  // panel still has anything to be about.
  selectedInstanceIdsRef,

  // --- Hover ---
  commitHoverTarget,
  clearHoverImmediate,

  // --- Pie menu ---
  pieMenuButtonsRef,
  pieMenuPageCountRef,
  // The connection menu's live buttons and the slope of the edge they are laid
  // along. Kept separate from the node menu's: only one is ever open, but they
  // are different arrays with different layouts.
  edgePieMenuButtonsRef,
  edgeAnchorAngleRef,
  // Client-space `(x, y, pointerKind) => { edgeId, connection } | null`, the
  // same nearest-wins hit test the mouse click and hover paths use.
  findEdgeAtClientPointRef,
  // The instance id the open pie menu belongs to. Pie actions take it as their
  // first argument, exactly as PieMenu passes `node?.id` on a click.
  pieMenuNodeIdRef,
  setPieMenuPage,
  onPieMenuHoverChange,

  // --- Camera ---
  // The drift tweens pan through this. It deliberately does NOT go through
  // animateCanvasView: that sets the shared isAnimatingZoomRef, and a drift
  // cancelling itself would then clear a flag belonging to whatever took the
  // camera next — which is exactly what glitched a node lift. See gamepadAim.js.
  setPan,
  // True while something else owns the camera: drag-zoom on lift,
  // focus-on-select, carousel framing. The drift stands down for all of it.
  isAnimatingZoomRef,
  // The carousel locks the view entirely.
  abstractionCarouselVisibleRef,
  // Mirrors whether a drift is running, so NodeCanvas can exempt it from
  // connection-label suppression the same way it exempts its own camera moves.
  driftingRef,

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
  // True while the left trigger is drawing a selection box.
  const marqueeRef = useRef(false);

  // Auto-aim bookkeeping: when the stick went neutral, and whether this dwell
  // has already fired. Reset on any stick movement.
  const neutralSinceRef = useRef(0);
  const autoAimFiredRef = useRef(false);
  // Set when a gesture ENDS on a target, and held until the stick moves again.
  //
  // The dwell means "the user came to rest over this thing", and after a drop
  // that reading is simply false: they didn't come to rest over the node, they
  // put it down. Without this the camera pulls the node's CENTRE onto the
  // crosshair a beat after every drop — which, if you gripped the node near an
  // edge, is a lurch of half a node, undoing the placement you just made by
  // hand. The other latches can't carry this: both are cleared on every frame
  // the drift is disallowed, and the whole restore animation is such a frame.
  const suppressAutoAimRef = useRef(false);

  // Held-direction repeat for the list walkers.
  const repeatRef = useRef(null);
  if (!repeatRef.current) {
    repeatRef.current = createRepeater({
      delayMs: REPEAT_DELAY_MS,
      intervalMs: REPEAT_INTERVAL_MS,
    });
  }

  // The d-pad's navigator over the panels. Built once and kept for the life of
  // the session: where the d-pad is standing is a place in the UI, not a mode
  // that gets entered and left, so it outlives any one interaction.
  const panelNavRef = useRef(null);
  if (!panelNavRef.current) panelNavRef.current = createPanelNavigator();
  // Which panel the user last touched, so "go into a panel" has an answer when
  // both are open and the direction doesn't say which.
  const lastPanelSideRef = useRef('left');
  // Header focus mirrored into a ref. The tick reads it on the same frame it
  // writes it, and React state is a frame behind.
  const headerFocusRef = useRef(null);

  // The bottom control panel's walker, kept SEPARATE from the menu walker on
  // purpose: a selector can open on top of a selected group (naming a new
  // node-group does exactly that), and the selector takeover disposes whatever
  // the menu walker was holding. Sharing one ref would tear down the group's
  // panel walker as a side effect of a dialog the group itself opened.
  const bottomWalkerRef = useRef(null);

  // DOM focus walker state for MENU / ACTIONS modes.
  const menuWalkerRef = useRef(null);
  // Which surface the current walker is pointed at. A colour picker opening
  // over a selector has to swap the walker's target without leaving the mode,
  // and comparing kinds is how that swap is detected.
  const walkerKindRef = useRef(null);

  // Cached container rect. getBoundingClientRect() forces a synchronous layout,
  // and this runs every frame right after the loop has written a new transform
  // — so asking fresh each tick would reflow 60 times a second, exactly what
  // the wheel handler caches its own rect to avoid. The rect only moves when
  // the panels or the window do, and viewportBounds is a useMemo that produces
  // a new object on precisely those events, so its identity is a free and
  // exact invalidation signal.
  const rectCacheRef = useRef({ boundsIdentity: null, rect: null });

  // ---------------------------------------------------------------------------
  // DRIFT ARBITRATION
  //
  // One predicate answers "may the camera drift right now", and it is asked in
  // two places: before starting a drift, and again on EVERY frame of one. That
  // second use is what makes the drift yield rather than fight — a node lift, a
  // focus-on-select or a carousel opening mid-drift simply makes the next frame
  // return false and the tween stops where it is. Nothing has to reach in and
  // cancel it, and it never clears a flag that belongs to somebody else.
  //
  // A ref holding a function, rather than a useCallback, because the drift
  // controller is built once and must not be rebuilt when the predicate's
  // dependencies change.
  const driftAllowedRef = useRef(() => false);
  driftAllowedRef.current = () => {
    if (!activeRef.current) return false;
    const p = paramsRef.current;
    // Our own trigger gestures own the camera while they run.
    if (carryingRef.current || connectingRef.current) return false;
    // Anything but a settled drag means the drag system is moving the view:
    // the lift ramp, the drag-zoom out, and the zoom restore on drop.
    if (p.dragPhaseRef?.current && p.dragPhaseRef.current !== 'idle') return false;
    // The shared "someone is animating the camera" flag: drag-zoom,
    // focus-on-select, carousel framing. Read, never written — writing it is
    // what made a drift cancel clobber a lift. Same predicate the stick yields
    // to at the end of the tick, so the drift and the stick stand down for the
    // same reason at the same moment rather than each having their own idea of
    // who owns the camera.
    if (cameraHeldElsewhere(p.isAnimatingZoomRef?.current, p.dragPhaseRef?.current)) return false;
    // The carousel locks the view outright.
    if (p.abstractionCarouselVisibleRef?.current) return false;
    // Only the canvas drifts; a menu mode has the stick doing something else.
    if (modeRef.current !== MODE.CANVAS) return false;
    return true;
  };

  // Built once. `shouldContinue` reads through the ref above, so the permission
  // logic can change freely without the controller being rebuilt mid-drift.
  const driftRef = useRef(null);
  if (!driftRef.current) {
    driftRef.current = createDriftController({
      panRef: { get current() { return paramsRef.current.panOffsetRef.current; } },
      setPan: (pan) => paramsRef.current.setPan?.(pan),
      shouldContinue: () => driftAllowedRef.current(),
    });
  }



  const paramsRef = useRef(null);
  paramsRef.current = {
    containerRef, viewportBoundsRef, panOffsetRef, zoomLevelRef, canvasSizeRef,
    mousePositionRef, nodesRef, visibleNodeIdsRef,
    startDragForNodeRef, draggingNodeInfoRef, dragPhaseRef, releasePointerRef,
    startConnectionFromNodeRef, drawingConnectionFromRef, plusSignControlRef, groupControlRef, marqueeControlRef,
    setSelectedInstanceIds, selectedInstanceIdsRef, commitHoverTarget, clearHoverImmediate,
    pieMenuButtonsRef, pieMenuPageCountRef, pieMenuNodeIdRef, setPieMenuPage, onPieMenuHoverChange,
    edgePieMenuButtonsRef, edgeAnchorAngleRef, findEdgeAtClientPointRef,
    setPan, isAnimatingZoomRef, abstractionCarouselVisibleRef, driftingRef,
    isPausedRef, activeGraphIdRef, minZoom, maxZoom,
  };

  // When the current mode was entered. The menu modes are re-derived from the
  // selection each frame (see the re-sync in the tick), but selection lands a
  // React commit or two after the button that caused it — so a re-sync with no
  // grace window would bounce straight back out on the very next frame.
  const modeSinceRef = useRef(0);

  const setModeBoth = useCallback((next) => {
    if (modeRef.current === next) return;
    modeRef.current = next;
    modeSinceRef.current = performance.now();
    setMode(next);
  }, []);

  const setPieFocusBoth = useCallback((next) => {
    if (pieFocusedIndexRef.current === next) return;
    pieFocusedIndexRef.current = next;
    setPieFocusedIndex(next);
  }, []);

  /**
   * Header focus, written to the ref and to state together.
   *
   * The header's outline is declarative (HeaderGraphTab takes isGamepadFocused)
   * rather than a class the navigator writes, which is why the header is
   * handled here instead of through the DOM navigator.
   */
  const setHeaderFocusBoth = useCallback((id) => {
    headerFocusRef.current = id;
    setHeaderFocusedGraphId(id);
  }, []);

  /**
   * One d-pad step, dispatched spatially.
   *
   * The chrome has a real layout — the header runs across the top, the panels
   * down either side — and the d-pad simply obeys it. There is no mode to be
   * in, only a place the focus currently IS, which is why every rule below is
   * phrased as "what is in that direction from here". Nothing is disabled
   * while the focus is somewhere: the sticks keep flying the canvas, the
   * triggers keep picking nodes up.
   */
  const navigate = useCallback((dir) => {
    const store = useGraphStore.getState();
    const nav = panelNavRef.current;
    const leftOpen = !!store.leftPanelExpanded;
    const rightOpen = !!store.rightPanelExpanded;
    const openFor = (s) => (s === 'left' ? leftOpen : rightOpen);

    // --- The header has the focus ---
    if (headerFocusRef.current !== null) {
      const openIds = store.openGraphIds || [];
      const idx = Math.max(0, openIds.indexOf(headerFocusRef.current));
      if (dir === 'left' && idx > 0) setHeaderFocusBoth(openIds[idx - 1]);
      else if (dir === 'right' && idx < openIds.length - 1) setHeaderFocusBoth(openIds[idx + 1]);
      else if (dir === 'down') {
        // Down out of the header goes into whichever panel is open, preferring
        // the one last touched — the header spans both, so the direction alone
        // cannot say which side was meant.
        setHeaderFocusBoth(null);
        const preferred = openFor(lastPanelSideRef.current) ? lastPanelSideRef.current
          : (leftOpen ? 'left' : (rightOpen ? 'right' : null));
        if (preferred) { nav.enter(preferred); lastPanelSideRef.current = preferred; }
      }
      return;
    }

    // --- A panel has the focus ---
    if (nav.hasFocus()) {
      const dx = dir === 'left' ? -1 : (dir === 'right' ? 1 : 0);
      const dy = dir === 'up' ? -1 : (dir === 'down' ? 1 : 0);
      const result = nav.move(dx, dy);
      if (result !== 'edge') return;

      // Off the top of a panel is the header, which sits above both of them.
      if (dy < 0) {
        nav.clear();
        setHeaderFocusBoth(store.activeGraphId ?? null);
        return;
      }
      // Off the side is the other panel, when the direction points at it and
      // it is open. The canvas lies between them, but the canvas is the
      // sticks' business, so the d-pad steps straight across.
      if (dx) {
        const here = nav.side();
        const towardOther = (here === 'left' && dx > 0) || (here === 'right' && dx < 0);
        const other = here === 'left' ? 'right' : 'left';
        if (towardOther && openFor(other)) {
          nav.clear();
          nav.enter(other);
          lastPanelSideRef.current = other;
        }
      }
      return;
    }

    // --- Nothing has the focus: the direction chooses where to start ---
    if (dir === 'up') {
      setHeaderFocusBoth(store.activeGraphId ?? null);
      return;
    }
    if (dir === 'left' || dir === 'right') {
      const side = dir === 'left' ? 'left' : 'right';
      if (openFor(side) && nav.enter(side)) lastPanelSideRef.current = side;
      return;
    }
    // Down is the bottom of the screen, which is where the TypeList lives.
    // It keeps the binding it had when the d-pad was a set of shortcuts, and
    // it keeps it for the same reason the header is up: that is where the
    // thing actually is.
    const order = ['connection', 'node', 'component', 'closed'];
    const cur = store.typeListMode || 'closed';
    store.setTypeListMode?.(order[(order.indexOf(cur) + 1) % order.length]);
  }, [setHeaderFocusBoth]);

  /** Give up whatever the d-pad was standing on. B, and leaving the pad. */
  const clearNavFocus = useCallback(() => {
    const had = panelNavRef.current.hasFocus() || headerFocusRef.current !== null;
    panelNavRef.current.clear();
    if (headerFocusRef.current !== null) setHeaderFocusBoth(null);
    return had;
  }, [setHeaderFocusBoth]);

  const deactivate = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    setModeBoth(MODE.CANVAS);
    setPieFocusBoth(-1);
    setHeaderFocusedGraphId(null);
    menuWalkerRef.current?.dispose?.();
    menuWalkerRef.current = null;
    bottomWalkerRef.current?.dispose?.();
    bottomWalkerRef.current = null;
    // The d-pad's place in the chrome is given up with the pad itself.
    panelNavRef.current?.clear();
    headerFocusRef.current = null;
    driftRef.current?.stop();
    if (paramsRef.current?.driftingRef) paramsRef.current.driftingRef.current = false;
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
  /**
   * What the crosshair is pointing at, resolved ONCE per frame.
   *
   * The hover preview, the A button and the drift all read this same answer —
   * see the note at the top of gamepadAim.js for why they must not each run
   * their own hit test.
   *
   * `aimPoint` is where the target "wants to be": a node's centre, or the point
   * on a connection nearest the crosshair. It is the drift's target and nothing
   * else's, so a target with no sensible aim point simply has none.
   *
   * @returns {null | {kind, id, node?, connection?, aimPoint: {x,y}|null}}
   */
  const resolveCrosshairTarget = useCallback(() => {
    const p = paramsRef.current;
    const cross = getCrosshair();
    if (!cross) return null;
    const rect = getContainerRect();
    if (!rect) return null;

    const list = p.nodesRef?.current;
    const visible = p.visibleNodeIdsRef?.current;
    const pan = p.panOffsetRef?.current;
    const zoom = p.zoomLevelRef?.current;
    const cs = p.canvasSizeRef?.current;

    // Nodes win ties. A connection terminates inside its endpoints' boxes, so
    // near a node the two hit tests overlap constantly — and every mouse path
    // in NodeCanvas resolves that the same way, by checking the node first.
    const node = list?.length
      ? list.find(n => (
        (!visible || visible.has(n.id))
        && !n.isGroupAnchor
        && isInsideNode(n, cross.x, cross.y, rect, pan, zoom, cs)
      ))
      : null;

    if (node) {
      const dims = getNodeDimensions(node, false, null);
      return {
        kind: 'node',
        id: node.id,
        node,
        aimPoint: {
          x: node.x + dims.currentWidth / 2,
          y: node.y + dims.currentHeight / 2,
        },
      };
    }

    // The plus sign outranks a connection: it is a transient affordance the
    // user just placed deliberately, and a connection merely happening to pass
    // beneath it should not win. It cannot outrank a node, because it is only
    // ever placed on empty canvas in the first place.
    const plus = p.plusSignControlRef?.current;
    if (plus?.sign) {
      const cx = (cross.x - rect.left - pan.x) / zoom + cs.offsetX;
      const cy = (cross.y - rect.top - pan.y) / zoom + cs.offsetY;
      if (Math.abs(cx - plus.sign.x) <= plus.halfHit && Math.abs(cy - plus.sign.y) <= plus.halfHit) {
        // Same square the component draws for touch, so it drifts to centre and
        // aims exactly like a node does.
        return { kind: 'plus', id: 'plus-sign', aimPoint: { x: plus.sign.x, y: plus.sign.y } };
      }
    }

    // A group's title pill. Below the plus for the same reason the plus is
    // below a node — the more deliberate, more transient affordance wins — and
    // above connections, whose hit test is the loosest of the four and would
    // otherwise claim a pill that merely has an edge passing behind it.
    const group = p.groupControlRef?.current?.findAt?.(cross.x, cross.y);
    if (group) {
      return {
        kind: 'group',
        id: group.groupId,
        group,
        aimPoint: group.center,
      };
    }

    const hit = p.findEdgeAtClientPointRef?.current?.(cross.x, cross.y, 'mouse');
    if (!hit) return null;

    return {
      kind: 'connection',
      id: hit.edgeId,
      connection: hit.connection,
      aimPoint: edgeAimPoint(p, hit, cross, rect, pan, zoom, cs),
    };
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

    // Canvas interaction needs a graph to act on. The overlay walkers do NOT —
    // the loading escape hatch exists precisely for the state where there is no
    // graph, and a selector can be up during a prompt. So this gates the canvas
    // modes further down rather than the whole tick.
    const canvasReady = !p.isPausedRef?.current && !!p.activeGraphIdRef?.current;

    const cross = getCrosshair();
    if (!cross) return ZERO_TICK;

    // The crosshair IS the cursor — publish it so the drag re-projection and
    // every other pointer consumer follows it. See the header note.
    if (p.mousePositionRef) p.mousePositionRef.current = { x: cross.x, y: cross.y };

    // Let NodeCanvas exempt the drift from connection-label suppression the way
    // it exempts its own camera animations. Published from here rather than
    // from an effect because this function already runs every frame — a second
    // rAF just to mirror a boolean would be exactly the duplication this hook
    // exists to avoid.
    if (p.driftingRef) p.driftingRef.current = driftRef.current?.isActive() === true;

    const now = performance.now();
    const currentMode = modeRef.current;

    // ---- Held-direction repeat ------------------------------------------
    // Returns true when a direction should act this frame: on the press edge,
    // then again after a delay, then at a steady interval.
    const repeats = (buttonIndex) => repeatRef.current.held(buttonIndex, buttons.pressed[buttonIndex], now);
    // The stick acting as a d-pad, with the same press/delay/repeat cadence a
    // held button gets — see stickDirection for why lists and grids step
    // rather than being aimed at.
    const stickStep = (stick, prefix) => {
      const dir = stickDirection(stick.x, stick.y, PIE_AIM_THRESHOLD);
      if (!dir) {
        // Neutral ENDS the gesture, so the very next flick steps immediately
        // rather than waiting out the hold-to-repeat delay.
        repeatRef.current.releasePrefix(`${prefix}:`);
        return null;
      }
      return repeatRef.current.held(`${prefix}:${dir}`, true, now) ? dir : null;
    };

    const store = useGraphStore.getState();

    // ---- SELECTOR: auto-takeover -----------------------------------------
    // A unified selector or node grid opens as the RESULT of another action
    // (Swap, node creation, node typing), so nothing presses a button to get
    // here. Checked before every other mode because while one of these is up it
    // is modal — it covers the canvas and owns the input.
    // A colour picker sits ON TOP of whatever opened it, so it wins. Retargeting
    // the walker at it — rather than nesting a second mode — means B, A and the
    // stick all keep meaning the same things, just aimed one layer in.
    const pickerOpen = isColorPickerOpen();
    const openSelector = pickerOpen ? 'colorPicker' : detectOpenSelector();
    if (openSelector && (currentMode !== MODE.SELECTOR || walkerKindRef.current !== openSelector)) {
      menuWalkerRef.current?.dispose?.();
      menuWalkerRef.current = walkMenu(openSelector);
      walkerKindRef.current = openSelector;
      setModeBoth(MODE.SELECTOR);
      return ZERO_TICK;
    }
    if (currentMode === MODE.SELECTOR) {
      if (!openSelector) {
        // Dismissed, or its choice was made — either way it is gone.
        menuWalkerRef.current?.dispose?.();
        menuWalkerRef.current = null;
        walkerKindRef.current = null;
        setModeBoth(MODE.CANVAS);
        return ZERO_TICK;
      }
      const walker = menuWalkerRef.current;
      walker?.sync();

      // A focused slider takes the stick's horizontal axis as an ANALOG value,
      // not as a step — see nudgeSlider. Vertical still steps between rows, so
      // up/down moves off the slider onto whatever is above or below it,
      // slider or not.
      const onSlider = walker?.isSliderFocused();
      if (onSlider && Math.abs(left.x) > STICK_DEADZONE) {
        walker.nudgeSlider(left.x * SLIDER_RATE_PER_FRAME * frameRatio);
      }
      let dir = stickStep(left, 'sel')
        || (repeats(BTN.DPAD_LEFT) ? 'left' : null)
        || (repeats(BTN.DPAD_RIGHT) ? 'right' : null)
        || (repeats(BTN.DPAD_UP) ? 'up' : null)
        || (repeats(BTN.DPAD_DOWN) ? 'down' : null);
      // On a slider the stick's horizontal axis is already spoken for. The
      // d-pad still steps it in whole notches, which is the precise way to
      // land on an exact value.
      if (onSlider && (dir === 'left' || dir === 'right')) {
        if (buttons.pressed[BTN.DPAD_LEFT] || buttons.pressed[BTN.DPAD_RIGHT]) {
          walker.nudgeSlider(dir === 'left' ? -SLIDER_STEP_FRACTION : SLIDER_STEP_FRACTION);
        }
        dir = null;
      }
      if (dir) {
        if (walker?.isGrid()) {
          if (dir === 'left') walker.moveGrid(-1, 0);
          else if (dir === 'right') walker.moveGrid(1, 0);
          else if (dir === 'up') walker.moveGrid(0, -1);
          else walker.moveGrid(0, 1);
        } else {
          // A short vertical list: both axes just step it, so a flick in any
          // direction does the obvious thing rather than nothing.
          walker?.move(dir === 'up' || dir === 'left' ? -1 : 1);
        }
      } else if (buttons.justPressed[BTN.A]) {
        walker?.activate();
      } else if (buttons.justPressed[BTN.Y]) {
        // Y opens the colour picker. The same button toggles it shut, so this
        // is also how it closes if Y is pressed again.
        walker?.togglePalette();
      } else if (buttons.justPressed[BTN.B]) {
        // B closes the INNERMOST thing first. With a picker open over the
        // selector, B that shut the whole selector would throw away the choice
        // the user was in the middle of making.
        if (isColorPickerOpen() && walker?.hasPalette()) walker.togglePalette();
        else walker?.close();
      }
      return ZERO_TICK;
    }

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

    // Past this point everything needs a canvas to act on.
    if (!canvasReady) return ZERO_TICK;

    // ---- CANVAS, NODE and EDGE modes ------------------------------------
    // Selection can end without the pad doing it: a menu action deletes its
    // own subject (Delete), navigates away (Expand, Open Definition), or the
    // menu auto-closes. Any of those would strand the stick aiming a menu that
    // is no longer there, so the mode is re-derived from the selection rather
    // than trusted to have been cleaned up.
    const modeSettled = now - modeSinceRef.current > MODE_SYNC_GRACE_MS;
    if (modeSettled) {
      const edgeGone = !store.selectedEdgeId && !(store.selectedEdgeIds?.size > 0);
      const nodeGone = !p.pieMenuNodeIdRef?.current;
      // The bottom panel has two possible subjects, and it is gone only when
      // BOTH are: a selected group, or a box selection of instances.
      const groupGone = !p.groupControlRef?.current?.selectedId?.();
      const selectionGone = !(p.selectedInstanceIdsRef?.current?.size > 0);
      if (currentMode === MODE.BOTTOM && groupGone && selectionGone) {
        bottomWalkerRef.current?.dispose?.();
        bottomWalkerRef.current = null;
        setModeBoth(MODE.CANVAS);
        setPieFocusBoth(-1);
      }
      if ((currentMode === MODE.EDGE && edgeGone) || (currentMode === MODE.NODE && nodeGone)) {
        setModeBoth(MODE.CANVAS);
        setPieFocusBoth(-1);
        p.onPieMenuHoverChange?.(null);
      }
    }

    const inNodeMode = modeRef.current === MODE.NODE;
    const inEdgeMode = modeRef.current === MODE.EDGE;
    const inBottomMode = modeRef.current === MODE.BOTTOM;
    // Both "something is selected and its menu owns the stick" modes. Used
    // wherever the distinction between a ring and a row doesn't matter.
    const inMenuMode = inNodeMode || inEdgeMode || inBottomMode;

    // While a trigger gesture is in flight — carrying a node, or drawing a
    // connection out of one — the only thing the other buttons could do is yank
    // the ground out from under it: selecting something else, opening a panel
    // over the drop point, switching webs mid-carry. The trigger owns the pad
    // until it is released. The sticks stay live, because moving the canvas is
    // how you aim both gestures.
    const carrying = carryingRef.current || connectingRef.current || marqueeRef.current;

    // Mode entries that are available from both canvas and node mode.
    if (!carrying && buttons.justPressed[BTN.START]) {
      const walker = walkMenu('menu');
      if (walker) { menuWalkerRef.current = walker; setModeBoth(MODE.MENU); return ZERO_TICK; }
    }
    if (!carrying && buttons.justPressed[BTN.SELECT]) {
      const walker = walkMenu('actions');
      if (walker) { menuWalkerRef.current = walker; setModeBoth(MODE.ACTIONS); return ZERO_TICK; }
    }
    // The stick clicks open and close their own panel. That is ALL they do —
    // no mode, nothing disabled, nothing to leave. Left stick, left panel;
    // right stick, right panel.
    // Deliberately not `return`ing: a press here must not cost the frame's
    // pan. Everything on this pad is meant to be usable at the same time as
    // everything else.
    if (!carrying && buttons.justPressed[BTN.L3]) {
      store.toggleLeftPanel?.();
      lastPanelSideRef.current = 'left';
      // Closing the panel focus was sitting in would strand the ring on a
      // detached element; `leftPanelExpanded` is still the PRE-toggle value.
      if (panelNavRef.current.side() === 'left' && store.leftPanelExpanded) panelNavRef.current.clear();
    }
    if (!carrying && buttons.justPressed[BTN.R3]) {
      store.toggleRightPanel?.();
      lastPanelSideRef.current = 'right';
      if (panelNavRef.current.side() === 'right' && store.rightPanelExpanded) panelNavRef.current.clear();
    }

    // ---- D-PAD: the navigator over everything that isn't the canvas -------
    // Runs alongside the sticks rather than instead of them: you can be
    // walking a list in the right panel and flying the canvas at the same
    // time, because those are different hands and different surfaces. See
    // navigate() for the spatial rules.
    if (!carrying) {
      panelNavRef.current.sync();
      const dir = (repeats(BTN.DPAD_UP) ? 'up' : null)
        || (repeats(BTN.DPAD_DOWN) ? 'down' : null)
        || (repeats(BTN.DPAD_LEFT) ? 'left' : null)
        || (repeats(BTN.DPAD_RIGHT) ? 'right' : null);
      if (dir) navigate(dir);
    }

    // ONE resolution per frame, shared by the hover preview, the A button and
    // the drift — see resolveCrosshairTarget.
    const target = resolveCrosshairTarget();
    const nodeUnderCrosshair = target?.kind === 'node' ? target.node : null;
    const edgeUnderCrosshair = target?.kind === 'connection' ? target : null;

    // ---- Right trigger: pick up / put down -------------------------------
    // Zero delay, by design. The long-press timer exists to tell a click from a
    // drag with one button; a trigger is not that button, so there is nothing
    // to disambiguate. This path never touches nodeLiftDelay — that setting
    // still governs the mouse and only the mouse.
    if (!inMenuMode) {
      if (buttons.justPressed[BTN.RT] && nodeUnderCrosshair && !carryingRef.current) {
        asDiscreteInput(() => p.startDragForNodeRef?.current?.(nodeUnderCrosshair, cross.x, cross.y));
        carryingRef.current = true;
      } else if (buttons.justPressed[BTN.RT] && target?.kind === 'group' && !carryingRef.current) {
        // A group is carried by its title, which is the only part of it the
        // mouse can grab either — and with no long-press, since the trigger has
        // nothing to disambiguate itself from.
        carryingRef.current = asDiscreteInput(
          () => p.groupControlRef?.current?.startDrag?.(target.id, cross.x, cross.y)
        ) === true;
      } else if (buttons.justReleased[BTN.RT] && carryingRef.current) {
        carryingRef.current = false;
        // The node is where the user put it. Don't let the auto-aim quietly
        // move the camera to recentre it once the restore animation finishes —
        // see suppressAutoAimRef.
        suppressAutoAimRef.current = true;
        // Reuse the real release path so group-drop detection and the save
        // signalling behave exactly as they do for a mouse drop — including,
        // via asDiscreteInput, committing in the same frame the way a real
        // mouseup does.
        asDiscreteInput(() => p.releasePointerRef?.current?.({ clientX: cross.x, clientY: cross.y }));
      }

      // ---- Left trigger: draw a connection ------------------------------
      // Press over the source, pan until the target sits under the crosshair,
      // release. The line's free end is re-projected onto the crosshair every
      // frame the canvas moves — the host loop already does that for any draw
      // in flight, and the crosshair is what it reads as the pointer.
      if (buttons.justPressed[BTN.LT] && nodeUnderCrosshair && !connectingRef.current && !carryingRef.current) {
        connectingRef.current = !!asDiscreteInput(() => p.startConnectionFromNodeRef?.current?.(
          nodeUnderCrosshair.id, cross.x, cross.y
        ));
        connectStartedAtRef.current = now;
      } else if (buttons.justPressed[BTN.LT] && !target && !connectingRef.current
        && !carryingRef.current && !marqueeRef.current && !inMenuMode) {
        // Empty canvas: the same trigger draws a selection box instead. This
        // mirrors the mouse exactly — drag from a node to connect, drag from
        // nothing to select — and it is the pad's only route to a multi-
        // selection, which is in turn the only route to making a plain group.
        marqueeRef.current = p.marqueeControlRef?.current?.begin?.(cross.x, cross.y) === true;
      } else if (buttons.justReleased[BTN.LT] && marqueeRef.current) {
        marqueeRef.current = false;
        const count = p.marqueeControlRef?.current?.end?.() ?? 0;
        // A box that caught something raises the bottom panel; the stick steps
        // it from here, which is where "Group Selection" lives.
        if (count > 0) {
          bottomWalkerRef.current?.dispose?.();
          bottomWalkerRef.current = walkMenu('bottomPanel');
          setPieFocusBoth(0);
          setModeBoth(MODE.BOTTOM);
        }
      } else if (buttons.justReleased[BTN.LT] && connectingRef.current) {
        connectingRef.current = false;
        // Same release path as the drop: it is the one that decides whether the
        // gesture landed on a node, makes the edge, and discards the draw if it
        // did not.
        asDiscreteInput(() => p.releasePointerRef?.current?.({ clientX: cross.x, clientY: cross.y }));
      }

      // The box is redrawn every frame, because with a pad it is the CANVAS
      // that moves under the fixed crosshair rather than the other way round.
      if (marqueeRef.current) p.marqueeControlRef?.current?.update?.(cross.x, cross.y);

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
    // A acts on whatever the d-pad is standing on, when it is standing on
    // something. This is not a mode stealing the button: the d-pad only ever
    // holds a focus because the user put it there a moment ago, and B (or
    // moving off the end of a panel) hands A straight back to the canvas.
    if (!carrying && buttons.justPressed[BTN.A] && headerFocusRef.current !== null) {
      const target = headerFocusRef.current;
      setHeaderFocusBoth(null);
      if (target) store.setActiveGraph?.(target);
    } else if (!carrying && buttons.justPressed[BTN.A] && panelNavRef.current.hasFocus()) {
      panelNavRef.current.activate();
    } else if (!carrying && buttons.justPressed[BTN.A]) {
      if (inNodeMode) {
        const list = p.pieMenuButtonsRef?.current || [];
        const focused = list[pieFocusedIndexRef.current];
        if (focused && !focused.hidden) {
          focused.action?.(p.pieMenuNodeIdRef?.current ?? null, { x: cross.x, y: cross.y });
        }
      } else if (inEdgeMode) {
        const list = p.edgePieMenuButtonsRef?.current || [];
        const focused = list[pieFocusedIndexRef.current];
        // Connection menus are anchor-mode, so PieMenu passes null as the
        // action's node id on a click; match that exactly.
        if (focused && !focused.hidden) focused.action?.(null, { x: cross.x, y: cross.y });
      } else if (inBottomMode) {
        // The panel's buttons are ordinary DOM with their own onClick, so the
        // walker clicks the focused one — the same event the mouse produces.
        bottomWalkerRef.current?.activate();
      } else if (target?.kind === 'plus') {
        // On the plus: commit it, exactly as clicking it does.
        p.plusSignControlRef?.current?.activate?.();
      } else if (target?.kind === 'group') {
        // Selecting a group raises its bottom control panel, and the stick then
        // steps that panel — see the GROUP branch in the stick section.
        if (p.groupControlRef?.current?.select?.(target.id)) {
          p.clearHoverImmediate?.();
          bottomWalkerRef.current?.dispose?.();
          // Lazily resolved: the panel mounts a commit or two after the
          // selection that asks for it, and the walker is built to wait.
          bottomWalkerRef.current = walkMenu('bottomPanel');
          setPieFocusBoth(0);
          setModeBoth(MODE.BOTTOM);
        }
      } else if (nodeUnderCrosshair) {
        p.setSelectedInstanceIds?.(new Set([nodeUnderCrosshair.id]));
        // HoverVisionAid ranks hovered-connection, then hovered-node, then the
        // pie-item chip — so the hover that was live at the moment of selection
        // would outrank every chip for as long as the menu stayed open. With a
        // mouse this never shows up, because moving onto a bubble means leaving
        // the node. A crosshair never leaves.
        p.clearHoverImmediate?.();
        // Land on slot 0 rather than on nothing. A menu where A does nothing
        // until you have aimed reads as broken, and always having a focused
        // option is what makes a double-tap of A mean "do the first thing".
        setPieFocusBoth(0);
        setModeBoth(MODE.NODE);
      } else if (edgeUnderCrosshair) {
        // Same single-select path a plain (unmodified) click takes.
        store.clearSelectedEdgeIds?.();
        store.setSelectedEdgeId?.(edgeUnderCrosshair.id);
        // See the note on the node branch: the live hover outranks the chip.
        p.clearHoverImmediate?.();
        p.setSelectedInstanceIds?.(new Set());
        setPieFocusBoth(0);
        setModeBoth(MODE.EDGE);
      } else if (p.plusSignControlRef?.current?.sign) {
        // Empty canvas with a plus already up: A off the plus dismisses it,
        // which is what a click on empty canvas does.
        p.plusSignControlRef.current.dismiss?.();
      } else {
        // Empty canvas, nothing up: A puts a plus sign under the crosshair, the
        // same as clicking empty canvas puts one under the pointer.
        p.plusSignControlRef?.current?.create?.(cross.x, cross.y);
      }
    }

    // B gives up the d-pad's place before it does anything on the canvas, so
    // one button always means "back out of where I am" rather than needing the
    // user to remember which surface they last touched.
    if (!carrying && buttons.justPressed[BTN.B] && clearNavFocus()) {
      // Consumed.
    } else if (!carrying && buttons.justPressed[BTN.B]) {
      // B is the universal "back": it drops the plus wherever the crosshair
      // happens to be, which is the one way out that needs no aiming at all.
      p.plusSignControlRef?.current?.dismiss?.();
      p.setSelectedInstanceIds?.(new Set());
      store.setSelectedEdgeId?.(null);
      store.clearSelectedEdgeIds?.();
      // A selected group is its own selection, held outside selectedInstanceIds
      // — clearing the node set does not touch it, so B has to say so.
      p.groupControlRef?.current?.dismiss?.();
      bottomWalkerRef.current?.dispose?.();
      bottomWalkerRef.current = null;
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
    } else if (inEdgeMode) {
      // A connection menu has no pages to turn, and its d-pad belongs to the
      // rows — so the shoulders simply do nothing here rather than reaching
      // past the open menu to toggle panels.
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
      // Bumpers step through the open webs, matching Tab+Q/E. They sit on the
      // shoulders because that is where a "previous / next" pair belongs — the
      // same place they switch tabs once you are inside a panel.
      const openIds = store.openGraphIds || [];
      const curIdx = openIds.indexOf(store.activeGraphId);
      if (buttons.justPressed[BTN.LB] && curIdx > 0) {
        store.setActiveGraphTab?.(openIds[curIdx - 1]);
      } else if (buttons.justPressed[BTN.RB] && curIdx >= 0 && curIdx < openIds.length - 1) {
        store.setActiveGraphTab?.(openIds[curIdx + 1]);
      }
      // The d-pad's left and right used to toggle the panels from here. They
      // don't any more: the panels moved to the stick clicks so that the whole
      // d-pad could become the panel navigator once you are inside one. A
      // direction cannot both open a panel and mean something within it.
    }

    // ---- Left stick: pie aiming in node mode, pan otherwise --------------
    let panDx = 0;
    let panDy = 0;

    if (inEdgeMode) {
      // A connection's menu is a row (or two) laid along the edge, so it is
      // STEPPED like a grid rather than aimed at like a ring: flick left/right
      // to walk the row, up/down to change row. Absolute aiming would hand each
      // of five buttons a fifth of the stick's throw, which is twitchy on a
      // layout whose options sit only a few degrees apart.
      const list = p.edgePieMenuButtonsRef?.current || [];
      // The stick alone. The d-pad used to step this row as well, but the
      // d-pad now belongs to the chrome at all times — a button that means
      // "next connection option" here and "next thing in the right panel"
      // one keypress later means neither reliably.
      const dir = stickStep(left, 'edge');
      if (dir) {
        const next = stepLineFocus(pieFocusedIndexRef.current, dir, list.length);
        if (next >= 0) setPieFocusBoth(next);
      }
    } else if (inBottomMode) {
      // One linear row of actions, so it is stepped exactly as a connection's
      // menu is. The walker's synthesised hover raises the panel's own label
      // chip on the way past, which is the same vision aid the pie menus give.
      const dir = stickStep(left, 'group');
      if (dir === 'left') bottomWalkerRef.current?.move(-1);
      else if (dir === 'right') bottomWalkerRef.current?.move(1);
    } else if (inNodeMode) {
      // A ring, by contrast, IS aimed at: every option has its own direction,
      // so absolute aiming is both faster and more discoverable than stepping.
      // Deliberate lockout: with a node selected the left stick belongs to its
      // menu, and B is how you get panning back. Holding the previous focus
      // below the aim threshold means easing off the stick before pressing A
      // doesn't drop the selection.
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

    if (inBottomMode) bottomWalkerRef.current?.sync();

    // ---- Hover + auto-aim ------------------------------------------------
    // Reads modeRef, not the `inMenuMode` computed at the top of this tick: the
    // A button may have entered a menu mode a few lines ago, and the stale
    // local would re-commit the hover that entry just cleared — which is what
    // kept the pie-item chip from ever appearing (see the clear on entry).
    if (modeRef.current === MODE.CANVAS) {
      // Every branch goes through commitHoverTarget rather than any of them
      // calling clearHoverImmediate: this runs every frame, and only
      // commitHoverTarget carries the "already showing this" guard that keeps a
      // steady crosshair from re-setting the same state 60 times a second.
      // Connections raise the same triplet preview they do under a mouse.
      if (target?.kind === 'node') {
        p.commitHoverTarget?.({ kind: 'node', id: target.id, node: target.node });
      } else if (target?.kind === 'connection') {
        p.commitHoverTarget?.({
          kind: 'connection',
          id: target.id,
          edgeInfo: { edgeId: target.id },
          connection: target.connection,
        });
      } else {
        p.commitHoverTarget?.({ kind: 'none' });
      }

      // ---- Drift arbitration ------------------------------------------
      // The camera has several claimants and the drift is the most junior of
      // them. It never cancels anyone; it simply declines to run, and stands
      // down mid-flight, whenever something else has a claim. See the header
      // note in gamepadAim.js for why that is ownership rather than courtesy.
      const inputActive = left.magnitude > 0 || Math.abs(zoomInput) > 0;
      if (inputActive || !driftAllowedRef.current()) {
        // Stopping is idempotent, and the drift's own per-frame permission
        // check would stop it anyway — this just makes it happen on the same
        // frame as the input rather than one later.
        driftRef.current?.stop();
        neutralSinceRef.current = 0;
        autoAimFiredRef.current = false;
        // Moving the stick is the user asking to aim again, which is the one
        // thing that lifts a post-drop suppression. Deliberately keyed on
        // input, not on time: however long they sit looking at what they just
        // placed, the camera stays put until they ask it not to.
        if (inputActive) suppressAutoAimRef.current = false;
      } else {
        if (neutralSinceRef.current === 0) neutralSinceRef.current = now;
        const dwelled = now - neutralSinceRef.current >= AUTO_AIM_DWELL_MS;
        // `aimPoint` is null for targets that have no sensible place to be
        // pulled to — a self-loop, or a routed connection whose chord guess
        // failed verification. Those simply don't attract.
        if (dwelled && !suppressAutoAimRef.current && !autoAimFiredRef.current && target?.aimPoint) {
          autoAimFiredRef.current = true;
          const zoom = p.zoomLevelRef.current;
          const cs = p.canvasSizeRef.current;
          const rect = getContainerRect();
          if (rect && cs) {
            const targetPan = panToPlacePointAt(
              target.aimPoint.x, target.aimPoint.y,
              cross.x, cross.y,
              rect, p.panOffsetRef.current, zoom, cs
            );
            const cur = p.panOffsetRef.current;
            if (Math.hypot(targetPan.x - cur.x, targetPan.y - cur.y) > AUTO_AIM_MIN_DISTANCE_PX) {
              driftRef.current?.start(targetPan, AUTO_AIM_DURATION_MS);
            }
          }
        }
      }
    }

    // ---- Yield the camera --------------------------------------------------
    // Last thing in the tick, so everything above still ran: the buttons, the
    // hover, the trigger gestures. It is only the two camera channels that
    // stand down, and only while the drag system is flying it — 250ms at each
    // end of a carry. The stick is not queued or remembered; whatever it is
    // doing when the animation ends is what takes effect on that frame.
    if (cameraHeldElsewhere(p.isAnimatingZoomRef?.current, p.dragPhaseRef?.current)) {
      return ZERO_TICK;
    }

    return { panDx, panDy, zoomMultiplier };
  }, [deactivate, getCrosshair, getContainerRect, resolveCrosshairTarget, setModeBoth, setPieFocusBoth,
    navigate, clearNavFocus, setHeaderFocusBoth]);

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
