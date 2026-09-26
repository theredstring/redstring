import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useCanvasUIStore from '../../src/store/canvasUIStore.js';
import { useCanvasDialogStore } from '../../src/components/canvas/dialogs/canvasDialogs.js';
import {
  requestDeleteDefinition, describeDefinitionDeletion, deleteDefinition,
} from '../../src/components/canvas/dialogs/deleteDefinition.js';

// Deleting a definition asks first, and afterwards every context's definition
// index still points at the definition it showed.

const makeGraph = (id, instanceCount = 0) => ({
  id, name: id, description: '',
  instances: new Map(Array.from({ length: instanceCount }, (_, i) => [`${id}-i${i}`, { id: `${id}-i${i}`, prototypeId: 'p-leaf', x: 0, y: 0 }])),
  edgeIds: [], groups: new Map(), definingNodeIds: [],
});
const makePrototype = (id, name, definitionGraphIds = []) => ({
  id, name, description: '', color: '#8B0000', typeNodeId: 'base-thing-prototype', definitionGraphIds,
});

const st = () => useGraphStore.getState();
const indices = () => useCanvasUIStore.getState().nodeDefinitionIndices;

beforeEach(() => {
  useGraphStore.setState({
    graphs: new Map([['main', makeGraph('main')], ['d0', makeGraph('d0', 2)], ['d1', makeGraph('d1')], ['d2', makeGraph('d2')]]),
    nodePrototypes: new Map([
      ['p-box', makePrototype('p-box', 'Box', ['d0', 'd1', 'd2'])],
      ['p-leaf', makePrototype('p-leaf', 'Leaf')],
    ]),
    edges: new Map(),
    openGraphIds: ['main'],
    activeGraphId: 'main',
    expandedGraphIds: new Set(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
  });
  useCanvasUIStore.getState().setNodeDefinitionIndices(new Map());
  useCanvasDialogStore.setState({ deleteDefinitionDialog: null });
});

describe('deleteDefinition', () => {
  it('asks instead of deleting', () => {
    requestDeleteDefinition('p-box', 'd1');
    expect(useCanvasDialogStore.getState().deleteDefinitionDialog).toEqual({ prototypeId: 'p-box', graphId: 'd1' });
    expect(st().nodePrototypes.get('p-box').definitionGraphIds).toEqual(['d0', 'd1', 'd2']);
  });

  it('describes which definition and what goes with it', () => {
    expect(describeDefinitionDeletion('p-box', 'd0')).toMatchObject({
      nodeName: 'Box', number: 1, total: 3, componentCount: 2, sharedWith: 0,
    });
    expect(describeDefinitionDeletion('p-box', 'missing')).toBeNull();
  });

  it('keeps an index after the deleted one on the same definition', () => {
    useCanvasUIStore.getState().setNodeDefinitionIndex('p-box-main', 2); // showing d2
    deleteDefinition('p-box', 'd0');
    expect(st().nodePrototypes.get('p-box').definitionGraphIds).toEqual(['d1', 'd2']);
    expect(indices().get('p-box-main')).toBe(1); // still d2
    expect(st().graphs.has('d0')).toBe(false);
  });

  it('steps back when the last definition on show is deleted', () => {
    useCanvasUIStore.getState().setNodeDefinitionIndex('p-box-main', 2);
    useCanvasUIStore.getState().setNodeDefinitionIndex('p-box-other', 0);
    deleteDefinition('p-box', 'd2');
    expect(indices().get('p-box-main')).toBe(1);
    expect(indices().get('p-box-other')).toBe(0);
  });

  it('closes the tab of a Web that went with its definition', () => {
    st().openRightPanelGraphTab('d1', 'p-box');
    deleteDefinition('p-box', 'd1');
    expect(st().rightPanelTabs.some((t) => t.type === 'graph')).toBe(false);
    expect(st().rightPanelTabs[0].isActive).toBe(true);
  });
});

describe('Web tabs', () => {
  it('opens once per Web and sits beside its Thing\'s tab', () => {
    st().openRightPanelNodeTab('p-box');
    st().openRightPanelGraphTab('d0', 'p-box');
    st().openRightPanelGraphTab('d0', 'p-box');
    st().openRightPanelGraphTab('d2', 'p-box');
    const tabs = st().rightPanelTabs;
    expect(tabs.map((t) => t.type)).toEqual(['home', 'node', 'graph', 'graph']);
    expect(tabs.find((t) => t.isActive)).toMatchObject({ type: 'graph', graphId: 'd2', nodeId: 'p-box' });
  });

  it('closes a Web tab without closing its Thing\'s tab', () => {
    st().openRightPanelNodeTab('p-box');
    st().openRightPanelGraphTab('d0', 'p-box');
    st().closeRightPanelTab('d0');
    expect(st().rightPanelTabs.map((t) => t.type)).toEqual(['home', 'node']);
    st().openRightPanelGraphTab('d0', 'p-box');
    st().closeRightPanelTab('p-box');
    expect(st().rightPanelTabs.map((t) => t.graphId || t.type)).toEqual(['home', 'd0']);
  });
});
