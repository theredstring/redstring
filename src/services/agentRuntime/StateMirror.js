// StateMirror: Single source of truth for state merge + local-apply logic
// Keeps "brain-body" aligned by maintaining a local mirror of Redstring state

/**
 * Smart merge: Preserves graphs/prototypes from other sources (e.g. tests) if not explicitly overwritten
 * @param {Object} existing - Current bridge store data
 * @param {Object} incoming - New state from UI or other sources
 * @returns {Object} Merged state
 */
export function smartMergeState(existing, incoming) {
  const merged = { ...existing };

  // SMART MERGE: Preserves graphs from other sources (e.g. tests) if not explicitly overwritten
  if (incoming.graphs && Array.isArray(incoming.graphs)) {
    const existingGraphs = Array.isArray(existing.graphs) ? existing.graphs : [];
    const incomingIds = new Set(incoming.graphs.map(g => g.id));

    // Keep existing graphs that are "test" graphs and not in the incoming set
    const testGraphs = existingGraphs.filter(g =>
      !incomingIds.has(g.id) &&
      (g.id.includes('test') || g.id.includes('itm-') || g.name?.toLowerCase().includes('test'))
    );

    merged.graphs = [...incoming.graphs, ...testGraphs];
  } else if (incoming.graphs !== undefined) {
    merged.graphs = incoming.graphs;
  }

  // Merge node prototypes
  if (incoming.nodePrototypes && Array.isArray(incoming.nodePrototypes)) {
    const existingProtos = Array.isArray(existing.nodePrototypes) ? existing.nodePrototypes : [];
    const incomingIds = new Set(incoming.nodePrototypes.map(p => p.id));
    const testProtos = existingProtos.filter(p => !incomingIds.has(p.id) && p.id.includes('test'));
    merged.nodePrototypes = [...incoming.nodePrototypes, ...testProtos];
  } else if (incoming.nodePrototypes !== undefined) {
    merged.nodePrototypes = incoming.nodePrototypes;
  }

  // Update other fields
  if (incoming.activeGraphId !== undefined) merged.activeGraphId = incoming.activeGraphId;
  if (incoming.openGraphIds !== undefined) merged.openGraphIds = incoming.openGraphIds;
  merged.graphLayouts = { ...merged.graphLayouts, ...(incoming.graphLayouts || {}) };
  merged.graphSummaries = { ...merged.graphSummaries, ...(incoming.graphSummaries || {}) };
  if (incoming.graphEdges !== undefined) merged.graphEdges = incoming.graphEdges;
  if (incoming.source !== undefined) merged.source = incoming.source || 'redstring-ui';

  // CRITICAL: Normalize edge data structure
  if (merged.graphEdges && Array.isArray(merged.graphEdges)) {
    merged.edges = merged.edges || {};
    for (const edge of merged.graphEdges) {
      if (edge && edge.id) {
        merged.edges[edge.id] = edge;
      }
    }
  }

  // CRITICAL: Normalize graph instances structure
  if (Array.isArray(merged.graphs)) {
    merged.graphs.forEach(graph => {
      if (graph && !graph.instances) {
        graph.instances = {};
      } else if (graph && graph.instances && typeof graph.instances === 'object') {
        if (graph.instances instanceof Map) {
          graph.instances = Object.fromEntries(graph.instances.entries());
        }
      }
    });
  }

  if (merged.summary) merged.summary.lastUpdate = Date.now();

  return merged;
}

/**
 * Apply mutations locally to the state mirror (for headless execution)
 * This ensures the AI's perception of the graph is immediately updated
 * @param {Array} ops - Array of mutation operations
 * @param {Object} state - Current state object to mutate
 */
export function localApplyMutations(ops, state) {
  if (!Array.isArray(ops)) return;

  for (const op of ops) {
    try {
      switch (op.type) {
        case 'createNewGraph':
          if (op.initialData) {
            const newGraph = {
              id: op.initialData.id,
              name: op.initialData.name,
              instances: {},
              edgeIds: [],
              ...op.initialData
            };
            if (Array.isArray(state.graphs)) {
              state.graphs.push(newGraph);
            } else {
              state.graphs = [newGraph];
            }
            state.activeGraphId = newGraph.id;
          }
          break;

        case 'addNodePrototype':
          if (op.prototypeData) {
            if (!Array.isArray(state.nodePrototypes)) {
              state.nodePrototypes = [];
            }
            state.nodePrototypes.push(op.prototypeData);
          }
          break;

        case 'addNodeInstance':
          if (op.graphId && op.prototypeId) {
            const graph = (Array.isArray(state.graphs) ? state.graphs : []).find(g => g.id === op.graphId);
            if (graph) {
              if (!graph.instances) graph.instances = {};
              graph.instances[op.instanceId] = {
                id: op.instanceId,
                prototypeId: op.prototypeId,
                x: op.position?.x || 0,
                y: op.position?.y || 0
              };
            }
          }
          break;

        case 'addEdge':
          if (op.graphId && op.edgeData) {
            const graph = (Array.isArray(state.graphs) ? state.graphs : []).find(g => g.id === op.graphId);
            if (graph) {
              if (!graph.edgeIds) graph.edgeIds = [];
              graph.edgeIds.push(op.edgeData.id);

              if (!state.edges) state.edges = {};
              state.edges[op.edgeData.id] = op.edgeData;

              if (!Array.isArray(state.graphEdges)) state.graphEdges = [];
              state.graphEdges.push({ ...op.edgeData, graphId: op.graphId });
            }
          }
          break;

        case 'deleteEdge':
          if (op.graphId && op.edgeId) {
            const graph = (Array.isArray(state.graphs) ? state.graphs : []).find(g => g.id === op.graphId);
            if (graph) {
              graph.edgeIds = (graph.edgeIds || []).filter(id => id !== op.edgeId);
              if (state.edges) delete state.edges[op.edgeId];
              state.graphEdges = (state.graphEdges || []).filter(e => e.id !== op.edgeId);
            }
          }
          break;

        case 'deleteGraph':
          if (op.graphId) {
            state.graphs = (Array.isArray(state.graphs) ? state.graphs : []).filter(g => g.id !== op.graphId);
            if (state.activeGraphId === op.graphId) state.activeGraphId = null;
          }
          break;
      }
    } catch (e) {
      throw new Error(`StateMirror: Error applying local mutation ${op.type}: ${e.message}`);
    }
  }
}

/**
 * Create initial empty state mirror
 */
export function createInitialState() {
  return {
    graphs: [],
    nodePrototypes: [],
    activeGraphId: null,
    openGraphIds: [],
    summary: { totalGraphs: 0, totalPrototypes: 0, lastUpdate: Date.now() },
    graphLayouts: {},
    graphSummaries: {},
    graphEdges: [],
    edges: {},
    source: 'agent-runtime'
  };
}











