import { describe, it, expect } from 'vitest';
import {
  projectGraphView,
  mapOpenDefinitions,
  resolveOwner,
  connectionHome,
  openGroupId,
  anchorIdFromOpenGroupId,
  initialOpenOffset,
  openInPlaceBlock,
  viewIdOf,
  storedIdOf,
  storedGroupIdOf,
} from '../../src/core/openDefinitions.js';

const graph = (id, instances = [], edgeIds = [], groups = []) => ({
  id, name: id,
  instances: new Map(instances.map(i => [i.id, i])),
  edgeIds,
  groups: new Map(groups.map(g => [g.id, g])),
});
const inst = (id, prototypeId, x, y, extra = {}) => ({ id, prototypeId, x, y, scale: 1, ...extra });
const proto = (id, definitionGraphIds = []) => ({ id, name: id, color: '#111', definitionGraphIds });
const edge = (id, sourceId, destinationId, extra = {}) => ({
  id, sourceId, destinationId, directionality: { arrowsToward: new Set() }, ...extra,
});

/**
 * Main: box (Box, open at offset 1000,0), out. Box's definition: a, b, sub (Sub).
 * Sub's definition: s1. Connections: a→b inside, a→out across (via box).
 */
const world = ({ boxOpen = true, subOpen = false } = {}) => {
  const graphs = new Map();
  graphs.set('main', graph('main', [
    inst('box', 'p-box', 500, 500, boxOpen ? { openDefinition: { index: 0, offset: { x: 1000, y: 0 } } } : {}),
    inst('out', 'p-out', 0, 0),
  ], ['e-across']));
  graphs.set('box-def', graph('box-def', [
    inst('a', 'p-a', 0, 0),
    inst('b', 'p-b', 200, 0),
    inst('sub', 'p-sub', 0, 300, subOpen ? { openDefinition: { index: 0, offset: { x: 0, y: 500 } } } : {}),
  ], ['e-in', 'e-into-sub']));
  graphs.set('sub-def', graph('sub-def', [inst('s1', 'p-s1', 10, 10)]));
  const nodePrototypes = new Map([
    ['p-box', proto('p-box', ['box-def'])],
    ['p-sub', proto('p-sub', ['sub-def'])],
    ['p-out', proto('p-out')], ['p-a', proto('p-a')], ['p-b', proto('p-b')], ['p-s1', proto('p-s1')],
  ]);
  const edges = new Map([
    ['e-across', edge('e-across', 'a', 'out', { sourceVia: ['box'], directionality: { arrowsToward: new Set(['a']) } })],
    ['e-in', edge('e-in', 'a', 'b')],
    ['e-into-sub', edge('e-into-sub', 'b', 's1', { destinationVia: ['sub'] })],
  ]);
  return { graphs, nodePrototypes, edges };
};

describe('openDefinitions: projection', () => {
  it('passes a graph with nothing open straight through', () => {
    const state = world({ boxOpen: false });
    state.graphs.get('main').edgeIds = [];
    expect(projectGraphView(state, 'main')).toBe(state.graphs.get('main'));
  });

  it('draws the definition inside the box at the box offset, without copying', () => {
    const state = world();
    const view = projectGraphView(state, 'main');
    expect(view.instances.get('a')).toMatchObject({ x: 1000, y: 0, prototypeId: 'p-a' });
    expect(view.instances.get('b')).toMatchObject({ x: 1200, y: 0 });
    // The definition itself is untouched.
    expect(state.graphs.get('box-def').instances.get('a').x).toBe(0);
    // The anchor hides behind the box's shell.
    expect(view.instances.get('box')).toMatchObject({ isGroupAnchor: true, anchorForGroupId: openGroupId('box') });
    expect(state.graphs.get('main').instances.get('box').isGroupAnchor).toBeUndefined();

    const group = view.groups.get(openGroupId('box'));
    expect(group).toMatchObject({ isOpenDefinition: true, linkedNodePrototypeId: 'p-box', anchorInstanceId: 'box' });
    expect(group.memberInstanceIds.sort()).toEqual(['a', 'b', 'sub']);
    expect(view.edgeIds).toEqual(expect.arrayContaining(['e-across', 'e-in']));
  });

  it('keeps projected objects stable across unrelated rebuilds', () => {
    const state = world();
    const first = projectGraphView(state, 'main');
    expect(projectGraphView(state, 'main')).toBe(first);
    const renamed = { ...state, nodePrototypes: new Map(state.nodePrototypes) };
    const second = projectGraphView(renamed, 'main');
    expect(second).not.toBe(first);
    expect(second.instances.get('a')).toBe(first.instances.get('a'));
  });

  it('draws a connection into a closed box to the box, arrow included', () => {
    const view = projectGraphView(world({ boxOpen: false }), 'main');
    const shown = view.openView.edges.get('e-across');
    expect(shown.sourceId).toBe('box');
    expect(shown.destinationId).toBe('out');
    expect(Array.from(shown.directionality.arrowsToward)).toEqual(['box']);
    expect(view.instances.has('a')).toBe(false);
  });

  it('draws the same connection to the inner node once the box is open', () => {
    const view = projectGraphView(world(), 'main');
    expect(view.openView.edges.has('e-across')).toBe(false);
  });

  it('nests: a box open inside a box, offsets composed', () => {
    const view = projectGraphView(world({ subOpen: true }), 'main');
    // sub sits at 0,300 in box-def; sub-def opens at +0,+500 of that; box adds +1000,0.
    expect(view.instances.get('s1')).toMatchObject({ x: 1010, y: 510 });
    expect(view.groups.get(openGroupId('box')).memberInstanceIds).toEqual(expect.arrayContaining(['s1', 'sub']));
    expect(view.groups.get(openGroupId('sub')).memberInstanceIds).toEqual(['s1']);
    // Inside the open Sub the connection reaches s1 itself.
    expect(view.openView.edges.has('e-into-sub')).toBe(false);
  });

  it('draws a connection into a closed nested box to that box', () => {
    const view = projectGraphView(world({ subOpen: false }), 'main');
    expect(view.openView.edges.get('e-into-sub').destinationId).toBe('sub');
  });

  it('shows a definition opened inside itself closed', () => {
    const state = world();
    // Box's definition holds another Box, also flagged open.
    state.graphs.get('box-def').instances.set('box2', inst('box2', 'p-box', 0, 600, { openDefinition: { index: 0, offset: { x: 0, y: 0 } } }));
    const { boxes } = mapOpenDefinitions(state.graphs, state.nodePrototypes, 'main');
    expect(Array.from(boxes.keys())).toEqual(['box']);
  });

  it('draws a connection with no via to the closed node whose definition holds its end', () => {
    const state = world({ boxOpen: false });
    state.edges.set('e-across', edge('e-across', 'a', 'out'));
    const view = projectGraphView(state, 'main');
    expect(view.openView.edges.get('e-across').sourceId).toBe('box');
  });

  it('leaves out a connection whose end is nowhere on screen', () => {
    const state = world({ boxOpen: false });
    state.graphs.get('main').instances.delete('box');
    const view = projectGraphView(state, 'main');
    expect(view.edgeIds).not.toContain('e-across');
  });
});

describe('openDefinitions: owners and new connections', () => {
  it('resolves where a visible instance lives and how it is offset', () => {
    const state = world({ subOpen: true });
    expect(resolveOwner(state.graphs, state.nodePrototypes, 'main', 'out')).toMatchObject({ graphId: 'main', path: [] });
    const s1 = resolveOwner(state.graphs, state.nodePrototypes, 'main', 's1');
    expect(s1.graphId).toBe('sub-def');
    expect(s1.offset).toEqual({ x: 1000, y: 500 });
    expect(s1.path.map(step => step.anchorId)).toEqual(['box', 'sub']);
    expect(resolveOwner(state.graphs, state.nodePrototypes, 'main', 'nowhere')).toBeNull();
  });

  it('puts a connection in the innermost graph both ends share', () => {
    const state = world({ subOpen: true });
    const owner = (id) => resolveOwner(state.graphs, state.nodePrototypes, 'main', id);

    expect(connectionHome(owner('a'), owner('b'), 'main')).toEqual({ homeGraphId: 'box-def', viaA: [], viaB: [] });
    expect(connectionHome(owner('a'), owner('out'), 'main')).toEqual({ homeGraphId: 'main', viaA: ['box'], viaB: [] });
    expect(connectionHome(owner('s1'), owner('b'), 'main')).toEqual({ homeGraphId: 'box-def', viaA: ['sub'], viaB: [] });
    expect(connectionHome(owner('s1'), owner('out'), 'main')).toEqual({ homeGraphId: 'main', viaA: ['box', 'sub'], viaB: [] });
  });

  it('round-trips open-box group ids', () => {
    expect(anchorIdFromOpenGroupId(openGroupId('x'))).toBe('x');
    expect(anchorIdFromOpenGroupId('some-group')).toBeNull();
  });

  it('opens a definition with its top-left on the anchor', () => {
    const def = graph('d', [inst('p', 'x', 100, 50), inst('q', 'x', 300, 20)]);
    expect(initialOpenOffset({ x: 1000, y: 1000 }, def)).toEqual({ x: 900, y: 980 });
    expect(initialOpenOffset({ x: 7, y: 8 }, graph('empty'))).toEqual({ x: 7, y: 8 });
  });
});

describe('openDefinitions: what can open in place', () => {
  it('lets a closed node open a definition nothing else shows', () => {
    const { graphs, nodePrototypes } = world({ boxOpen: false });
    expect(openInPlaceBlock(graphs, nodePrototypes, 'main', 'box')).toBeNull();
  });

  it('lets a second node open a definition already open in the view', () => {
    const { graphs, nodePrototypes } = world();
    graphs.get('main').instances.set('box2', inst('box2', 'p-box', 0, 900));
    expect(openInPlaceBlock(graphs, nodePrototypes, 'main', 'box2')).toBeNull();
  });

  it('blocks a node opening its own definition inside itself', () => {
    const { graphs, nodePrototypes } = world();
    // A Box inside Box's own definition, seen through the open box.
    graphs.get('box-def').instances.set('again', inst('again', 'p-box', 0, 600));
    expect(openInPlaceBlock(graphs, nodePrototypes, 'main', 'again')).toBe('inside');
    // And the definition viewed directly.
    expect(openInPlaceBlock(graphs, nodePrototypes, 'box-def', 'again')).toBe('inside');
  });

  it('never blocks a node with no definition yet', () => {
    const { graphs, nodePrototypes } = world();
    expect(openInPlaceBlock(graphs, nodePrototypes, 'main', 'out')).toBeNull();
  });
});

/** world(), plus a second Box ('again') open at 0,2000. */
const twice = (options = {}, againOpen = true) => {
  const state = world(options);
  state.graphs.get('main').instances.set('again', inst('again', 'p-box', 0, 900,
    againOpen ? { openDefinition: { index: 0, offset: { x: 0, y: 2000 } } } : {}));
  return state;
};

describe('openDefinitions: one definition open in two boxes', () => {
  it('reads view ids back to stored ids', () => {
    expect(viewIdOf('', 'a')).toBe('a');
    expect(viewIdOf('again', 'a')).toBe('again/a');
    expect(viewIdOf('again/sub', 's1')).toBe('again/sub/s1');
    expect(storedIdOf('again/sub/s1')).toBe('s1');
    expect(storedIdOf('a')).toBe('a');
    expect(storedGroupIdOf('again/g')).toBe('g');
    expect(storedGroupIdOf(openGroupId('again/sub'))).toBe(openGroupId('again/sub'));
  });

  it('opens both: the first under stored ids, the repeat under view ids', () => {
    const view = projectGraphView(twice(), 'main');
    expect(view.instances.get('a')).toMatchObject({ id: 'a', x: 1000, y: 0 });
    expect(view.instances.get('again/a')).toMatchObject({ id: 'again/a', x: 0, y: 2000, prototypeId: 'p-a' });
    expect(view.instances.get('again/b')).toMatchObject({ x: 200, y: 2000 });
    expect(view.groups.get(openGroupId('box')).memberInstanceIds).toEqual(['a', 'b', 'sub']);
    expect(view.groups.get(openGroupId('again')).memberInstanceIds).toEqual(['again/a', 'again/b', 'again/sub']);
    expect(view.openView.boxes.get('again')).toMatchObject({ instanceId: 'again', repeat: true, scope: 'again' });
    expect(view.openView.boxes.get('box')).toMatchObject({ repeat: false, scope: '' });
  });

  it('draws the definition\'s own connections in each box', () => {
    const view = projectGraphView(twice(), 'main');
    expect(view.edgeIds).toEqual(expect.arrayContaining(['e-in', 'again/e-in']));
    expect(view.openView.edges.has('e-in')).toBe(false);
    expect(view.openView.edges.get('again/e-in')).toMatchObject({ id: 'again/e-in', sourceId: 'again/a', destinationId: 'again/b' });
  });

  it('draws a connection across a box\'s edge to the copy its via goes through', () => {
    const state = twice();
    state.graphs.get('main').edgeIds.push('e-across-again');
    state.edges.set('e-across-again', edge('e-across-again', 'a', 'out', {
      sourceVia: ['again'], directionality: { arrowsToward: new Set(['a']) },
    }));
    const view = projectGraphView(state, 'main');
    expect(view.openView.edges.has('e-across')).toBe(false); // to 'a', through 'box'
    const shown = view.openView.edges.get('e-across-again');
    expect(shown).toMatchObject({ sourceId: 'again/a', destinationId: 'out' });
    expect(Array.from(shown.directionality.arrowsToward)).toEqual(['again/a']);
  });

  it('draws it to the closed node it goes through, not the open copy', () => {
    const state = twice({}, false);
    state.graphs.get('main').edgeIds.push('e-across-again');
    state.edges.set('e-across-again', edge('e-across-again', 'a', 'out', { sourceVia: ['again'] }));
    const view = projectGraphView(state, 'main');
    expect(view.openView.edges.get('e-across-again').sourceId).toBe('again');
  });

  it('nests: a box inside the repeat is addressed through it', () => {
    const view = projectGraphView(twice({ subOpen: true }), 'main');
    expect(view.instances.get('s1')).toMatchObject({ x: 1010, y: 510 });
    expect(view.instances.get('again/sub/s1')).toMatchObject({ x: 10, y: 2510 });
    expect(view.groups.get(openGroupId('again/sub')).memberInstanceIds).toEqual(['again/sub/s1']);
    expect(view.openView.edges.get('again/e-into-sub')).toMatchObject({ sourceId: 'again/b', destinationId: 'again/sub/s1' });
  });

  it('shows the groups inside the definition in each box', () => {
    const state = twice();
    state.graphs.get('box-def').groups.set('g', { id: 'g', name: 'G', memberInstanceIds: ['a', 'b'] });
    const view = projectGraphView(state, 'main');
    expect(view.groups.get('g').memberInstanceIds).toEqual(['a', 'b']);
    expect(view.groups.get('again/g')).toMatchObject({ id: 'again/g', name: 'G', memberInstanceIds: ['again/a', 'again/b'] });
  });

  it('resolves a repeat\'s instance to where it is stored', () => {
    const state = twice({ subOpen: true });
    const owner = resolveOwner(state.graphs, state.nodePrototypes, 'main', 'again/sub/s1');
    expect(owner).toMatchObject({ graphId: 'sub-def', instanceId: 's1', offset: { x: 0, y: 2500 } });
    expect(owner.path.map(step => step.anchorId)).toEqual(['again', 'again/sub']);
  });

  it('puts a connection between the two boxes around both, and one inside a box inside it', () => {
    const state = twice({ subOpen: true });
    const owner = (id) => resolveOwner(state.graphs, state.nodePrototypes, 'main', id);
    expect(connectionHome(owner('a'), owner('again/b'), 'main')).toEqual({ homeGraphId: 'main', viaA: ['box'], viaB: ['again'] });
    expect(connectionHome(owner('again/a'), owner('again/b'), 'main')).toEqual({ homeGraphId: 'box-def', viaA: [], viaB: [] });
    expect(connectionHome(owner('again/sub/s1'), owner('out'), 'main')).toEqual({ homeGraphId: 'main', viaA: ['again', 'sub'], viaB: [] });
    expect(connectionHome(owner('again/sub/s1'), owner('again/a'), 'main')).toEqual({ homeGraphId: 'box-def', viaA: ['sub'], viaB: [] });
  });

  it('still shows a definition opened inside itself closed', () => {
    const state = twice();
    state.graphs.get('box-def').instances.set('box2', inst('box2', 'p-box', 0, 600, { openDefinition: { index: 0, offset: { x: 0, y: 0 } } }));
    const { boxes } = mapOpenDefinitions(state.graphs, state.nodePrototypes, 'main');
    expect(Array.from(boxes.keys())).toEqual(['box', 'again']);
  });
});
