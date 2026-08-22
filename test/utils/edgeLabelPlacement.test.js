import { describe, it, expect } from 'vitest';
import {
  quantizeAngle,
  estimateTextWidth,
  labelBoundsFor,
  chooseRoutedLabelPlacement,
  getVisibleObstacleRects,
} from '../../src/utils/canvas/edgeLabelPlacement.js';
import {
  computeLombardiTangents,
  computeLombardiRouting,
  LOMBARDI_LANE_FRACTION,
} from '../../src/utils/canvas/edgeRouting.js';

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
  // 3px, not the old 12: at 12 the formula sat at the 9-degree ceiling for every
  // zoom up to ~1, a visible tilt on every label of a dense graph. See the
  // constant's comment in NodeCanvas.
  const LABEL_ANGLE_ERROR_PX = 3;
  const LABEL_HALF_WIDTH_CANVAS = 150;
  const MAX_LABEL_ANGLE_QUANTUM = 9;

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
    expect(quantumFor(0.15)).toBeCloseTo(9, 6);
    const buckets = new Set();
    for (let a = -90; a < 90; a += 0.05) buckets.add(quantizeAngle(a, quantumFor(0.15)));
    // 10 divisions either side of zero, plus zero itself.
    expect(buckets.size).toBe(21);
  });

  it('stays fine at working zooms and only reaches the cap when the tilt is sub-budget', () => {
    // The old assertion here was the inverse — cap at every zoom up to 1 —
    // encoded when the 12px error budget existed to make the coarse bucket
    // reachable for the glyph atlas. That read as every label visibly tilted at
    // ordinary zooms. At the 3px budget the bucket is gentle where the viewer
    // can see and coarsens smoothly on the way out, hitting the cap only below
    // zoom ~0.26 where 3px on screen still bounds the displacement.
    expect(quantumFor(1)).toBeLessThanOrEqual(2.5);
    expect(quantumFor(0.5)).toBeLessThanOrEqual(5);
    expect(quantumFor(0.5)).toBeGreaterThan(quantumFor(1));
    expect(quantumFor(0.15)).toBeCloseTo(MAX_LABEL_ANGLE_QUANTUM, 6);
    expect(quantumFor(0.1)).toBeCloseTo(MAX_LABEL_ANGLE_QUANTUM, 6);
    // Zooming in keeps tightening toward exact.
    expect(quantumFor(2)).toBeLessThan(quantumFor(1));
    expect(quantumFor(4)).toBeLessThan(quantumFor(2));
  });
});

describe('labelBoundsFor (the box a rotated label actually occupies)', () => {
  const W = 392;
  const H = 59;
  const extent = (angle) => {
    const r = labelBoundsFor(0, 0, W, H, angle);
    return { w: r.maxX - r.minX, h: r.maxY - r.minY };
  };

  it('is exact on the axes, where the old snap-to-axis box was already right', () => {
    expect(extent(0).w).toBeCloseTo(W, 6);
    expect(extent(0).h).toBeCloseTo(H, 6);
    expect(extent(90).w).toBeCloseTo(H, 6);
    expect(extent(90).h).toBeCloseTo(W, 6);
    expect(extent(180).w).toBeCloseTo(W, 6);
    expect(extent(-90).h).toBeCloseTo(W, 6);
  });

  it('accounts for the tilt off the axes, where it did not', () => {
    // The regression, in one number: a Lombardi label on a shallow arc. The
    // old box claimed the bare text height; the real one is over twice that,
    // which is the difference between "these two lanes are clear of each
    // other" and "these two labels are drawn on top of each other".
    const { h } = extent(12);
    expect(h).toBeCloseTo(W * Math.sin(12 * Math.PI / 180) + H * Math.cos(12 * Math.PI / 180), 6);
    expect(h).toBeGreaterThan(2 * H);
  });

  it('never claims less room than the un-rotated text', () => {
    for (let a = -180; a <= 180; a += 3.5) {
      const { w, h } = extent(a);
      expect(Math.max(w, h)).toBeGreaterThanOrEqual(Math.min(W, H) - 1e-9);
      expect(w).toBeGreaterThanOrEqual(H - 1e-9);
      expect(h).toBeGreaterThanOrEqual(H - 1e-9);
    }
  });

  it('is symmetric under a half turn and under mirroring', () => {
    for (const a of [7, 23.5, 61, 88]) {
      expect(extent(a).h).toBeCloseTo(extent(a + 180).h, 9);
      expect(extent(a).h).toBeCloseTo(extent(-a).h, 9);
    }
  });
});

describe('parallel connections between the same two nodes', () => {
  // Their arcs are fanned a fixed lane apart, so they are the case where an
  // understated label box shows up as labels drawn on top of one another.
  const FONT = 59.4;
  const laneSpacing = 200 * LOMBARDI_LANE_FRACTION;
  const NAMES = ['contains', 'is a kind of', 'depends upon', 'refers to'];

  const place = (k) => {
    const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1400, y: 300 }];
    const dims = new Map([
      ['a', { currentWidth: 340, currentHeight: 130 }],
      ['b', { currentWidth: 340, currentHeight: 130 }],
    ]);
    const edges = Array.from({ length: k }, (_, i) => ({
      id: `e${i}`, sourceId: 'a', destinationId: 'b',
      directionality: { arrowsToward: new Set() },
    }));
    const tangents = computeLombardiTangents(nodes, edges, dims);
    const visible = new Set(['a', 'b']);
    const obstacles = getVisibleObstacleRects(nodes, visible, dims, 18, new Set());
    const placed = new Map();

    return edges.map((edge, i) => {
      const routing = computeLombardiRouting(
        edge, nodes[0], nodes[1], dims.get('a'), dims.get('b'), tangents,
        { curvature: 1, selectedInstanceIds: new Set(), laneSpacing,
          curveInfo: { pairIndex: i, totalInPair: k } }
      );
      const p = chooseRoutedLabelPlacement(routing, NAMES[i], nodes, visible, dims,
        placed, FONT, edge.id, new Set(), { obstacles, segmentIndex: null });
      const rect = labelBoundsFor(p.x, p.y, estimateTextWidth(NAMES[i], FONT), FONT * 1.1, p.angle);
      placed.set(edge.id, { rect, position: { x: p.x, y: p.y, angle: p.angle } });
      return { ...p, rect };
    });
  };

  const overlaps = (a, b) => !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);

  for (const k of [2, 3, 4]) {
    it(`keeps ${k} labels clear of each other`, () => {
      const out = place(k);
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          expect(overlaps(out[i].rect, out[j].rect)).toBe(false);
        }
      }
    });
  }

  it('spreads them instead of leaving every one at its arc midpoint', () => {
    // The failure mode was that nothing ever registered a collision, so every
    // label took the first candidate on the ladder — dead centre, no radial
    // offset — and the bundle drew as one stack of text. Which axis the placer
    // spreads them on is its business (along the arc when nothing is crossing,
    // radially when something is); that they are no longer all at the same
    // anchor is the invariant.
    const out = place(4);
    const anchors = out.map(p => `${p.anchor.t.toFixed(3)}@${p.anchor.offset}`);
    expect(new Set(anchors).size).toBe(anchors.length);
  });
});

describe('estimateTextWidth', () => {
  it('scales with both length and font size', () => {
    expect(estimateTextWidth('abcd', 20)).toBeGreaterThan(estimateTextWidth('ab', 20));
    expect(estimateTextWidth('abcd', 40)).toBeGreaterThan(estimateTextWidth('abcd', 20));
  });
});
