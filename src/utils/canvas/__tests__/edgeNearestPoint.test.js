/**
 * The hit test reports WHERE on a connection the pointer is nearest, not just
 * how far away it is.
 *
 * The controller's auto-aim drifts the camera so that point lands under the
 * crosshair. It used to compute the point itself, by projecting onto the chord
 * between the two endpoints — correct for a plain straight line, a fiction for
 * every curved or routed style. In Lombardi mode the arc bows well clear of its
 * chord, so the camera confidently walked to a patch of empty canvas beside the
 * connection the user was looking at.
 *
 * So what these tests are really asserting is a single property, per style: the
 * reported point lies ON the drawn geometry. `distance` alone cannot catch a
 * regression here — the old code got the distance right and the point wrong.
 */

import { describe, it, expect } from 'vitest';
import {
  computeLombardiTangents,
  lombardiArcFor,
  distanceToArc,
  sampleArc,
} from '../edgeRouting.js';
import { distanceToPolyline } from '../geometryUtils.js';
import { distanceToQuadraticBezier } from '../parallelEdgeUtils.js';
import { distanceToSelfLoop } from '../selfLoopUtils.js';

const DIMS = { currentWidth: 300, currentHeight: 200, scaledCornerRadius: 40 };
const dimsFor = () => ({ ...DIMS });
const nodeAt = (id, x, y) => ({ id, x, y });

/** Shortest distance from `pt` to a densely sampled version of the same arc. */
const distanceToSampledArc = (pt, arc) => distanceToPolyline(pt.x, pt.y, sampleArc(arc, 512));

describe('distanceToArc — reported point', () => {
  // A two-member bundle, which is what forces a real arc: a lone edge between
  // two nodes can come back straight, and a straight "arc" is the one case
  // where the old chord projection happened to be right.
  const edges = [
    { id: 'e0', sourceId: 'a', destinationId: 'b' },
    { id: 'e1', sourceId: 'a', destinationId: 'b' },
  ];
  const nodes = [nodeAt('a', 0, 0), nodeAt('b', 1200, 0)];
  const dims = new Map(nodes.map(n => [n.id, dimsFor()]));
  const tangents = computeLombardiTangents(nodes, edges, dims);

  const { p, q, arc } = lombardiArcFor(
    edges[0], nodes[0], nodes[1], dimsFor(), dimsFor(), tangents, 1,
    { curveInfo: { pairIndex: 0, totalInPair: 2 }, laneSpacing: 100 }
  );

  it('sits on the arc, not on the chord between the endpoints', () => {
    expect(arc).toBeTruthy();

    // A probe out to one side, so the nearest point is mid-arc rather than an
    // endpoint.
    const probe = { x: 600, y: -400 };
    const out = { x: 0, y: 0 };
    const d = distanceToArc(probe.x, probe.y, arc, out);

    // On the arc: the sampled polyline agrees the point is on the curve.
    expect(distanceToSampledArc(out, arc)).toBeLessThan(1);

    // And the point is genuinely the one the distance refers to.
    expect(Math.hypot(probe.x - out.x, probe.y - out.y)).toBeCloseTo(d, 6);

    // The regression guard. The chord is the straight p→q the old code
    // projected onto; this arc bows clear of it, so the honest answer is a
    // measurable distance away from that line. Were the fiction to come back,
    // the reported point would sit ON the chord and this would read ~0.
    expect(distanceToPolyline(out.x, out.y, [p, q])).toBeGreaterThan(20);
  });

  it('clamps to the nearer endpoint when the bearing falls outside the sweep', () => {
    // Far off the end of the arc, well outside its angular span.
    const out = { x: 0, y: 0 };
    const d = distanceToArc(-5000, 0, arc, out);
    expect(distanceToSampledArc(out, arc)).toBeLessThan(1);
    expect(Math.hypot(-5000 - out.x, 0 - out.y)).toBeCloseTo(d, 6);
  });
});

describe('distanceToPolyline — reported point', () => {
  it('lands on the segment the distance was measured to', () => {
    // An L: across, then down. A chord from first to last point cuts the corner.
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const out = { x: 0, y: 0 };
    const d = distanceToPolyline(10, 30, points, out);

    expect(d).toBeCloseTo(30, 6);
    expect(out).toEqual({ x: 10, y: 0 });
  });

  it('is left untouched when there is nothing to measure against', () => {
    const out = { x: -1, y: -1 };
    expect(distanceToPolyline(0, 0, [{ x: 5, y: 5 }], out)).toBe(Infinity);
    expect(out).toEqual({ x: -1, y: -1 });
  });
});

describe('distanceToQuadraticBezier — reported point', () => {
  it('sits on the curve, off the chord', () => {
    // Control point pulled far above the baseline, so the curve's midpoint is
    // nowhere near the straight line from (0,0) to (200,0).
    const out = { x: 0, y: 0 };
    const d = distanceToQuadraticBezier(100, -400, 0, 0, 100, -400, 200, 0, 64, out);

    expect(Math.hypot(100 - out.x, -400 - out.y)).toBeCloseTo(d, 6);
    // Apex of this curve is y = -200; the chord is y = 0.
    expect(out.y).toBeLessThan(-100);
  });
});

describe('distanceToSelfLoop — reported point', () => {
  it('sits on the drawn lobe', () => {
    const out = { x: 0, y: 0 };
    // Probe well outside the loop, opposite the node, so the nearest point is
    // on the drawn major arc rather than in the undrawn wedge.
    const d = distanceToSelfLoop(150, -600, 0, 0, 300, 200, null, out);

    expect(Number.isFinite(d)).toBe(true);
    expect(Math.hypot(150 - out.x, -600 - out.y)).toBeCloseTo(d, 6);
  });
});
