const assert = require('assert');

const { default: useGraphStore } = require('../../src/store/graphStore.js');

// The mirror of addInstancesToGroup. Containment is derived from membership
// (isGroupInsideGroup in groupLayout.js), so pulling a node out of an outer
// group while a group nested inside it keeps that node breaks the relation the
// same way adding to the inner one alone does: the inner group stops being
// contained, loses its depth, and — if it's a plain group — drops to the flat
// bottom render layer behind the shell that encloses it.
describe('removeInstancesFromGroup', () => {
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

  const st = () => useGraphStore.getState();
  const getGroup = (graphId, groupId) =>
    useGraphStore.getState().graphs.get(graphId).groups.get(groupId);

  const buildGraph = () => {
    resetStore();
    st().addNodePrototype({ id: 'p', name: 'P', description: '', color: '#111111', typeNodeId: null, definitionGraphIds: [] });
    st().createNewGraph({ name: 'Main', typeNodeId: null, color: '#333' });
    const graphId = st().activeGraphId;
    ['m1', 'm2', 'c', 'd'].forEach((id, i) => {
      st().addNodeInstance(graphId, 'p', { x: i * 100, y: 0 }, id);
    });
    return graphId;
  };

  it('cascades down to every nested group', () => {
    const graphId = buildGraph();
    const innerId = st().createGroup(graphId, { name: 'Inner', memberInstanceIds: ['m1', 'm2'] });
    const outerId = st().createGroup(graphId, { name: 'Outer', memberInstanceIds: ['m1', 'm2', 'c'] });
    st().updateGroup(graphId, outerId, (g) => { g.linkedNodePrototypeId = 'p'; });
    const unrelatedId = st().createGroup(graphId, { name: 'Unrelated', memberInstanceIds: ['m2', 'd'] });

    st().removeInstancesFromGroup(graphId, outerId, ['m2']);

    assert.deepStrictEqual(getGroup(graphId, outerId).memberInstanceIds, ['m1', 'c']);
    assert.deepStrictEqual(getGroup(graphId, innerId).memberInstanceIds, ['m1'], 'nested group must let go too');
    assert.deepStrictEqual(getGroup(graphId, unrelatedId).memberInstanceIds, ['m2', 'd']);
  });

  it('does not propagate upward', () => {
    // Removing from the inner group only shrinks it, which keeps it contained.
    const graphId = buildGraph();
    const innerId = st().createGroup(graphId, { name: 'Inner', memberInstanceIds: ['m1', 'm2'] });
    const outerId = st().createGroup(graphId, { name: 'Outer', memberInstanceIds: ['m1', 'm2', 'c'] });

    st().removeInstancesFromGroup(graphId, innerId, ['m2']);

    assert.deepStrictEqual(getGroup(graphId, innerId).memberInstanceIds, ['m1']);
    assert.deepStrictEqual(getGroup(graphId, outerId).memberInstanceIds, ['m1', 'm2', 'c']);
  });

  it('removes only the named instances from descendants, not their whole membership', () => {
    // Dropping a nested node-group's anchor from the outer group must not take
    // that node-group's members with it — only the ids actually asked for go.
    const graphId = buildGraph();
    const outerId = st().createGroup(graphId, { name: 'Outer', memberInstanceIds: ['c', 'm1', 'm2'] });
    const innerId = st().createGroup(graphId, { name: 'Inner', memberInstanceIds: ['m1', 'm2'] });
    st().updateGroup(graphId, innerId, (g) => {
      g.linkedNodePrototypeId = 'p';
      g.anchorInstanceId = 'c';
    });

    st().removeInstancesFromGroup(graphId, outerId, ['c']);

    assert.deepStrictEqual(getGroup(graphId, outerId).memberInstanceIds, ['m1', 'm2']);
    assert.deepStrictEqual(getGroup(graphId, innerId).memberInstanceIds, ['m1', 'm2']);
  });

  it('refreshes semantic relationships on every group it touches', () => {
    const graphId = buildGraph();
    const innerId = st().createGroup(graphId, { name: 'Inner', memberInstanceIds: ['m1', 'm2'] });
    const outerId = st().createGroup(graphId, { name: 'Outer', memberInstanceIds: ['m1', 'm2', 'c'] });

    st().removeInstancesFromGroup(graphId, outerId, ['m2']);

    assert.deepStrictEqual(
      getGroup(graphId, outerId).semanticMetadata.relationships.map(r => r.subject),
      ['m1', 'c']
    );
    assert.deepStrictEqual(
      getGroup(graphId, innerId).semanticMetadata.relationships.map(r => r.subject),
      ['m1']
    );
  });
});
