import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useCanvasUIStore from '../../src/store/canvasUIStore.js';

/**
 * Edge selection lives in canvasUIStore (P2.03c, D-22). graphStore keeps its
 * five action names as shims that forward there without touching graphStore,
 * so an edge click no longer runs its save middleware.
 *
 * The no-op guard (P1.09) carries over: NodeCanvas clears the selection with
 * `new Set()` on several paths where it is usually empty already, and each of
 * those used to be a fresh Set, so a full canvas render, for nothing.
 */
describe('edge selection (P1.09 guard, P2.03c store)', () => {
  const graph = () => useGraphStore.getState();
  const ui = () => useCanvasUIStore.getState();
  let notifications;
  let graphNotifications;
  const unsubscribes = [];

  beforeEach(() => {
    useCanvasUIStore.setState({ selectedEdgeIds: new Set(), selectedEdgeId: null });
    notifications = 0;
    graphNotifications = 0;
    unsubscribes.push(useCanvasUIStore.subscribe(() => { notifications++; }));
    unsubscribes.push(useGraphStore.subscribe(() => { graphNotifications++; }));
  });

  afterEach(() => {
    unsubscribes.splice(0).forEach((u) => u());
    vi.restoreAllMocks();
  });

  it('graphStore action names forward to canvasUIStore and never notify graphStore', () => {
    graph().setSelectedEdgeId('e1');
    graph().setSelectedEdgeIds(['a', 'b']);
    graph().addSelectedEdgeId('c');
    graph().removeSelectedEdgeId('a');
    expect(ui().selectedEdgeId).toBe('e1');
    expect([...ui().selectedEdgeIds].sort()).toEqual(['b', 'c']);
    graph().clearSelectedEdgeIds();
    expect(ui().selectedEdgeIds.size).toBe(0);
    expect(graphNotifications).toBe(0);
    expect('selectedEdgeIds' in graph()).toBe(false);
  });

  it('does not write when clearing an already-empty selection', () => {
    const beforeSet = ui().selectedEdgeIds;
    graph().setSelectedEdgeIds(new Set());
    graph().setSelectedEdgeIds([]);
    graph().setSelectedEdgeIds(undefined); // new Set(undefined) is empty, as before
    graph().clearSelectedEdgeIds();
    graph().removeSelectedEdgeId('nope');

    expect(ui().selectedEdgeIds).toBe(beforeSet);
    expect(notifications).toBe(0);
  });

  it('does not write when the members are the same, whatever iterable carries them', () => {
    graph().setSelectedEdgeIds(['a', 'b']);
    expect(notifications).toBe(1);
    const stored = ui().selectedEdgeIds;

    graph().setSelectedEdgeIds(new Set(['b', 'a']));       // order
    graph().setSelectedEdgeIds(['a', 'b', 'a']);           // duplicates
    graph().setSelectedEdgeIds(new Map([['a', 1], ['b', 2]]).keys()); // iterator
    graph().addSelectedEdgeId('a');                          // already there

    expect(ui().selectedEdgeIds).toBe(stored);
    expect(notifications).toBe(1);
  });

  it('writes when the size or the members differ', () => {
    graph().setSelectedEdgeIds(['a', 'b']);
    graph().setSelectedEdgeIds(['a']);          // smaller
    expect([...ui().selectedEdgeIds]).toEqual(['a']);
    graph().setSelectedEdgeIds(['a', 'c']);     // larger
    graph().setSelectedEdgeIds(['a', 'd']);     // same size, different member
    expect([...ui().selectedEdgeIds].sort()).toEqual(['a', 'd']);
    graph().setSelectedEdgeIds([]);             // cleared
    expect(ui().selectedEdgeIds.size).toBe(0);
    expect(notifications).toBe(5);
  });

  it("still stores its own copy, never the caller's Set", () => {
    const mine = new Set(['x']);
    graph().setSelectedEdgeIds(mine);
    expect(ui().selectedEdgeIds).not.toBe(mine);
    mine.add('y');
    expect([...ui().selectedEdgeIds]).toEqual(['x']);
  });

  it('does not log', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    graph().setSelectedEdgeIds(['a']);
    graph().setSelectedEdgeId('a');
    graph().clearSelectedEdgeIds();
    expect(log).not.toHaveBeenCalled();
  });

  it('removeEdge drops the removed edge from both selections', () => {
    const g = graph();
    const graphId = 'g-edge-sel';
    useGraphStore.setState((s) => ({
      graphs: new Map(s.graphs).set(graphId, { id: graphId, instances: new Map(), edgeIds: ['e9'], groups: new Map() }),
      edges: new Map(s.edges).set('e9', { id: 'e9', sourceId: 'x', destinationId: 'y' }),
    }));
    g.setSelectedEdgeId('e9');
    g.setSelectedEdgeIds(['e9', 'e10']);
    graph().removeEdge('e9');
    expect(ui().selectedEdgeId).toBeNull();
    expect([...ui().selectedEdgeIds]).toEqual(['e10']);
  });
});
