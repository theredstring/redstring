const assert = require('assert');

const { default: useGraphStore } = require('../../src/store/graphStore.js');

// Two duplicate-group defects, pinned:
//  1. applyBulkGraphUpdates minted a NEW group every call, so repeated bulk
//     builds (expandGraph run twice, a re-run wizard turn) stacked identical
//     same-named groups on top of each other.
//  2. The decompose dedup guards compared `linkedDefinitionIndex === definitionIndex`,
//     which misses a half-built node-group whose index is undefined (undefined !== 0),
//     minting a second overlapping group for the same prototype.
describe('group duplicate prevention', () => {
  const st = () => useGraphStore.getState();

  const resetStore = () => {
    useGraphStore.setState({
      graphs: new Map(),
      nodePrototypes: new Map(),
      edges: new Map(),
      openGraphIds: [],
      activeGraphId: null,
      activeDefinitionNodeId: null,
      rightPanelTabs: [{ type: 'home', isActive: true }],
      expandedGraphIds: new Set(),
      savedNodeIds: new Set(),
      savedGraphIds: new Set(),
      isUniverseLoaded: true,
      isUniverseLoading: false,
      universeLoadingError: null,
      hasUniverseFile: true,
    }, false, 'test_reset');
  };

  const addProto = (id, name, definitionGraphIds = []) => {
    st().addNodePrototype({ id, name, description: '', color: '#111111', typeNodeId: null, definitionGraphIds });
  };

  const groupsOf = (graphId) => Array.from(st().graphs.get(graphId).groups.values());

  it('applyBulkGraphUpdates merges into a same-named group instead of duplicating it', () => {
    resetStore();
    st().createNewGraph({ name: 'Main', typeNodeId: null, color: '#333' });
    const graphId = st().activeGraphId;

    st().applyBulkGraphUpdates(graphId, {
      nodes: [{ name: 'Alpha' }, { name: 'Beta' }],
      edges: [],
      groups: [{ name: 'Cluster', color: '#8B0000', memberNames: ['Alpha', 'Beta'] }]
    });
    // Second pass adds a node and names the same group again.
    st().applyBulkGraphUpdates(graphId, {
      nodes: [{ name: 'Gamma' }],
      edges: [],
      groups: [{ name: 'Cluster', color: '#8B0000', memberNames: ['Gamma'] }]
    });

    const groups = groupsOf(graphId);
    assert.strictEqual(groups.length, 1, 'only one "Cluster" group exists');
    assert.strictEqual(groups[0].memberInstanceIds.length, 3, 'the new member merged into the existing group');
  });

  it('decompose does not duplicate a group whose linkedDefinitionIndex was never set', () => {
    resetStore();

    // A definition graph with content to decompose.
    addProto('p-part', 'Part');
    st().createNewGraph({ name: 'Def', typeNodeId: null, color: '#333' });
    const defGraphId = st().activeGraphId;
    st().addNodeInstance(defGraphId, 'p-part', { x: 0, y: 0 }, 'def-part');

    addProto('p-thing', 'Thing', [defGraphId]);
    st().createNewGraph({ name: 'Main', typeNodeId: null, color: '#333' });
    const mainId = st().activeGraphId;
    st().addNodeInstance(mainId, 'p-thing', { x: 100, y: 100 }, 'thing-inst');

    // A half-built node-group: linked to the prototype but with no definition index.
    const groupId = st().createGroup(mainId, { name: 'Thing', color: '#8B0000', memberInstanceIds: ['thing-inst'] });
    st().updateGroup(mainId, groupId, (g) => { g.linkedNodePrototypeId = 'p-thing'; });

    const before = groupsOf(mainId).length;
    st().decomposeNodeToGroup(mainId, 'p-thing', 0, 'thing-inst');

    assert.strictEqual(groupsOf(mainId).length, before, 'decompose reused the existing group rather than adding a duplicate');
  });
});
