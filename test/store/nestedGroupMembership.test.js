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

// A definition graph can itself contain a decomposed node-group. Copying only its
// instances flattens that: the inner Thing's anchor arrives as an ordinary node
// sitting beside its own parts, with the group container dropped — so the nesting
// (shell, z-order, group drag) never exists in the expansion, even though the
// definition graph still shows it.
describe('nested node-groups inside definition graphs', () => {
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
    st().addNodePrototype({
      id, name, description: '', color: '#111111',
      typeNodeId: null, definitionGraphIds
    });
  };

  const getGraph = (graphId) => st().graphs.get(graphId);
  const getGroup = (graphId, groupId) => getGraph(graphId).groups.get(groupId);
  const groupsOf = (graphId) => Array.from(getGraph(graphId).groups.values());

  /**
   * Builds "Top", whose definition graph contains a *decomposed* "Sub" node-group
   * plus one loose sibling node. Returns the ids needed to expand Top elsewhere.
   */
  const buildTopWithNestedDefinition = () => {
    // Sub's own definition: two parts.
    addProto('p-part-a', 'Part A');
    addProto('p-part-b', 'Part B');
    st().createNewGraph({ name: 'Sub Def', typeNodeId: null, color: '#333' });
    const subDefId = st().activeGraphId;
    st().addNodeInstance(subDefId, 'p-part-a', { x: 0, y: 0 }, 'subdef-a');
    st().addNodeInstance(subDefId, 'p-part-b', { x: 100, y: 0 }, 'subdef-b');
    addProto('p-sub', 'Sub', [subDefId]);

    // Top's definition: a Sub instance (decomposed in place) and a sibling.
    addProto('p-sibling', 'Sibling');
    st().createNewGraph({ name: 'Top Def', typeNodeId: null, color: '#333' });
    const topDefId = st().activeGraphId;
    st().addNodeInstance(topDefId, 'p-sub', { x: 0, y: 0 }, 'topdef-sub');
    st().addNodeInstance(topDefId, 'p-sibling', { x: 400, y: 0 }, 'topdef-sibling');
    const defInnerGroupId = st().decomposeNodeToGroup(topDefId, 'p-sub', 0, 'topdef-sub');
    assert.ok(defInnerGroupId, 'setup: Sub should decompose inside Top\'s definition');

    addProto('p-top', 'Top', [topDefId]);

    st().createNewGraph({ name: 'Main', typeNodeId: null, color: '#333' });
    const mainId = st().activeGraphId;
    st().addNodeInstance(mainId, 'p-top', { x: 700, y: 700 }, 'top-inst');

    return { subDefId, topDefId, defInnerGroupId, mainId };
  };

  it('decompose carries a nested node-group across instead of flattening it into a node', () => {
    resetStore();
    const { topDefId, defInnerGroupId, mainId } = buildTopWithNestedDefinition();

    const topGroupId = st().decomposeNodeToGroup(mainId, 'p-top', 0, 'top-inst');
    assert.ok(topGroupId, 'decompose should create a group');

    const mainGroups = groupsOf(mainId);
    assert.strictEqual(mainGroups.length, 2, 'expected the Top group plus the nested Sub group');

    const nested = mainGroups.find(g => g.id !== topGroupId);
    assert.strictEqual(nested.linkedNodePrototypeId, 'p-sub');
    assert.notStrictEqual(nested.id, defInnerGroupId, 'the copy must get a fresh group id');
    assert.strictEqual(
      getGroup(topDefId, defInnerGroupId).memberInstanceIds.length, 2,
      'the definition graph\'s own group must be left untouched'
    );

    // The nested group's anchor is a real instance in the main graph, flagged so the
    // canvas hides it behind the group's shell rather than drawing a duplicate node.
    const anchor = getGraph(mainId).instances.get(nested.anchorInstanceId);
    assert.ok(anchor, 'nested group anchor instance should exist in the main graph');
    assert.strictEqual(anchor.prototypeId, 'p-sub');
    assert.strictEqual(anchor.isGroupAnchor, true);
    assert.strictEqual(anchor.anchorForGroupId, nested.id);

    // Nesting is derived from strict-subset membership, so the containment only
    // registers if every nested member — and the nested anchor — is in the outer group.
    const topGroup = getGroup(mainId, topGroupId);
    assert.strictEqual(nested.memberInstanceIds.length, 2);
    for (const memberId of nested.memberInstanceIds) {
      assert.ok(topGroup.memberInstanceIds.includes(memberId), `Top group should contain ${memberId}`);
    }
    assert.ok(topGroup.memberInstanceIds.includes(nested.anchorInstanceId));
    assert.ok(
      nested.memberInstanceIds.length < topGroup.memberInstanceIds.length,
      'nested membership must be a STRICT subset or the hierarchy never registers'
    );
  });

  it('pushing a group back into its definition preserves the groups nested inside it', () => {
    resetStore();
    const { mainId } = buildTopWithNestedDefinition();

    const topGroupId = st().decomposeNodeToGroup(mainId, 'p-top', 0, 'top-inst');
    const result = st().updateDefinitionFromNodeGroup(mainId, topGroupId);
    assert.ok(result, 'update should succeed');

    const defGroups = groupsOf(result.defGraphId);
    assert.strictEqual(defGroups.length, 1, 'the nested Sub group should land in the definition');
    const nestedInDef = defGroups[0];
    assert.strictEqual(nestedInDef.linkedNodePrototypeId, 'p-sub');

    // The group being pushed IS the definition — it must not also appear as a group
    // inside itself, which would nest Top in Top on the next expansion.
    assert.ok(
      !defGroups.some(g => g.linkedNodePrototypeId === 'p-top'),
      'the pushed group must not be copied into its own definition'
    );

    const defGraph = getGraph(result.defGraphId);
    const nestedAnchor = defGraph.instances.get(nestedInDef.anchorInstanceId);
    assert.ok(nestedAnchor, 'nested anchor should be copied into the definition');
    assert.strictEqual(nestedAnchor.isGroupAnchor, true);
    for (const memberId of nestedInDef.memberInstanceIds) {
      assert.ok(defGraph.instances.has(memberId), `definition should hold nested member ${memberId}`);
    }
  });

  it('combining the outer group dissolves the groups nested inside it', () => {
    resetStore();
    const { mainId } = buildTopWithNestedDefinition();

    const topGroupId = st().decomposeNodeToGroup(mainId, 'p-top', 0, 'top-inst');
    const survivingId = st().combineNodeGroup(mainId, topGroupId);
    assert.strictEqual(survivingId, 'top-inst');

    assert.strictEqual(
      groupsOf(mainId).length, 0,
      'the nested group has no members left — it must fold up with its container, not survive wrapped around the combined node'
    );

    const graph = getGraph(mainId);
    assert.strictEqual(graph.instances.size, 1, 'only the combined node should remain');
    const survivor = graph.instances.get(survivingId);
    assert.ok(!survivor.isGroupAnchor, 'the combined node should no longer be an anchor');
  });

  it('refreshing from the definition replaces nested groups instead of stranding them', () => {
    resetStore();
    const { mainId } = buildTopWithNestedDefinition();

    const topGroupId = st().decomposeNodeToGroup(mainId, 'p-top', 0, 'top-inst');
    const staleNestedId = groupsOf(mainId).find(g => g.id !== topGroupId).id;

    const result = st().refreshNodeGroupFromDefinition(mainId, topGroupId);
    assert.ok(result, 'refresh should succeed');

    const mainGroups = groupsOf(mainId);
    assert.strictEqual(mainGroups.length, 2, 'still exactly one Top group and one nested Sub group');
    assert.ok(!getGraph(mainId).groups.has(staleNestedId), 'the pre-refresh nested group should be gone');

    const nested = mainGroups.find(g => g.id !== topGroupId);
    assert.strictEqual(nested.linkedNodePrototypeId, 'p-sub');

    const graph = getGraph(mainId);
    for (const memberId of nested.memberInstanceIds) {
      assert.ok(graph.instances.has(memberId), `refreshed nested member ${memberId} should exist`);
    }
    assert.ok(graph.instances.has(nested.anchorInstanceId), 'refreshed nested anchor should exist');

    const topGroup = getGroup(mainId, topGroupId);
    for (const memberId of nested.memberInstanceIds) {
      assert.ok(topGroup.memberInstanceIds.includes(memberId), `Top group should contain ${memberId}`);
    }
  });
});
