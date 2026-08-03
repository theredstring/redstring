import { describe, it, expect } from 'vitest';
import {
  computeManhattanRouting,
  computeCleanRouting,
  buildRoundedOrthogonalPath,
} from '../../src/utils/canvas/edgeRouting.js';
import {
  placeLabelOnPath,
  chooseOrthogonalLabelPlacement,
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
