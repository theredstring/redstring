import { resolveGraphId, describeGraphAmbiguity } from './resolveGraphId.js';

/**
 * inspectWorkspace - Structural overview of the workspace, with IDs.
 *
 * This tool used to return every node, edge and group of every graph, with no
 * limits of any kind: `includeAllGraphs` on a 75-graph universe produced a dump
 * large enough to crowd out the conversation it was supposed to inform. Worse,
 * most of it was redundant — the context header already describes the active
 * graph's contents on every single iteration, so the model was reading the same
 * data twice and paying for it both times.
 *
 * So the division of labour is now explicit:
 *   - The context header owns CONTENT for the active graph (names, types,
 *     descriptions, connection triplets).
 *   - This tool owns STRUCTURE and IDENTIFIERS — the instance and prototype IDs
 *     the header omits, and the shape of graphs the header only counted.
 *
 * `includeAllGraphs` is therefore a census, never a dump.
 */

/** Cap on nodes/edges listed for a single graph before the list is summarized. */
const MAX_NODES_PER_GRAPH = 60;
const MAX_EDGES_PER_GRAPH = 60;
/** Cap on graphs enumerated in census mode. */
const MAX_GRAPHS_IN_CENSUS = 100;

function getInstances(graph) {
  if (!graph?.instances) return [];
  if (graph.instances instanceof Map) return Array.from(graph.instances.values());
  if (Array.isArray(graph.instances)) return graph.instances;
  return Object.values(graph.instances || {});
}

/**
 * Get a fast, comprehensive overview of the workspace
 * @param {Object} args - { graphId } (optional, defaults to active graph)
 * @param {Object} graphState - Current state
 */
export async function inspectWorkspace(args, graphState) {
  const { graphId, includeAllGraphs } = args || {};

  const { graphs = [], nodePrototypes = [], edges = [], activeGraphId, openGraphIds = [] } = graphState;
  const targetGraphId = resolveGraphId(graphId, graphs, { activeGraphId, openGraphIds }) || activeGraphId;
  const ambiguityNote = describeGraphAmbiguity(graphId, graphs, targetGraphId);

  // Build prototype lookup
  const protoMap = new Map();
  for (const proto of nodePrototypes) {
    protoMap.set(proto.id, proto);
  }

  const edgesById = new Map();
  for (const e of edges) {
    if (e?.id) edgesById.set(e.id, e);
  }

  /**
   * Census entry for one graph: shape and identity, no contents. This is what
   * every graph gets in includeAllGraphs mode, and it is deliberately a fixed
   * small size regardless of how large the graph is.
   */
  function censusGraph(graph) {
    const instances = getInstances(graph);
    const groups = Array.isArray(graph.groups) ? graph.groups : [];
    return {
      graphId: graph.id,
      name: graph.name || 'Unnamed',
      isActive: graph.id === activeGraphId,
      counts: {
        nodes: instances.length,
        edges: Array.isArray(graph.edgeIds) ? graph.edgeIds.length : 0,
        groups: groups.length
      }
    };
  }

  // Helper to summarize a single graph
  function summarizeGraph(graph) {
    const instances = getInstances(graph);
    const graphEdgeIds = new Set(Array.isArray(graph.edgeIds) ? graph.edgeIds : []);
    const graphEdges = [];
    for (const eid of graphEdgeIds) {
      const e = edgesById.get(eid);
      if (e) graphEdges.push(e);
    }
    const groups = Array.isArray(graph.groups) ? graph.groups : [];

    const nodeOverflow = Math.max(0, instances.length - MAX_NODES_PER_GRAPH);
    const edgeOverflow = Math.max(0, graphEdges.length - MAX_EDGES_PER_GRAPH);

    // Build node list with prototype info
    const nodes = instances.slice(0, MAX_NODES_PER_GRAPH).map(inst => {
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
    const edgeList = graphEdges.slice(0, MAX_EDGES_PER_GRAPH).map(e => {
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
      // linkedNodePrototypeId is THE discriminator (definingNodeId/definedByNodeId
      // are not fields on a group, so this always reported false).
      isThingGroup: !!g.linkedNodePrototypeId
    }));

    const result = {
      graphId: graph.id,
      name: graph.name || 'Unnamed',
      isActive: graph.id === activeGraphId,
      nodes,
      edges: edgeList,
      groups: groupList,
      counts: {
        nodes: instances.length,
        edges: graphEdges.length,
        groups: groupList.length
      }
    };

    if (nodeOverflow > 0 || edgeOverflow > 0) {
      result.truncated = true;
      result.truncationNote =
        `Listing capped: showing ${nodes.length} of ${instances.length} nodes and `
        + `${edgeList.length} of ${graphEdges.length} connections. `
        + 'Use searchNodes or searchConnections with a query to reach the rest.';
    }

    if (ambiguityNote) {
      result.ambiguity = ambiguityNote;
    }

    if (graph.id === activeGraphId) {
      result.note =
        'This is the active graph — its names, types, descriptions and connection '
        + 'triplets are already in your context header. Use the IDs here for tools '
        + 'that need them; do not re-read this graph just to see its contents.';
    }

    return result;
  }

  if (includeAllGraphs) {
    // Census, not a dump. Returning every graph's full contents here was the
    // single largest context blowup in the system.
    const listed = graphs.slice(0, MAX_GRAPHS_IN_CENSUS);
    const result = {
      totalGraphs: graphs.length,
      totalPrototypes: nodePrototypes.length,
      activeGraphId,
      graphs: listed.map(censusGraph),
      note:
        'Counts only. To see a specific graph\'s contents, call inspectWorkspace '
        + 'or readGraph with that graphId.'
    };
    if (graphs.length > listed.length) {
      result.truncated = true;
      result.truncationNote = `Showing ${listed.length} of ${graphs.length} graphs.`;
    }
    return result;
  }

  // Single graph mode
  const graph = graphs.find(g => g.id === targetGraphId);
  if (!graph) {
    return `Graph ${targetGraphId || '(none)'} not found. Available graphs: ${graphs.map(g => `${g.name} (${g.id})`).join(', ')}`;
  }

  return summarizeGraph(graph);
}
