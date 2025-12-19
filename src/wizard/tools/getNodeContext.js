/**
 * getNodeContext - Get a node and its neighbors
 */

export async function getNodeContext(args, graphState, cid, ensureSchedulerStarted) {
  const { nodeId } = args;
  if (!nodeId) {
    throw new Error('nodeId is required');
  }

  const { nodePrototypes = [], edges = [], activeGraphId, graphs = [] } = graphState;
  
  const node = nodePrototypes.find(p => p.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found`);
  }

  // Find connected nodes via edges
  const activeGraph = graphs.find(g => g.id === activeGraphId);
  const graphEdgeIds = activeGraph?.edgeIds || [];
  
  const neighbors = [];
  for (const edgeId of graphEdgeIds) {
    const edge = Array.isArray(edges) 
      ? edges.find(e => e.id === edgeId)
      : edges[edgeId];
    
    if (edge) {
      if (edge.sourceId === nodeId || edge.destinationId === nodeId) {
        const neighborId = edge.sourceId === nodeId ? edge.destinationId : edge.sourceId;
        const neighbor = nodePrototypes.find(p => p.id === neighborId);
        if (neighbor) {
          neighbors.push({
            id: neighbor.id,
            name: neighbor.name,
            relationship: edge.name || ''
          });
        }
      }
    }
  }

  return {
    node: {
      id: node.id,
      name: node.name,
      color: node.color,
      description: node.description
    },
    neighbors
  };
}

