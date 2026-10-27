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
import { computeGroupLayout, buildGroupsByMemberIdIndex, groupLabelSizing } from '../../src/services/groupLayout.js';

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

  it('gives the same object for the same web while its font loads, and works it out again once loaded', () => {
    // React reads a store snapshot twice and loops forever if it differs.
    const fonts = { status: 'loading' };
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
    try {
      const state = webState();
      const early = computeFormulaObjects(state);
      expect(computeFormulaObjects(state)).toBe(early);
      fonts.status = 'loaded';
      const loaded = computeFormulaObjects(state);
      expect(loaded).not.toBe(early);
      expect(computeFormulaObjects(state)).toBe(loaded);
    } finally {
      delete document.fonts;
    }
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
    // Standard notation by default: (a + b)c.
    expect(tokens.map(t => t.text)).toEqual(['(', 'a', '+', 'b', ')', 'c']);
    expect(computeFormulaObjects(state, { standard: false }).objects[0].tokens.map(t => t.text))
      .toEqual(['(', 'a', '+', 'b', ')', '×', 'c']);
    const nodeById = new Map([...state.graphs.get('web').instances].map(([id, inst]) => [id, { ...inst }]));
    const redirected = redirectEdgeCtx({ nodeById, baseDimsById: new Map() }, fo);
    const cBox = fo.tokenBoxById.get('c');
    expect(redirected.nodeById.get('c')).toMatchObject({ x: cBox.x, y: cBox.y });
    expect(fo.tokenBoxById.get('pa').x).toBe(fo.objects[0].boxes[0].x);
    expect(state.graphs.get('web').instances.get('c').x).toBe(700);
  });

  it('stands across the middle of its box as Things, which a part on one side widens', () => {
    // Swapping between the two then runs straight in and out, not sideways.
    const state = webState();
    const graph = state.graphs.get('web');
    const fo = computeFormulaObjects(state);
    const named = new Map([...graph.groups].map(([id, g]) => [id, { ...g, name: state.nodePrototypes.get(g.linkedNodePrototypeId)?.name || g.name }]));
    const box = computeGroupLayout(named.get('top'), {
      nodesById: graph.instances,
      dimsById: new Map([...graph.instances.keys()].map(id => [id, { currentWidth: 120, currentHeight: 100 }])),
      groupsById: named,
      groupsByMemberId: buildGroupsByMemberIdIndex(named),
      gridSize: state.gridSettings?.size || 200,
      ...groupLabelSizing(state.textSettings, () => 0),
    }).rect;
    expect(fo.objects[0].center.x).toBeCloseTo(box.x + box.w / 2, 6);
    // The Things alone (a at 0 to c ending at 820) are centred further right.
    expect(box.x + box.w / 2).toBeLessThan(410 - 1);
  });

  it('lets the Things come back on their own once they stop being a formula', () => {
    const state = webState();
    state.nodePrototypes.get('p-Addition').name = 'Likes';
    const fo = computeFormulaObjects(state);
    expect(fo.objects).toEqual([]);
    expect(fo.hiddenIds.size).toBe(0);
  });
});
