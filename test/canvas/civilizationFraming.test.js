import { describe, it, expect, afterEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { largestCluster, civilizationView } from '../../src/components/canvas/camera/backToCivilization.js';
import { watchNewlyOpenedWeb } from '../../src/components/canvas/camera/viewPersistence.js';
import { computeLombardiTangents, lombardiArcFor } from '../../src/utils/canvas/edgeRouting.js';
import { arcBounds } from '../../src/components/canvas/groups/connectionBounds.js';

/**
 * Framing a web (Back to Civilization, opening a web): the largest cluster
 * when a wide gap splits the web, and which activations count as opening.
 */
const dims = () => ({ currentWidth: 100, currentHeight: 60 });
const grid = (prefix, x0, y0, count) => Array.from({ length: count }, (_, k) => ({
  id: `${prefix}${k}`, x: x0 + (k % 4) * 150, y: y0 + Math.floor(k / 4) * 120,
}));
const ids = (nodes) => nodes.map(n => n.id);
const dimsById = (nodes) => new Map(nodes.map(n => [n.id, dims()]));

describe('largestCluster', () => {
  it('keeps every node when the web has no wide gap', () => {
    const nodes = grid('a', 0, 0, 12);
    expect(largestCluster(nodes, dims)).toBe(nodes);
  });

  it('drops a far-off node', () => {
    const main = grid('a', 0, 0, 8);
    const nodes = [...main, { id: 'far', x: 40000, y: -30000 }];
    expect(ids(largestCluster(nodes, dims))).toEqual(ids(main));
  });

  it('frames the cluster with the most nodes, wherever it sits', () => {
    const small = grid('s', 0, 0, 3);
    const big = grid('b', 20000, 5000, 9);
    expect(ids(largestCluster([...small, ...big], dims))).toEqual(ids(big));
  });

  it('keeps islands a short hop apart together', () => {
    const nodes = [...grid('a', 0, 0, 4), ...grid('b', 900, 0, 4)];
    expect(largestCluster(nodes, dims)).toBe(nodes);
  });
});

describe('civilizationView', () => {
  const viewportSize = { width: 1200, height: 800 };
  const canvasSize = { width: 100000, height: 100000, offsetX: -50000, offsetY: -50000 };

  it('centres the main cluster, not the space between it and an outlier', () => {
    const main = grid('a', 0, 0, 8); // spans x 0..550, y 0..180
    const nodes = [...main, { id: 'far', x: 40000, y: 40000 }];
    const { pan, zoom } = civilizationView({ nodes, baseDimsById: dimsById(nodes), viewportSize, canvasSize });
    const centreX = (viewportSize.width / 2 - pan.x) / zoom + canvasSize.offsetX;
    const centreY = (viewportSize.height / 2 - pan.y) / zoom + canvasSize.offsetY;
    expect(centreX).toBeCloseTo(275, 0);
    expect(centreY).toBeCloseTo(90, 0);
  });

  it('keeps the arcs of Lombardi connections in view', () => {
    const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 600, y: 0 }, { id: 'c', x: 300, y: 500 }];
    const edges = ['ab', 'bc', 'ca'].map(([s, d]) => ({ id: s + d, sourceId: s, destinationId: d, directionality: { arrowsToward: new Set() } }));
    const baseDimsById = dimsById(nodes);
    const lombardiTangents = computeLombardiTangents(nodes, edges, baseDimsById);
    const connections = { edges, anchors: new Map(), enableAutoRouting: true, routingStyle: 'lombardi', lombardiTangents, lombardiCurvature: 1, edgeCurveInfo: new Map() };
    const { pan, zoom } = civilizationView({ nodes, baseDimsById, viewportSize, canvasSize, connections });
    const seen = {
      minX: -pan.x / zoom + canvasSize.offsetX, minY: -pan.y / zoom + canvasSize.offsetY,
      maxX: (viewportSize.width - pan.x) / zoom + canvasSize.offsetX, maxY: (viewportSize.height - pan.y) / zoom + canvasSize.offsetY,
    };
    const byId = new Map(nodes.map(n => [n.id, n]));
    edges.forEach((e) => {
      const { arc } = lombardiArcFor(e, byId.get(e.sourceId), byId.get(e.destinationId), dims(), dims(), lombardiTangents, 1, {});
      const b = arcBounds(arc);
      expect(b.minX).toBeGreaterThan(seen.minX + 100);
      expect(b.minY).toBeGreaterThan(seen.minY + 100);
      expect(b.maxX).toBeLessThan(seen.maxX - 100);
      expect(b.maxY).toBeLessThan(seen.maxY - 100);
    });
  });

  it('caps the zoom at maxZoom', () => {
    const nodes = [{ id: 'one', x: 0, y: 0 }];
    const { zoom } = civilizationView({ nodes, baseDimsById: dimsById(nodes), viewportSize, canvasSize, maxZoom: 1 });
    expect(zoom).toBe(1);
  });
});

describe('watchNewlyOpenedWeb', () => {
  let unsubscribe;
  afterEach(() => unsubscribe?.());

  const watch = (state) => {
    useGraphStore.setState({ _isLoadingUniverse: false, ...state });
    const ref = { current: null };
    unsubscribe = watchNewlyOpenedWeb(ref);
    return ref;
  };

  it('marks a web added to the header and made active', () => {
    const ref = watch({ openGraphIds: ['g1'], activeGraphId: 'g1' });
    useGraphStore.setState({ openGraphIds: ['g1', 'g2'], activeGraphId: 'g2' });
    expect(ref.current).toBe('g2');
  });

  it('ignores switching to a tab already in the header', () => {
    const ref = watch({ openGraphIds: ['g1', 'g2'], activeGraphId: 'g1' });
    useGraphStore.setState({ activeGraphId: 'g2' });
    expect(ref.current).toBe(null);
  });

  it('ignores a universe load', () => {
    const ref = watch({ openGraphIds: [], activeGraphId: null, _isLoadingUniverse: true });
    useGraphStore.setState({ openGraphIds: ['u1'], activeGraphId: 'u1', _isLoadingUniverse: false });
    expect(ref.current).toBe(null);
  });
});
