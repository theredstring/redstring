import { describe, it, expect } from 'vitest';
import {
  quantizeAngle,
  estimateTextWidth,
  labelBoundsFor,
  chooseRoutedLabelPlacement,
  placeLabelOnRoute,
  getVisibleObstacleRects,
} from '../../src/utils/canvas/edgeLabelPlacement.js';
import {
  computeLombardiTangents,
  computeLombardiRouting,
  LOMBARDI_LANE_FRACTION,
  POLY_TIP,
} from '../../src/utils/canvas/edgeRouting.js';
import { getNodeHitbox } from '../../src/utils/canvas/nodeHitbox.js';

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

describe('label angle quantum (the renderer\'s style-gated bucket size)', () => {
  // Mirrors NodeCanvas's `labelAngleQuantum`. Kept here so the properties the
  // constants claim are checked rather than asserted in a comment.
  const LABEL_ANGLE_QUANTUM = 4.5;
  const LABEL_ANGLE_QUANTUM_MIN_COUNT = 80;

  const ALWAYS_STYLES = new Set(['lombardi']);

  const quantumFor = (visibleLabels, style = 'straight') => {
    if (ALWAYS_STYLES.has(style)) return LABEL_ANGLE_QUANTUM;
    return visibleLabels <= LABEL_ANGLE_QUANTUM_MIN_COUNT ? 0 : LABEL_ANGLE_QUANTUM;
  };

  // The formula this replaced, reproduced so the bug it caused stays pinned
  // rather than described. It derived the bucket from zoom via a 3px budget on
  // how far snapping may displace a label's far end.
  const legacyQuantumFor = (zoom) => {
    const halfWidthOnScreen = 150 * zoom;
    const wanted = halfWidthOnScreen > 3
      ? Math.min(9, 2 * Math.asin(3 / halfWidthOnScreen) * (180 / Math.PI))
      : 9;
    return 90 / Math.max(1, Math.ceil(90 / wanted));
  };

  it('leaves angles exact below the count gate, so a label lies along its line', () => {
    // The whole point of the gate. Under it there is no tilt to see at all.
    for (const count of [0, 1, 12, 47, 48, 79, LABEL_ANGLE_QUANTUM_MIN_COUNT]) {
      expect(quantumFor(count)).toBe(0);
      for (let a = -90; a <= 90; a += 3.1) {
        expect(quantizeAngle(a, quantumFor(count))).toBe(a);
      }
    }
  });

  it('snaps once there are enough labels on screen to trouble the atlas', () => {
    for (const count of [81, 120, 200, 500]) {
      expect(quantumFor(count)).toBe(LABEL_ANGLE_QUANTUM);
    }
  });

  it('snaps lombardi at every count, gate or no gate', () => {
    // Lombardi is the style that actually mints rotations — one per character
    // while curved, an arbitrary chord angle once the zoom flattens the bow —
    // so it is gated by style rather than by population.
    for (const count of [0, 1, 12, 48, 79, 80, 81, 200]) {
      expect(quantumFor(count, 'lombardi')).toBe(LABEL_ANGLE_QUANTUM);
    }
  });

  it('leaves straight and manhattan exact below the gate', () => {
    // Straight mints one rotation per label, which is mild enough that lying
    // exactly along the line is worth more than the buckets. Manhattan sits on
    // 0/90, where the snap is a no-op either way.
    for (const style of ['straight', 'manhattan', 'clean']) {
      expect(quantumFor(48, style)).toBe(0);
      expect(quantumFor(80, style)).toBe(0);
      expect(quantumFor(81, style)).toBe(LABEL_ANGLE_QUANTUM);
    }
  });

  it('does not vary with zoom — a label may not rotate while its line holds still', () => {
    // The reported bug. The legacy bucket changed on every zoom, so each label
    // re-rounded to a different angle even though nothing about the edge moved:
    // over an ordinary working range a typical label swung by degrees, and the
    // sign flipped, which reads as wobble rather than drift.
    const zooms = [0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5, 2];
    const trueAngle = 37.4;

    const legacy = zooms.map((z) => quantizeAngle(trueAngle, legacyQuantumFor(z)));
    expect(Math.max(...legacy) - Math.min(...legacy)).toBeGreaterThan(2);

    // The count is what it is at a given moment; the zoom must not enter into
    // it. Same count, every zoom, one rendered angle.
    const current = zooms.map(() => quantizeAngle(trueAngle, quantumFor(200)));
    expect(new Set(current).size).toBe(1);
  });

  it('divides 90, so manhattan labels stay on their exact axes', () => {
    // The mode that was already fast must not be made slower or crooked.
    const q = quantumFor(200);
    expect(90 / q).toBeCloseTo(Math.round(90 / q), 9);
    expect(quantizeAngle(90, q)).toBeCloseTo(90, 9);
    expect(quantizeAngle(0, q)).toBe(0);
  });

  it('tilts a label by at most half a quantum', () => {
    const q = quantumFor(200);
    for (let a = -90; a <= 90; a += 0.05) {
      expect(Math.abs(quantizeAngle(a, q) - a)).toBeLessThanOrEqual(q / 2 + 1e-9);
    }
  });

  it('collapses the angles far enough to be worth doing at all', () => {
    // The mechanism is atlas slots, not the bucket size in the abstract: what
    // has to be true is that a full sweep of angles lands in a handful of
    // distinct rotations. 20 divisions either side of zero, plus zero itself.
    const buckets = new Set();
    for (let a = -90; a < 90; a += 0.05) buckets.add(quantizeAngle(a, quantumFor(200)));
    expect(buckets.size).toBe(41);
  });

  it('keeps the worst tilt inside what a label can wear over its own line', () => {
    // The reason this is 4.5 and not the 9 that reaches the 120Hz floor: a
    // label sits ON its connection, so the eye is judging two adjacent lines
    // for parallelism rather than judging the text in isolation.
    expect(LABEL_ANGLE_QUANTUM / 2).toBeLessThanOrEqual(2.25);
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

describe('a straight Lombardi connection centres its label on what is visible', () => {
  // A subgraph of a single triplet is the case: both nodes are degree 1, so
  // each one's single tangent slot lands on the bearing to the other, the two
  // demands cancel, and solveLombardiArc emits a LINE. The label then had no
  // arc to ride and was placed on the raw centre-to-centre chord — whose
  // midpoint is the middle of the visible run only when both nodes are the same
  // size along it.
  const FONT = 59.4;
  const NAME = 'is a kind of';

  // Deliberately lopsided: 'b' is nearly three times as wide as 'a', so the
  // chord midpoint and the visible midpoint are ~200px apart.
  const NODES = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1600, y: 0 }];
  const DIMS = new Map([
    ['a', { currentWidth: 260, currentHeight: 130 }],
    ['b', { currentWidth: 740, currentHeight: 130 }],
  ]);

  const route = (arrows = []) => {
    const edge = {
      id: 'e1', sourceId: 'a', destinationId: 'b',
      directionality: { arrowsToward: new Set(arrows) },
    };
    const tangents = computeLombardiTangents(NODES, [edge], DIMS);
    return {
      edge,
      routing: computeLombardiRouting(
        edge, NODES[0], NODES[1], DIMS.get('a'), DIMS.get('b'), tangents,
        { curvature: 1, selectedInstanceIds: new Set(), connectionWidth: 1 }
      ),
    };
  };

  // Where the connection emerges from each node — the ends of the run a reader
  // can actually see, and what the straight/curved styles centre on.
  const visibleMidX = () => {
    const a = getNodeHitbox(NODES[0], DIMS.get('a'), false).maxX;
    const b = getNodeHitbox(NODES[1], DIMS.get('b'), false).minX;
    return (a + b) / 2;
  };
  const chordMidX = () => (
    (NODES[0].x + DIMS.get('a').currentWidth / 2 + NODES[1].x + DIMS.get('b').currentWidth / 2) / 2
  );

  const place = (routing, edge) => chooseRoutedLabelPlacement(
    routing, NAME, NODES, new Set(['a', 'b']), DIMS,
    new Map(), FONT, edge.id, new Set(), { obstacles: [], segmentIndex: null }
  );

  it('is a line, not an arc', () => {
    expect(route().routing.arc).toBeNull();
  });

  it('lands on the visible midpoint rather than the chord midpoint', () => {
    const { routing, edge } = route();
    // The two are far enough apart that this cannot pass by coincidence.
    expect(Math.abs(visibleMidX() - chordMidX())).toBeGreaterThan(100);
    expect(place(routing, edge).x).toBeCloseTo(visibleMidX(), 6);
  });

  it('centres on the run an arrowhead leaves, not on the border it points at', () => {
    // An arrowhead's TIP sits on the border, but the triangle behind it reaches
    // 2·POLY_TIP·cw further back along the connection — 68px at width 1, and
    // three times that at the widths the slider allows. That stretch is outside
    // every node box, so nothing in the obstacle set covers it; a label centred
    // border-to-border simply sat on top of the head, and the ladder could park
    // one squarely on it. So an arrowed end's run stops at the rear edge, and
    // the label centres on what is left.
    const head = 2 * POLY_TIP; // connectionWidth 1
    for (const [arrows, shift] of [
      [[], 0],                    // no arrows: the whole border-to-border run
      [['b'], -head / 2],         // dest arrow eats the far end, label backs off
      [['a'], head / 2],
      [['a', 'b'], 0],            // both ends eaten equally: centred again
    ]) {
      const { routing, edge } = route(arrows);
      expect(place(routing, edge).x, `arrows ${JSON.stringify(arrows)}`)
        .toBeCloseTo(visibleMidX() + shift, 6);
    }
  });

  it('keeps the label level along the connection', () => {
    const { routing, edge } = route();
    expect(place(routing, edge).angle).toBeCloseTo(0, 6);
    expect(place(routing, edge).y).toBeCloseTo(65, 6);
  });

  it('hands the drag the same polyline the full solve used', () => {
    // The per-frame placer re-evaluates the settled solve's anchor. Measured
    // against a different polyline it would resolve somewhere else, and the
    // label would jump the instant a node was picked up.
    const { routing, edge } = route();
    const solved = place(routing, edge);
    const carried = placeLabelOnRoute(routing, solved.anchor);
    expect(carried.x).toBeCloseTo(solved.x, 6);
    expect(carried.y).toBeCloseTo(solved.y, 6);
  });

  it('falls back to the full chord when the nodes overlap', () => {
    // Nothing is visible to centre on; the chord at least keeps the label near
    // the connection instead of collapsing it onto a degenerate sliver.
    const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 }];
    const dims = new Map([
      ['a', { currentWidth: 260, currentHeight: 130 }],
      ['b', { currentWidth: 260, currentHeight: 130 }],
    ]);
    const edge = {
      id: 'e1', sourceId: 'a', destinationId: 'b',
      directionality: { arrowsToward: new Set() },
    };
    const routing = computeLombardiRouting(
      edge, nodes[0], nodes[1], dims.get('a'), dims.get('b'),
      computeLombardiTangents(nodes, [edge], dims),
      { curvature: 1, selectedInstanceIds: new Set(), connectionWidth: 1 }
    );
    expect(routing.labelPoints).toEqual([
      { x: 130, y: 65 },
      { x: 170, y: 65 },
    ]);
  });
});

describe('estimateTextWidth', () => {
  it('scales with both length and font size', () => {
    expect(estimateTextWidth('abcd', 20)).toBeGreaterThan(estimateTextWidth('ab', 20));
    expect(estimateTextWidth('abcd', 40)).toBeGreaterThan(estimateTextWidth('abcd', 20));
  });
});
