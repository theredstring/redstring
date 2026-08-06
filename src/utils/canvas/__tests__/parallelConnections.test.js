/**
 * Multiple connections between the SAME two nodes must stay distinguishable in
 * every routing style.
 *
 * They are different connections — each has its own type, name, direction and
 * label — so a router that derives geometry from the two endpoints alone draws
 * the whole bundle as one line with N labels stacked on it. These tests measure
 * the thing that actually matters to a reader: how far apart the drawn paths
 * are at their midpoints, and whether two members ever coincide.
 */

import { describe, it, expect } from 'vitest';
import {
  generateManhattanRoutingPath,
  computeManhattanRouting,
  computeLombardiTangents,
  lombardiArcFor,
  sampleArc,
  arcPointAt,
  parallelLaneRank,
} from '../edgeRouting.js';
import { calculateParallelEdgePath } from '../parallelEdgeUtils.js';
import { calculateStaggeredPosition, getPortPosition } from '../portPositioning.js';

const DIMS = { currentWidth: 300, currentHeight: 200, scaledCornerRadius: 40 };
const dimsFor = () => ({ ...DIMS });

const nodeAt = (id, x, y) => ({ id, x, y });
const bundle = (n, sourceId = 'a', destinationId = 'b') =>
  Array.from({ length: n }, (_, i) => ({ id: `e${i}`, sourceId, destinationId }));

const curveInfoFor = (edges) =>
  new Map(edges.map((e, i) => [e.id, { pairIndex: i, totalInPair: edges.length }]));

/** What NodeCanvas's edgeCurveInfo memo produces: grouped by unordered pair. */
const curveInfoForPairs = (edges) => {
  const groups = new Map();
  for (const e of edges) {
    const key = [e.sourceId, e.destinationId].sort().join('-');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.id);
  }
  const out = new Map();
  groups.forEach(ids => ids.forEach((id, i) =>
    out.set(id, { pairIndex: i, totalInPair: ids.length })));
  return out;
};

/** Closest approach between two polylines, sampled at their vertices. */
const minVertexDistance = (a, b) => {
  let min = Infinity;
  for (const p of a) {
    for (const q of b) min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y));
  }
  return min;
};

const polylineLength = (pts) => {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return total;
};

/** Point a fraction `t` of the way along a polyline by arc length. */
const pointAlong = (pts, t) => {
  const target = polylineLength(pts) * t;
  let walked = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (walked + seg >= target) {
      const f = seg > 0 ? (target - walked) / seg : 0;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * f,
      };
    }
    walked += seg;
  }
  return pts[pts.length - 1];
};

/** Do two polylines share a point? Segment-intersection, endpoints excluded. */
const segmentsCross = (a, b) => {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const [p1, p2, p3, p4] = [a[i], a[i + 1], b[j], b[j + 1]];
      const d1 = cross(p3, p4, p1);
      const d2 = cross(p3, p4, p2);
      const d3 = cross(p1, p2, p3);
      const d4 = cross(p1, p2, p4);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
    }
  }
  return false;
};

describe('parallelLaneRank', () => {
  it('centres the fan on the route a lone connection would take', () => {
    expect(parallelLaneRank({ pairIndex: 0, totalInPair: 1 })).toBe(0);
    expect(parallelLaneRank(undefined)).toBe(0);
    expect([0, 1].map(i => parallelLaneRank({ pairIndex: i, totalInPair: 2 })))
      .toEqual([-0.5, 0.5]);
    expect([0, 1, 2].map(i => parallelLaneRank({ pairIndex: i, totalInPair: 3 })))
      .toEqual([-1, 0, 1]);
  });
});

describe('manhattan routing of a bundle', () => {
  const LANE = 50;

  const routeBundle = (count, source, dest, bends = 'auto') => {
    const edges = bundle(count);
    const info = curveInfoFor(edges);
    return edges.map(e => generateManhattanRoutingPath(
      e, source, dest, dimsFor(), dimsFor(), bends,
      { curveInfo: info.get(e.id), laneSpacing: LANE }
    ));
  };

  // The four quadrants plus the two axis-aligned degenerate cases: the lane
  // offsets have to invert with the route's direction of travel, so a bug there
  // shows up in half the quadrants and nowhere else.
  const PLACEMENTS = [
    ['right and down', nodeAt('a', 0, 0), nodeAt('b', 900, 500)],
    ['right and up', nodeAt('a', 0, 500), nodeAt('b', 900, 0)],
    ['left and down', nodeAt('a', 900, 0), nodeAt('b', 0, 500)],
    ['left and up', nodeAt('a', 900, 500), nodeAt('b', 0, 0)],
    ['straight across', nodeAt('a', 0, 0), nodeAt('b', 900, 0)],
    ['straight down', nodeAt('a', 0, 0), nodeAt('b', 0, 700)],
  ];

  for (const [label, source, dest] of PLACEMENTS) {
    it(`separates every member ${label}`, () => {
      const routes = routeBundle(3, source, dest);
      for (let i = 0; i < routes.length; i++) {
        for (let j = i + 1; j < routes.length; j++) {
          const gap = Math.hypot(
            pointAlong(routes[i], 0.5).x - pointAlong(routes[j], 0.5).x,
            pointAlong(routes[i], 0.5).y - pointAlong(routes[j], 0.5).y
          );
          expect(gap).toBeGreaterThan(1);
          expect(minVertexDistance(routes[i], routes[j])).toBeGreaterThan(1);
        }
      }
    });

    it(`nests rather than crosses ${label}`, () => {
      const routes = routeBundle(3, source, dest);
      for (let i = 0; i < routes.length; i++) {
        for (let j = i + 1; j < routes.length; j++) {
          expect(segmentsCross(routes[i], routes[j])).toBe(false);
        }
      }
    });
  }

  it('separates a bundle even when the user forces one bend', () => {
    // A one-bend route turns at a coordinate every lane shares, so the bundle
    // has to be promoted to the two-bend form to have a trunk to offset.
    const routes = routeBundle(2, nodeAt('a', 0, 0), nodeAt('b', 900, 500), 'one');
    expect(minVertexDistance(routes[0], routes[1])).toBeGreaterThan(1);
  });

  it('leaves a lone connection exactly where it was', () => {
    const source = nodeAt('a', 0, 0);
    const dest = nodeAt('b', 900, 500);
    const solo = generateManhattanRoutingPath(
      { id: 'e0' }, source, dest, dimsFor(), dimsFor(), 'auto',
      { curveInfo: { pairIndex: 0, totalInPair: 1 }, laneSpacing: LANE }
    );
    const unaware = generateManhattanRoutingPath(
      { id: 'e0' }, source, dest, dimsFor(), dimsFor(), 'auto'
    );
    expect(solo).toEqual(unaware);
  });

  it('keeps every port on the side the arrowhead is oriented for', () => {
    const source = nodeAt('a', 0, 0);
    const dest = nodeAt('b', 900, 40);
    const edges = bundle(5);
    const info = curveInfoFor(edges);
    for (const e of edges) {
      const routing = computeManhattanRouting(
        source, dest, dimsFor(), dimsFor(), 'auto',
        { curveInfo: info.get(e.id), laneSpacing: 400 }  // deliberately wider than the node
      );
      expect(routing.sourceSide).toBe('right');
      expect(routing.destSide).toBe('left');
      // Clamped into the node's straight side, clear of the rounded corners.
      expect(routing.startY).toBeGreaterThan(source.y);
      expect(routing.startY).toBeLessThan(source.y + DIMS.currentHeight);
    }
  });
});

/** Where each solved arc actually sits at the middle of its span. */
// The TRUE middle of the arc, via arcPointAt(0.5) — not a sampled vertex.
// sampleArc(arc, 32)[16] is one step past the middle, and which way "past" points
// depends on the direction of travel. Two arcs on the SAME circle traversed in
// opposite directions therefore came out ~130px apart, which is how an
// anti-parallel bundle that drew as a single line still passed these tests.
const midpointsOf = (solved) => solved.map(({ p, q, arc }) => (
  arc ? arcPointAt(arc, 0.5) : { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
));

describe('lombardi routing of a bundle', () => {
  const LANE = 100;
  const arcsFor = (nodes, edges, curvature = 1) => {
    const dims = new Map(nodes.map(n => [n.id, dimsFor()]));
    const tangents = computeLombardiTangents(nodes, edges, dims);
    const info = curveInfoForPairs(edges);
    return edges.map(e => lombardiArcFor(
      e,
      nodes.find(n => n.id === e.sourceId),
      nodes.find(n => n.id === e.destinationId),
      dimsFor(), dimsFor(), tangents, curvature,
      { curveInfo: info.get(e.id), laneSpacing: LANE }
    ));
  };

  it('gives equal-degree endpoints distinct arcs', () => {
    // The case that used to fail outright. With the tie broken the same way at
    // both ends, consecutive members differ by (stepA - stepB)/2 — identically
    // zero when the two nodes have the same degree, so both arcs came out as
    // the same circle.
    const nodes = [nodeAt('a', 0, 0), nodeAt('b', 900, 0)];
    const solved = arcsFor(nodes, bundle(2));
    const [one, two] = solved.map(s => s.arc);
    expect(one).toBeTruthy();
    expect(two).toBeTruthy();
    expect(Math.abs(one.cx - two.cx) + Math.abs(one.cy - two.cy)).toBeGreaterThan(1);
  });

  it('holds the members apart across the middle of the span', () => {
    for (const count of [2, 3, 4]) {
      const nodes = [nodeAt('a', 0, 0), nodeAt('b', 900, 200)];
      const mids = midpointsOf(arcsFor(nodes, bundle(count)));
      for (let i = 0; i < mids.length; i++) {
        for (let j = i + 1; j < mids.length; j++) {
          const gap = Math.hypot(mids[i].x - mids[j].x, mids[i].y - mids[j].y);
          expect(gap, `bundle of ${count}: members ${i} and ${j}`).toBeGreaterThan(8);
        }
      }
    }
  });

  it('separates them at unequal degrees too', () => {
    // b also connects to c, so deg(a)=2 and deg(b)=3 — the case that happened
    // to work before, and must keep working.
    const nodes = [nodeAt('a', 0, 0), nodeAt('b', 900, 0), nodeAt('c', 900, 600)];
    const edges = [...bundle(2), { id: 'e2', sourceId: 'b', destinationId: 'c' }];
    const mids = midpointsOf(arcsFor(nodes, edges).slice(0, 2));
    expect(Math.hypot(mids[0].x - mids[1].x, mids[0].y - mids[1].y)).toBeGreaterThan(8);
  });

  it('handles a bundle running the other way round', () => {
    // b→a as well as a→b: anti-parallel edges tie at both nodes too.
    const nodes = [nodeAt('a', 0, 0), nodeAt('b', 900, 0)];
    const edges = [
      { id: 'e0', sourceId: 'a', destinationId: 'b' },
      { id: 'e1', sourceId: 'b', destinationId: 'a' },
    ];
    const mids = midpointsOf(arcsFor(nodes, edges));
    expect(Math.hypot(mids[0].x - mids[1].x, mids[0].y - mids[1].y)).toBeGreaterThan(8);
  });

  it('draws the same fan whichever end each member was drawn from', () => {
    // The invariant behind bundleFrameSign, and the one that actually failed:
    // a bundle's lanes belong to the PAIR, not to either member's direction. The
    // bow is measured from the chord, so reversing a member reverses the
    // perpendicular it is measured against — which cancels its opposite lane rank
    // exactly and drops it onto its sibling's circle. Both connections then draw
    // as one line, with two labels stacked on it and nothing to click apart.
    const nodes = [nodeAt('a', 0, 0), nodeAt('b', 900, 200)];
    const sameWay = midpointsOf(arcsFor(nodes, bundle(2)));
    const bothWays = midpointsOf(arcsFor(nodes, [
      { id: 'e0', sourceId: 'a', destinationId: 'b' },
      { id: 'e1', sourceId: 'b', destinationId: 'a' },
    ]));

    for (let i = 0; i < 2; i++) {
      expect(bothWays[i].x, `lane ${i} x`).toBeCloseTo(sameWay[i].x, 6);
      expect(bothWays[i].y, `lane ${i} y`).toBeCloseTo(sameWay[i].y, 6);
    }
  });

  it('matches the lane order the straight styles give the same bundle', () => {
    // Switching routing style must not reshuffle which connection is which lane.
    // Both routers read bundleFrameSign, so their fans agree by construction —
    // this pins that they keep agreeing.
    const nodes = [nodeAt('a', 0, 0), nodeAt('b', 900, 200)];
    const edges = [
      { id: 'e0', sourceId: 'a', destinationId: 'b' },
      { id: 'e1', sourceId: 'b', destinationId: 'a' },
    ];
    const info = curveInfoForPairs(edges);
    const arcMids = midpointsOf(arcsFor(nodes, edges));

    const straightApexes = edges.map((e) => {
      const s = nodes.find(n => n.id === e.sourceId);
      const d = nodes.find(n => n.id === e.destinationId);
      const path = calculateParallelEdgePath(
        s.x + DIMS.currentWidth / 2, s.y + DIMS.currentHeight / 2,
        d.x + DIMS.currentWidth / 2, d.y + DIMS.currentHeight / 2,
        info.get(e.id), LANE * 2 // a quadratic's apex sits at half its control offset
      );
      return { x: path.apexX, y: path.apexY };
    });

    // Same side of the chord for each member — compare the sign of the offset
    // from the chord midpoint rather than the magnitudes, which the two styles
    // are not obliged to match exactly.
    const chordMid = { x: 450 + DIMS.currentWidth / 2, y: 100 + DIMS.currentHeight / 2 };
    for (let i = 0; i < 2; i++) {
      expect(Math.sign(arcMids[i].y - chordMid.y), `lane ${i} side`)
        .toBe(Math.sign(straightApexes[i].y - chordMid.y));
    }
  });

  it('draws the same fan whatever order the bundle is listed in', () => {
    // Which member takes which lane follows pairIndex, exactly as it does in the
    // straight styles — so re-ordering the list swaps two connections' lanes.
    // The FAN itself must not change: same arcs, same positions, just reassigned.
    const nodes = [nodeAt('a', 0, 0), nodeAt('b', 900, 200)];
    const edges = bundle(3);
    const byX = (mids) => mids.map(m => m.x).sort((a, b) => a - b);
    expect(byX(midpointsOf(arcsFor(nodes, [...edges].reverse()))))
      .toEqual(byX(midpointsOf(arcsFor(nodes, edges))));
  });

  it('orders the lanes by pairIndex', () => {
    // Monotonic, so the fan reads as a fan rather than a shuffle, and adding a
    // connection doesn't reorder the ones already drawn.
    const nodes = [nodeAt('a', 0, 0), nodeAt('b', 900, 0)];
    const ys = midpointsOf(arcsFor(nodes, bundle(5))).map(m => m.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  });
});

describe('clean routing ports for a bundle', () => {
  const stagger = (count) => {
    const base = getPortPosition(nodeAt('a', 0, 0), DIMS, 'right', DIMS.scaledCornerRadius);
    return Array.from({ length: count }, (_, i) =>
      calculateStaggeredPosition(base, 'right', i, DIMS, DIMS.scaledCornerRadius, 100, count)
    );
  };

  it('gives every connection on a side its own port', () => {
    // The stagger used to take the index MODULO however many ports fit at the
    // preferred spacing, so a side carrying more edges than that folded them
    // back onto ports already in use — several connections, one visible line.
    for (const count of [2, 3, 5, 9]) {
      const ys = stagger(count).map(p => p.y);
      expect(new Set(ys.map(y => y.toFixed(4))).size, `${count} on a side`).toBe(count);
    }
  });

  it('keeps a lone connection on the centre of the side', () => {
    const [only] = stagger(1);
    expect(only.y).toBeCloseTo(DIMS.currentHeight / 2, 6);
  });

  it('keeps every port on the node it belongs to', () => {
    for (const count of [2, 5, 12]) {
      for (const port of stagger(count)) {
        expect(port.y).toBeGreaterThanOrEqual(0);
        expect(port.y).toBeLessThanOrEqual(DIMS.currentHeight);
      }
    }
  });

  it('keeps the first connection on the centre as others join it', () => {
    // Slot 0 is the centre and stays there, so adding a second connection to a
    // pair doesn't shift the one that was already drawn.
    for (const count of [1, 2, 3, 6]) {
      expect(stagger(count)[0].y).toBeCloseTo(DIMS.currentHeight / 2, 6);
    }
  });
});
