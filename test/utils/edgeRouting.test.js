import { describe, it, expect } from 'vitest';
import {
  computeManhattanRouting,
  computeCleanRouting,
  buildRoundedOrthogonalPath,
  trimRouteEnd,
  computeLombardiTangents,
  computeLombardiRouting,
  solveLombardiArc,
  arcPointAt,
  sampleArc,
  arcPathBetween,
  rebuildRoutedPath,
  labelArcPath,
  MAX_TANGENT_CHORD,
} from '../../src/utils/canvas/edgeRouting.js';
import {
  placeLabelOnPath,
  chooseOrthogonalLabelPlacement,
  placeLabelOnArc,
  chooseArcLabelPlacement,
  chooseRoutedLabelPlacement,
} from '../../src/utils/canvas/edgeLabelPlacement.js';
import { stabilizeLabelPosition, clearLabelStabilization } from '../../src/utils/canvas/labelStabilization.js';

const dims = (w, h) => ({ currentWidth: w, currentHeight: h });
const node = (id, x, y) => ({ id, x, y });

describe('buildRoundedOrthogonalPath', () => {
  it('clamps the corner radius to half the shortest adjacent segment', () => {
    // 10px segment: an unclamped r=8 would overshoot past the corner.
    const d = buildRoundedOrthogonalPath([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 },
    ], 8);
    // Approach point can't pass the start of the incoming segment.
    const approachX = Number(d.match(/L (-?[\d.]+),/)[1]);
    expect(approachX).toBeGreaterThanOrEqual(0);
    expect(approachX).toBeLessThanOrEqual(10);
  });

  it('drops collinear interior points instead of emitting degenerate corners', () => {
    const d = buildRoundedOrthogonalPath([
      { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 },
    ]);
    expect(d).toBe('M 0,0 L 100,0');
    expect(d).not.toContain('Q');
  });
});

describe('computeManhattanRouting', () => {
  it('exits and enters on opposite sides for a horizontal layout', () => {
    const r = computeManhattanRouting(
      node('a', 0, 0), node('b', 600, 40), dims(200, 80), dims(200, 80), 'auto'
    );
    expect(r.sourceSide).toBe('right');
    expect(r.destSide).toBe('left');
    expect(r.startX).toBe(200);
    expect(r.endX).toBe(600);
    expect(r.pathD.startsWith('M ')).toBe(true);
  });

  it('reports sides that agree with its own endpoints for a vertical layout', () => {
    const r = computeManhattanRouting(
      node('a', 0, 0), node('b', 20, 500), dims(200, 80), dims(200, 80), 'auto'
    );
    expect(r.sourceSide).toBe('bottom');
    expect(r.destSide).toBe('top');
    expect(r.startY).toBe(80);
    expect(r.endY).toBe(500);
  });

  it('produces an axis-aligned polyline (every segment horizontal or vertical)', () => {
    const r = computeManhattanRouting(
      node('a', 0, 0), node('b', 500, 300), dims(200, 80), dims(200, 80), 'auto'
    );
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = r.points[i];
      const b = r.points[i + 1];
      const axisAligned = Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01;
      expect(axisAligned).toBe(true);
    }
  });
});

describe('computeCleanRouting', () => {
  const edge = { id: 'e1', sourceId: 'a', destinationId: 'b', directionality: { arrowsToward: new Set(['b']) } };

  it('routes through the assigned port and reports its side', () => {
    const lanes = new Map([['e1', {
      sourcePort: { x: 200, y: 40 },
      destPort: { x: 600, y: 80 },
      sourceSide: 'right',
      destSide: 'left',
    }]]);
    const r = computeCleanRouting(edge, node('a', 0, 0), node('b', 600, 40), dims(200, 80), dims(200, 80), lanes, 24);
    expect(r.destSide).toBe('left');
    // The arrow-bearing end terminates at its port.
    expect(r.endX).toBe(600);
    expect(r.endY).toBe(80);
  });

  it('falls back to a center-to-center route when no port is assigned', () => {
    const r = computeCleanRouting(edge, node('a', 0, 0), node('b', 600, 40), dims(200, 80), dims(200, 80), new Map(), 24);
    expect(r.points.length).toBeGreaterThanOrEqual(2);
    expect(r.sourceSide).toBeNull();
  });
});

describe('orthogonal label placement', () => {
  // A simple L: long horizontal run, then a vertical drop.
  const lPath = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }];

  it('places the label on the path, not off to one side', () => {
    const p = placeLabelOnPath(lPath);
    expect(p.y).toBe(0);
    expect(p.x).toBe(200);
  });

  it('keeps the angle axis-aligned rather than following the chord', () => {
    const p = placeLabelOnPath(lPath);
    // The chord angle here is ~26.6°; the label must not inherit it.
    expect(p.angle).toBe(0);
  });

  it('uses 90 degrees when the best run is vertical', () => {
    const vPath = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 500 }];
    expect(placeLabelOnPath(vPath).angle).toBe(90);
  });

  it('stays on the polyline even at large font sizes', () => {
    // Regression: the generic placer rejected every segment shorter than the
    // label text and fell back to chord-based off-path strategies.
    const placement = chooseOrthogonalLabelPlacement(
      lPath, 'Some Long Connection Name', [], new Set(), new Map(), new Map(), 59.4, 'e1', new Set()
    );
    expect([0, 90]).toContain(placement.angle);
    const onHorizontalRun = Math.abs(placement.y) <= 59.4 && placement.x >= 0 && placement.x <= 400;
    const onVerticalRun = Math.abs(placement.x - 400) <= 59.4 && placement.y >= 0 && placement.y <= 200;
    expect(onHorizontalRun || onVerticalRun).toBe(true);
  });

  it('never drifts more than a line height off the route when dodging obstacles', () => {
    const nodes = [{ id: 'blocker', x: 150, y: -40 }];
    const baseDims = new Map([['blocker', dims(100, 80)]]);
    const placement = chooseOrthogonalLabelPlacement(
      lPath, 'Rel', nodes, new Set(['blocker']), baseDims, new Map(), 24, 'e1', new Set()
    );
    const distToHorizontal = Math.abs(placement.y);
    const distToVertical = Math.abs(placement.x - 400);
    expect(Math.min(distToHorizontal, distToVertical)).toBeLessThanOrEqual(24 + 1);
  });

  it('always returns a placement even when everything collides', () => {
    const nodes = [{ id: 'huge', x: -5000, y: -5000 }];
    const baseDims = new Map([['huge', dims(10000, 10000)]]);
    const placement = chooseOrthogonalLabelPlacement(
      lPath, 'Rel', nodes, new Set(['huge']), baseDims, new Map(), 24, 'e1', new Set()
    );
    expect(Number.isFinite(placement.x)).toBe(true);
    expect(Number.isFinite(placement.y)).toBe(true);
  });
});

describe('trimRouteEnd (orthogonal hover preview)', () => {
  const box = { minX: 0, minY: -50, maxX: 100, maxY: 50 };

  it('retracts a start that begins inside the node to just past the border', () => {
    // Starts at the node center, runs right and out of the box.
    const pts = [{ x: 50, y: 0 }, { x: 400, y: 0 }];
    const r = trimRouteEnd(pts, box, true, 20);
    expect(r.endpoint.x).toBe(120); // border at 100, plus 20
    expect(r.endpoint.y).toBe(0);
    expect(r.points[0]).toEqual(r.endpoint);
    expect(r.points[r.points.length - 1]).toEqual({ x: 400, y: 0 });
  });

  it('retracts a start already on the border by exactly the extra distance', () => {
    // Manhattan case: the port already sits on the node edge.
    const pts = [{ x: 100, y: 0 }, { x: 400, y: 0 }];
    const r = trimRouteEnd(pts, box, true, 20);
    expect(r.endpoint.x).toBe(120);
  });

  it('trims the far end when fromStart is false, leaving the start untouched', () => {
    const endBox = { minX: 300, minY: -50, maxX: 400, maxY: 50 };
    const pts = [{ x: -200, y: 0 }, { x: 350, y: 0 }];
    const r = trimRouteEnd(pts, endBox, false, 20);
    expect(r.endpoint.x).toBe(280); // border at 300, minus 20
    expect(r.points[0]).toEqual({ x: -200, y: 0 });
    expect(r.points[r.points.length - 1]).toEqual(r.endpoint);
  });

  it('carries the pull-back around a corner onto the next segment', () => {
    // Exits the box travelling right after only 10px, so a 40px pull-back has to
    // continue past the bend and down the vertical leg.
    const pts = [{ x: 50, y: 0 }, { x: 110, y: 0 }, { x: 110, y: 500 }];
    const r = trimRouteEnd(pts, box, true, 40);
    expect(r.endpoint.x).toBe(110);
    expect(r.endpoint.y).toBeCloseTo(30, 6); // 10px right to the bend, 30px down
  });

  it('leaves the route alone when both endpoints are enclosed', () => {
    const huge = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const r = trimRouteEnd(pts, huge, true, 20);
    expect(r.points).toEqual(pts);
  });

  it('never returns a degenerate single-point route', () => {
    const pts = [{ x: 50, y: 0 }, { x: 130, y: 0 }];
    const r = trimRouteEnd(pts, box, true, 10000);
    expect(r.points.length).toBeGreaterThanOrEqual(2);
  });

  it('produces a shorter path than the untrimmed route', () => {
    const routing = computeManhattanRouting(
      node('a', 0, 0), node('b', 600, 40), dims(200, 80), dims(200, 80), 'auto'
    );
    const hitbox = { minX: 0, minY: 0, maxX: 200, maxY: 80 };
    const trimmed = trimRouteEnd(routing.points, hitbox, true, 30);
    const full = buildRoundedOrthogonalPath(routing.points);
    const short = buildRoundedOrthogonalPath(trimmed.points);
    expect(short).not.toBe(full);
    expect(trimmed.endpoint.x).toBeGreaterThan(routing.startX);
  });
});

describe('stabilizeLabelPosition', () => {
  it('holds position inside the jitter deadband', () => {
    clearLabelStabilization();
    stabilizeLabelPosition('e1', 100, 100, 0);
    const r = stabilizeLabelPosition('e1', 102, 101, 0);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
  });

  it('converges to the requested position in one call past the deadband', () => {
    // Regression: this used to lerp 30% per call and persist the lerp, so a
    // label whose route changed settled permanently short of its target.
    clearLabelStabilization();
    stabilizeLabelPosition('e2', 0, 0, 0);
    const r = stabilizeLabelPosition('e2', 500, 300, 90);
    expect(r.x).toBe(500);
    expect(r.y).toBe(300);
    expect(r.angle).toBe(90);
  });
});

// ===========================================================================
// LOMBARDI
// ===========================================================================

describe('computeLombardiTangents (perfect angular resolution)', () => {
  const dimsMap = (ids) => new Map(ids.map(id => [id, dims(100, 100)]));
  const at = (id, x, y) => ({ id, x, y });

  const anglesAround = (assignments, edges, nodeId) => {
    const out = [];
    edges.forEach(e => {
      const a = assignments.get(e.id);
      if (!a) return;
      if (e.sourceId === nodeId) out.push(a.sourceAngle);
      if (e.destinationId === nodeId) out.push(a.destAngle);
    });
    return out;
  };

  const gaps = (angles) => {
    const sorted = angles.map(a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((x, y) => x - y);
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      const next = sorted[(i + 1) % sorted.length];
      out.push(((next - sorted[i]) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI);
    }
    return out;
  };

  it('spaces a hub\'s edges evenly around the full circle', () => {
    const nodes = [at('h', 0, 0), at('a', 400, 0), at('b', 380, 40), at('c', 360, 80)];
    // All three neighbours are bunched to the right; perfect angular resolution
    // must still spread them 120 degrees apart.
    const edges = [
      { id: 'e1', sourceId: 'h', destinationId: 'a' },
      { id: 'e2', sourceId: 'h', destinationId: 'b' },
      { id: 'e3', sourceId: 'h', destinationId: 'c' },
    ];
    const t = computeLombardiTangents(nodes, edges, dimsMap(['h', 'a', 'b', 'c']));
    const g = gaps(anglesAround(t, edges, 'h'));
    g.forEach(v => expect(v).toBeCloseTo((2 * Math.PI) / 3, 6));
  });

  it('gives a degree-1 node the exact bearing to its neighbour', () => {
    const nodes = [at('a', 0, 0), at('b', 500, 0)];
    const edges = [{ id: 'e1', sourceId: 'a', destinationId: 'b' }];
    const t = computeLombardiTangents(nodes, edges, dimsMap(['a', 'b']));
    expect(t.get('e1').sourceAngle).toBeCloseTo(0, 6);
    expect(t.get('e1').destAngle).toBeCloseTo(Math.PI, 6);
  });

  it('fans parallel edges into separate slots instead of stacking them', () => {
    const nodes = [at('a', 0, 0), at('b', 500, 0)];
    const edges = [
      { id: 'e1', sourceId: 'a', destinationId: 'b' },
      { id: 'e2', sourceId: 'a', destinationId: 'b' },
    ];
    const t = computeLombardiTangents(nodes, edges, dimsMap(['a', 'b']));
    const delta = Math.abs(t.get('e1').sourceAngle - t.get('e2').sourceAngle);
    expect(delta).toBeCloseTo(Math.PI, 6);
  });

  it('is deterministic across repeated calls', () => {
    const nodes = [at('h', 0, 0), at('a', 400, 0), at('b', 0, 400), at('c', -400, 0)];
    const edges = [
      { id: 'e1', sourceId: 'h', destinationId: 'a' },
      { id: 'e2', sourceId: 'h', destinationId: 'b' },
      { id: 'e3', sourceId: 'h', destinationId: 'c' },
    ];
    const ids = ['h', 'a', 'b', 'c'];
    const first = computeLombardiTangents(nodes, edges, dimsMap(ids));
    const second = computeLombardiTangents(nodes, edges, dimsMap(ids));
    edges.forEach(e => expect(second.get(e.id)).toEqual(first.get(e.id)));
  });

  it('ignores self-loops so they never consume a slot', () => {
    const nodes = [at('a', 0, 0), at('b', 500, 0)];
    const edges = [
      { id: 'loop', sourceId: 'a', destinationId: 'a' },
      { id: 'e1', sourceId: 'a', destinationId: 'b' },
    ];
    const t = computeLombardiTangents(nodes, edges, dimsMap(['a', 'b']));
    expect(t.has('loop')).toBe(false);
    expect(t.get('e1').sourceAngle).toBeCloseTo(0, 6);
  });
});

describe('solveLombardiArc', () => {
  const p = { x: 0, y: 0 };
  const q = { x: 100, y: 0 };

  it('degenerates to a straight line when both tangents already point along the chord', () => {
    const arc = solveLombardiArc(p, q, 0, Math.PI, 1);
    expect(arc.straight).toBe(true);
  });

  it('honours BOTH tangents exactly when they are mutually consistent', () => {
    // Property 1: an arc makes the same angle with the chord at both ends, so a
    // symmetric pair of demands is satisfiable exactly.
    const arc = solveLombardiArc(p, q, 0.4, Math.PI - 0.4, 1);
    expect(arc.delta).toBeCloseTo(0.4, 9);

    const start = arcPointAt(arc, 0);
    const end = arcPointAt(arc, 1);
    expect(start.angle * (Math.PI / 180)).toBeCloseTo(0.4, 6);
    // Arrival heading is the reverse of the destination's outward tangent.
    expect(end.angle * (Math.PI / 180)).toBeCloseTo(-0.4, 6);
  });

  it('splits the difference when the two demands conflict', () => {
    // Source wants +0.6, destination's slot implies an arrival deviation of
    // -0.2, so the compromise is 0.4.
    const arc = solveLombardiArc(p, q, 0.6, Math.PI - 0.2, 1);
    expect(arc.delta).toBeCloseTo(0.4, 9);
  });

  it('starts and ends exactly on the two endpoints', () => {
    const arc = solveLombardiArc(p, q, 0.5, Math.PI - 0.3, 1);
    const start = arcPointAt(arc, 0);
    const end = arcPointAt(arc, 1);
    expect(start.x).toBeCloseTo(0, 6);
    expect(start.y).toBeCloseTo(0, 6);
    expect(end.x).toBeCloseTo(100, 6);
    expect(end.y).toBeCloseTo(0, 6);
  });

  it('bows to the side the departure tangent points', () => {
    const down = solveLombardiArc(p, q, 0.5, Math.PI - 0.5, 1);
    const up = solveLombardiArc(p, q, -0.5, Math.PI + 0.5, 1);
    expect(arcPointAt(down, 0.5).y).toBeGreaterThan(0);
    expect(arcPointAt(up, 0.5).y).toBeLessThan(0);
  });

  it('keeps every sampled point on the circle', () => {
    const arc = solveLombardiArc(p, q, 0.9, Math.PI - 0.9, 1);
    sampleArc(arc).forEach(pt => {
      expect(Math.hypot(pt.x - arc.cx, pt.y - arc.cy)).toBeCloseTo(arc.radius, 6);
    });
  });

  it('scales the bow by the curvature multiplier', () => {
    const base = solveLombardiArc(p, q, 0.5, Math.PI - 0.5, 1);
    const half = solveLombardiArc(p, q, 0.5, Math.PI - 0.5, 0.5);
    expect(half.delta).toBeCloseTo(base.delta / 2, 9);
    expect(Math.abs(arcPointAt(half, 0.5).y)).toBeLessThan(Math.abs(arcPointAt(base, 0.5).y));
  });

  it('clamps runaway curvature so an arc never becomes a lasso', () => {
    const arc = solveLombardiArc(p, q, 1.5, Math.PI - 1.5, 4);
    expect(Math.abs(arc.delta)).toBeLessThanOrEqual(MAX_TANGENT_CHORD + 1e-9);
    // Staying under a half-turn is what keeps SVG in its small-arc case.
    expect(Math.abs(arc.sweep)).toBeLessThan(Math.PI);
  });

  it('returns null for coincident endpoints', () => {
    expect(solveLombardiArc(p, { x: 0, y: 0 }, 0, Math.PI, 1)).toBeNull();
  });
});

describe('arc path emission', () => {
  const p = { x: 0, y: 0 };
  const q = { x: 100, y: 0 };

  it('emits an A command whose sweep flag matches the bow direction', () => {
    const down = arcPathBetween(solveLombardiArc(p, q, 0.5, Math.PI - 0.5, 1), p, q);
    const up = arcPathBetween(solveLombardiArc(p, q, -0.5, Math.PI + 0.5, 1), p, q);
    expect(down).toMatch(/A [\d.]+,[\d.]+ 0 0 0 /);
    expect(up).toMatch(/A [\d.]+,[\d.]+ 0 0 1 /);
  });

  it('snaps an off-circle endpoint back onto the arc', () => {
    const arc = solveLombardiArc(p, q, 0.6, Math.PI - 0.6, 1);
    // A point taken off a chord of the sampled polyline sits slightly inside.
    const inside = { x: 50, y: arcPointAt(arc, 0.5).y - 3 };
    const d = arcPathBetween(arc, p, inside);
    const endX = Number(d.match(/ (-?[\d.]+),(-?[\d.]+)$/)[1]);
    const endY = Number(d.match(/ (-?[\d.]+),(-?[\d.]+)$/)[2]);
    expect(Math.hypot(endX - arc.cx, endY - arc.cy)).toBeCloseTo(arc.radius, 6);
  });

  it('rebuildRoutedPath keeps a trimmed arc on the same circle', () => {
    const arc = solveLombardiArc(p, q, 0.6, Math.PI - 0.6, 1);
    const routing = { arc, points: sampleArc(arc) };
    const trimmed = trimRouteEnd(routing.points, { minX: -40, minY: -40, maxX: 20, maxY: 40 }, true, 5);
    const d = rebuildRoutedPath(routing, trimmed.points);
    expect(d).toContain(` A ${arc.radius},${arc.radius} `);
  });

  it('rebuildRoutedPath still emits a rounded polyline for orthogonal routings', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(rebuildRoutedPath({ points: pts }, pts)).toContain('Q');
  });
});

describe('computeLombardiRouting', () => {
  const node = (id, x, y) => ({ id, x, y });
  const d = dims(120, 100);
  const edge = (arrows = []) => ({
    id: 'e1', sourceId: 'a', destinationId: 'b',
    directionality: { arrowsToward: new Set(arrows) },
  });

  const tangents = new Map([['e1', { sourceAngle: 0.5, destAngle: Math.PI - 0.5 }]]);

  it('anchors arrow-less ends at the node centres', () => {
    const r = computeLombardiRouting(edge(), node('a', 0, 0), node('b', 600, 0), d, d, tangents);
    expect(r.startX).toBeCloseTo(60, 6);
    expect(r.startY).toBeCloseTo(50, 6);
    expect(r.endX).toBeCloseTo(660, 6);
    expect(r.sourceArrow).toBeNull();
    expect(r.destArrow).toBeNull();
  });

  it('pulls an arrow-bearing end back to the node border', () => {
    const r = computeLombardiRouting(edge(['b']), node('a', 0, 0), node('b', 600, 0), d, d, tangents);
    // Border of b is at x = 600 + 6 (visual inset), well short of its centre.
    expect(r.endX).toBeLessThan(660);
    expect(r.endX).toBeGreaterThan(600);
    expect(r.destArrow).not.toBeNull();
  });

  it('orients the source arrow back toward its own node', () => {
    const r = computeLombardiRouting(edge(['a', 'b']), node('a', 0, 0), node('b', 600, 0), d, d, tangents);
    // Travel is broadly left-to-right, so the destination arrow points right
    // and the source arrow points back the other way.
    expect(Math.abs(r.destArrow.angle)).toBeLessThan(90);
    expect(Math.abs(r.sourceArrow.angle)).toBeGreaterThan(90);
  });

  it('falls back to a straight line when no tangents are assigned', () => {
    const r = computeLombardiRouting(edge(), node('a', 0, 0), node('b', 600, 0), d, d, new Map());
    expect(r.arc).toBeNull();
    expect(r.points).toHaveLength(2);
    expect(r.pathD).toContain('L ');
  });

  it('reports no sides — Lombardi has no notion of one', () => {
    const r = computeLombardiRouting(edge(), node('a', 0, 0), node('b', 600, 0), d, d, tangents);
    expect(r.sourceSide).toBeNull();
    expect(r.destSide).toBeNull();
  });
});

describe('arc label placement', () => {
  const arc = solveLombardiArc({ x: 0, y: 0 }, { x: 600, y: 0 }, 0.6, Math.PI - 0.6, 1);

  it('sits on the arc, not on the chord', () => {
    const p = placeLabelOnArc(arc);
    expect(Math.hypot(p.x - arc.cx, p.y - arc.cy)).toBeCloseTo(arc.radius, 6);
    expect(Math.abs(p.y)).toBeGreaterThan(10);
  });

  it('follows the tangent rather than snapping to an axis', () => {
    // At the apex of a symmetric arc the tangent is parallel to the chord.
    expect(placeLabelOnArc(arc).angle).toBeCloseTo(0, 6);
    const skewed = solveLombardiArc({ x: 0, y: 0 }, { x: 400, y: 400 }, Math.PI / 4 + 0.5, Math.PI + Math.PI / 4 - 0.5, 1);
    expect(placeLabelOnArc(skewed).angle).toBeCloseTo(45, 6);
  });

  it('stays within a line height of the arc when dodging obstacles', () => {
    const blockers = [{ id: 'x', x: 250, y: 60 }];
    const baseDims = new Map([['x', dims(120, 100)]]);
    const p = chooseArcLabelPlacement(arc, 'Rel', blockers, new Set(['x']), baseDims, new Map(), 24, 'e1', new Set());
    const radial = Math.abs(Math.hypot(p.x - arc.cx, p.y - arc.cy) - arc.radius);
    expect(radial).toBeLessThanOrEqual(24 + 1);
  });

  it('always returns a placement even when everything collides', () => {
    const blockers = [{ id: 'huge', x: -5000, y: -5000 }];
    const baseDims = new Map([['huge', dims(10000, 10000)]]);
    const p = chooseArcLabelPlacement(arc, 'Rel', blockers, new Set(['huge']), baseDims, new Map(), 24, 'e1', new Set());
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it('chooseRoutedLabelPlacement dispatches on the descriptor, not the caller', () => {
    const lPath = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }];
    const ortho = chooseRoutedLabelPlacement({ points: lPath }, 'Rel', [], new Set(), new Map(), new Map(), 24, 'e1', new Set());
    expect([0, 90]).toContain(ortho.angle);
    const curved = chooseRoutedLabelPlacement({ arc, points: sampleArc(arc) }, 'Rel', [], new Set(), new Map(), new Map(), 24, 'e2', new Set());
    expect(Math.hypot(curved.x - arc.cx, curved.y - arc.cy)).toBeCloseTo(arc.radius, 6);
  });
});

describe('labelArcPath (curved labels)', () => {
  const arc = solveLombardiArc({ x: 0, y: 0 }, { x: 1200, y: 0 }, 0.5, Math.PI - 0.5, 1);
  const apex = arcPointAt(arc, 0.5);

  it('rides a circle concentric with the edge arc', () => {
    const p = labelArcPath(arc, apex, 200);
    const start = p.d.match(/^M (-?[\d.]+),(-?[\d.]+)/);
    expect(Math.hypot(Number(start[1]) - arc.cx, Number(start[2]) - arc.cy)).toBeCloseTo(p.radius, 6);
    // Same centre as the edge, so the label curves the way the line does.
    expect(p.radius).toBeCloseTo(arc.radius, 6);
  });

  it('keeps a radially offset label on its own concentric circle', () => {
    // A label nudged off the line to dodge something still curves — just at a
    // slightly different radius.
    const nudged = { x: apex.x, y: apex.y + 40 };
    const p = labelArcPath(arc, nudged, 200);
    expect(p.radius).not.toBeCloseTo(arc.radius, 1);
    const start = p.d.match(/^M (-?[\d.]+),(-?[\d.]+)/);
    expect(Math.hypot(Number(start[1]) - arc.cx, Number(start[2]) - arc.cy)).toBeCloseTo(p.radius, 6);
  });

  it('runs the text left-to-right so it never reads upside down', () => {
    const p = labelArcPath(arc, apex, 200);
    const m = p.d.match(/^M (-?[\d.]+),(-?[\d.]+) A [\d.]+,[\d.]+ 0 0 \d (-?[\d.]+),(-?[\d.]+)$/);
    expect(Number(m[3])).toBeGreaterThan(Number(m[1]));
  });

  it('still reads left-to-right on an arc that runs the other way', () => {
    const back = solveLombardiArc({ x: 1200, y: 0 }, { x: 0, y: 0 }, Math.PI - 0.5, 0.5, 1);
    const p = labelArcPath(back, arcPointAt(back, 0.5), 200);
    const m = p.d.match(/^M (-?[\d.]+),(-?[\d.]+) A [\d.]+,[\d.]+ 0 0 \d (-?[\d.]+),(-?[\d.]+)$/);
    expect(Number(m[3])).toBeGreaterThan(Number(m[1]));
  });

  it('curves even on a tight arc', () => {
    // No aesthetic gate: a curved label reads fine at any bend a real
    // connection produces, so the only thing that declines is degeneracy.
    const tight = solveLombardiArc({ x: 0, y: 0 }, { x: 160, y: 0 }, 1.1, Math.PI - 1.1, 1);
    expect(labelArcPath(tight, arcPointAt(tight, 0.5), 120)).not.toBeNull();
    expect(labelArcPath(arc, apex, 400)).not.toBeNull();
  });

  it('flags the large-arc case so long text does not run backwards', () => {
    // Past a half turn the endpoints alone no longer identify the arc; without
    // the flag SVG takes the short way round and the text reverses.
    const tight = solveLombardiArc({ x: 0, y: 0 }, { x: 200, y: 0 }, 1.2, Math.PI - 1.2, 1);
    const p = labelArcPath(tight, arcPointAt(tight, 0.5), 400);
    expect(p.sweep).toBeGreaterThan(Math.PI);
    expect(p.d).toMatch(/A [\d.]+,[\d.]+ 0 1 \d /);
  });

  it('declines only once the label would wrap the whole circle', () => {
    const tight = solveLombardiArc({ x: 0, y: 0 }, { x: 200, y: 0 }, 1.3, Math.PI - 1.3, 1);
    expect(labelArcPath(tight, arcPointAt(tight, 0.5), 5000)).toBeNull();
  });

  it('declines for a straight edge, which has no arc to ride', () => {
    expect(labelArcPath(null, apex, 200)).toBeNull();
  });

  it('declines for empty text', () => {
    expect(labelArcPath(arc, apex, 0)).toBeNull();
  });

  it('accepts an explicit span, for callers that measured the rendered path', () => {
    const estimated = labelArcPath(arc, apex, 200);
    const measured = labelArcPath(arc, apex, 0, { span: 200 * 1.4 });
    expect(measured.d).toBe(estimated.d);
  });

  it('makes the path longer than the text so nothing clips', () => {
    const p = labelArcPath(arc, apex, 200);
    expect(p.sweep * p.radius).toBeGreaterThan(200);
  });
});
