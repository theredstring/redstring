const assert = require('assert');

const { default: useGraphStore } = require('../../src/store/graphStore.js');
const { placeholderIdForGroup } = require('../../src/services/groupLayout.js');

// An empty node-group (decomposed but with nothing in its definition yet) has no
// member instance to carry its position, so its box rides on a synthetic
// `__placeholder__<groupId>` id through the whole drag pipeline. Dragging a
// group that CONTAINS such a group ships the child's placeholder along in the
// same position batch.
//
// The store used to persist only the DRAGGED group's own placeholder — keyed off
// contextOptions.groupId — so a nested empty child snapped back to its pre-drag
// spot on release, and the parent's box then stretched to span both the moved
// members and the child left behind.
describe('nested empty node-group placeholders survive a drag', () => {
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

  const addProto = (id, name) => {
    st().addNodePrototype({
      id, name, description: '', color: '#111111',
      typeNodeId: null, definitionGraphIds: []
    });
  };

  const getGroup = (graphId, groupId) => st().graphs.get(graphId).groups.get(groupId);

  // Outer node-group holding a member plus the anchor of an empty child group.
  const buildNestedFixture = () => {
    resetStore();
    addProto('p-member', 'Member');
    addProto('p-child', 'Child');
    addProto('p-outer', 'Outer');

    st().createNewGraph({ name: 'Main', typeNodeId: null, color: '#333' });
    const graphId = st().activeGraphId;

    st().addNodeInstance(graphId, 'p-member', { x: 0, y: 0 }, 'member-inst');
    st().addNodeInstance(graphId, 'p-child', { x: 300, y: 0 }, 'child-anchor');
    st().addNodeInstance(graphId, 'p-outer', { x: 150, y: -200 }, 'outer-anchor');

    // createGroup only carries name/color/members — the node-group fields are
    // written by the decompose paths, so set them explicitly here.
    const childId = st().createGroup(graphId, { name: 'Child', color: '#8B0000', memberInstanceIds: [] });
    st().updateGroup(graphId, childId, (draft) => {
      draft.linkedNodePrototypeId = 'p-child';
      draft.anchorInstanceId = 'child-anchor';
      draft.emptyPlaceholderOrigin = { x: 300, y: 0 };
    });

    const outerId = st().createGroup(graphId, {
      name: 'Outer', color: '#003366',
      memberInstanceIds: ['member-inst', 'child-anchor'],
    });
    st().updateGroup(graphId, outerId, (draft) => {
      draft.linkedNodePrototypeId = 'p-outer';
      draft.anchorInstanceId = 'outer-anchor';
    });

    return { graphId, childId, outerId };
  };

  it('persists a nested child placeholder moved by its parent drag', () => {
    const { graphId, childId, outerId } = buildNestedFixture();

    // Drag the OUTER group by +500/+400: every member moves, and the child's
    // placeholder rides along in the same batch.
    st().updateMultipleNodeInstancePositions(graphId, [
      { instanceId: 'member-inst', x: 500, y: 400 },
      { instanceId: 'child-anchor', x: 800, y: 400 },
      { instanceId: 'outer-anchor', x: 650, y: 200 },
      { instanceId: placeholderIdForGroup(childId), x: 800, y: 400 },
    ], { finalize: true, groupId: outerId });

    assert.deepStrictEqual(
      getGroup(graphId, childId).emptyPlaceholderOrigin,
      { x: 800, y: 400 },
      'the nested empty group followed its parent instead of snapping back'
    );
  });

  it('still persists the dragged group\'s own placeholder', () => {
    const { graphId, childId } = buildNestedFixture();

    st().updateMultipleNodeInstancePositions(graphId, [
      { instanceId: 'child-anchor', x: 320, y: 90 },
      { instanceId: placeholderIdForGroup(childId), x: 320, y: 90 },
    ], { finalize: true, groupId: childId });

    assert.deepStrictEqual(
      getGroup(graphId, childId).emptyPlaceholderOrigin,
      { x: 320, y: 90 }
    );
  });

  it('never mints an instance for a placeholder id', () => {
    const { graphId, childId } = buildNestedFixture();

    st().updateMultipleNodeInstancePositions(graphId, [
      { instanceId: placeholderIdForGroup(childId), x: 10, y: 20 },
    ], { finalize: true, groupId: childId });

    const instances = st().graphs.get(graphId).instances;
    assert.strictEqual(instances.has(placeholderIdForGroup(childId)), false);
    assert.strictEqual(instances.size, 3);
  });

  it('leaves a populated group\'s placeholder origin alone', () => {
    const { graphId, childId } = buildNestedFixture();
    // Once the group has real members the placeholder box no longer applies.
    st().updateGroup(graphId, childId, (draft) => { draft.memberInstanceIds = ['member-inst']; });

    st().updateMultipleNodeInstancePositions(graphId, [
      { instanceId: placeholderIdForGroup(childId), x: 999, y: 999 },
    ], { finalize: true, groupId: childId });

    assert.deepStrictEqual(
      getGroup(graphId, childId).emptyPlaceholderOrigin,
      { x: 300, y: 0 }
    );
  });
});
