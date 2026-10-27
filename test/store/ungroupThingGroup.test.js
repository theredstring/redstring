import { describe, it, expect } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';

// Ungrouping a Thing-group takes its title node with it. A group the title
// node was also in (Things grouped around a formula's parentheses) must let it
// go, or it lists a member that isn't there; a collaborator's copy dropped it
// and this one didn't, so the two never matched again.
describe('ungrouping a Thing-group', () => {
  it('its title node leaves the other groups it was in', () => {
    const s = () => useGraphStore.getState();
    s().clearUniverse();
    s().createNewGraph({ id: 'uweb', name: 'W' });
    for (const id of ['whole', 'a', 'b', 'c']) s().addNodePrototype({ id, name: id });
    s().addNodeInstance('uweb', 'a', { x: 0, y: 0 }, 'iA');
    s().addNodeInstance('uweb', 'b', { x: 100, y: 0 }, 'iB');
    s().addNodeInstance('uweb', 'c', { x: 200, y: 0 }, 'iC');
    const thingGroup = s().createGroup('uweb', { name: 'T', memberInstanceIds: ['iA', 'iB'] });
    s().convertGroupToNodeGroup('uweb', thingGroup, 'whole');
    const titleId = s().graphs.get('uweb').groups.get(thingGroup).anchorInstanceId;
    const around = s().createGroup('uweb', { name: 'Around', memberInstanceIds: [titleId, 'iC'] });

    s().deleteGroup('uweb', thingGroup);
    const graph = s().graphs.get('uweb');
    expect(graph.instances.has(titleId)).toBe(false);
    expect(graph.groups.get(around).memberInstanceIds).toEqual(['iC']);
  });
});
