import { describe, it, expect } from 'vitest';
import { quantizeAngle, estimateTextWidth } from '../../src/utils/canvas/edgeLabelPlacement.js';

describe('quantizeAngle', () => {
  // The point of this function is a rendering-cost one: distinct rotation
  // matrices are distinct glyph-atlas keys, so what matters is that a large
  // spread of angles collapses onto a small set. See CONNECTION LABEL
  // RENDERING BUDGETS in NodeCanvas.jsx.

  it('leaves the angle untouched when quantisation is off', () => {
    for (const q of [0, -1, undefined, NaN]) {
      expect(quantizeAngle(37.418, q)).toBe(37.418);
    }
  });

  it('snaps to the nearest multiple of the quantum', () => {
    expect(quantizeAngle(37.4, 4)).toBe(36);
    expect(quantizeAngle(38.1, 4)).toBe(40);
    expect(quantizeAngle(-37.4, 4)).toBe(-36);
    expect(quantizeAngle(0, 4)).toBe(0);
  });

  it('never moves an angle by more than half a quantum', () => {
    for (const q of [0.5, 1, 2, 3, 4, 8]) {
      for (let a = -90; a <= 90; a += 0.37) {
        expect(Math.abs(quantizeAngle(a, q) - a)).toBeLessThanOrEqual(q / 2 + 1e-9);
      }
    }
  });

  it('collapses a full spread of angles into 180/q buckets or fewer', () => {
    // This is the property the performance fix actually depends on.
    for (const q of [1, 2, 4, 8]) {
      const buckets = new Set();
      for (let a = -90; a < 90; a += 0.05) buckets.add(quantizeAngle(a, q));
      expect(buckets.size).toBeLessThanOrEqual(180 / q + 1);
    }
  });

  it('is stable — quantising twice changes nothing', () => {
    for (let a = -90; a <= 90; a += 1.7) {
      const once = quantizeAngle(a, 3);
      expect(quantizeAngle(once, 3)).toBeCloseTo(once, 9);
    }
  });

  it('does NOT preserve 90 for a quantum that fails to divide it', () => {
    // Documents why the renderer constrains its quantum: a raw 4-degree bucket
    // would tilt every vertical manhattan label to 92.
    expect(quantizeAngle(90, 4)).toBe(92);
  });
});

describe('label angle quantum (the renderer\'s zoom-derived bucket size)', () => {
  // Mirrors NodeCanvas's `labelAngleQuantum`. Kept here so the error bound the
  // constants claim is actually checked rather than asserted in a comment.
  const LABEL_ANGLE_ERROR_PX = 2;
  const LABEL_HALF_WIDTH_CANVAS = 150;
  const MAX_LABEL_ANGLE_QUANTUM = 4;

  const quantumFor = (zoom) => {
    const halfWidthOnScreen = LABEL_HALF_WIDTH_CANVAS * zoom;
    const wanted = halfWidthOnScreen > LABEL_ANGLE_ERROR_PX
      ? Math.min(
        MAX_LABEL_ANGLE_QUANTUM,
        2 * Math.asin(LABEL_ANGLE_ERROR_PX / halfWidthOnScreen) * (180 / Math.PI)
      )
      : MAX_LABEL_ANGLE_QUANTUM;
    return 90 / Math.max(1, Math.ceil(90 / wanted));
  };

  it('holds the on-screen error inside the budget at every zoom', () => {
    for (let zoom = 0.02; zoom <= 3; zoom *= 1.15) {
      const q = quantumFor(zoom);
      // Worst-case tilt is half a quantum; it displaces the label end by
      // halfWidth * sin(tilt), in canvas units, which the zoom then scales.
      const errorPx = LABEL_HALF_WIDTH_CANVAS * Math.sin((q / 2) * Math.PI / 180) * zoom;
      expect(errorPx).toBeLessThanOrEqual(LABEL_ANGLE_ERROR_PX + 1e-6);
    }
  });

  it('tightens as you zoom in and coarsens as you zoom out', () => {
    let prev = 0;
    for (let zoom = 3; zoom >= 0.02; zoom /= 1.3) {
      const q = quantumFor(zoom);
      expect(q).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = q;
    }
  });

  it('never exceeds the hard cap', () => {
    for (let zoom = 0.001; zoom <= 10; zoom *= 1.4) {
      expect(quantumFor(zoom)).toBeLessThanOrEqual(MAX_LABEL_ANGLE_QUANTUM);
    }
  });

  it('always divides 90, so manhattan labels stay on their exact axes', () => {
    // The mode that was already fast must not be made slower or crooked.
    for (let zoom = 0.01; zoom <= 5; zoom *= 1.11) {
      const q = quantumFor(zoom);
      expect(90 / q).toBeCloseTo(Math.round(90 / q), 9);
      expect(quantizeAngle(90, q)).toBeCloseTo(90, 9);
      expect(quantizeAngle(0, q)).toBe(0);
    }
  });

  it('is coarse enough at fit-the-graph zoom to matter', () => {
    // 0.15 is roughly where a 250-node graph fits on screen — the case that
    // was measured at 50ms/frame with unquantised angles.
    expect(quantumFor(0.15)).toBeCloseTo(90 / 23, 6);
    expect(quantumFor(0.15)).toBeLessThanOrEqual(MAX_LABEL_ANGLE_QUANTUM);
    const buckets = new Set();
    for (let a = -90; a < 90; a += 0.05) buckets.add(quantizeAngle(a, quantumFor(0.15)));
    // 23 divisions either side of zero, plus zero itself.
    expect(buckets.size).toBe(47);
  });
});

describe('estimateTextWidth', () => {
  it('scales with both length and font size', () => {
    expect(estimateTextWidth('abcd', 20)).toBeGreaterThan(estimateTextWidth('ab', 20));
    expect(estimateTextWidth('abcd', 40)).toBeGreaterThan(estimateTextWidth('abcd', 20));
  });
});
