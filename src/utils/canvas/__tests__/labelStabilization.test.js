/**
 * The deadband that keeps a settled label from jittering, and the one thing it
 * must never do: change the direction the label is drawn in.
 *
 * A connection label is drawn along the connection it names. That is the whole
 * of how a reader knows which line a name belongs to, so the angle is not a
 * quantity this layer gets to have opinions about — it damps WHEN a label
 * updates, never WHAT it updates to.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  stabilizeLabelPosition,
  clearLabelStabilization,
} from '../labelStabilization.js';

describe('stabilizeLabelPosition', () => {
  beforeEach(clearLabelStabilization);

  it('passes an angle through untouched', () => {
    // The regression this file exists for. Angles near a multiple of 15 used to
    // be snapped onto it — two thirds of all angles, tilted by up to 5 degrees
    // — so a connection running at -26 degrees carried a label drawn at -30.
    // Every one of these is inside a band that used to be captured.
    for (const angle of [-26, -29.4, 1.2, 13.7, 44, 46.5, 88.9, 91.1, 151]) {
      clearLabelStabilization();
      expect(stabilizeLabelPosition('e', 0, 0, angle).angle).toBe(angle);
      // And on the update path too, not just the first sighting.
      expect(stabilizeLabelPosition('e', 500, 500, angle).angle).toBe(angle);
    }
  });

  it('holds position and angle inside the deadband', () => {
    stabilizeLabelPosition('e', 100, 100, 30);
    const held = stabilizeLabelPosition('e', 103, 100, 30.2);
    expect(held).toEqual({ x: 100, y: 100, angle: 30 });
  });

  it('adopts a move past the deadband outright, with no lag', () => {
    stabilizeLabelPosition('e', 100, 100, 30);
    expect(stabilizeLabelPosition('e', 140, 100, 42)).toEqual({ x: 140, y: 100, angle: 42 });
  });

  it('releases the deadband when the angle moves but the centre does not', () => {
    // A long connection whose far end swings pivots about a label that barely
    // moves. Freezing on distance alone would leave the label pointing along a
    // direction the line no longer runs in.
    stabilizeLabelPosition('e', 100, 100, 30);
    const turned = stabilizeLabelPosition('e', 101, 100, 37);
    expect(turned.angle).toBe(37);
    expect(turned.x).toBe(101);
  });

  it('measures the angle the short way round', () => {
    // 179.6 and -179.8 are 0.6 degrees apart, not 359.4. Without that the
    // deadband would release on every label that happens to sit near the wrap.
    stabilizeLabelPosition('e', 100, 100, 179.6);
    expect(stabilizeLabelPosition('e', 101, 100, -179.8))
      .toEqual({ x: 100, y: 100, angle: 179.6 });
    // Genuinely turning across the wrap still releases it.
    expect(stabilizeLabelPosition('e', 101, 100, -177).angle).toBe(-177);
  });

  it('keeps edges separate and forgets them on clear', () => {
    stabilizeLabelPosition('a', 0, 0, 10);
    expect(stabilizeLabelPosition('b', 900, 900, 80)).toEqual({ x: 900, y: 900, angle: 80 });
    // 'a' is still held at its own position, not 'b's.
    expect(stabilizeLabelPosition('a', 2, 0, 10).x).toBe(0);

    clearLabelStabilization();
    expect(stabilizeLabelPosition('a', 2, 0, 10).x).toBe(2);
  });
});
