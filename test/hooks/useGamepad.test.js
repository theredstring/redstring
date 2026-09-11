import { describe, it, expect } from 'vitest';
import { applyStickDeadzone, pieButtonIndexForStick, BTN, AXIS } from '../../src/hooks/useGamepad.js';

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
