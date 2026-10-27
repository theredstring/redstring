import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runCullingPass } from '../../src/components/canvas/data/culling.js';
import { computeEdgeCurveInfo } from '../../src/components/canvas/edges/edgeGeometry.js';
import { calculateCurveControlPoint } from '../../src/utils/canvas/parallelEdgeUtils.js';

// Zooming far in on a connection whose ends are both off screen. The culler
// used to test only the straight chord between the node centres, so a
// connection drawn away from that chord (a parallel pair's curve here) was
// culled while it sat in the middle of the view.

const DIMS = { currentWidth: 100, currentHeight: 50 };
const nodes = [
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 2000, y: 0 },
  { id: 'far', x: 0, y: 40000 },
  { id: 'far2', x: 2000, y: 40000 },
];
const edges = [
  { id: 'ab1', sourceId: 'a', destinationId: 'b' },
  { id: 'ab2', sourceId: 'a', destinationId: 'b' },
  { id: 'far', sourceId: 'far', destinationId: 'far2' },
];
const CURVE_SPACING = 1000;
const VIEWPORT = { width: 1000, height: 800 };
const ZOOM = 20;

const ref = (current) => ({ current });

function cull({ centerX, centerY, withScene = true }) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const baseDimsById = new Map(nodes.map(n => [n.id, DIMS]));
  const edgeCurveInfo = computeEdgeCurveInfo({ edges });
  const scene = {
    visibleEdges: [], nodeById, baseDimsById, previewingNodeId: null, edgeCurveInfo, nodePrototypesMap: new Map(),
    enableAutoRouting: false, routingStyle: 'straight', curveSpacing: CURVE_SPACING,
    anchorGeometryFor: (node, dims) => ({ node, dims }), labelTruncationRef: ref(new Map()),
  };
  let committedEdges = null;
  const visibleEdgesRef = ref([]);
  runCullingPass({
    cullingRafIdRef: ref(null), zoomPerfRef: ref({}), glowUpdateRef: ref(null), ENABLE_CULLING: true,
    nodesRef: ref(nodes), edgesRef: ref(edges), visibleNodeIdsRef: ref(new Set()),
    setVisibleNodeIds: () => {}, visibleEdgesRef,
    setVisibleEdges: (fn) => { committedEdges = fn(visibleEdgesRef.current); },
    viewportSizeRef: ref(VIEWPORT), canvasSizeRef: ref({ offsetX: 0, offsetY: 0 }),
    draggingNodeInfoRef: ref(null), isAnimatingZoomRef: ref(false),
    panOffsetRef: ref({
      x: -(centerX - VIEWPORT.width / (2 * ZOOM)) * ZOOM,
      y: -(centerY - VIEWPORT.height / (2 * ZOOM)) * ZOOM,
    }),
    zoomLevelRef: ref(ZOOM), cullPruneRef: ref(true), isViewMovingRef: ref(false), cullGuardRectRef: ref(null),
    baseDimsByIdRef: ref(baseDimsById), nodeByIdRef: ref(nodeById),
    connectionSceneRef: ref(withScene ? scene : null),
  });
  return committedEdges.map(e => e.id);
}

// Apex of the drawn quadratic curve for one member of the a-b pair.
function apexOf(edgeId) {
  const info = computeEdgeCurveInfo({ edges }).get(edgeId);
  const [x1, y1, x2, y2] = [50, 25, 2050, 25];
  const { ctrlX, ctrlY } = calculateCurveControlPoint(x1, y1, x2, y2, info, CURVE_SPACING);
  return { x: 0.25 * x1 + 0.5 * ctrlX + 0.25 * x2, y: 0.25 * y1 + 0.5 * ctrlY + 0.25 * y2 };
}

describe('culling keeps connections that are drawn on screen', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return null; });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a curved connection whose chord is far off screen', () => {
    const apex = apexOf('ab1');
    // The bow is well past the culling padding, so the chord test alone misses.
    expect(Math.abs(apex.y - 25)).toBeGreaterThan(220);
    const visible = cull({ centerX: apex.x, centerY: apex.y });
    expect(visible).toContain('ab1');
    expect(visible).not.toContain('far');
  });

  it('still culls the chord-only miss when no connection scene is available', () => {
    const apex = apexOf('ab1');
    expect(cull({ centerX: apex.x, centerY: apex.y, withScene: false })).not.toContain('ab1');
  });

  it('culls a connection that is near the view but not on it', () => {
    // Well clear of both curves of the pair: neither is drawn here.
    const visible = cull({ centerX: 1050, centerY: 25 + 1200 });
    expect(visible).toEqual([]);
  });
});
