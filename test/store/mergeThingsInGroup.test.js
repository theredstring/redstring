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
});
