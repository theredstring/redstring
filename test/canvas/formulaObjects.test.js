import { describe, it, expect, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import {
  computeFormulaObjects, redirectEdgeCtx, filterFormulaEdges,
} from '../../src/components/canvas/formats/formula/formulaObjects.js';

// a + b, grouped, plus an outside Thing wired to b.
function webState({ shown = true } = {}) {
  const protos = [['p-plus', 'Addition'], ['p-a', 'a'], ['p-b', 'b'], ['p-cat', 'Cat']];
  const nodePrototypes = new Map(protos.map(([id, name]) => [id, { id, name, color: '#8B0000' }]));
  const at = (id, prototypeId, x, y) => [id, { id, prototypeId, x, y }];
  const instances = new Map([at('plus', 'p-plus', 100, 0), at('a', 'p-a', 0, 200), at('b', 'p-b', 200, 200), at('cat', 'p-cat', 900, 200)]);
  const edgeList = [['plus', 'a'], ['plus', 'b'], ['cat', 'b']].map(([s, d]) => ({
    id: `${s}-${d}`, sourceId: s, destinationId: d, directionality: { arrowsToward: new Set([d]) },
  }));
  const groups = new Map([['g1', { id: 'g1', name: 'Sum', memberInstanceIds: ['plus', 'a', 'b'], ...(shown ? { format: 'formula' } : {}) }]]);
  return {
    activeGraphId: 'web',
    graphs: new Map([['web', { id: 'web', name: 'Web', instances, edgeIds: edgeList.map(e => e.id), groups }]]),
    nodePrototypes, edges: new Map(edgeList.map(e => [e.id, e])), edgePrototypes: new Map(),
    edgeList,
  };
}

describe('formula objects', () => {
  it('costs nothing while no formula is shown', () => {
    const state = webState({ shown: false });
    const none = computeFormulaObjects(state);
    expect(none.objects).toEqual([]);
    expect(redirectEdgeCtx({ nodeById: new Map() }, none).nodeById).toBeInstanceOf(Map);
    expect(filterFormulaEdges(state.edgeList, none)).toBe(state.edgeList);
  });

  it('hides a group marked as a formula, its frame and its inner connections', () => {
    const state = webState();
    const fo = computeFormulaObjects(state);
    expect(fo.objects).toHaveLength(1);
    expect(fo.objects[0].text).toBe('a + b');
    expect([...fo.hiddenIds].sort()).toEqual(['a', 'b', 'plus']);
    expect([...fo.hiddenGroupIds]).toEqual(['g1']);
    // Only the outside connection is still drawn.
    expect(filterFormulaEdges(state.edgeList, fo).map(e => e.id)).toEqual(['cat-b']);
  });

  it('lands outside connections on the token, without moving anything stored', () => {
    const state = webState();
    const fo = computeFormulaObjects(state);
    const nodeById = new Map([...state.graphs.get('web').instances].map(([id, inst]) => [id, { ...inst }]));
    const ctx = { nodeById, baseDimsById: new Map() };
    const redirected = redirectEdgeCtx(ctx, fo);
    const box = fo.tokenBoxById.get('b');
    expect(redirected.nodeById.get('b')).toMatchObject({ x: box.x, y: box.y });
    expect(redirected.baseDimsById.get('b')).toMatchObject({ currentWidth: box.w, currentHeight: box.h });
    expect(ctx.nodeById.get('b').x).toBe(200);
    expect(state.graphs.get('web').instances.get('b').x).toBe(200);
  });

  it('lets the Things come back on their own once they stop being a formula', () => {
    const state = webState();
    state.nodePrototypes.set('p-plus', { id: 'p-plus', name: 'Dog', color: '#8B0000' });
    const fo = computeFormulaObjects(state);
    expect(fo.objects).toEqual([]);
    expect(fo.hiddenIds.size).toBe(0);
  });
});
