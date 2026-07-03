/**
 * bridgeStateSerializer.js
 *
 * Environment-agnostic construction of the "bridge state" payload — the lossy
 * summary of the Redstring store that the wizard-server exposes at
 * `GET /api/bridge/state` and that the MCP server + wizard tools read.
 *
 * This is the MCP compatibility contract. The shape produced by
 * `buildBridgeState` is what `redstring-mcp-server.js` (`getRealRedstringState`
 * → `toPlainState`) deserializes. A Vitest snapshot test locks this shape;
 * if you add a field the tools need, update all three serialization hops
 * (BridgeClient/daemon → wizard-server → MCP) — see MEMORY.md.
 *
 * Extracted verbatim from BridgeClient.jsx so the browser (BridgeClient) and
 * the Node daemon (wizard-server headless mode) build the identical payload
 * from the same code. No browser globals are referenced here — safe in Node.
 *
 * NOTE: this is a summary payload for MCP *reads*, NOT a sync format. Daemon↔
 * browser hydration must use `exportToRedstring` JSON, not this.
 */

import { NODE_DEFAULT_COLOR } from '../constants.js';

export const MAX_LAYOUT_NODES = 400;

export const MAX_SUMMARY_EDGES = 600;

export const safePrototypeName = (prototypes, prototypeId) => {
  if (!prototypeId) return 'Unknown Prototype';
  const proto = prototypes.get(prototypeId);
  return proto?.name || prototypeId;
};

export const computeGraphQuality = (nodeCount, edgeCount) => {
  if (nodeCount === 0) {
    return { label: 'empty', score: 0, density: 0 };
  }
  if (nodeCount === 1) {
    return { label: 'single', score: 10, density: 0 };
  }
  const density = edgeCount / (nodeCount * (nodeCount - 1));
  let label = 'sparse';
  if (density >= 0.45) label = 'dense';
  else if (density >= 0.18) label = 'balanced';
  else if (density === 0) label = 'disconnected';
  const score = Math.max(5, Math.min(100, Math.round((density * 80) + Math.min(nodeCount * 2, 40))));
  return { label, score, density: Number(density.toFixed(3)) };
};

export const buildGraphLayouts = (state) => {
  const layouts = {};
  for (const [graphId, graph] of state.graphs.entries()) {
    const instances = graph?.instances instanceof Map ? Array.from(graph.instances.entries()) : [];
    if (!instances.length) {
      layouts[graphId] = {
        nodes: {},
        metadata: {
          nodeCount: 0,
          edgeCount: Array.isArray(graph?.edgeIds) ? graph.edgeIds.length : 0,
          boundingBox: null,
          centroid: null,
          computedAt: Date.now(),
          truncated: false
        }
      };
      continue;
    }

    const nodes = {};
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let totalX = 0;
    let totalY = 0;
    let counted = 0;

    instances.forEach(([instanceId, instance], index) => {
      if (!instance || typeof instance !== 'object') return;
      const { x = 0, y = 0, scale = 1, prototypeId = null } = instance;
      if (index < MAX_LAYOUT_NODES) {
        nodes[instanceId] = { x, y, scale, prototypeId };
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      totalX += x;
      totalY += y;
      counted += 1;
    });

    const edgeCount = Array.isArray(graph?.edgeIds) ? graph.edgeIds.length : 0;
    const truncated = instances.length > MAX_LAYOUT_NODES;
    layouts[graphId] = {
      nodes,
      metadata: {
        nodeCount: instances.length,
        edgeCount,
        boundingBox: counted ? { minX, minY, maxX, maxY } : null,
        centroid: counted ? { x: totalX / counted, y: totalY / counted } : null,
        computedAt: Date.now(),
        truncated
      }
    };
  }
  return layouts;
};

export const buildGraphSummaries = (state) => {
  const summaries = {};
  const prototypes = state.nodePrototypes || new Map();
  const edgesMap = state.edges || new Map();

  for (const [graphId, graph] of state.graphs.entries()) {
    const instances = graph?.instances instanceof Map ? Array.from(graph.instances.entries()) : [];
    const instanceById = new Map(instances);
    const nodes = instances.slice(0, MAX_LAYOUT_NODES).map(([instanceId, instance]) => ({
      id: instanceId,
      prototypeId: instance?.prototypeId || null,
      name: safePrototypeName(prototypes, instance?.prototypeId)
    }));

    const edgeIds = Array.isArray(graph?.edgeIds) ? graph.edgeIds : [];
    const edges = edgeIds
      .map(edgeId => edgesMap.get(edgeId))
      .filter(Boolean);

    const edgesSerialized = edges.slice(0, MAX_SUMMARY_EDGES).map(edge => {
      const sourceInstance = instanceById.get(edge.sourceId);
      const targetInstance = instanceById.get(edge.destinationId);
      return {
        id: edge.id,
        from: edge.sourceId,
        to: edge.destinationId,
        type: safePrototypeName(prototypes, edge.typeNodeId),
        sourceLabel: safePrototypeName(prototypes, sourceInstance?.prototypeId),
        targetLabel: safePrototypeName(prototypes, targetInstance?.prototypeId)
      };
    });

    const quality = computeGraphQuality(instances.length, edges.length);

    const textLines = [
      `Graph: ${graph?.name || 'Untitled'} (${graphId})`,
      `Nodes (${instances.length} total${instances.length > MAX_LAYOUT_NODES ? `, showing ${MAX_LAYOUT_NODES}` : ''}):`
    ];
    nodes.forEach(node => {
      textLines.push(`- ${node.name} [${node.id}]`);
    });

    textLines.push('', `Edges (${edges.length} total${edges.length > MAX_SUMMARY_EDGES ? `, showing ${MAX_SUMMARY_EDGES}` : ''}):`);
    edgesSerialized.forEach(edge => {
      const relation = edge.type ? ` (${edge.type})` : '';
      textLines.push(`- ${edge.sourceLabel} → ${edge.targetLabel}${relation}`);
    });

    summaries[graphId] = {
      id: graphId,
      name: graph?.name || 'New Thing',
      description: graph?.description || '',
      nodeCount: instances.length,
      edgeCount: edges.length,
      density: quality.density,
      quality: quality.label,
      score: quality.score,
      nodes,
      edges: edgesSerialized,
      text: textLines.join('\n'),
      computedAt: Date.now()
    };
  }

  return summaries;
};

/**
 * Build the complete bridge-state payload from a live store state.
 *
 * @param {object} state    - `useGraphStore.getState()` (graphs/nodePrototypes/edges are Maps).
 * @param {object} [opts]
 * @param {object|null} [opts.fileStatus] - optional file-status object (browser supplies it; daemon may pass null).
 * @returns {object} the bridgeData payload POSTed to `/api/bridge/state`.
 */
export const buildBridgeState = (state, { fileStatus = null } = {}) => {
  const layouts = buildGraphLayouts(state);
  const summaries = buildGraphSummaries(state);

  // CRITICAL: Send ALL edges (edges don't have graphId - graphs have edgeIds)
  // The graph.edgeIds array determines which edges belong to which graph
  const graphEdges = state.edges
    ? Array.from(state.edges.values()).map(edge => ({
      id: edge.id,
      sourceId: edge.sourceId,
      destinationId: edge.destinationId,
      name: edge.name || '',
      type: edge.type || '',
      typeNodeId: edge.typeNodeId || null,
      definitionNodeIds: Array.isArray(edge.definitionNodeIds) ? [...edge.definitionNodeIds] : [],
      arrowsToward: Array.isArray(edge.arrowsToward) ? [...edge.arrowsToward] : []
    }))
    : [];

  return {
    // Graph data with instance positions for spatial reasoning
    graphs: Array.from(state.graphs.entries()).map(([id, graph]) => ({
      id,
      name: graph.name,
      description: graph.description || '',
      instanceCount: graph.instances?.size || 0,
      // CRITICAL: Include edgeIds for semantic graph queries
      edgeIds: Array.isArray(graph.edgeIds) ? graph.edgeIds : [],
      // CRITICAL: Include groups for MCP tool queries
      groups: graph.groups instanceof Map
        ? Array.from(graph.groups.values())
        : Array.isArray(graph.groups) ? graph.groups : [],
      // CRITICAL: Include definingNodeIds for recursive composition
      definingNodeIds: Array.isArray(graph.definingNodeIds) ? [...graph.definingNodeIds] : [],
      // Include instance data for all graphs (MCP tools need names for resolution)
      instances: graph.instances ?
        Object.fromEntries(Array.from(graph.instances.entries()).map(([instanceId, instance]) => [
          instanceId, {
            id: instance.id,
            prototypeId: instance.prototypeId,
            name: instance.name || '',
            description: instance.description || '',
            color: instance.color || '',
            x: instance.x || 0,
            y: instance.y || 0,
            scale: instance.scale || 1
          }
        ])) : undefined
    })),

    // CRITICAL: Include color for LLM context (palette matching)
    nodePrototypes: Array.from(state.nodePrototypes.entries()).map(([id, prototype]) => ({
      id,
      name: prototype.name,
      color: prototype.color || NODE_DEFAULT_COLOR,
      description: prototype.description || '',
      definitionGraphIds: Array.isArray(prototype.definitionGraphIds) ? [...prototype.definitionGraphIds] : [],
      typeNodeId: prototype.typeNodeId || null,
      abstractionChains: prototype.abstractionChains || {}
    })),

    // UI state
    activeGraphId: state.activeGraphId,
    activeGraphName: state.activeGraphId ? (state.graphs.get(state.activeGraphId)?.name || null) : null,
    openGraphIds: state.openGraphIds,
    // Auto-layout settings (for AI to use same parameters as UI)
    autoLayoutSettings: state.autoLayoutSettings || {
      layoutScale: 'balanced',
      layoutScaleMultiplier: 1,
      layoutIterations: 'balanced'
    },
    // File status (optional)
    fileStatus,

    // Summary stats
    summary: {
      totalGraphs: state.graphs.size,
      totalPrototypes: state.nodePrototypes.size,
      lastUpdate: Date.now()
    },
    graphLayouts: layouts,
    graphSummaries: summaries,
    graphEdges: graphEdges
  };
};
