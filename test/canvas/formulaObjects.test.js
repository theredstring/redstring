import { describe, it, expect, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import {
  computeFormulaObjects, redirectEdgeCtx, filterFormulaEdges,
} from '../../src/components/canvas/formats/formula/formulaObjects.js';
import { formulaWeb } from './formulaWeb.js';

// (a + b) × c shown as a formula, plus an outside Thing wired to c and to the part.
function webState({ shown = true } = {}) {
  const state = formulaWeb({
    things: [['a', 'a', 0], ['b', 'b', 300], ['c', 'c', 700]],
    parts: [{ id: 'g', anchor: 'pa', name: 'a + b', members: ['a', 'b'], x: 150 }],
    ops: [['a', 'b', 'Addition'], ['pa', 'c', 'Multiplication']],
    top: ['a', 'b', 'pa', 'c'],
    extra: [['cat', 'Cat', 1500, 400]],
    format: shown ? 'formula' : undefined,
  });
  const graph = state.graphs.get('web');
  for (const [id, to] of [['out-c', 'c'], ['out-part', 'pa']]) {
    state.edges.set(id, { id, sourceId: 'cat', destinationId: to, definitionNodeIds: [], directionality: { arrowsToward: new Set() } });
    graph.edgeIds.push(id);
  }
  state.edgeList = graph.edgeIds.map(id => state.edges.get(id));
  return state;
}

describe('formula objects', () => {
  it('costs nothing while no formula is shown', () => {
    const state = webState({ shown: false });
    const none = computeFormulaObjects(state);
    expect(none.objects).toEqual([]);
    const ctx = { nodeById: new Map() };
    expect(redirectEdgeCtx(ctx, none)).toBe(ctx);
    expect(filterFormulaEdges(state.edgeList, none)).toBe(state.edgeList);
  });

  it('hides a formula group, its parts and its operations', () => {
    const fo = computeFormulaObjects(webState());
    expect(fo.objects).toHaveLength(1);
    expect(fo.objects[0].text).toBe('(a + b) × c');
    expect([...fo.hiddenIds].sort()).toEqual(['a', 'b', 'c', 'pa']);
    expect([...fo.hiddenGroupIds].sort()).toEqual(['g', 'top']);
    // Only the connections from outside are still drawn.
    const state = webState();
    expect(filterFormulaEdges(state.edgeList, computeFormulaObjects(state)).map(e => e.id)).toEqual(['out-c', 'out-part']);
  });

  it('lands outside connections on tokens (a part on its opening parenthesis), moving nothing stored', () => {
    const state = webState();
    const fo = computeFormulaObjects(state);
    const tokens = fo.objects[0].tokens;
    expect(tokens.map(t => t.text)).toEqual(['(', 'a', '+', 'b', ')', '×', 'c']);
    const nodeById = new Map([...state.graphs.get('web').instances].map(([id, inst]) => [id, { ...inst }]));
    const redirected = redirectEdgeCtx({ nodeById, baseDimsById: new Map() }, fo);
    const cBox = fo.tokenBoxById.get('c');
    expect(redirected.nodeById.get('c')).toMatchObject({ x: cBox.x, y: cBox.y });
    expect(fo.tokenBoxById.get('pa').x).toBe(fo.objects[0].boxes[0].x);
    expect(state.graphs.get('web').instances.get('c').x).toBe(700);
  });

  it('lets the Things come back on their own once they stop being a formula', () => {
    const state = webState();
    state.nodePrototypes.get('p-Addition').name = 'Likes';
    const fo = computeFormulaObjects(state);
    expect(fo.objects).toEqual([]);
    expect(fo.hiddenIds.size).toBe(0);
  });
});
