import { describe, it, expect } from 'vitest';
import {
  MIN_BOX,
  boxOf,
  nodeBox,
  halfExtentTowards,
  circumRadius,
  estimateEdgeLabelWidth,
  requiredEdgeLength,
  getPointSegmentDistSq,
  densify,
  boxMTV,
  polylineBoxMTV,
  segmentBoxMTV
} from '../layoutGeometry.js';

const n = (width, height) => ({ id: 'n', width, height, labelWidth: width });
const CFG = { edgeLabelFontSize: 59.4, minEdgeLength: 260, labelPadding: 90, nodeGap: 140 };

describe('boxOf / nodeBox', () => {
  it('floors both dimensions at MIN_BOX', () => {
    expect(boxOf({ width: 10, height: 10 })).toEqual({ w: MIN_BOX, h: MIN_BOX });
    expect(boxOf(null)).toEqual({ w: MIN_BOX, h: MIN_BOX });
  });

  it('takes the larger of width and labelWidth', () => {
    expect(boxOf({ width: 100, labelWidth: 400, height: 80 }).w).toBe(400);
  });

  it('keeps width and height independent — the whole point of the box model', () => {
    const { hw, hh } = nodeBox(n(600, 100));
    expect(hw).toBe(300);
    expect(hh).toBe(50);
  });

  it('applies padding and the image allowance', () => {
    const box = nodeBox({ width: 200, height: 100, imageHeight: 40 }, { boxPadding: 10 });
    expect(box.hw).toBe(110);
    expect(box.hh).toBe(60 + 20); // 50 + pad 10 + 40*0.5
  });
});

describe('halfExtentTowards', () => {
  const wide = n(600, 100);

  it('returns the half-width along the horizontal axis', () => {
    expect(halfExtentTowards(wide, 1, 0)).toBe(300);
  });

  it('returns the half-height along the vertical axis', () => {
    expect(halfExtentTowards(wide, 0, 1)).toBe(50);
  });

  it('is sign-independent', () => {
    expect(halfExtentTowards(wide, -1, 0)).toBe(halfExtentTowards(wide, 1, 0));
    expect(halfExtentTowards(wide, 0, -1)).toBe(halfExtentTowards(wide, 0, 1));
  });

  it('never exceeds the circumradius in any direction', () => {
    const r = circumRadius(wide);
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      expect(halfExtentTowards(wide, Math.cos(a), Math.sin(a))).toBeLessThanOrEqual(r + 1e-9);
    }
  });

  it('is what a single radius gets wrong: 6x smaller vertically than circumradius', () => {
    // The concrete reason getNodeRadius over-reserves. A 600x100 node needs
    // 50px of vertical clearance and reserves ~304.
    expect(circumRadius(wide) / halfExtentTowards(wide, 0, 1)).toBeGreaterThan(6);
  });
});

describe('requiredEdgeLength', () => {
  it('is monotonic in label length', () => {
    const a = n(200, 100);
    const b = n(200, 100);
    const short = requiredEdgeLength(a, b, { name: 'is' }, CFG, 1, 0);
    const long = requiredEdgeLength(a, b, { name: 'influenced the development of' }, CFG, 1, 0);
    expect(long).toBeGreaterThan(short);
  });

  it('is direction-aware for anisotropic nodes', () => {
    const wide = n(600, 100);
    const horizontal = requiredEdgeLength(wide, wide, { name: '' }, CFG, 1, 0);
    const vertical = requiredEdgeLength(wide, wide, { name: '' }, CFG, 0, 1);
    expect(horizontal).toBeGreaterThan(vertical);
  });

  it('never returns less than minEdgeLength', () => {
    const tiny = n(10, 10);
    expect(requiredEdgeLength(tiny, tiny, { name: '' }, CFG, 1, 0)).toBeGreaterThanOrEqual(CFG.minEdgeLength);
  });
});

describe('estimateEdgeLabelWidth', () => {
  it('is zero for an empty label', () => {
    expect(estimateEdgeLabelWidth('')).toBe(0);
    expect(estimateEdgeLabelWidth(null)).toBe(0);
  });

  it('grows with text length', () => {
    expect(estimateEdgeLabelWidth('abcd')).toBeGreaterThan(estimateEdgeLabelWidth('ab'));
  });
});

describe('getPointSegmentDistSq', () => {
  it('clamps t to the segment', () => {
    expect(getPointSegmentDistSq(-100, 0, 0, 0, 100, 0).t).toBe(0);
    expect(getPointSegmentDistSq(200, 0, 0, 0, 100, 0).t).toBe(1);
  });

  it('handles a degenerate zero-length segment', () => {
    const r = getPointSegmentDistSq(3, 4, 0, 0, 0, 0);
    expect(r.distSq).toBe(25);
    expect(r.t).toBe(0);
  });

  it('finds the perpendicular foot', () => {
    const r = getPointSegmentDistSq(50, 30, 0, 0, 100, 0);
    expect(r.closestX).toBe(50);
    expect(r.closestY).toBe(0);
    expect(r.distSq).toBe(900);
  });
});

describe('densify', () => {
  it('never leaves a gap larger than step', () => {
    const out = densify([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 30);
    for (let i = 1; i < out.length; i++) {
      expect(Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y)).toBeLessThanOrEqual(30 + 1e-9);
    }
  });

  it('preserves the endpoints', () => {
    const out = densify([{ x: 0, y: 0 }, { x: 100, y: 50 }], 30);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1].x).toBeCloseTo(100);
    expect(out[out.length - 1].y).toBeCloseTo(50);
  });

  it('passes through degenerate input', () => {
    expect(densify([], 30)).toEqual([]);
    expect(densify(null, 30)).toEqual([]);
  });
});

describe('boxMTV', () => {
  const box = { hw: 50, hh: 50 };

  it('returns null when the boxes are already clear', () => {
    expect(boxMTV({ x: 0, y: 0 }, box, { x: 500, y: 0 }, box, 0)).toBe(null);
  });

  it('resolves along the axis that needs the least movement', () => {
    // Deeply overlapping in x, barely in y → push along y.
    const mtv = boxMTV({ x: 0, y: 0 }, box, { x: 5, y: 95 }, box, 0);
    expect(mtv.dx).toBe(0);
    expect(mtv.dy).toBeGreaterThan(0);
  });

  it('separates completely when applied', () => {
    const pA = { x: 0, y: 0 };
    const pB = { x: 20, y: 30 };
    const mtv = boxMTV(pA, box, pB, box, 0);
    const moved = { x: pB.x + mtv.dx, y: pB.y + mtv.dy };
    expect(boxMTV(pA, box, moved, box, 0)).toBe(null);
  });

  it('honours the gap', () => {
    const mtv = boxMTV({ x: 0, y: 0 }, box, { x: 120, y: 0 }, box, 40);
    expect(mtv).not.toBe(null);
    expect(mtv.depth).toBeCloseTo(20);
  });

  it('picks a deterministic axis for coincident centres', () => {
    const a = boxMTV({ x: 0, y: 0 }, box, { x: 0, y: 0 }, box, 0);
    const b = boxMTV({ x: 0, y: 0 }, box, { x: 0, y: 0 }, box, 0);
    expect(a).toEqual(b);
    expect(a.depth).toBeGreaterThan(0);
  });
});

describe('polylineBoxMTV', () => {
  const center = { x: 0, y: 0 };
  const box = { hw: 100, hh: 50 };

  it('returns null for a path that clears the box', () => {
    const pts = densify([{ x: -500, y: 300 }, { x: 500, y: 300 }], 30);
    expect(polylineBoxMTV(pts, center, box, 0)).toBe(null);
  });

  it('clears a path running straight through the box', () => {
    const pts = densify([{ x: -500, y: 0 }, { x: 500, y: 0 }], 30);
    const mtv = polylineBoxMTV(pts, center, box, 0);
    expect(mtv).not.toBe(null);
    // Horizontal line through the middle: the normal is vertical, so the push
    // is too. (toBeCloseTo, not toBe — the normal's x component is a signed 0.)
    expect(mtv.dx).toBeCloseTo(0);
    expect(Math.abs(mtv.dy)).toBeCloseTo(50);
  });

  it('moves the node away from the path, not into it', () => {
    // Path grazes the top of the box; the node must move DOWN (+y).
    const pts = densify([{ x: -500, y: -40 }, { x: 500, y: -40 }], 30);
    const mtv = polylineBoxMTV(pts, center, box, 0);
    expect(mtv.dy).toBeGreaterThan(0);
  });

  it('applying the vector actually clears the box', () => {
    const pts = densify([{ x: -500, y: 10 }, { x: 500, y: 10 }], 5);
    const mtv = polylineBoxMTV(pts, center, box, 0);
    const moved = { x: center.x + mtv.dx, y: center.y + mtv.dy };
    expect(polylineBoxMTV(pts, moved, box, 0)).toBe(null);
  });

  it('respects extra padding', () => {
    const pts = densify([{ x: -500, y: 80 }, { x: 500, y: 80 }], 30);
    expect(polylineBoxMTV(pts, center, box, 0)).toBe(null);
    expect(polylineBoxMTV(pts, center, box, 40)).not.toBe(null);
  });

  it('handles degenerate input', () => {
    expect(polylineBoxMTV([], center, box, 0)).toBe(null);
    expect(polylineBoxMTV(null, center, box, 0)).toBe(null);
  });

  it('does not slip a node between two distant polyline vertices', () => {
    // Segment testing, not point sampling: these two vertices are 1000px
    // apart and the box sits squarely between them.
    const pts = [{ x: -500, y: 0 }, { x: 500, y: 0 }];
    expect(polylineBoxMTV(pts, center, box, 0)).not.toBe(null);
  });

  it('converges on a STEEP edge instead of sliding along it', () => {
    // The regression this whole normal-direction rewrite exists for. A steep
    // line through a wide flat box has a small vertical penetration, so an
    // axis-aligned "shortest way out" picks vertical — which is nearly
    // parallel to the line, so the node slides along the edge and never
    // clears. Iterating must terminate.
    const wide = { hw: 145, hh: 50 };
    const path = [{ x: 4808, y: 5566 }, { x: 4184, y: 4239 }];
    let c = { x: 4557, y: 4950 };

    let iterations = 0;
    while (iterations < 25) {
      const mtv = polylineBoxMTV(path, c, wide, 0);
      if (!mtv) break;
      c = { x: c.x + mtv.dx, y: c.y + mtv.dy };
      iterations++;
    }

    expect(polylineBoxMTV(path, c, wide, 0)).toBe(null);
    expect(iterations).toBeLessThanOrEqual(2);
  });
});

describe('segmentBoxMTV', () => {
  const box = { hw: 100, hh: 50 };
  const center = { x: 0, y: 0 };

  it('ignores a line whose infinite extension would hit but whose segment does not', () => {
    // Segment ends well to the left of the box; the line through it crosses.
    expect(segmentBoxMTV(-900, 0, -400, 0, center, box, 0)).toBe(null);
  });

  it('uses the box support function, so orientation matters', () => {
    // Same box, same distance, different line orientation: a vertical line
    // must be 100px away to clear, a horizontal one only 50px.
    expect(segmentBoxMTV(-500, 70, 500, 70, center, box, 0)).toBe(null);   // horizontal, 70 > hh
    expect(segmentBoxMTV(70, -500, 70, 500, center, box, 0)).not.toBe(null); // vertical, 70 < hw
  });

  it('pushes perpendicular to the segment', () => {
    // 45-degree line through the origin → push along (±1,∓1)/√2.
    const mtv = segmentBoxMTV(-500, -500, 500, 500, center, box, 0);
    expect(mtv).not.toBe(null);
    expect(Math.abs(Math.abs(mtv.dx) - Math.abs(mtv.dy))).toBeLessThan(1e-6);
  });

  it('clears in a single application', () => {
    const mtv = segmentBoxMTV(-500, 10, 500, 10, center, box, 0);
    const moved = { x: center.x + mtv.dx, y: center.y + mtv.dy };
    expect(segmentBoxMTV(-500, 10, 500, 10, moved, box, 0)).toBe(null);
  });

  it('handles a degenerate zero-length segment', () => {
    expect(segmentBoxMTV(0, 0, 0, 0, center, box, 0)).not.toBe(null);
    expect(segmentBoxMTV(900, 900, 900, 900, center, box, 0)).toBe(null);
  });
});
