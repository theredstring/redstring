import { describe, it, expect } from 'vitest';
import { getPortPosition, calculateStaggeredPosition } from '../../src/utils/canvas/portPositioning.js';

const dims = (w, h) => ({ currentWidth: w, currentHeight: h });

// A default text-only node at nodeScale 1: 120*1.4 x 100*1.4, corner 40*1.4.
const TEXT_NODE = dims(168, 140);
const TEXT_CORNER = 56;
const node = { x: 1000, y: 500 };

describe('calculateStaggeredPosition centering', () => {
  it('puts a lone port exactly on the side midpoint (top)', () => {
    const base = getPortPosition(node, TEXT_NODE, 'top', TEXT_CORNER);
    const p = calculateStaggeredPosition(base, 'top', 0, TEXT_NODE, TEXT_CORNER, 24);
    // Regression: this used to return segmentStart + safeMargin, landing left of center.
    expect(p.x).toBe(node.x + TEXT_NODE.currentWidth / 2);
    expect(p.y).toBe(node.y);
  });

  it('puts a lone port exactly on the side midpoint (bottom)', () => {
    const base = getPortPosition(node, TEXT_NODE, 'bottom', TEXT_CORNER);
    const p = calculateStaggeredPosition(base, 'bottom', 0, TEXT_NODE, TEXT_CORNER, 24);
    expect(p.x).toBe(node.x + TEXT_NODE.currentWidth / 2);
    expect(p.y).toBe(node.y + TEXT_NODE.currentHeight);
  });

  it('puts a lone port exactly on the side midpoint (left/right)', () => {
    const wide = dims(600, 400);
    for (const side of ['left', 'right']) {
      const base = getPortPosition(node, wide, side, TEXT_CORNER);
      const p = calculateStaggeredPosition(base, side, 0, wide, TEXT_CORNER, 24);
      expect(p.y).toBe(node.y + wide.currentHeight / 2);
    }
  });

  it('straddles the midpoint symmetrically rather than the band edges', () => {
    // Wide enough that multiple lanes fit (usable run >= 100px).
    const wide = dims(600, 400);
    const base = getPortPosition(node, wide, 'top', TEXT_CORNER);
    const center = node.x + wide.currentWidth / 2;

    const p0 = calculateStaggeredPosition(base, 'top', 0, wide, TEXT_CORNER, 24);
    const p1 = calculateStaggeredPosition(base, 'top', 1, wide, TEXT_CORNER, 24);
    const p2 = calculateStaggeredPosition(base, 'top', 2, wide, TEXT_CORNER, 24);

    expect(p0.x).toBe(center);
    // Regression: indices 0 and 1 used to land on the far left and far right of
    // the usable band, leaving the middle of the side empty.
    expect(p1.x).toBeGreaterThan(center);
    expect(p2.x).toBeLessThan(center);
    // Symmetric fan-out.
    expect(p1.x - center).toBeCloseTo(center - p2.x, 6);
  });

  it('never places a port outside the straight-edge band', () => {
    const wide = dims(600, 400);
    const base = getPortPosition(node, wide, 'top', TEXT_CORNER);
    for (let i = 0; i < 12; i++) {
      const p = calculateStaggeredPosition(base, 'top', i, wide, TEXT_CORNER, 24);
      expect(p.x).toBeGreaterThanOrEqual(base.segmentStart);
      expect(p.x).toBeLessThanOrEqual(base.segmentEnd);
    }
  });

  it('centers a lone port when the side has no straight run', () => {
    // Text-only node: 140px tall against a 56px corner radius leaves no usable
    // left/right band at all, so the midpoint is the only sane attachment point.
    const base = getPortPosition(node, TEXT_NODE, 'left', TEXT_CORNER);
    const p = calculateStaggeredPosition(base, 'left', 0, TEXT_NODE, TEXT_CORNER, 24, 1);
    expect(p.x).toBe(node.x);
    expect(p.y).toBe(node.y + TEXT_NODE.currentHeight / 2);
  });

  it('still separates several ports when the side has no straight run', () => {
    // This case USED to collapse every port onto the midpoint, which is how
    // several connections between one pair of nodes ended up drawn as a single
    // line. With no band to work in, spilling a few pixels toward the rounded
    // corner is the lesser evil — the ports must stay distinct.
    const base = getPortPosition(node, TEXT_NODE, 'left', TEXT_CORNER);
    const ys = [0, 1, 2, 3].map(i =>
      calculateStaggeredPosition(base, 'left', i, TEXT_NODE, TEXT_CORNER, 24, 4).y
    );
    expect(new Set(ys).size).toBe(4);
    for (const y of ys) {
      expect(y).toBeGreaterThan(node.y);
      expect(y).toBeLessThan(node.y + TEXT_NODE.currentHeight);
    }
  });

  it('is deterministic for a given index', () => {
    const wide = dims(600, 400);
    const base = getPortPosition(node, wide, 'top', TEXT_CORNER);
    const a = calculateStaggeredPosition(base, 'top', 5, wide, TEXT_CORNER, 24);
    const b = calculateStaggeredPosition(base, 'top', 5, wide, TEXT_CORNER, 24);
    expect(a).toEqual(b);
  });
});
