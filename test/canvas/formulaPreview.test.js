import { describe, it, expect, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
vi.mock('../../src/services/textMeasurement.js', async (orig) => ({
  ...(await orig()),
  measureTextWidth: (text) => String(text || '').length * 20,
}));
import { layoutWebPreview, layoutPreviewConnections } from '../../src/components/webPreview/webPreviewLayout.js';
import { formulaWeb } from './formulaWeb.js';

// (a + b) × c, with an outside Thing wired to c: the web as a preview is given it.
function preview({ shown = true } = {}) {
  const state = formulaWeb({
    things: [['a', 'a', 0], ['b', 'b', 300], ['c', 'c', 700]],
    parts: [{ id: 'g', anchor: 'pa', name: 'a + b', members: ['a', 'b'], x: 150 }],
    ops: [['a', 'b', 'Addition'], ['pa', 'c', 'Multiplication']],
    top: ['a', 'b', 'pa', 'c'],
    extra: [['cat', 'Cat', 1500, 400]],
    format: shown ? 'formula' : undefined,
  });
  const graph = state.graphs.get('web');
  state.edges.set('out-c', { id: 'out-c', sourceId: 'cat', destinationId: 'c', definitionNodeIds: [], directionality: { arrowsToward: new Set() } });
  graph.edgeIds.push('out-c');
  const nodes = [...graph.instances.values()].map(inst => ({ ...state.nodePrototypes.get(inst.prototypeId), ...inst }));
  const edges = graph.edgeIds.map(id => state.edges.get(id));
  const layout = layoutWebPreview({
    nodes, edges, groups: graph.groups, nodePrototypes: state.nodePrototypes, edgePrototypes: state.edgePrototypes,
    textSettings: state.textSettings, gridSize: 200,
  });
  return { layout, nodes, edges };
}

describe('a formula in a web preview', () => {
  it('is drawn as its formula, not as its group and Things', () => {
    const { layout } = preview();
    expect(layout.formulas.objects).toHaveLength(1);
    expect(layout.groupShapes).toEqual([]);
    for (const id of ['a', 'b', 'c', 'pa']) expect(layout.hiddenIds.has(id)).toBe(true);
    expect(layout.hiddenIds.has('cat')).toBe(false);
    const { frame } = layout.formulas.objects[0];
    expect(layout.bounds.minY).toBeLessThanOrEqual(frame.y);
  });

  it('draws only the connections from outside, landed on the formula', () => {
    const { layout, nodes, edges } = preview();
    const settings = { enableAutoRouting: false, routingStyle: 'straight', multiConnectionCurve: 1, connectionWidth: 1 };
    const drawn = layoutPreviewConnections(layout, nodes, edges, settings, 1);
    expect(drawn.map(c => c.edge.id)).toEqual(['out-c']);
    const token = layout.formulas.standIns.get('c');
    expect(drawn[0].geometry.destNode.x).toBe(token.x);
  });

  it('is left as its group while it is shown as its Things', () => {
    const { layout } = preview({ shown: false });
    expect(layout.formulas.objects).toEqual([]);
    expect(layout.groupShapes.length).toBeGreaterThan(0);
  });
});
