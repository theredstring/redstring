import { describe, it, expect } from 'vitest';
import {
  findNearestEdgeAtCanvasPoint,
  edgeHitThreshold,
  EDGE_HIT_FLOOR_PX_MOUSE,
  EDGE_HIT_FLOOR_PX_TOUCH,
  EDGE_HIT_TOUCH_BOOST,
  EDGE_HOVER_STICKY_FRACTION,
} from '../../src/utils/canvas/edgeHitTest.js';

// P4.01: the edge hit test, moved out of NodeCanvas.
const node = (id, x, y, extra = {}) => ({ id, x, y, name: id.toUpperCase(), color: '#111', prototypeId: `p-${id}`, ...extra });
const dims = { currentWidth: 100, currentHeight: 40 };

function scene(nodes, edges, extra = {}) {
  return {
    visibleEdges: edges,
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    baseDimsById: new Map(nodes.map((n) => [n.id, dims])),
    previewingNodeId: null,
    edgeCurveInfo: new Map(),
    nodePrototypesMap: new Map(),
    enableAutoRouting: false,
    routingStyle: 'straight',
    cleanLaneOffsets: new Map(),
    cleanLaneSpacing: 24,
    manhattanBends: 'auto',
    lombardiTangents: new Map(),
    lombardiCurvature: 1,
    lombardiLaneSpacing: 24,
    orthogonalLaneSpacing: 24,
    curveSpacing: 200,
    lombardiMinBow: 0,
    anchorGeometryFor: (n, d) => ({ node: n, dims: d }),
    labelTruncationRef: { current: new Map() },
    ...extra,
  };
}

// Two horizontal connections 30 units apart. Centres are at x+50, y+20.
const a = node('a', 0, 0);
const b = node('b', 400, 0);
const c = node('c', 0, 30);
const d = node('d', 400, 30);
const top = { id: 'e-top', sourceId: 'a', destinationId: 'b', connectionName: 'Top' };
const low = { id: 'e-low', sourceId: 'c', destinationId: 'd', connectionName: 'Low' };

describe('findNearestEdgeAtCanvasPoint', () => {
  it('returns the nearest connection, its distance and the closest point on it', () => {
    const hit = findNearestEdgeAtCanvasPoint(250, 30, 40, scene([a, b, c, d], [top, low]));
    expect(hit.edgeId).toBe('e-top');
    expect(hit.distance).toBeCloseTo(10);
    expect(hit.point).toEqual({ x: 250, y: 20 });
    expect(hit.connection.name).toBe('Top');
  });

  it('nearest wins over scan order', () => {
    const hit = findNearestEdgeAtCanvasPoint(250, 42, 40, scene([a, b, c, d], [top, low]));
    expect(hit.edgeId).toBe('e-low');
  });

  it('returns null outside the threshold', () => {
    expect(findNearestEdgeAtCanvasPoint(250, 200, 40, scene([a, b, c, d], [top, low]))).toBeNull();
  });

  it('keeps a sticky connection against a rival that is only slightly nearer', () => {
    const s = scene([a, b, c, d], [top, low]);
    // 16 from top, 14 from low: low wins honestly, top wins when sticky.
    expect(findNearestEdgeAtCanvasPoint(250, 36, 40, s).edgeId).toBe('e-low');
    expect(40 * EDGE_HOVER_STICKY_FRACTION).toBeGreaterThan(2);
    expect(findNearestEdgeAtCanvasPoint(250, 36, 40, s, { stickyEdgeId: 'e-top' }).edgeId).toBe('e-top');
  });

  it('names an unnamed connection after its definition node, and orders endpoints left to right', () => {
    const def = { name: 'Causes', color: '#c00' };
    const reversed = { id: 'e-rev', sourceId: 'b', destinationId: 'a', definitionNodeIds: ['p-def'] };
    const hit = findNearestEdgeAtCanvasPoint(250, 20, 40, scene([a, b], [reversed], {
      nodePrototypesMap: new Map([['p-def', def]]),
    }));
    expect(hit.connection.name).toBe('Causes');
    expect(hit.connection.color).toBe('#c00');
    expect(hit.connection.source.id).toBe('a');
    expect(hit.connection.target.id).toBe('b');
  });

  it('reports whether the canvas is truncating the label', () => {
    const s = scene([a, b], [top], { labelTruncationRef: { current: new Map([['e-top', true]]) } });
    expect(findNearestEdgeAtCanvasPoint(250, 20, 40, s).connection.labelTruncated).toBe(true);
  });
});

describe('edgeHitThreshold', () => {
  it('is 40 canvas units for straight styles and 50 for routed ones at zoom 1', () => {
    expect(edgeHitThreshold('mouse', false, 1, 1)).toBe(40);
    expect(edgeHitThreshold('mouse', true, 1, 1)).toBe(50);
  });
  it('scales with a thick connection width', () => {
    expect(edgeHitThreshold('mouse', false, 2, 1)).toBe(80);
  });
  it('boosts touch', () => {
    expect(edgeHitThreshold('touch', false, 1, 1)).toBeCloseTo(40 * EDGE_HIT_TOUCH_BOOST);
  });
  it('keeps a screen-pixel floor when zoomed out', () => {
    expect(edgeHitThreshold('mouse', false, 1, 0.1)).toBeCloseTo(EDGE_HIT_FLOOR_PX_MOUSE / 0.1);
    expect(edgeHitThreshold('touch', false, 1, 0.1)).toBeCloseTo(EDGE_HIT_FLOOR_PX_TOUCH / 0.1);
  });
});
