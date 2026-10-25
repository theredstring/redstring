import { describe, it, expect, beforeEach, vi } from 'vitest';

const copied = [];
vi.mock('../../src/utils/systemClipboard.js', () => ({
  copyText: async (text) => { copied.push(text); return true; },
  default: async (text) => { copied.push(text); return true; },
}));

import useGraphStore from '../../src/store/graphStore.js';
import { copyFormula } from '../../src/components/canvas/formats/formula/copyFormula.js';
import { pasteClipboard, pasteLabelFor } from '../../src/utils/clipboard.js';
import { readFormulaGroup, chainText } from '../../src/components/canvas/formats/formula/formulaChain.js';
import { projectGraphView, openGroupId } from '../../src/core/openDefinitions.js';
import { formulaWeb } from './formulaWeb.js';

/**
 * A formula's Copy (formats/formula/copyFormula): its text to the system
 * clipboard, and the formula to the canvas clipboard, pasting back as the
 * same formula: its Things, parts and connections, or, opened in place, its
 * equation's Thing opened as its formula.
 */
const dims = () => ({ currentWidth: 100, currentHeight: 50 });

// √(a + b) × c, as the web's own Things: the part `g` (anchor `pa`) inside the formula `top`.
const ownThings = () => formulaWeb({
  things: [['a', 'a', 0], ['b', 'b', 200], ['c', 'c', 600]],
  ops: [['a', 'b', 'Addition'], ['pa', 'c', 'Multiplication']],
  parts: [{ id: 'g', anchor: 'pa', name: 'a + b', type: 'Square Root', members: ['a', 'b'] }],
  top: ['a', 'b', 'pa', 'c'],
  format: 'formula',
});

const textOf = (groupId) => {
  const st = useGraphStore.getState();
  const graph = st.graphs.get('web');
  return chainText(readFormulaGroup(st, graph, graph.groups.get(groupId)));
};

const paste = (clip, at) => {
  const st = useGraphStore.getState();
  return pasteClipboard(clip, 'web', at, st, st.graphs.get('web'), dims);
};

beforeEach(() => { copied.length = 0; });

describe('copying a formula of the web\'s own Things', () => {
  beforeEach(() => { useGraphStore.setState(ownThings()); });

  it('puts its text on the system clipboard', () => {
    const clip = copyFormula('web', 'top');
    expect(clip.kind).toBe('formula');
    expect(copied).toEqual([textOf('top')]);
    expect(pasteLabelFor(clip)).toBe('Paste Formula');
  });

  it('pastes back as the same formula, parts and all', () => {
    const text = textOf('top');
    const result = paste(copyFormula('web', 'top'), { x: 0, y: 1000 });

    const graph = useGraphStore.getState().graphs.get('web');
    expect(graph.groups.size).toBe(4);
    const [outerId, partId] = result.newGroupIds;
    const outer = graph.groups.get(outerId);
    const part = graph.groups.get(partId);
    expect(outer.format).toBe('formula');
    expect(outer.memberInstanceIds.every(id => result.newInstanceIds.includes(id))).toBe(true);
    const anchor = graph.instances.get(part.anchorInstanceId);
    expect(anchor).toMatchObject({ isGroupAnchor: true, anchorForGroupId: partId });
    expect(outer.memberInstanceIds).toContain(part.anchorInstanceId);
    expect(textOf(outerId)).toBe(text);
    // A plain group has no anchor: it is selected as itself.
    expect(result.selectGroupId).toBe(outerId);
  });

  it('copies nothing from a group not shown as its formula, or a part of one', () => {
    useGraphStore.setState(formulaWeb({ things: [['a', 'a', 0], ['b', 'b', 200]], ops: [['a', 'b', 'Addition']], top: ['a', 'b'] }));
    expect(copyFormula('web', 'top')).toBeNull();
    useGraphStore.setState(ownThings());
    expect(copyFormula('web', 'g')).toBeNull();
    expect(copied).toEqual([]);
  });
});

describe('copying a formula opened in place', () => {
  // The equation's Thing `eq`, its definition `def` holding a + b, placed in `web` open as its formula.
  beforeEach(() => {
    const defWeb = formulaWeb({ things: [['a', 'a', 0], ['b', 'b', 200]], ops: [['a', 'b', 'Addition']] });
    const def = { ...defWeb.graphs.get('web'), id: 'def' };
    const nodePrototypes = new Map(defWeb.nodePrototypes);
    nodePrototypes.set('eq', { id: 'eq', name: 'Sum', color: '#8B0000', definitionGraphIds: ['def'] });
    const instances = new Map([['box', {
      id: 'box', prototypeId: 'eq', x: 100, y: 100, format: 'formula', formulaSize: 2,
      openDefinition: { index: 0, offset: { x: 150, y: 120 } },
    }]]);
    useGraphStore.setState({
      activeGraphId: 'web',
      graphs: new Map([['web', { id: 'web', name: 'Web', instances, edgeIds: [], groups: new Map() }], ['def', def]]),
      nodePrototypes,
      edges: defWeb.edges,
    });
  });

  it('pastes its Thing, opened as its formula where it stood from the node', () => {
    const clip = copyFormula('web', openGroupId('box'));
    expect(copied).toHaveLength(1);
    expect(clip.nodes).toHaveLength(1);
    expect(clip.groups).toBeUndefined();

    // Pasted into another web, it opens there.
    useGraphStore.setState((s) => ({ graphs: new Map(s.graphs).set('other', { id: 'other', name: 'Other', instances: new Map(), edgeIds: [], groups: new Map() }) }));
    const st = useGraphStore.getState();
    const result = pasteClipboard(clip, 'other', { x: 500, y: 500 }, st, st.graphs.get('other'), dims);
    const pasted = useGraphStore.getState().graphs.get('other').instances.get(result.newInstanceIds[0]);
    expect(pasted).toMatchObject({ prototypeId: 'eq', format: 'formula', formulaSize: 2 });
    expect(pasted.openDefinition.index).toBe(0);
    expect(pasted.openDefinition.offset).toEqual({ x: pasted.x + 50, y: pasted.y + 20 });
    expect(result.selectIds).toEqual([pasted.id]);
    expect(projectGraphView(useGraphStore.getState(), 'other').groups.get(openGroupId(pasted.id))?.format).toBe('formula');
  });
});
