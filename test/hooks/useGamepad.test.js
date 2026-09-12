import { describe, it, expect } from 'vitest';
import {
  applyStickDeadzone,
  pieButtonIndexForStick,
  stepLineFocus,
  stickDirection,
  lineFrameDirection,
  createRepeater,
  cameraHeldElsewhere,
  panelResizeDelta,
  panelResizeArms,
  handPointerToCrosshair,
  BTN,
  AXIS,
} from '../../src/hooks/useGamepad.js';
import { lineModeLayout, LINE_MODE_MAX_PER_ROW } from '../../src/utils/pieMenuLayout.js';
import { nearestPointOnSegment, panToPlacePointAt } from '../../src/utils/gamepadAim.js';

/**
 * Unit tests for the pure parts of the controller layer — the bits that can be
 * checked without a physical pad attached.
 *
 * The stateful half (mode transitions, button dispatch) reaches into the store,
 * the DOM and NodeCanvas callbacks, so it is covered by the manual pass with a
 * real controller rather than by a mountain of mocks that would mostly assert
 * that the mocks were called.
 */

describe('applyStickDeadzone', () => {
  it('zeroes a resting stick', () => {
    expect(applyStickDeadzone(0, 0)).toEqual({ x: 0, y: 0, magnitude: 0 });
  });

  it('zeroes drift inside the deadzone', () => {
    // Real sticks rest a few percent off centre; this is the noise floor.
    const r = applyStickDeadzone(0.1, 0.1);
    expect(r.magnitude).toBe(0);
  });

  it('is radial, not per-axis', () => {
    // A per-axis deadzone leaves a cross-shaped dead region: each component
    // here is under 0.18 on its own, but the vector is 0.212 — outside it.
    const r = applyStickDeadzone(0.15, 0.15);
    expect(r.magnitude).toBeGreaterThan(0);
  });

  it('reaches full magnitude at full deflection', () => {
    const r = applyStickDeadzone(0, -1);
    expect(r.magnitude).toBeCloseTo(1, 5);
    expect(r.y).toBeCloseTo(-1, 5);
  });

  it('has no discontinuity at the deadzone edge', () => {
    // Just past the boundary must be near zero, not a jump to some fraction.
    const r = applyStickDeadzone(0.19, 0);
    expect(r.magnitude).toBeGreaterThan(0);
    expect(r.magnitude).toBeLessThan(0.05);
  });

  it('preserves direction', () => {
    const r = applyStickDeadzone(0.6, 0.6);
    expect(r.x).toBeCloseTo(r.y, 10);
  });

  it('survives non-finite axis values', () => {
    expect(applyStickDeadzone(NaN, NaN).magnitude).toBe(0);
  });
});

describe('pieButtonIndexForStick', () => {
  // Slot 0 is due North and the layout steps clockwise in 45° increments,
  // mirroring NUM_FIXED_POSITIONS / START_ANGLE_OFFSET in PieMenu.jsx. Screen
  // coords: +y is DOWN, which is also the gamepad's Y convention.
  const UP = [0, -1];
  const UP_RIGHT = [0.707, -0.707];
  const RIGHT = [1, 0];
  const DOWN_RIGHT = [0.707, 0.707];
  const DOWN = [0, 1];
  const DOWN_LEFT = [-0.707, 0.707];
  const LEFT = [-1, 0];
  const UP_LEFT = [-0.707, -0.707];

  it('maps each cardinal and diagonal to its own slot', () => {
    const cases = [
      [UP, 0], [UP_RIGHT, 1], [RIGHT, 2], [DOWN_RIGHT, 3],
      [DOWN, 4], [DOWN_LEFT, 5], [LEFT, 6], [UP_LEFT, 7],
    ];
    for (const [[x, y], expected] of cases) {
      expect(pieButtonIndexForStick(x, y, 8)).toBe(expected);
    }
  });

  it('wraps correctly across the ±PI boundary', () => {
    // Due west is atan2 = ±PI; a naive nearest-angle search that forgets to
    // normalise picks the wrong slot here.
    expect(pieButtonIndexForStick(-1, 0.001, 8)).toBe(6);
    expect(pieButtonIndexForStick(-1, -0.001, 8)).toBe(6);
  });

  it('never returns a slot past the end of a short page', () => {
    // Aiming south-west with only three buttons must still land on a real one.
    for (const [x, y] of [UP, RIGHT, DOWN, LEFT, DOWN_LEFT, UP_LEFT]) {
      const idx = pieButtonIndexForStick(x, y, 3);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(3);
    }
  });

  it('always picks the only button when there is one', () => {
    // PieMenu draws a lone button in the NE slot rather than due north, so
    // there is nothing to aim at and every direction must resolve to index 0.
    for (const [x, y] of [UP, RIGHT, DOWN, LEFT]) {
      expect(pieButtonIndexForStick(x, y, 1)).toBe(0);
    }
  });

  it('returns -1 when there is nothing to aim at', () => {
    expect(pieButtonIndexForStick(0, -1, 0)).toBe(-1);
    expect(pieButtonIndexForStick(0, -1, undefined)).toBe(-1);
  });

  it('resolves a direction halfway between two slots deterministically', () => {
    // 22.5° between North and North-East — must pick one, not throw or drift.
    const idx = pieButtonIndexForStick(Math.sin(Math.PI / 8), -Math.cos(Math.PI / 8), 8);
    expect([0, 1]).toContain(idx);
  });
});

describe('stickDirection', () => {
  it('returns null inside the threshold', () => {
    expect(stickDirection(0, 0)).toBeNull();
    expect(stickDirection(0.3, 0.2, 0.5)).toBeNull();
  });

  it('picks the dominant axis', () => {
    expect(stickDirection(1, 0)).toBe('right');
    expect(stickDirection(-1, 0)).toBe('left');
    expect(stickDirection(0, -1)).toBe('up');
    expect(stickDirection(0, 1)).toBe('down');
  });

  it('breaks a perfect diagonal toward the horizontal', () => {
    // Rows are the long axis of these menus, so ties going horizontal is the
    // less surprising of the two.
    expect(stickDirection(0.7, -0.7)).toBe('right');
  });
});

describe('stepLineFocus', () => {
  // The connection menu behaves as linear rows: left/right walks a row,
  // up/down changes row. Rows stack toward the edge's upward side.

  it('walks a single row and stops at the ends', () => {
    expect(stepLineFocus(0, 'right', 4)).toBe(1);
    expect(stepLineFocus(1, 'left', 4)).toBe(0);
    // Clamps rather than wrapping — wrapping off a row lands somewhere
    // visually unrelated, which reads as a glitch.
    expect(stepLineFocus(0, 'left', 4)).toBe(0);
    expect(stepLineFocus(3, 'right', 4)).toBe(3);
  });

  it('changes row on up, and comes back on down', () => {
    const count = LINE_MODE_MAX_PER_ROW + 2;
    const slots = lineModeLayout({ count, angle: 0, step: 1, perpOffset: 0, rowGap: 1 });
    const up = stepLineFocus(0, 'up', count);
    expect(slots[up].row).toBe(1);
    expect(slots[stepLineFocus(up, 'down', count)].row).toBe(0);
  });

  it('does not leave the menu at the row extremes', () => {
    const count = LINE_MODE_MAX_PER_ROW + 2;
    const slots = lineModeLayout({ count, angle: 0, step: 1, perpOffset: 0, rowGap: 1 });
    const topRow = slots.findIndex(sl => sl.row === 1);
    expect(stepLineFocus(topRow, 'up', count)).toBe(topRow);
    expect(stepLineFocus(0, 'down', count)).toBe(0);
  });

  it('keeps roughly the same position when rows differ in length', () => {
    // Row 0 is full, row 1 holds the remainder — stepping up from the far end
    // must still land on a real button, as near the same column as exists.
    const count = LINE_MODE_MAX_PER_ROW + 2;
    const slots = lineModeLayout({ count, angle: 0, step: 1, perpOffset: 0, rowGap: 1 });
    const lastOfRow0 = slots.map((sl, i) => ({ sl, i }))
      .filter(({ sl }) => sl.row === 0).pop().i;
    const up = stepLineFocus(lastOfRow0, 'up', count);
    expect(slots[up].row).toBe(1);
    expect(up).toBeGreaterThanOrEqual(0);
    expect(up).toBeLessThan(count);
  });

  it('always lands on a real button from any start', () => {
    for (let count = 1; count <= 9; count++) {
      for (const dir of ['left', 'right', 'up', 'down']) {
        for (let from = -1; from < count; from++) {
          const idx = stepLineFocus(from, dir, count);
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(count);
        }
      }
    }
  });

  it('returns -1 when there is nothing to step through', () => {
    expect(stepLineFocus(0, 'right', 0)).toBe(-1);
  });
});

describe('createRepeater', () => {
  const make = () => createRepeater({ delayMs: 260, intervalMs: 90 });

  it('fires immediately on the first press', () => {
    const r = make();
    expect(r.held('a', true, 0)).toBe(true);
  });

  it('holds off until the delay, then repeats at the interval', () => {
    const r = make();
    r.held('a', true, 0);
    expect(r.held('a', true, 100)).toBe(false);
    expect(r.held('a', true, 259)).toBe(false);
    expect(r.held('a', true, 260)).toBe(true);
    expect(r.held('a', true, 300)).toBe(false);
    expect(r.held('a', true, 350)).toBe(true);
  });

  it('fires immediately when the direction changes', () => {
    const r = make();
    r.held('a', true, 0);
    // Switching direction is a new gesture, not a continuation of the old one.
    expect(r.held('b', true, 10)).toBe(true);
  });

  it('REGRESSION: a second flick inside the delay window is not swallowed', () => {
    // The bug this factory was extracted for. A stick returning to neutral left
    // the direction latched, so flick → release → flick within the delay did
    // nothing, and the menu felt like it had a long cooldown after every step.
    const r = make();
    expect(r.held('edge:right', true, 0)).toBe(true);
    r.releasePrefix('edge:');           // stick back to centre
    expect(r.held('edge:right', true, 50)).toBe(true);  // flicked again, well inside 260ms
    r.releasePrefix('edge:');
    expect(r.held('edge:right', true, 90)).toBe(true);
  });

  it('releasePrefix only ends gestures it owns', () => {
    const r = make();
    r.held('sel:down', true, 0);
    r.releasePrefix('edge:');   // a different surface's stick going neutral
    expect(r.held('sel:down', true, 50)).toBe(false); // still mid-delay, untouched
  });

  it('releasing a button key ends its gesture', () => {
    const r = make();
    r.held(14, true, 0);
    expect(r.held(14, false, 10)).toBe(false);
    expect(r.held(14, true, 20)).toBe(true); // re-press fires at once
  });
});

describe('button mapping table', () => {
  it('matches the W3C standard gamepad layout', () => {
    // These indices are load-bearing across Xbox, DualSense and Switch Pro —
    // all three report mapping === 'standard' and normalise to this order.
    expect(BTN.A).toBe(0);
    expect(BTN.B).toBe(1);
    expect(BTN.X).toBe(2);
    expect(BTN.Y).toBe(3);
    expect(BTN.LB).toBe(4);
    expect(BTN.RB).toBe(5);
    expect(BTN.LT).toBe(6);
    expect(BTN.RT).toBe(7);
    expect(BTN.SELECT).toBe(8);
    expect(BTN.START).toBe(9);
    expect(BTN.L3).toBe(10);
    expect(BTN.R3).toBe(11);
    expect(BTN.DPAD_UP).toBe(12);
    expect(BTN.DPAD_DOWN).toBe(13);
    expect(BTN.DPAD_LEFT).toBe(14);
    expect(BTN.DPAD_RIGHT).toBe(15);
  });

  it('maps the sticks to the standard axis order', () => {
    expect(AXIS.LX).toBe(0);
    expect(AXIS.LY).toBe(1);
    expect(AXIS.RX).toBe(2);
    expect(AXIS.RY).toBe(3);
  });
});

describe('nearestPointOnSegment', () => {
  it('projects onto the interior of a segment', () => {
    const r = nearestPointOnSegment(5, 10, 0, 0, 10, 0);
    expect(r.x).toBeCloseTo(5, 10);
    expect(r.y).toBeCloseTo(0, 10);
    expect(r.t).toBeCloseTo(0.5, 10);
  });

  it('clamps past either end rather than running off the line', () => {
    // A connection is a segment, not an infinite line — projecting past an
    // endpoint would aim the drift at empty canvas beyond the node.
    expect(nearestPointOnSegment(-50, 0, 0, 0, 10, 0)).toMatchObject({ x: 0, y: 0, t: 0 });
    expect(nearestPointOnSegment(999, 0, 0, 0, 10, 0)).toMatchObject({ x: 10, y: 0, t: 1 });
  });

  it('handles a degenerate zero-length segment', () => {
    const r = nearestPointOnSegment(3, 4, 7, 7, 7, 7);
    expect(r).toMatchObject({ x: 7, y: 7 });
  });

  it('projects onto a diagonal', () => {
    const r = nearestPointOnSegment(0, 10, 0, 0, 10, 10);
    expect(r.x).toBeCloseTo(5, 10);
    expect(r.y).toBeCloseTo(5, 10);
  });
});

describe('panToPlacePointAt', () => {
  const rect = { left: 100, top: 50 };
  const canvasSize = { offsetX: -1000, offsetY: -1000 };

  it('produces a pan that lands the world point under the client point', () => {
    const zoom = 2;
    const pan = panToPlacePointAt(300, 400, 640, 360, rect, { x: 0, y: 0 }, zoom, canvasSize);
    // Re-project forward: world -> screen under the computed pan.
    const screenX = (300 - canvasSize.offsetX) * zoom + pan.x + rect.left;
    const screenY = (400 - canvasSize.offsetY) * zoom + pan.y + rect.top;
    expect(screenX).toBeCloseTo(640, 10);
    expect(screenY).toBeCloseTo(360, 10);
  });

  it('round-trips at any zoom', () => {
    for (const zoom of [0.1, 0.5, 1, 3, 12]) {
      const pan = panToPlacePointAt(-77, 250, 400, 300, rect, { x: 5, y: -5 }, zoom, canvasSize);
      const screenX = (-77 - canvasSize.offsetX) * zoom + pan.x + rect.left;
      const screenY = (250 - canvasSize.offsetY) * zoom + pan.y + rect.top;
      expect(screenX).toBeCloseTo(400, 8);
      expect(screenY).toBeCloseTo(300, 8);
    }
  });
});

/**
 * REGRESSION: releasing a carried node stuttered the canvas.
 *
 * The drag system's two zoom animations write pan absolutely from a snapshot
 * taken when they start, so a pan delta added by the stick in between is
 * discarded on the next frame rather than merged. The two writers alternate
 * and the canvas judders for the 250ms the animation runs. A mouse never hits
 * it — your hand is still at the moment of release — but a pad is almost
 * always still leaning on the stick, because that is how the node was flown
 * into place.
 */
describe('cameraHeldElsewhere', () => {
  it('yields while a drag-zoom animation is running', () => {
    expect(cameraHeldElsewhere(true, 'dragging')).toBe(true);
    expect(cameraHeldElsewhere(true, 'idle')).toBe(true);
  });

  it('yields through the drop, animation or not', () => {
    // `finalizing` is the sliver between the drag ending and the restore
    // animation starting: no frame may fall between the two guards.
    expect(cameraHeldElsewhere(false, 'finalizing')).toBe(true);
    expect(cameraHeldElsewhere(false, 'restoring')).toBe(true);
  });

  it('leaves the stick alone while merely carrying a node', () => {
    // Panning IS how a carried node is moved, so a plain drag must not yield.
    expect(cameraHeldElsewhere(false, 'dragging')).toBe(false);
  });

  it('does not yield when nothing is driving the camera', () => {
    expect(cameraHeldElsewhere(false, 'idle')).toBe(false);
    expect(cameraHeldElsewhere(undefined, undefined)).toBe(false);
    expect(cameraHeldElsewhere(null, null)).toBe(false);
  });
});

/**
 * Holding a bumper and pushing the stick sideways resizes that panel.
 *
 * The value is VIRTUAL CURSOR TRAVEL, not panel width: the pad drives the same
 * overlay resizer a mouse drags, and which panel a rightward drag widens is
 * already settled there. Restating it here is how the two would come to
 * disagree.
 */
describe('panelResizeDelta', () => {
  const FRAME = 1; // one 60fps frame

  it('moves the cursor the way the stick is pushed', () => {
    expect(panelResizeDelta(1, 1, FRAME)).toBeGreaterThan(0);
    expect(panelResizeDelta(-1, 1, FRAME)).toBeLessThan(0);
  });

  it('is symmetric about centre', () => {
    expect(panelResizeDelta(0.8, 1, FRAME)).toBeCloseTo(-panelResizeDelta(-0.8, 1, FRAME), 10);
  });

  it('scales with sensitivity and with frame time', () => {
    const base = panelResizeDelta(1, 1, FRAME);
    expect(panelResizeDelta(1, 2, FRAME)).toBeCloseTo(base * 2, 10);
    // A frame that took twice as long moves twice as far, so the rate holds
    // however the frame time drifts.
    expect(panelResizeDelta(1, 1, 2)).toBeCloseTo(base * 2, 10);
  });

  it('defaults a missing sensitivity to 1x rather than to nothing', () => {
    expect(panelResizeDelta(1, undefined, FRAME)).toBeCloseTo(panelResizeDelta(1, 1, FRAME), 10);
    expect(panelResizeDelta(1, 0, FRAME)).toBeCloseTo(panelResizeDelta(1, 1, FRAME), 10);
  });

  it('survives a garbage axis reading', () => {
    expect(panelResizeDelta(NaN, 1, FRAME)).toBe(0);
    expect(panelResizeDelta(undefined, 1, FRAME)).toBe(0);
    expect(panelResizeDelta(0, 1, FRAME)).toBe(0);
  });

  /**
   * The curve, which is this gesture's own rather than the pan curve the
   * deflection arrives carrying. Panning makes small angles deliberately very
   * slow so the same stick can nudge a node and cross the canvas; a panel edge
   * has a range of a few hundred pixels and nothing to aim at, so a
   * half-pushed stick should mean about half speed.
   */
  it('gives the small and middle angles more than their linear share', () => {
    const full = panelResizeDelta(1, 1, FRAME);
    for (const x of [0.3, 0.5, 0.7]) {
      const share = panelResizeDelta(x, 1, FRAME) / full;
      expect(share).toBeGreaterThan(x); // above the straight line
      expect(share).toBeLessThan(1);    // but still short of full speed
    }
  });

  it('still rises all the way to full deflection', () => {
    let previous = 0;
    for (const x of [0.2, 0.4, 0.6, 0.8, 1]) {
      const here = panelResizeDelta(x, 1, FRAME);
      expect(here).toBeGreaterThan(previous);
      previous = here;
    }
  });

  /**
   * REGRESSION: the pan curve is undone before this one is applied. If that
   * step were dropped, the two would compound into an exponent well above 1
   * and the low end would be slower than a straight line rather than faster —
   * the exact complaint this curve exists to answer.
   */
  it('does not compound with the pan curve it arrives carrying', () => {
    const half = panelResizeDelta(0.5, 1, FRAME) / panelResizeDelta(1, 1, FRAME);
    // A compounded 1.6 x 0.85 would put half-deflection near 0.4 of full.
    expect(half).toBeGreaterThan(0.5);
  });
});

/**
 * Whether holding a bumper has become a resize.
 *
 * The bumper can be tapped at any moment, including mid-pan with the stick
 * already pushed hard over — so this is travel since the press, never absolute
 * deflection.
 */
describe('panelResizeArms', () => {
  it('arms when the stick moves after the press', () => {
    expect(panelResizeArms(0.5, 0)).toBe(true);
    expect(panelResizeArms(-0.5, 0)).toBe(true);
  });

  it('does not arm on small movement', () => {
    expect(panelResizeArms(0.3, 0)).toBe(false);
    expect(panelResizeArms(0.1, -0.1)).toBe(false);
  });

  /**
   * REGRESSION: the case that makes this measure travel rather than position.
   * Panning hard right and tapping the bumper to switch webs must switch webs
   * — an absolute test would read the resting deflection as a resize and eat
   * the tap.
   */
  it('does not arm from deflection the stick already had at the press', () => {
    expect(panelResizeArms(1, 1)).toBe(false);
    expect(panelResizeArms(0.95, 1)).toBe(false);
  });

  it('arms from a moving stick that moves further', () => {
    expect(panelResizeArms(0.2, 1)).toBe(true);
    expect(panelResizeArms(-1, -0.5)).toBe(true);
  });

  it('survives a garbage reading', () => {
    expect(panelResizeArms(NaN, 0)).toBe(false);
    expect(panelResizeArms(0.5, undefined)).toBe(false);
  });
});

/**
 * A connection's menu is laid along its edge, so its row runs at whatever angle
 * that edge has. These check the change of basis that makes navigation agree
 * with the drawing at every angle — the same `along` / `perp` vectors
 * lineModeLayout places the buttons with.
 */
describe('lineFrameDirection', () => {
  const FULL = 1;

  it('is ordinary screen direction for a horizontal connection', () => {
    expect(lineFrameDirection(FULL, 0, 0)).toBe('right');
    expect(lineFrameDirection(-FULL, 0, 0)).toBe('left');
    expect(lineFrameDirection(0, -FULL, 0)).toBe('up');
    expect(lineFrameDirection(0, FULL, 0)).toBe('down');
  });

  /**
   * The case that motivated this. On a vertical connection the row is stacked
   * top to bottom, so pushing the stick right — the screen direction that used
   * to mean "next" — points off the side of a menu that has no width.
   */
  it('walks a vertical connection along its own row', () => {
    const UP_EDGE = Math.PI / 2; // row runs downward on screen
    expect(lineFrameDirection(0, FULL, UP_EDGE)).toBe('right'); // stick down = next
    expect(lineFrameDirection(0, -FULL, UP_EDGE)).toBe('left'); // stick up = previous
    // Across the row changes row, as it does on a horizontal one.
    expect(lineFrameDirection(FULL, 0, UP_EDGE)).toBe('up');
    expect(lineFrameDirection(-FULL, 0, UP_EDGE)).toBe('down');
  });

  it('handles the other vertical sign the same way round', () => {
    const DOWN_EDGE = -Math.PI / 2;
    // The row runs upward on screen here, so pushing up is what advances it.
    expect(lineFrameDirection(0, -FULL, DOWN_EDGE)).toBe('right');
    expect(lineFrameDirection(0, FULL, DOWN_EDGE)).toBe('left');
  });

  it('treats a diagonal connection as just another angle', () => {
    const DIAG = Math.PI / 4;
    const d = Math.SQRT1_2;
    // Pushing along the edge advances the row...
    expect(lineFrameDirection(d, d, DIAG)).toBe('right');
    expect(lineFrameDirection(-d, -d, DIAG)).toBe('left');
    // ...and pushing across it changes row.
    expect(lineFrameDirection(d, -d, DIAG)).toBe('up');
    expect(lineFrameDirection(-d, d, DIAG)).toBe('down');
  });

  /**
   * Rotation preserves length, so the deadzone threshold has to mean exactly
   * what it means for an unrotated stick — otherwise the menu would get twitchy
   * at some angles and sluggish at others.
   */
  it('thresholds on magnitude, unchanged by the rotation', () => {
    for (const angle of [0, 0.3, Math.PI / 4, Math.PI / 2, -1.1]) {
      expect(lineFrameDirection(0.2, 0.2, angle, 0.5)).toBeNull();
      expect(lineFrameDirection(0.6, 0.6, angle, 0.5)).not.toBeNull();
    }
  });

  it('falls back to the screen frame on a missing angle', () => {
    expect(lineFrameDirection(FULL, 0, undefined)).toBe('right');
    expect(lineFrameDirection(FULL, 0, NaN)).toBe('right');
  });
});

/**
 * The Settings sliders reach the hook through two places that were previously
 * fixed constants. These check the parameterisation itself — that a supplied
 * value is honoured, and that callers who supply nothing behave exactly as they
 * did before it existed.
 */
describe('applyStickDeadzone — adjustable deadzone', () => {
  it('uses the module default when none is given', () => {
    expect(applyStickDeadzone(0.15, 0).magnitude).toBe(0);   // inside 0.18
    expect(applyStickDeadzone(0.5, 0).magnitude).toBeGreaterThan(0);
  });

  it('honours a wider deadzone, for a stick that drifts', () => {
    expect(applyStickDeadzone(0.3, 0, 0.4).magnitude).toBe(0);
    expect(applyStickDeadzone(0.5, 0, 0.4).magnitude).toBeGreaterThan(0);
  });

  it('honours a narrower one', () => {
    expect(applyStickDeadzone(0.1, 0, 0.05).magnitude).toBeGreaterThan(0);
  });

  /**
   * The rescale has to use the SAME deadzone it tested against, or the curve
   * starts partway up and the stick jumps the moment it leaves the dead region.
   */
  it('still starts from zero at the edge of whatever deadzone it was given', () => {
    for (const dz of [0.05, 0.18, 0.4]) {
      const justInside = applyStickDeadzone(dz * 0.99, 0, dz).magnitude;
      const justOutside = applyStickDeadzone(dz + 0.001, 0, dz).magnitude;
      expect(justInside).toBe(0);
      expect(justOutside).toBeLessThan(0.01); // continuous, not a step
    }
  });

  it('still reaches full magnitude at full deflection', () => {
    for (const dz of [0.05, 0.18, 0.4]) {
      expect(applyStickDeadzone(1, 0, dz).magnitude).toBeCloseTo(1, 10);
    }
  });

  it('ignores a nonsense deadzone rather than dividing by it', () => {
    expect(applyStickDeadzone(0.5, 0, NaN).magnitude)
      .toBeCloseTo(applyStickDeadzone(0.5, 0).magnitude, 10);
  });
});

describe('createRepeater — adjustable rate', () => {
  it('repeats faster when the rate is above 1', () => {
    let rate = 1;
    const r = createRepeater({ delayMs: 200, intervalMs: 100, rate: () => rate });
    expect(r.held('a', true, 0)).toBe(true);      // press edge
    expect(r.held('a', true, 150)).toBe(false);   // still inside the 200ms delay
    expect(r.held('a', true, 210)).toBe(true);    // delay elapsed

    rate = 2;
    r.held('a', false, 220);
    expect(r.held('a', true, 300)).toBe(true);    // press edge again
    expect(r.held('a', true, 410)).toBe(true);    // 100ms in: delay is now halved
  });

  it('behaves exactly as before when no rate is supplied', () => {
    const r = createRepeater({ delayMs: 200, intervalMs: 100 });
    expect(r.held('a', true, 0)).toBe(true);
    expect(r.held('a', true, 150)).toBe(false);
    expect(r.held('a', true, 210)).toBe(true);
    expect(r.held('a', true, 260)).toBe(false);
    expect(r.held('a', true, 320)).toBe(true);
  });

  it('falls back to 1x on a nonsense or zero rate rather than dividing by it', () => {
    for (const bad of [0, -1, NaN, undefined]) {
      const r = createRepeater({ delayMs: 200, intervalMs: 100, rate: () => bad });
      expect(r.held('a', true, 0)).toBe(true);
      expect(r.held('a', true, 150)).toBe(false);
      expect(r.held('a', true, 210)).toBe(true);
    }
  });
});

describe('handPointerToCrosshair', () => {
  /**
   * Picking up a controller does not move the physical mouse, and no web page
   * can move it. So whatever it was resting on stays hovered for the whole
   * session unless the pointer is handed over deliberately, once, on engaging.
   */
  const setup = () => {
    document.body.innerHTML = '';
    const wasOver = document.createElement('div');
    const atReticle = document.createElement('div');
    document.body.append(wasOver, atReticle);

    const seen = [];
    for (const el of [wasOver, atReticle]) {
      for (const type of ['mouseout', 'mouseover', 'mousemove']) {
        el.addEventListener(type, (e) => seen.push({
          el: el === wasOver ? 'wasOver' : 'atReticle',
          type,
          x: e.clientX,
          y: e.clientY,
          trusted: e.isTrusted,
        }));
      }
    }

    // jsdom has no layout, so elementFromPoint always returns null. Stand in
    // for it with the two points these tests care about.
    document.elementFromPoint = (x, y) => (x === 10 && y === 20 ? wasOver : atReticle);
    return { seen, wasOver, atReticle };
  };

  it('releases the element the mouse was left on and enters the one at the reticle', () => {
    const { seen } = setup();
    handPointerToCrosshair({ x: 10, y: 20 }, { x: 800, y: 450 });

    expect(seen.map(s => `${s.el}:${s.type}`)).toEqual([
      'wasOver:mouseout',
      'atReticle:mouseover',
      'atReticle:mousemove',
    ]);
  });

  it('reports the reticle as the pointer position, not the old mouse position', () => {
    const { seen } = setup();
    handPointerToCrosshair({ x: 10, y: 20 }, { x: 800, y: 450 });

    for (const s of seen) {
      expect({ x: s.x, y: s.y }).toEqual({ x: 800, y: 450 });
    }
  });

  it('still reports the move when the reticle is over the same element', () => {
    // Nothing to enter or leave, but anything tracking a position WITHIN one
    // element — the canvas above all — still has stale coordinates to correct.
    const { seen } = setup();
    handPointerToCrosshair({ x: 600, y: 300 }, { x: 800, y: 450 });

    expect(seen.map(s => s.type)).toEqual(['mousemove']);
  });

  it('copes with no known previous mouse position', () => {
    const { seen } = setup();
    expect(() => handPointerToCrosshair(null, { x: 800, y: 450 })).not.toThrow();
    expect(seen.map(s => `${s.el}:${s.type}`)).toEqual([
      'atReticle:mouseover',
      'atReticle:mousemove',
    ]);
  });

  it('emits untrusted events, which is what keeps the mode from switching itself off', () => {
    // The window-level mousemove listener hands control back to the mouse. This
    // hand-off fires a mousemove at the reticle as controller mode engages, so
    // without the isTrusted guard on that listener the mode would deactivate on
    // the very frame it activated.
    const { seen } = setup();
    handPointerToCrosshair({ x: 10, y: 20 }, { x: 800, y: 450 });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(s => s.trusted === false)).toBe(true);
  });
});
