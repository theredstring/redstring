import { describe, it, expect, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 300, currentHeight: 120 }),
}));
import { layoutWebPreview, prepareConnections, previewFitBounds } from '../../src/components/webPreview/webPreviewLayout.js';
import { connectionRoutingSettings } from '../../src/utils/canvas/settledConnection.js';
import { lombardiArcFor, sampleArc } from '../../src/utils/canvas/edgeRouting.js';

// Three Things joined in a ring, as a Cup of Coffee's web: under Lombardi their
// connections are one circle, which bows well past the Things it joins.
const nodes = [
  { id: 'vessel', name: 'Ceramic Vessel', x: 400, y: 0 },
  { id: 'coffee', name: 'Brewed Coffee', x: 0, y: 700 },
  { id: 'heat', name: 'Heat', x: 800, y: 700 },
];
const connection = (id, sourceId, destinationId) => ({
  id, sourceId, destinationId, definitionNodeIds: [], directionality: { arrowsToward: new Set([destinationId]) },
});
const edges = [
  connection('e1', 'vessel', 'coffee'),
  connection('e2', 'coffee', 'heat'),
  connection('e3', 'heat', 'vessel'),
];

const fitIn = (routingStyle) => {
  const layout = layoutWebPreview({
    nodes, edges, groups: new Map(), nodePrototypes: new Map(), edgePrototypes: new Map(), textSettings: {}, gridSize: 200,
  });
  const settings = connectionRoutingSettings({ autoLayoutSettings: { enableAutoRouting: true, routingStyle }, textSettings: {} });
  const prepared = prepareConnections(layout, nodes, edges, settings);
  return { layout, prepared, fit: previewFitBounds(layout, prepared) };
};

describe('fitting a web preview', () => {
  it('holds every Lombardi arc', () => {
    const { prepared, fit } = fitIn('lombardi');
    const { scene } = prepared;
    const dims = scene.dimsById.get('vessel');
    let sampled = 0;
    for (const edge of edges) {
      const { arc } = lombardiArcFor(
        edge, scene.nodeById.get(edge.sourceId), scene.nodeById.get(edge.destinationId), dims, dims,
        scene.lombardiTangents, scene.lombardiCurvature,
      );
      expect(arc, edge.id).toBeTruthy();
      for (const p of sampleArc(arc)) {
        sampled++;
        expect(p.x).toBeGreaterThanOrEqual(fit.minX);
        expect(p.x).toBeLessThanOrEqual(fit.maxX);
        expect(p.y).toBeGreaterThanOrEqual(fit.minY);
        expect(p.y).toBeLessThanOrEqual(fit.maxY);
      }
    }
    expect(sampled).toBeGreaterThan(0);
  });

  it('grows past the Things only for the connections that bow past them', () => {
    const lombardi = fitIn('lombardi');
    expect(lombardi.fit.maxY).toBeGreaterThan(lombardi.layout.bounds.maxY);
    const straight = fitIn('straight');
    expect(straight.fit).toEqual(straight.layout.bounds);
  });
});
