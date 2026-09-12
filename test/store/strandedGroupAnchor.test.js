const assert = require('assert');

const { default: useGraphStore } = require('../../src/store/graphStore.js');

// The "invisible node" defect: an instance keeps `isGroupAnchor` while no group names
// it back. The node layer hides flagged anchors unconditionally, but the single-selection
// render path doesn't check the flag — so the node vanishes except while selected, with
// its edges still drawn to where it isn't.
//
// Observed as two flagged anchors on one group: `ensureGroupAnchor` minted a fresh anchor
// past a stranded one, and the group it belonged to was memberless with no
// `emptyPlaceholderOrigin`, so `computeGroupLayout` returned ok:false and the shell that
// would have stood in for the hidden anchor was never drawn either.
describe('stranded group anchors', () => {
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

  // Builds a graph holding one node-group whose anchor instance is flagged, and returns
  // the ids. `anchorInstanceId` is left dangling to model the state a stale save leaves.
  const setupDanglingGroup = () => {
    resetStore();
    st().createNewGraph({ name: 'Main', typeNodeId: null, color: '#333' });
    const graphId = st().activeGraphId;
    const protoId = 'proto-chatgpt';
    st().addNodePrototype({ id: protoId, name: 'ChatGPT', description: '', color: '#8B0000', typeNodeId: null, definitionGraphIds: [] });

    const instId = 'inst-flagged';
    const groupId = 'group-1';
    useGraphStore.setState((state) => {
      const graphs = new Map(state.graphs);
      const graph = { ...graphs.get(graphId) };
      graph.instances = new Map(graph.instances);
      graph.instances.set(instId, {
        id: instId, prototypeId: protoId, x: 400, y: 250, scale: 1,
        isGroupAnchor: true, anchorForGroupId: groupId,
      });
      graph.groups = new Map(graph.groups || []);
      graph.groups.set(groupId, {
        id: groupId, name: 'ChatGPT', color: '#8B0000',
        memberInstanceIds: [],
        linkedNodePrototypeId: protoId,
        linkedDefinitionIndex: 0,
        anchorInstanceId: 'inst-long-gone',
      });
      graphs.set(graphId, graph);
      return { graphs };
    }, false, 'test_setup');

    return { graphId, groupId, protoId, instId };
  };

  const graphOf = (graphId) => st().graphs.get(graphId);

  it('ensureGroupAnchor reclaims a stranded flagged instance instead of minting past it', () => {
    const { graphId, groupId, instId } = setupDanglingGroup();

    st().ensureGroupAnchor(graphId, groupId);

    const graph = graphOf(graphId);
    assert.strictEqual(graph.instances.size, 1, 'no duplicate anchor was minted');
    assert.strictEqual(graph.groups.get(groupId).anchorInstanceId, instId, 'the group reclaimed the flagged instance');
    assert.strictEqual(graph.instances.get(instId).isGroupAnchor, true, 'the reclaimed instance stays flagged');
  });

  it('ensureGroupAnchor seeds a memberless node-group so its shell can lay out', () => {
    const { graphId, groupId } = setupDanglingGroup();

    st().ensureGroupAnchor(graphId, groupId);

    // Without an origin computeGroupLayout returns { ok: false, reason: 'no-resolvable-members' }
    // and NodeCanvas skips the group, leaving its hidden anchor with nothing standing in for it.
    const origin = graphOf(graphId).groups.get(groupId).emptyPlaceholderOrigin;
    assert.deepStrictEqual(origin, { x: 400, y: 250 }, 'the shell origin is frozen at the anchor position');
  });

  it('the sweep demotes an anchor whose group anchors a different instance, keeping its edges', () => {
    const { graphId, groupId, protoId, instId } = setupDanglingGroup();

    // A second instance takes over as the group's anchor, stranding the first.
    const liveAnchorId = 'inst-live-anchor';
    const otherId = 'inst-other';
    useGraphStore.setState((state) => {
      const graphs = new Map(state.graphs);
      const graph = { ...graphs.get(graphId) };
      graph.instances = new Map(graph.instances);
      graph.instances.set(liveAnchorId, {
        id: liveAnchorId, prototypeId: protoId, x: 0, y: 0, scale: 1,
        isGroupAnchor: true, anchorForGroupId: groupId,
      });
      graph.instances.set(otherId, { id: otherId, prototypeId: protoId, x: 900, y: 900, scale: 1 });
      graph.groups = new Map(graph.groups);
      graph.groups.set(groupId, { ...graph.groups.get(groupId), anchorInstanceId: liveAnchorId });
      graphs.set(graphId, graph);
      return { graphs };
    }, false, 'test_setup_takeover');

    st().addEdge(graphId, { id: 'edge-1', sourceId: instId, destinationId: otherId });

    st().cleanupOrphanedGroupAnchors(graphId);

    const graph = graphOf(graphId);
    const demoted = graph.instances.get(instId);
    assert.ok(demoted, 'the stranded instance is demoted, not deleted');
    assert.strictEqual(demoted.isGroupAnchor, undefined, 'it renders as a plain node again');
    assert.strictEqual(demoted.anchorForGroupId, undefined, 'its stale group reference is cleared');
    assert.ok(st().edges.has('edge-1'), 'its edges survive the repair');
    assert.strictEqual(graph.instances.get(liveAnchorId).isGroupAnchor, true, 'the real anchor is untouched');
  });

  it('the sweep demotes an anchor flagged with no anchorForGroupId at all', () => {
    // This shape round-trips through save/load intact: the reader restores
    // `isGroupAnchor` but only a non-null `anchorForGroupId`, so the old sweep — which
    // required a group id to be present — could never reach it.
    const { graphId, protoId } = setupDanglingGroup();
    const looseId = 'inst-loose';
    useGraphStore.setState((state) => {
      const graphs = new Map(state.graphs);
      const graph = { ...graphs.get(graphId) };
      graph.instances = new Map(graph.instances);
      graph.instances.set(looseId, {
        id: looseId, prototypeId: protoId, x: 100, y: 100, scale: 1, isGroupAnchor: true,
      });
      graphs.set(graphId, graph);
      return { graphs };
    }, false, 'test_setup_loose');

    st().cleanupOrphanedGroupAnchors(graphId);

    const loose = graphOf(graphId).instances.get(looseId);
    assert.ok(loose, 'the instance survives');
    assert.strictEqual(loose.isGroupAnchor, undefined, 'it renders as a plain node again');
  });

  it('the sweep leaves a healthy anchor alone', () => {
    const { graphId, groupId, instId } = setupDanglingGroup();
    st().ensureGroupAnchor(graphId, groupId); // reclaims instId as the anchor

    st().cleanupOrphanedGroupAnchors(graphId);

    const graph = graphOf(graphId);
    assert.strictEqual(graph.instances.get(instId).isGroupAnchor, true, 'a properly anchored instance keeps its flag');
    assert.strictEqual(graph.groups.get(groupId).anchorInstanceId, instId, 'the group still names it');
  });
});
