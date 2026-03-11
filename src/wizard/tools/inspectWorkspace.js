/**
 * inspectWorkspace - Quick comprehensive overview of workspace contents with IDs
 * 
 * Returns a structured summary of all objects (nodes, edges, groups, graphs)
 * organized by type, with their important IDs included.
 */

/**
 * Get a fast, comprehensive overview of the workspace
 * @param {Object} args - { graphId } (optional, defaults to active graph)
 * @param {Object} graphState - Current state
 */
export async function inspectWorkspace(args, graphState) {
  const { graphId, includeAllGraphs } = args || {};

  const targetGraphId = graphId || graphState.activeGraphId;
  const { graphs = [], nodePrototypes = [], edges = [], activeGraphId } = graphState;

  // Build prototype lookup
  const protoMap = new Map();
  for (const proto of nodePrototypes) {
    protoMap.set(proto.id, proto);
  }

  // Helper to summarize a single graph
  function summarizeGraph(graph) {
    const instances = graph.instances || [];
    const graphEdgeIds = new Set(Array.isArray(graph.edgeIds) ? graph.edgeIds : []);
    const graphEdges = edges.filter(e => graphEdgeIds.has(e.id));
    const groups = Array.isArray(graph.groups) ? graph.groups : [];

    // Build node list with prototype info
    const nodes = instances.map(inst => {
      const proto = protoMap.get(inst.prototypeId);
      return {
        instanceId: inst.id,
        prototypeId: inst.prototypeId,
        name: proto?.name || inst.name || 'Unknown',
        color: proto?.color || '',
        type: proto?.typeNodeId ? (protoMap.get(proto.typeNodeId)?.name || proto.typeNodeId) : null,
        hasDefinitionGraphs: (proto?.definitionGraphIds?.length || 0) > 0,
        definitionGraphCount: proto?.definitionGraphIds?.length || 0
      };
    });

    // Build edge list with resolved names
    const edgeList = graphEdges.map(e => {
      // Resolve source/destination to names
      const srcProto = protoMap.get(e.sourceId);
      const dstProto = protoMap.get(e.destinationId);
      const typeProto = e.typeNodeId ? protoMap.get(e.typeNodeId) : null;
      return {
        edgeId: e.id,
        source: srcProto?.name || e.sourceId,
        sourceId: e.sourceId,
        target: dstProto?.name || e.destinationId,
        targetId: e.destinationId,
        type: typeProto?.name || e.type || e.name || ''
      };
    });

    // Build group list
    const groupList = groups.map(g => ({
      groupId: g.id,
      name: g.name || 'Unnamed',
      memberCount: g.memberInstanceIds?.length || 0,
      isThingGroup: !!(g.definingNodeId || g.definedByNodeId)
    }));

    return {
      graphId: graph.id,
      name: graph.name || 'Unnamed',
      isActive: graph.id === activeGraphId,
      nodes,
      edges: edgeList,
      groups: groupList,
      counts: {
        nodes: nodes.length,
        edges: edgeList.length,
        groups: groupList.length
      }
    };
  }

  if (includeAllGraphs) {
    // Return summaries for all graphs
    const summaries = graphs.map(g => summarizeGraph(g));
    return {
      totalGraphs: graphs.length,
      totalPrototypes: nodePrototypes.length,
      activeGraphId,
      graphs: summaries
    };
  }

  // Single graph mode
  const graph = graphs.find(g => g.id === targetGraphId);
  if (!graph) {
    return `Graph ${targetGraphId || '(none)'} not found. Available graphs: ${graphs.map(g => `${g.name} (${g.id})`).join(', ')}`;
  }

  return summarizeGraph(graph);
}
