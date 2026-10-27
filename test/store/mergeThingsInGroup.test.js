import { describe, it, expect } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';

// Merging two Things removes the duplicate placement from a web; the groups
// it was in must hold the Thing it became, not an id that points at nothing.
describe('merging Things in a group', () => {
  it('the group holds the Thing it became', () => {
    useGraphStore.getState().clearUniverse();
    useGraphStore.getState().createNewGraph({ id: 'gweb', name: 'W' });
    for (const id of ['fern', 'moss', 'seed']) useGraphStore.getState().addNodePrototype({ id, name: id });
    useGraphStore.getState().addNodeInstance('gweb', 'fern', { x: 0, y: 0 }, 'iFern');
    useGraphStore.getState().addNodeInstance('gweb', 'moss', { x: 100, y: 0 }, 'iMoss');
    useGraphStore.getState().addNodeInstance('gweb', 'seed', { x: 200, y: 0 }, 'iSeed');
    useGraphStore.getState().createGroup('gweb', { name: 'G', memberInstanceIds: ['iMoss', 'iSeed'] });
    useGraphStore.getState().mergeNodePrototypes('fern', 'moss');
    const graph = useGraphStore.getState().graphs.get('gweb');
    const group = [...graph.groups.values()].find((g) => g.name === 'G');
    expect([...group.memberInstanceIds].sort()).toEqual(['iFern', 'iSeed']);
  });

  // A Thing-group's title node is the group's: merging its Thing into a
  // Thing already in the web (a formula's √(x + 1) into x) used to delete it,
  // leaving the group's title pointing at nothing.
  it('a Thing-group keeps its title node, which takes the other Thing', () => {
    useGraphStore.getState().clearUniverse();
    useGraphStore.getState().createNewGraph({ id: 'tweb', name: 'W' });
    for (const id of ['whole', 'part', 'other']) useGraphStore.getState().addNodePrototype({ id, name: id });
    useGraphStore.getState().addNodeInstance('tweb', 'part', { x: 0, y: 0 }, 'iPart');
    useGraphStore.getState().addNodeInstance('tweb', 'other', { x: 100, y: 0 }, 'iOther');
    const groupId = useGraphStore.getState().createGroup('tweb', { name: 'G', memberInstanceIds: ['iPart', 'iOther'] });
    useGraphStore.getState().convertGroupToNodeGroup('tweb', groupId, 'whole');
    const before = useGraphStore.getState().graphs.get('tweb').groups.get(groupId);
    expect(before.anchorInstanceId).toBeTruthy();

    useGraphStore.getState().mergeNodePrototypes('part', 'whole');
    const graph = useGraphStore.getState().graphs.get('tweb');
    const group = graph.groups.get(groupId);
    expect(graph.instances.has(group.anchorInstanceId)).toBe(true);
    expect(graph.instances.get(group.anchorInstanceId).prototypeId).toBe('part');
    expect(group.linkedNodePrototypeId).toBe('part');
    expect(graph.instances.has('iPart')).toBe(true);
  });
});
