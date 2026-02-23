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

  // Build a prototype map for resolving definitionNodeIds on edges
  const protoMap = new Map();
  for (const proto of nodePrototypes) {
    if (proto.id) protoMap.set(proto.id, proto);
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
      const destId = edge.destinationId || edge.targetId;
      if (edge.sourceId === nodeId || destId === nodeId) {
        const neighborId = edge.sourceId === nodeId ? destId : edge.sourceId;
        const neighbor = nodePrototypes.find(p => p.id === neighborId);
        if (neighbor) {
          // Resolve relationship type from definitionNodeIds first
          let relationship = edge.name || '';
          if (Array.isArray(edge.definitionNodeIds) && edge.definitionNodeIds.length > 0) {
            relationship = protoMap.get(edge.definitionNodeIds[0])?.name || relationship;
          } else if (edge.type) {
            relationship = edge.type;
          }
          neighbors.push({
            id: neighbor.id,
            name: neighbor.name,
            relationship
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

