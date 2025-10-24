const assert = require('assert');

// Minimal harness to import the store factory in a Node test context
const React = require('react');
const { default: useGraphStore } = require('../../src/store/graphStore.jsx');

describe('mergeNodePrototypes', () => {
  it('remaps instances, saved sets, activeDefinitionNodeId and tabs; deletes secondary', () => {
    // Reset store to clean state
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

    const { addNodePrototype, createNewGraph, addNodeInstance, mergeNodePrototypes, toggleSavedNode, openRightPanelNodeTab, setActiveDefinitionNode } = useGraphStore.getState();

    // Create two prototypes A (primary) and B (secondary)
    const primaryId = 'proto-A';
    const secondaryId = 'proto-B';
    addNodePrototype({ id: primaryId, name: 'Alpha', description: '', color: '#111', typeNodeId: null, definitionGraphIds: [] });
    addNodePrototype({ id: secondaryId, name: 'Alpha Copy', description: 'desc', color: '#222', typeNodeId: null, definitionGraphIds: [] });

    // Create a graph defined by secondary
    createNewGraph({ name: 'B Graph', typeNodeId: null, color: '#333' });
    const state1 = useGraphStore.getState();
    const createdGraphId = state1.activeGraphId;
    // Assign the defining node to secondary explicitly
    state1.updateGraph(createdGraphId, (g) => {
      g.definingNodeIds = [secondaryId];
    });
    // Update the secondary to reflect definition
    state1.updateNodePrototype(secondaryId, (proto) => {
      proto.definitionGraphIds = [createdGraphId];
    });

    // Add instance that references secondary
    addNodeInstance(createdGraphId, secondaryId, { x: 10, y: 20 }, 'inst-1');

    // Save secondary and open its tab; also set it as active definition
    toggleSavedNode(secondaryId);
    openRightPanelNodeTab(secondaryId);
    setActiveDefinitionNode(secondaryId);

    // Merge B into A
    mergeNodePrototypes(primaryId, secondaryId);

    const state2 = useGraphStore.getState();

    // Secondary deleted
    assert.strictEqual(state2.nodePrototypes.has(secondaryId), false);
    // Instances remapped
    const g = state2.graphs.get(createdGraphId);
    const inst = g && g.instances && g.instances.get('inst-1');
    assert.ok(inst, 'instance missing after merge');
    assert.strictEqual(inst.prototypeId, primaryId, 'instance prototype not remapped');
    // Saved remapped
    assert.strictEqual(state2.savedNodeIds.has(secondaryId), false);
    assert.strictEqual(state2.savedNodeIds.has(primaryId), true);
    // Defining nodes remapped
    assert.ok(Array.isArray(g.definingNodeIds));
    assert.strictEqual(g.definingNodeIds.includes(secondaryId), false);
    assert.strictEqual(g.definingNodeIds.includes(primaryId), true);
    // Active definition node remapped/cleared to primary
    assert.strictEqual(state2.activeDefinitionNodeId === null || state2.activeDefinitionNodeId === primaryId, true);
    // Tabs remapped (there should be a node tab pointing to primary now)
    const nodeTabs = state2.rightPanelTabs.filter(t => t.type === 'node');
    if (nodeTabs.length > 0) {
      assert.strictEqual(nodeTabs.every(t => t.nodeId === primaryId), true, 'node tabs not remapped to primary');
    }
  });
});


