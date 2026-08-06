const assert = require('assert');

const { default: useGraphStore } = require('../../src/store/graphStore.js');

// A node-group and its linked prototype are the same Thing to the user: editing the
// group's title/color on canvas IS editing the node, and vice versa. These tests pin
// that identity in both directions, and across every graph the prototype appears in.
describe('node-group identity sync', () => {
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

  // Builds a graph holding one node-group linked to `prototypeId`.
  const makeNodeGroup = (graphId, groupId, prototypeId) => {
    const { createNewGraph, addNodeInstance, createGroup, updateGroup } = useGraphStore.getState();
    createNewGraph({ id: graphId, name: 'G', typeNodeId: null, color: '#333' });
    const realGraphId = useGraphStore.getState().activeGraphId;
    addNodeInstance(realGraphId, prototypeId, { x: 0, y: 0 }, `${groupId}-member`);
    const createdGroupId = createGroup(realGraphId, {
      id: groupId,
      name: 'Old Name',
      color: '#111111',
      memberInstanceIds: [`${groupId}-member`]
    });
    updateGroup(realGraphId, createdGroupId, (g) => { g.linkedNodePrototypeId = prototypeId; });
    return { graphId: realGraphId, groupId: createdGroupId };
  };

  const getGroup = (graphId, groupId) =>
    useGraphStore.getState().graphs.get(graphId).groups.get(groupId);

  it('renaming/recoloring a node-group writes through to its linked prototype', () => {
    resetStore();
    useGraphStore.getState().addNodePrototype({
      id: 'proto-1', name: 'Old Name', description: '', color: '#111111',
      typeNodeId: null, definitionGraphIds: []
    });
    const { graphId, groupId } = makeNodeGroup('g1', 'grp-1', 'proto-1');

    useGraphStore.getState().updateGroup(graphId, groupId, (g) => {
      g.name = 'New Name';
      g.color = '#00FF00';
    });

    const proto = useGraphStore.getState().nodePrototypes.get('proto-1');
    assert.strictEqual(proto.name, 'New Name');
    assert.strictEqual(proto.color, '#00FF00');
  });

  it('editing the prototype writes back to every node-group linked to it', () => {
    resetStore();
    useGraphStore.getState().addNodePrototype({
      id: 'proto-1', name: 'Old Name', description: '', color: '#111111',
      typeNodeId: null, definitionGraphIds: []
    });
    const a = makeNodeGroup('g1', 'grp-1', 'proto-1');
    const b = makeNodeGroup('g2', 'grp-2', 'proto-1');

    useGraphStore.getState().updateNodePrototype('proto-1', (p) => {
      p.name = 'Renamed From Panel';
      p.color = '#0000FF';
    });

    [a, b].forEach(({ graphId, groupId }) => {
      const group = getGroup(graphId, groupId);
      assert.strictEqual(group.name, 'Renamed From Panel');
      assert.strictEqual(group.color, '#0000FF');
    });
  });

  it('a node-group edit reaches sibling node-groups sharing the prototype', () => {
    resetStore();
    useGraphStore.getState().addNodePrototype({
      id: 'proto-1', name: 'Old Name', description: '', color: '#111111',
      typeNodeId: null, definitionGraphIds: []
    });
    const a = makeNodeGroup('g1', 'grp-1', 'proto-1');
    const b = makeNodeGroup('g2', 'grp-2', 'proto-1');

    useGraphStore.getState().updateGroup(a.graphId, a.groupId, (g) => {
      g.name = 'Edited On Canvas';
      g.color = '#ABCDEF';
    });

    const sibling = getGroup(b.graphId, b.groupId);
    assert.strictEqual(sibling.name, 'Edited On Canvas');
    assert.strictEqual(sibling.color, '#ABCDEF');
  });

  it('leaves plain (unlinked) groups and unrelated prototypes alone', () => {
    resetStore();
    const st = useGraphStore.getState();
    st.addNodePrototype({
      id: 'proto-1', name: 'Linked', description: '', color: '#111111',
      typeNodeId: null, definitionGraphIds: []
    });
    st.addNodePrototype({
      id: 'proto-2', name: 'Untouched', description: '', color: '#222222',
      typeNodeId: null, definitionGraphIds: []
    });

    st.createNewGraph({ name: 'Plain', typeNodeId: null, color: '#333' });
    const graphId = useGraphStore.getState().activeGraphId;
    useGraphStore.getState().addNodeInstance(graphId, 'proto-2', { x: 0, y: 0 }, 'inst-plain');
    const plainGroupId = useGraphStore.getState().createGroup(graphId, {
      name: 'Just A Group', color: '#999999', memberInstanceIds: ['inst-plain']
    });

    useGraphStore.getState().updateGroup(graphId, plainGroupId, (g) => {
      g.name = 'Renamed Plain Group';
      g.color = '#123456';
    });

    // A plain group owns its own identity — nothing should have leaked to a prototype.
    assert.strictEqual(useGraphStore.getState().nodePrototypes.get('proto-1').name, 'Linked');
    assert.strictEqual(useGraphStore.getState().nodePrototypes.get('proto-2').name, 'Untouched');
    assert.strictEqual(useGraphStore.getState().nodePrototypes.get('proto-2').color, '#222222');
    assert.strictEqual(getGroup(graphId, plainGroupId).name, 'Renamed Plain Group');
  });
});
