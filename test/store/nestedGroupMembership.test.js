const assert = require('assert');

const { default: useGraphStore } = require('../../src/store/graphStore.js');

// Nesting between groups is expressed purely as strict-subset membership: the
// inner group's memberInstanceIds must all appear in the outer group's. These
// tests pin that decompose/combine keep outer-group membership in sync — before
// this, decomposing a node inside a group minted members the outer group never
// saw (nesting invisible), and combining an inner group left stale deleted ids
// in the outer group while dropping the surviving node out of it entirely.
describe('nested group membership sync (decompose/combine)', () => {
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
    useGraphStore.getState().addNodePrototype({
      id, name, description: '', color: '#111111',
      typeNodeId: null, definitionGraphIds
    });
  };

  const getGroup = (graphId, groupId) =>
    useGraphStore.getState().graphs.get(graphId).groups.get(groupId);

  it('decomposing a node inside an outer group adds the new members to that outer group', () => {
    resetStore();
    const st = () => useGraphStore.getState();

    // Definition graph with two instances — the content the decompose expands.
    addProto('p-part-a', 'Part A');
    addProto('p-part-b', 'Part B');
    st().createNewGraph({ name: 'Def', typeNodeId: null, color: '#333' });
    const defGraphId = st().activeGraphId;
    st().addNodeInstance(defGraphId, 'p-part-a', { x: 0, y: 0 }, 'def-a');
    st().addNodeInstance(defGraphId, 'p-part-b', { x: 100, y: 0 }, 'def-b');

    addProto('p-inner', 'Inner', [defGraphId]);
    addProto('p-other', 'Other');

    st().createNewGraph({ name: 'Main', typeNodeId: null, color: '#333' });
    const mainId = st().activeGraphId;
    st().addNodeInstance(mainId, 'p-inner', { x: 500, y: 500 }, 'inner-inst');
    st().addNodeInstance(mainId, 'p-other', { x: 800, y: 500 }, 'other-inst');

    const outerId = st().createGroup(mainId, {
      id: 'outer', name: 'Outer', color: '#222222',
      memberInstanceIds: ['inner-inst', 'other-inst']
    });

    const newGroupId = st().decomposeNodeToGroup(mainId, 'p-inner', 0, 'inner-inst');
    assert.ok(newGroupId, 'decompose should create a group');

    const newGroup = getGroup(mainId, newGroupId);
    assert.strictEqual(newGroup.memberInstanceIds.length, 2);

    const outer = getGroup(mainId, outerId);
    // Outer keeps its original members (anchor included) AND gains every new
    // member — making the new group a strict subset (a detectable child).
    assert.ok(outer.memberInstanceIds.includes('inner-inst'));
    assert.ok(outer.memberInstanceIds.includes('other-inst'));
    for (const newMemberId of newGroup.memberInstanceIds) {
      assert.ok(
        outer.memberInstanceIds.includes(newMemberId),
        `outer group should contain new member ${newMemberId}`
      );
    }
  });

  it('combining a nested group swaps its members for the surviving node in every outer group', () => {
    resetStore();
    const st = () => useGraphStore.getState();

    addProto('p-linked', 'Linked');
    addProto('p-m', 'Member');
    addProto('p-other', 'Other');

    st().createNewGraph({ name: 'Main', typeNodeId: null, color: '#333' });
    const mainId = st().activeGraphId;
    st().addNodeInstance(mainId, 'p-m', { x: 0, y: 0 }, 'm1');
    st().addNodeInstance(mainId, 'p-m', { x: 100, y: 0 }, 'm2');
    st().addNodeInstance(mainId, 'p-linked', { x: 50, y: -100 }, 'anchor-inst');
    st().addNodeInstance(mainId, 'p-other', { x: 400, y: 0 }, 'other-inst');

    const innerId = st().createGroup(mainId, {
      id: 'inner', name: 'Inner', color: '#222222',
      memberInstanceIds: ['m1', 'm2']
    });
    st().updateGroup(mainId, innerId, (g) => {
      g.linkedNodePrototypeId = 'p-linked';
      g.anchorInstanceId = 'anchor-inst';
    });

    // Outer A lists the anchor already; Outer B does not — both must end up
    // holding the surviving instance exactly once, with no stale member ids.
    const outerAId = st().createGroup(mainId, {
      id: 'outerA', name: 'Outer A', color: '#222222',
      memberInstanceIds: ['m1', 'm2', 'anchor-inst', 'other-inst']
    });
    const outerBId = st().createGroup(mainId, {
      id: 'outerB', name: 'Outer B', color: '#222222',
      memberInstanceIds: ['m1', 'm2', 'other-inst']
    });

    const survivingId = st().combineNodeGroup(mainId, innerId);
    assert.strictEqual(survivingId, 'anchor-inst');

    for (const outerId of [outerAId, outerBId]) {
      const outer = getGroup(mainId, outerId);
      assert.ok(!outer.memberInstanceIds.includes('m1'), `${outerId} still lists deleted m1`);
      assert.ok(!outer.memberInstanceIds.includes('m2'), `${outerId} still lists deleted m2`);
      assert.ok(outer.memberInstanceIds.includes('other-inst'));
      assert.strictEqual(
        outer.memberInstanceIds.filter(id => id === 'anchor-inst').length, 1,
        `${outerId} should contain the surviving instance exactly once`
      );
    }
  });
});
