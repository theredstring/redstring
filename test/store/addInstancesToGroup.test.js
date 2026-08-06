const assert = require('assert');

const { default: useGraphStore } = require('../../src/store/graphStore.js');
const {
  buildGroupsByMemberIdIndex,
  buildChildGroupIdsIndex,
  computeGroupDepths,
} = require('../../src/services/groupLayout.js');

// Nesting between groups is derived from membership, never stored — see
// isGroupInsideGroup in groupLayout.js. Dropping a node into a nested group
// therefore has to add it to that group's containers too, or the inner group
// stops being contained, loses its depth, and a plain group that loses its
// depth falls back to the flat bottom render layer where the containing
// node-group's opaque shell hides it entirely.
describe('addInstancesToGroup', () => {
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

  // Main graph with four instances: m1/m2 in a plain group, plus c and d.
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

  it('propagates the addition to a containing node-group', () => {
    const graphId = buildGraph();
    const plainId = st().createGroup(graphId, { name: 'Plain', memberInstanceIds: ['m1', 'm2'] });
    const ngId = st().createGroup(graphId, { name: 'NG', memberInstanceIds: ['m1', 'm2', 'c'] });
    st().updateGroup(graphId, ngId, (g) => { g.linkedNodePrototypeId = 'p'; });

    st().addInstancesToGroup(graphId, plainId, ['d']);

    const plain = getGroup(graphId, plainId);
    const ng = getGroup(graphId, ngId);
    assert.ok(plain.memberInstanceIds.includes('d'));
    assert.ok(ng.memberInstanceIds.includes('d'), 'container must gain the member too');
    // Strict-subset relation survives, so the nesting is still detectable.
    assert.ok(plain.memberInstanceIds.length < ng.memberInstanceIds.length);
    for (const id of plain.memberInstanceIds) {
      assert.ok(ng.memberInstanceIds.includes(id), `container missing ${id}`);
    }
  });

  it('propagates up an entire nesting chain', () => {
    const graphId = buildGraph();
    const innerId = st().createGroup(graphId, { name: 'Inner', memberInstanceIds: ['m1'] });
    const middleId = st().createGroup(graphId, { name: 'Middle', memberInstanceIds: ['m1', 'm2'] });
    const outerId = st().createGroup(graphId, { name: 'Outer', memberInstanceIds: ['m1', 'm2', 'c'] });

    st().addInstancesToGroup(graphId, innerId, ['d']);

    assert.deepStrictEqual(getGroup(graphId, innerId).memberInstanceIds, ['m1', 'd']);
    assert.deepStrictEqual(getGroup(graphId, middleId).memberInstanceIds, ['m1', 'm2', 'd']);
    assert.deepStrictEqual(getGroup(graphId, outerId).memberInstanceIds, ['m1', 'm2', 'c', 'd']);
  });

  it('leaves non-containing and peer groups alone', () => {
    const graphId = buildGraph();
    const targetId = st().createGroup(graphId, { name: 'Target', memberInstanceIds: ['m1', 'm2'] });
    // Equal member set — a peer, not a container (strict subset requires more).
    const peerId = st().createGroup(graphId, { name: 'Peer', memberInstanceIds: ['m1', 'm2'] });
    // Overlaps but doesn't contain: missing m2.
    const overlapId = st().createGroup(graphId, { name: 'Overlap', memberInstanceIds: ['m1', 'c', 'd'] });
    const unrelatedId = st().createGroup(graphId, { name: 'Unrelated', memberInstanceIds: ['c'] });

    st().addInstancesToGroup(graphId, targetId, ['d']);

    assert.ok(getGroup(graphId, targetId).memberInstanceIds.includes('d'));
    assert.deepStrictEqual(getGroup(graphId, peerId).memberInstanceIds, ['m1', 'm2']);
    assert.deepStrictEqual(getGroup(graphId, overlapId).memberInstanceIds, ['m1', 'c', 'd']);
    assert.deepStrictEqual(getGroup(graphId, unrelatedId).memberInstanceIds, ['c']);
  });

  it('is idempotent and refreshes semantic relationships', () => {
    const graphId = buildGraph();
    const groupId = st().createGroup(graphId, { name: 'G', memberInstanceIds: ['m1'] });

    st().addInstancesToGroup(graphId, groupId, ['m2']);
    st().addInstancesToGroup(graphId, groupId, ['m2']);

    const group = getGroup(graphId, groupId);
    assert.deepStrictEqual(group.memberInstanceIds, ['m1', 'm2']);
    assert.deepStrictEqual(
      group.semanticMetadata.relationships.map(r => r.subject),
      ['m1', 'm2']
    );
  });

  it('does not treat an empty group as nested inside everything', () => {
    const graphId = buildGraph();
    // A plain group with no members and no anchor has no tie to anything —
    // this is the guardrail on the anchor rule below.
    const emptyId = st().createGroup(graphId, { name: 'Empty', memberInstanceIds: [] });
    const otherId = st().createGroup(graphId, { name: 'Other', memberInstanceIds: ['m1', 'm2'] });

    st().addInstancesToGroup(graphId, emptyId, ['c']);

    assert.deepStrictEqual(getGroup(graphId, emptyId).memberInstanceIds, ['c']);
    assert.deepStrictEqual(getGroup(graphId, otherId).memberInstanceIds, ['m1', 'm2']);
  });

  // Depth as the canvas computes it, so these assert what actually gets rendered
  // rather than just the member arrays.
  const depthsFor = (graphId) => {
    const groupsById = useGraphStore.getState().graphs.get(graphId).groups;
    const byMember = buildGroupsByMemberIdIndex(groupsById);
    return computeGroupDepths(groupsById, byMember, buildChildGroupIdsIndex(groupsById, byMember));
  };

  // An empty node-group (decomposeEmptyNodeToGroup) is nested purely by its
  // anchor. The first drop into one used to propagate nowhere — and it also
  // made the group non-empty, so it lost the anchor tie at the same moment.
  // Both nesting signals vanished at once, permanently.
  const buildEmptyNestedNodeGroup = () => {
    const graphId = buildGraph();
    const outerId = st().createGroup(graphId, { name: 'Outer', memberInstanceIds: ['m1', 'c'] });
    st().updateGroup(graphId, outerId, (g) => { g.linkedNodePrototypeId = 'p'; });
    const emptyId = st().createGroup(graphId, { name: 'Empty NG', memberInstanceIds: [] });
    st().updateGroup(graphId, emptyId, (g) => {
      g.linkedNodePrototypeId = 'p';
      g.anchorInstanceId = 'c';
    });
    return { graphId, outerId, emptyId };
  };

  it('propagates the first add into an empty nested node-group', () => {
    const { graphId, outerId, emptyId } = buildEmptyNestedNodeGroup();

    st().addInstancesToGroup(graphId, emptyId, ['d']);

    assert.deepStrictEqual(getGroup(graphId, emptyId).memberInstanceIds, ['d']);
    assert.ok(getGroup(graphId, outerId).memberInstanceIds.includes('d'), 'container must gain the member too');
    assert.strictEqual(depthsFor(graphId).get(emptyId), 1, 'must still render inside its container');
  });

  it('keeps propagating on later adds, not just the first', () => {
    const { graphId, outerId, emptyId } = buildEmptyNestedNodeGroup();

    st().addInstancesToGroup(graphId, emptyId, ['d']);
    st().addInstancesToGroup(graphId, emptyId, ['m2']);

    assert.deepStrictEqual(getGroup(graphId, emptyId).memberInstanceIds, ['d', 'm2']);
    const outer = getGroup(graphId, outerId).memberInstanceIds;
    assert.ok(outer.includes('d') && outer.includes('m2'));
    assert.strictEqual(depthsFor(graphId).get(emptyId), 1);
  });

  it('treats a node-group with an equal member set as a container', () => {
    // The outer group already holds the node being added, so it does not grow
    // while the target does — the sets come out equal. A node-group's opaque
    // shell would hide the plain group, so it still counts as containing it.
    const graphId = buildGraph();
    const plainId = st().createGroup(graphId, { name: 'Plain', memberInstanceIds: ['m1'] });
    const ngId = st().createGroup(graphId, { name: 'NG', memberInstanceIds: ['m1', 'd'] });
    st().updateGroup(graphId, ngId, (g) => { g.linkedNodePrototypeId = 'p'; });

    st().addInstancesToGroup(graphId, plainId, ['d']);

    assert.deepStrictEqual(getGroup(graphId, plainId).memberInstanceIds, ['m1', 'd']);
    assert.deepStrictEqual(getGroup(graphId, ngId).memberInstanceIds, ['m1', 'd']);
    assert.strictEqual(depthsFor(graphId).get(plainId), 1, 'plain group must not fall behind the shell');
  });

  it('propagates through a chain whose middle link is anchor-nested', () => {
    const graphId = buildGraph();
    const outerId = st().createGroup(graphId, { name: 'Outer', memberInstanceIds: ['c', 'm1'] });
    const midId = st().createGroup(graphId, { name: 'Mid', memberInstanceIds: ['m1'] });
    st().updateGroup(graphId, midId, (g) => {
      g.linkedNodePrototypeId = 'p';
      g.anchorInstanceId = 'c';
    });
    const innerId = st().createGroup(graphId, { name: 'Inner', memberInstanceIds: ['m1'] });

    st().addInstancesToGroup(graphId, innerId, ['d']);

    assert.deepStrictEqual(getGroup(graphId, innerId).memberInstanceIds, ['m1', 'd']);
    assert.deepStrictEqual(getGroup(graphId, midId).memberInstanceIds, ['m1', 'd']);
    assert.deepStrictEqual(getGroup(graphId, outerId).memberInstanceIds, ['c', 'm1', 'd']);
  });

  it('never adds a group its own anchor', () => {
    // A group can't be a member of itself, and letting it happen is the one way
    // to make containment mutual, which the predicate then has to break
    // arbitrarily.
    const graphId = buildGraph();
    const ngId = st().createGroup(graphId, { name: 'NG', memberInstanceIds: ['m1'] });
    st().updateGroup(graphId, ngId, (g) => {
      g.linkedNodePrototypeId = 'p';
      g.anchorInstanceId = 'c';
    });

    st().addInstancesToGroup(graphId, ngId, ['c', 'd']);

    assert.deepStrictEqual(getGroup(graphId, ngId).memberInstanceIds, ['m1', 'd']);
  });
});
