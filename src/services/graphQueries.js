/**
 * Graph Query Abstraction Layer
 * 
 * Provides semantic, high-level queries for graph data from the bridge store.
 * This abstracts away the internal data structure (maps, instances, prototypes, edges)
 * and provides a consistent API for the AI agent and orchestration pipeline.
 */

/**
 * Get a graph by ID with its complete structure
 * @param {Object} store - Bridge store data
 * @param {string} graphId - Graph ID
 * @returns {Object|null} Graph with instances, edges, metadata
 */
export function getGraphById(store, graphId) {
  if (!store?.graphs || !graphId) return null;
  
  // Handle both Map and Array storage
  let graph = null;
  
  if (store.graphs instanceof Map) {
    graph = store.graphs.get(graphId);
  } else if (Array.isArray(store.graphs)) {
    graph = store.graphs.find(g => g.id === graphId);
  }
  
  if (!graph) return null;
  
  return {
    id: graphId,
    name: graph.name || 'Untitled Graph',
    instances: graph.instances || new Map(),
    edgeIds: graph.edgeIds || [],
    metadata: {
      created: graph.created,
      modified: graph.modified
    }
  };
}

/**
 * Get the currently active graph
 * @param {Object} store - Bridge store data
 * @returns {Object|null} Active graph with complete structure
 */
export function getActiveGraph(store) {
  const activeGraphId = store?.activeGraphId;
  if (!activeGraphId) return null;
  return getGraphById(store, activeGraphId);
}

/**
 * Get semantic node structure (no x/y coordinates) for a graph
 * @param {Object} store - Bridge store data
 * @param {string} graphId - Graph ID
 * @param {Object} options - Query options
 * @param {boolean} options.includeDescriptions - Include node descriptions (default: true)
 * @param {boolean} options.includeColors - Include node colors (default: true)
 * @returns {Object} Semantic graph structure { nodes, edges, metadata }
 */
export function getGraphSemanticStructure(store, graphId, options = {}) {
  const graph = getGraphById(store, graphId);
  if (!graph) {
    return { error: 'Graph not found', graphId };
  }
  
  const includeDescriptions = options.includeDescriptions !== false;
  const includeColors = options.includeColors !== false;
  
  // Extract instances as array (handle Map, Array, or Object)
  const instancesArray = graph.instances instanceof Map 
    ? Array.from(graph.instances.values())
    : Array.isArray(graph.instances) 
      ? graph.instances 
      : graph.instances && typeof graph.instances === 'object'
        ? Object.values(graph.instances).filter(inst => inst && typeof inst === 'object')
        : [];
  
  console.log(`[graphQueries] getGraphSemanticStructure: graph "${graph.name}" (${graphId}) has ${instancesArray.length} instances`, {
    instancesType: graph.instances ? (graph.instances instanceof Map ? 'Map' : Array.isArray(graph.instances) ? 'Array' : 'Object') : 'null',
    rawInstancesLength: graph.instances instanceof Map ? graph.instances.size : Array.isArray(graph.instances) ? graph.instances.length : Object.keys(graph.instances || {}).length,
    sampleKeys: graph.instances ? (graph.instances instanceof Map ? Array.from(graph.instances.keys()).slice(0, 3) : Array.isArray(graph.instances) ? 'N/A-Array' : Object.keys(graph.instances).slice(0, 3)) : []
  });
  
  // Build node list with prototype data
  const nodes = instancesArray.map(inst => {
    const proto = getPrototypeById(store, inst.prototypeId);
    const node = {
      id: inst.id,
      prototypeId: inst.prototypeId,
      name: proto?.name || 'Unknown'
    };
    
    if (includeDescriptions && proto?.description) {
      node.description = proto.description;
    }
    
    if (includeColors && proto?.color) {
      node.color = proto.color;
    }
    
    // Include definitionGraphIds so AI knows which nodes are "expandable"
    if (proto?.definitionGraphIds && Array.isArray(proto.definitionGraphIds) && proto.definitionGraphIds.length > 0) {
      node.definitionGraphIds = proto.definitionGraphIds;
    }
    
    return node;
  });
  
  // Build instance ID -> name lookup
  const nodeNameById = new Map(nodes.map(n => [n.id, n.name]));
  
  // Extract edges
  console.log(`[graphQueries] Extracting edges for graph "${graph.name}": edgeIds type=${Array.isArray(graph.edgeIds) ? 'array' : typeof graph.edgeIds}, length=${Array.isArray(graph.edgeIds) ? graph.edgeIds.length : 'N/A'}, sample=${JSON.stringify((graph.edgeIds || []).slice(0, 3))}`);
  const edges = (graph.edgeIds || [])
    .map(edgeId => {
      const edge = getEdgeById(store, edgeId);
      if (!edge) return null;
      
      const sourceName = nodeNameById.get(edge.sourceId) || edge.sourceId;
      const destName = nodeNameById.get(edge.destinationId) || edge.destinationId;
      
      return {
        id: edge.id,
        sourceId: edge.sourceId,
        destinationId: edge.destinationId,
        sourceName: sourceName,
        destinationName: destName,
        label: `${sourceName} → ${destName}`,
        directionality: edge.arrowsToward?.length === 2 ? 'bidirectional' 
          : edge.arrowsToward?.length === 0 ? 'none' 
          : 'unidirectional',
        definitionNodeIds: edge.definitionNodeIds || []
      };
    })
    .filter(Boolean);
  
  return {
    graphId,
    name: graph.name,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    isEmpty: nodes.length === 0
  };
}

/**
 * Get a node prototype by ID
 * @param {Object} store - Bridge store data
 * @param {string} prototypeId - Prototype ID
 * @returns {Object|null} Prototype data
 */
export function getPrototypeById(store, prototypeId) {
  if (!store?.nodePrototypes || !prototypeId) return null;
  return store.nodePrototypes.find(p => p.id === prototypeId) || null;
}

/**
 * Get an edge by ID
 * @param {Object} store - Bridge store data
 * @param {string} edgeId - Edge ID
 * @returns {Object|null} Edge data
 */
export function getEdgeById(store, edgeId) {
  if (!store?.edges || !edgeId) return null;
  
  // Edges stored as Map
  if (store.edges instanceof Map) {
    return store.edges.get(edgeId) || null;
  }
  
  // Edges stored as Array
  if (Array.isArray(store.edges)) {
    return store.edges.find(e => e.id === edgeId) || null;
  }
  
  // Edges stored as Object
  if (typeof store.edges === 'object') {
    return store.edges[edgeId] || null;
  }
  
  return null;
}

/**
 * List all available graphs
 * @param {Object} store - Bridge store data
 * @returns {Array} List of graph summaries
 */
export function listAllGraphs(store) {
  if (!store?.graphs) return [];
  
  const graphs = [];
  
  // Handle both Map and Array storage
  if (store.graphs instanceof Map) {
    for (const [graphId, graph] of store.graphs) {
      const instanceCount = graph.instances instanceof Map 
        ? graph.instances.size 
        : Array.isArray(graph.instances) 
          ? graph.instances.length 
          : 0;
      
      graphs.push({
        id: graphId,
        name: graph.name || 'Untitled Graph',
        nodeCount: instanceCount,
        edgeCount: (graph.edgeIds || []).length,
        isActive: graphId === store.activeGraphId
      });
    }
  } else if (Array.isArray(store.graphs)) {
    for (const graph of store.graphs) {
      const instanceCount = graph.instances instanceof Map 
        ? graph.instances.size 
        : Array.isArray(graph.instances) 
          ? graph.instances.length 
          : Object.keys(graph.instances || {}).length;
      
      graphs.push({
        id: graph.id,
        name: graph.name || 'Untitled Graph',
        nodeCount: instanceCount,
        edgeCount: (graph.edgeIds || []).length,
        isActive: graph.id === store.activeGraphId
      });
    }
  }
  
  return graphs;
}

/**
 * Check if a graph exists
 * @param {Object} store - Bridge store data
 * @param {string} graphId - Graph ID
 * @returns {boolean}
 */
export function graphExists(store, graphId) {
  if (!store?.graphs || !graphId) return false;
  
  // Handle both Map and Array storage
  if (store.graphs instanceof Map) {
    return store.graphs.has(graphId);
  } else if (Array.isArray(store.graphs)) {
    return store.graphs.some(g => g.id === graphId);
  }
  
  return false;
}

/**
 * Get graph statistics for context/prompting
 * @param {Object} store - Bridge store data
 * @returns {Object} Statistics summary
 */
export function getGraphStatistics(store) {
  const graphs = listAllGraphs(store);
  const activeGraph = getActiveGraph(store);
  
  return {
    totalGraphs: graphs.length,
    activeGraph: activeGraph ? {
      id: activeGraph.id,
      name: activeGraph.name,
      nodeCount: activeGraph.instances instanceof Map ? activeGraph.instances.size : 0,
      edgeCount: activeGraph.edgeIds?.length || 0
    } : null,
    allGraphs: graphs
  };
}

/**
 * Find graphs by name (fuzzy search)
 * @param {Object} store - Bridge store data
 * @param {string} searchTerm - Search term
 * @returns {Array} Matching graphs
 */
export function findGraphsByName(store, searchTerm) {
  if (!searchTerm || !store?.graphs) return [];
  
  const term = searchTerm.toLowerCase();
  const graphs = listAllGraphs(store);
  
  return graphs.filter(g => 
    g.name.toLowerCase().includes(term)
  );
}

