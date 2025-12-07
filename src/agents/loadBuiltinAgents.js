/**
 * Load Built-in Agent Graphs
 * Loads The Wizard and other built-in agents into the graph store
 */

import wizardGraph from './wizard-graph.json';

/**
 * Load The Wizard agent graph into the store
 */
export function loadWizardAgent(storeActions) {
  const { addNodePrototype, addEdgePrototype, createGraph, addNodeInstance, addEdge } = storeActions;

  // Create the wizard graph
  const wizardGraphId = wizardGraph.id;
  createGraph({
    id: wizardGraphId,
    name: wizardGraph.name,
    description: wizardGraph.description
  });

  // Add node prototypes for agent nodes
  wizardGraph.nodes.forEach(node => {
    // Create prototype for agent node
    addNodePrototype({
      id: `prototype-${node.id}`,
      name: node.name,
      description: node.description,
      color: '#8B0000',
      agentConfig: node.agentConfig
    });

    // Create instance in wizard graph
    addNodeInstance({
      graphId: wizardGraphId,
      prototypeId: `prototype-${node.id}`,
      name: node.name,
      x: Math.random() * 1000,
      y: Math.random() * 1000
    });
  });

  // Add edge prototypes if needed
  const edgeTypeMap = {
    'agent-delegates-to': 'agent-delegates-to',
    'agent-reports-to': 'agent-reports-to',
    'agent-triggers': 'agent-triggers',
    'agent-validates': 'agent-validates',
    'agent-fallback-to': 'agent-fallback-to',
    'agent-depends-on': 'agent-depends-on'
  };

  // Add edges
  wizardGraph.edges.forEach(edge => {
    addEdge({
      graphId: wizardGraphId,
      sourceId: `instance-${edge.sourceId}`,
      destinationId: `instance-${edge.destinationId}`,
      typeNodeId: edge.typeNodeId || 'base-connection-prototype'
    });
  });

  return wizardGraphId;
}

/**
 * Get The Wizard agent graph
 */
export function getWizardGraph(storeState) {
  const wizardGraphId = 'wizard-agent-graph';
  const graph = storeState.graphs?.get(wizardGraphId);
  if (!graph) return null;

  // Convert to agent executor format
  const nodes = Array.from(graph.instances?.values() || []).map(instance => {
    const prototype = storeState.nodePrototypes?.get(instance.prototypeId);
    return {
      id: instance.id,
      name: instance.name || prototype?.name,
      agentConfig: prototype?.agentConfig
    };
  });

  const edges = Array.from(storeState.edges?.values() || [])
    .filter(edge => graph.edgeIds?.includes(edge.id))
    .map(edge => ({
      id: edge.id,
      sourceId: edge.sourceId,
      destinationId: edge.destinationId,
      typeNodeId: edge.typeNodeId
    }));

  return {
    id: wizardGraphId,
    nodes,
    edges,
    nodePrototypes: storeState.nodePrototypes,
    edgePrototypes: storeState.edgePrototypes
  };
}

export default {
  loadWizardAgent,
  getWizardGraph
};



