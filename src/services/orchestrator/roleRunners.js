import queueManager from '../queue/Queue.js';
// Avoid calling UI store from the daemon; generate ops directly here
import toolValidator from '../toolValidator.js';
import { RolePrompts, ToolAllowlists } from '../roles.js';
import { getBridgeStore, getGraphById, getActiveGraph } from '../bridgeStoreAccessor.js';
import { getGraphSemanticStructure } from '../graphQueries.js';
import executionTracer from '../ExecutionTracer.js';

// Helper to normalize string to Title Case
function toTitleCase(str) {
  if (!str) return '';
  return str
    .replace(/_/g, ' ') // snake_case -> space
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> space
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

// Generate a unique color for a connection type based on its name (deterministic hash)
function generateConnectionColor(connectionName) {
  if (!connectionName) return '#5B6CFF'; // Fallback blue

  // Simple hash to get a consistent hue for the same name
  let hash = 0;
  for (let i = 0; i < connectionName.length; i++) {
    hash = ((hash << 5) - hash) + connectionName.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Generate HSV with fixed saturation and value (matching user's palette style)
  const hue = Math.abs(hash % 360);
  const saturation = 1.0; // Full saturation
  const value = 0.5451; // Match user's existing palette brightness

  // Convert HSV to RGB
  const c = value * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - c;
  let r, g, b;
  if (hue >= 0 && hue < 60) { r = c; g = x; b = 0; }
  else if (hue >= 60 && hue < 120) { r = x; g = c; b = 0; }
  else if (hue >= 120 && hue < 180) { r = 0; g = c; b = x; }
  else if (hue >= 180 && hue < 240) { r = 0; g = x; b = c; }
  else if (hue >= 240 && hue < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// FUZZY DEDUPLICATION HELPER: Calculate string similarity (Dice coefficient on bigrams)
function calculateStringSimilarity(s1, s2) {
  const a = (s1 || '').toLowerCase().trim();
  const b = (s2 || '').toLowerCase().trim();
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const getBigrams = str => {
    const bigrams = [];
    for (let i = 0; i < str.length - 1; i++) bigrams.push(str.slice(i, i + 2));
    return bigrams;
  };

  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);
  let matches = 0;
  const used = new Set();

  bigramsA.forEach(bigram => {
    const idx = bigramsB.findIndex((b, i) => b === bigram && !used.has(i));
    if (idx >= 0) {
      matches++;
      used.add(idx);
    }
  });

  return (2 * matches) / (bigramsA.length + bigramsB.length);
}

// FUZZY DEDUPLICATION HELPER: Find existing prototype for a node name (exact or fuzzy match)
function findExistingPrototype(nodeName, store, similarityThreshold = 0.80) {
  if (!Array.isArray(store.nodePrototypes)) return null;

  // First try exact match (case-insensitive)
  let existingProto = store.nodePrototypes.find(p => p.name?.toLowerCase() === nodeName.toLowerCase());
  if (existingProto) return { proto: existingProto, matchType: 'exact' };

  // If no exact match, try fuzzy matching
  const candidates = store.nodePrototypes
    .map(p => ({ proto: p, similarity: calculateStringSimilarity(nodeName, p.name || '') }))
    .filter(c => c.similarity >= similarityThreshold)
    .sort((a, b) => b.similarity - a.similarity);

  if (candidates.length > 0) {
    return {
      proto: candidates[0].proto,
      matchType: 'fuzzy',
      similarity: candidates[0].similarity
    };
  }

  return null;
}

function buildPartialLayoutContext(graphId) {
  const store = getBridgeStore();
  const targetGraph = graphId ? getGraphById(graphId) : getActiveGraph();
  if (!targetGraph) return null;
  const instancesRaw = targetGraph.instances;
  if (!instancesRaw || typeof instancesRaw !== 'object') return null;
  const instances = Array.isArray(instancesRaw)
    ? instancesRaw
    : Object.values(instancesRaw);
  const positioned = instances
    .filter(inst => Number.isFinite(inst.x) && Number.isFinite(inst.y));
  if (positioned.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const nodes = positioned.map(inst => {
    minX = Math.min(minX, inst.x);
    minY = Math.min(minY, inst.y);
    maxX = Math.max(maxX, inst.x);
    maxY = Math.max(maxY, inst.y);
    return {
      id: inst.id,
      prototypeId: inst.prototypeId,
      x: inst.x,
      y: inst.y
    };
  });
  const spanX = Math.max(200, maxX - minX);
  const spanY = Math.max(200, maxY - minY);
  const width = Math.min(1800, spanX * 1.4 + 400);
  const height = Math.min(1200, spanY * 1.4 + 400);
  const anchorCenter = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2
  };
  return { nodes, width, height, anchorCenter };
}

// Planner: consumes goals and enqueues tasks (simple passthrough here; DAG may be produced by LLM elsewhere)
export async function runPlannerOnce() {
  const items = queueManager.pull('goalQueue', { max: 1 });
  if (items.length === 0) return;
  const item = items[0];
  // Fan out tasks from provided DAG or create a trivial task
  // Propagate meta from goal to tasks for agentic loop tracking
  const dag = item.dag || { tasks: [] };
  const goalMeta = item.meta || {};

  if (Array.isArray(dag.tasks) && dag.tasks.length > 0) {
    for (const t of dag.tasks) {
      queueManager.enqueue('taskQueue', {
        ...t,
        threadId: t.threadId || item.threadId,
        partitionKey: t.threadId || item.threadId || 'default',
        meta: goalMeta  // Propagate meta for agentic loop
      });
    }
  } else {
    queueManager.enqueue('taskQueue', {
      toolName: 'verify_state',
      args: {},
      threadId: item.threadId,
      partitionKey: item.threadId || 'default',
      meta: goalMeta
    });
  }
  queueManager.ack('goalQueue', item.leaseId);
}

// Executor: pulls one task per thread and produces a patch
export async function runExecutorOnce() {
  const tasks = queueManager.pull('taskQueue', { max: 1 });
  if (tasks.length === 0) return;
  const task = tasks[0];

  // Extract cid from task metadata for tracing
  const cid = task.meta?.cid || task.threadId || 'unknown';

  try {
    console.log(`[Executor] Processing task: ${task.toolName}`, JSON.stringify(task.args || {}));

    // Record executor stage start
    executionTracer.recordStage(cid, 'executor', {
      toolName: task.toolName,
      graphId: task.args?.graphId || task.args?.graph_id,
      threadId: task.threadId
    });

    const allow = new Set(ToolAllowlists.executor);
    if (!allow.has(task.toolName)) throw new Error(`Tool not allowed for executor: ${task.toolName}`);
    const validation = toolValidator.validateToolArgs(task.toolName, task.args || {});
    if (!validation.valid) {
      console.error(`[Executor] Validation failed for ${task.toolName}:`, validation.error, '\nTask args:', JSON.stringify(task.args, null, 2));
      throw new Error(`Validation failed: ${validation.error}`);
    }
    // Convert task into ops without touching UI store (Committer + UI will apply)
    const ops = [];
    if (task.toolName === 'create_node') {
      const store = getBridgeStore();
      const { name, graph_id, description, color, x, y } = validation.sanitized;
      
      // Check if prototype already exists
      const match = findExistingPrototype(name, store);
      let prototypeId;
      
      if (match) {
        prototypeId = match.proto.id;
        console.log(`[Executor] create_node: Reusing prototype "${name}" (${prototypeId})`);
      } else {
        prototypeId = `prototype-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        ops.push({
          type: 'addNodePrototype',
          prototypeData: {
            id: prototypeId,
            name,
            description: description || '',
            color: color || '#5B6CFF',
            typeNodeId: null,
            definitionGraphIds: []
          }
        });
        console.log(`[Executor] create_node: Created prototype "${name}" (${prototypeId})`);
      }
      
      const instanceId = `inst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ops.push({
        type: 'addNodeInstance',
        graphId: graph_id,
        prototypeId,
        position: { x: x || 0, y: y || 0 },
        instanceId
      });
      console.log(`[Executor] create_node: Created instance ${instanceId} in graph ${graph_id}`);
    } else if (task.toolName === 'create_node_prototype') {
      const prototypeId = `prototype-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ops.push({
        type: 'addNodePrototype',
        prototypeData: {
          id: prototypeId,
          name: validation.sanitized.name,
          description: validation.sanitized.description || '',
          color: validation.sanitized.color || '#5B6CFF',
          typeNodeId: validation.sanitized.type_node_id || null,
          definitionGraphIds: []
        }
      });
      console.log(`[Executor] ✨ NEW PROTOTYPE: Created "${validation.sanitized.name}" (${prototypeId})`);
    } else if (task.toolName === 'create_node_instance') {
      const instanceId = `inst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ops.push({ type: 'addNodeInstance', graphId: validation.sanitized.graph_id, prototypeId: validation.sanitized.prototype_id, position: { x: validation.sanitized.x, y: validation.sanitized.y }, instanceId });
    } else if (task.toolName === 'create_graph') {
      const newGraphId = `graph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ops.push({ type: 'createNewGraph', initialData: { id: newGraphId, name: validation.sanitized.name, description: validation.sanitized.description || '', color: validation.sanitized.color || '#4A90E2' } });
    } else if (task.toolName === 'create_subgraph') {
      // Use auto-layout to position nodes from LLM's semantic output
      const { applyLayout } = await import('../graphLayoutService.js');
      const graphId = validation.sanitized.graph_id;
      const graphSpec = validation.sanitized.graph_spec || {};
      const layoutAlgorithm = validation.sanitized.layout_algorithm || 'force';
      const layoutMode = validation.sanitized.layout_mode || 'auto';

      const nodes = Array.isArray(graphSpec.nodes) ? graphSpec.nodes : [];
      const edges = Array.isArray(graphSpec.edges) ? graphSpec.edges : [];

      // Create prototype IDs and temporary instance IDs for layout
      // SYNTHESIS: Get store to check for existing prototypes
      const store = getBridgeStore();
      const graph = getGraphById(graphId);
      const existingInstances = graph && graph.instances
        ? (graph.instances instanceof Map ? Array.from(graph.instances.values()) : Object.values(graph.instances))
        : [];

      const protoIdByName = new Map();
      const instanceIdByName = new Map();
      const tempInstances = [];

      nodes.forEach((node, idx) => {
        // CRITICAL: Node MUST have a name - check common field names (LLMs use different ones)
        const name = String(node?.name || node?.title || node?.label || node?.id || '').trim();

        if (!name) {
          throw new Error(`Node at index ${idx} missing required name field (checked: name, title, label, id). Node data: ${JSON.stringify(node)}`);
        }

        // FUZZY DEDUPLICATION: Check for exact or similar existing prototype
        const match = findExistingPrototype(name, store);

        let prototypeId;
        let instanceId;
        let isExistingInstance = false;

        if (match) {
          // Reuse existing prototype (exact or fuzzy match)
          prototypeId = match.proto.id;
          if (match.matchType === 'fuzzy') {
            console.log(`[Executor] 🧬 FUZZY MATCH: "${name}" → "${match.proto.name}" (${Math.round(match.similarity * 100)}% similar)`);
          } else {
            console.log(`[Executor] ♻️  EXACT MATCH: Reusing prototype "${match.proto.name}" (${prototypeId})`);
          }

          // Check if an instance of this prototype already exists in the graph
          const existingInstance = existingInstances.find(inst => inst.prototypeId === prototypeId);
          if (existingInstance) {
            instanceId = existingInstance.id;
            isExistingInstance = true;
            console.log(`[Executor] 📍 REUSING INSTANCE: "${name}" (${instanceId})`);
          }
        } else {
          // Create new prototype
          prototypeId = `prototype-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
          ops.push({
            type: 'addNodePrototype',
            prototypeData: {
              id: prototypeId,
              name,
              description: node.description || '',
              color: node.color || '#5B6CFF',
              typeNodeId: null,
              definitionGraphIds: []
            }
          });
          console.log(`[Executor] ✨ NEW PROTOTYPE: Created "${name}" (${prototypeId})`);
        }

        if (!instanceId) {
          instanceId = `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
        }

        protoIdByName.set(name, prototypeId);
        instanceIdByName.set(name, instanceId);

        // Store temp instance for layout calculation
        tempInstances.push({
          id: instanceId,
          prototypeId,
          name,
          isExisting: isExistingInstance
        });
      });

      // Build edge list for layout algorithm
      // Start with edges from the graphSpec (new edges being added)
      let tempEdges = edges.map(edge => ({
        sourceId: instanceIdByName.get(edge.source),
        destinationId: instanceIdByName.get(edge.target)
      })).filter(e => e.sourceId && e.destinationId);

      // Determine layout nodes + options
      // FULL layout: include ALL nodes (existing + new) for complete re-layout
      // PARTIAL layout: only layout new nodes, preserve existing positions
      // AUTO layout: defaults to FULL for comprehensive graph appearance
      const isFullLayout = layoutMode === 'full' || layoutMode === 'auto';
      const partialContext = !isFullLayout ? buildPartialLayoutContext(graphId) : null;
      const usePartialLayout = partialContext && layoutMode === 'partial';

      // For full layout, get ALL existing instances to include in layout
      let layoutNodes = [...tempInstances];
      const tempInstanceIds = new Set(tempInstances.map(i => i.id));

      if (isFullLayout) {
        // Add existing nodes to layout (they'll be repositioned)
        // Exclude those that are already in tempInstances (reused ones)
        existingInstances.forEach(inst => {
          if (tempInstanceIds.has(inst.id)) return;

          const proto = Array.isArray(store.nodePrototypes)
            ? store.nodePrototypes.find(p => p.id === inst.prototypeId)
            : null;
          if (proto) {
            layoutNodes.push({
              id: inst.id,
              prototypeId: inst.prototypeId,
              x: inst.x || 0,
              y: inst.y || 0,
              width: 200, // Approximate - layout will calculate properly
              height: 100
            });
          }
        });

        // For full layout, also include ALL existing edges
        if (graph && Array.isArray(graph.edgeIds) && store.edges) {
          const existingEdges = graph.edgeIds
            .map(edgeId => {
              const edge = typeof store.edges === 'object' && !Array.isArray(store.edges)
                ? store.edges[edgeId]
                : Array.isArray(store.edges)
                  ? store.edges.find(e => e.id === edgeId)
                  : null;
              return edge;
            })
            .filter(e => e && e.sourceId && e.destinationId)
            .map(e => ({
              sourceId: e.sourceId,
              destinationId: e.destinationId
            }));
          // Merge with new edges (avoid duplicates)
          const edgeSet = new Set(tempEdges.map(e => `${e.sourceId}-${e.destinationId}`));
          existingEdges.forEach(e => {
            const key = `${e.sourceId}-${e.destinationId}`;
            if (!edgeSet.has(key)) {
              tempEdges.push(e);
              edgeSet.add(key);
            }
          });
        }
      }

      // DETERMINISTIC LAYOUT: Use same parameters as Edit menu's Auto-Layout button
      const { getAutoLayoutSettings } = await import('../bridgeStoreAccessor.js');
      const autoSettings = getAutoLayoutSettings();

      // Dynamic layout sizing based on node count (heuristic since we don't have canvas size)
      const nodeCount = layoutNodes.length;
      const layoutWidth = Math.max(2000, Math.sqrt(nodeCount) * 400);
      const layoutHeight = Math.max(2000, Math.sqrt(nodeCount) * 400);
      const layoutPadding = Math.max(300, Math.min(layoutWidth, layoutHeight) * 0.08);

      // Update layout nodes with estimated dimensions
      layoutNodes = layoutNodes.map(n => {
        const nameLen = (n.name || '').length;
        // Estimate width: ~10px per char + padding, min 160
        const width = Math.max(160, nameLen * 10 + 40);
        // Estimate height: fixed 100 for now, or more if long text
        const height = nameLen > 30 ? 140 : 100;
        return {
          ...n,
          width,
          height,
          // Ensure x/y are numbers
          x: Number.isFinite(n.x) ? n.x : 0,
          y: Number.isFinite(n.y) ? n.y : 0
        };
      });

      const layoutOptions = {
        width: layoutWidth,
        height: layoutHeight,
        padding: layoutPadding,
        layoutMode,
        layoutScale: autoSettings.layoutScale,
        layoutScaleMultiplier: autoSettings.layoutScaleMultiplier,
        iterationPreset: autoSettings.iterationPreset,
        useExistingPositions: false  // Full re-layout by default
      };
      let partialTranslation = null;

      if (usePartialLayout && partialContext) {
        // Exclude reused instances from partial context to avoid duplicates
        const contextNodes = partialContext.nodes.filter(n => !tempInstanceIds.has(n.id));
        layoutNodes.unshift(...contextNodes);
        layoutOptions.useExistingPositions = true;
        layoutOptions.width = partialContext.width;
        layoutOptions.height = partialContext.height;
        partialTranslation = {
          x: partialContext.anchorCenter.x - (layoutOptions.width || 0) / 2,
          y: partialContext.anchorCenter.y - (layoutOptions.height || 0) / 2
        };
      }

      // Force 'force-directed' if 'force' is requested, to match UI
      const algorithmToUse = layoutAlgorithm === 'force' ? 'force-directed' : layoutAlgorithm;
      const positions = applyLayout(layoutNodes, tempEdges, algorithmToUse, layoutOptions);

      if (partialTranslation) {
        positions.forEach(pos => {
          pos.x += partialTranslation.x;
          pos.y += partialTranslation.y;
        });
      }

      // RECENTERING: Shift layout to center around (0,0) if it's a full layout or new graph
      // This mirrors the UI's behavior of centering the result
      if (isFullLayout || !usePartialLayout) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasPos = false;
        positions.forEach(p => {
          if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
            hasPos = true;
          }
        });

        if (hasPos) {
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          // Target center is (0,0)
          const offsetX = -centerX;
          const offsetY = -centerY;

          positions.forEach(p => {
            p.x += offsetX;
            p.y += offsetY;
          });
        }
      }

      // Create position map
      const positionMap = new Map();
      // We want positions for ALL tempInstances (whether new or reused)
      const tempInstanceIdsSet = new Set(tempInstances.map(inst => inst.id));
      positions.forEach(pos => {
        if (tempInstanceIdsSet.has(pos.instanceId)) {
          positionMap.set(pos.instanceId, { x: pos.x, y: pos.y });
        }
      });

      // Add node instance ops with calculated positions
      tempInstances.forEach(inst => {
        const position = positionMap.get(inst.id);
        // Fallback if layout failed for this node
        const finalPos = position || {
          x: 500 + Math.random() * 400,
          y: 300 + Math.random() * 400
        };

        if (!position) {
          console.error(`[Executor] Layout did not return position for instance ${inst.id} (${inst.name}).`);
        }

        if (inst.isExisting) {
          // Update existing instance position
          ops.push({
            type: 'moveNodeInstance',
            graphId,
            instanceId: inst.id,
            position: finalPos
          });
        } else {
          // Create new instance
          ops.push({
            type: 'addNodeInstance',
            graphId,
            prototypeId: inst.prototypeId,
            position: finalPos,
            instanceId: inst.id
          });
        }
      });

      // CRITICAL: For full layout, we must also move the existing nodes that were part of the layout context
      // but NOT part of the new graphSpec (tempInstances).
      if (isFullLayout) {
        const tempInstanceIdsSet = new Set(tempInstances.map(i => i.id));
        layoutNodes.forEach(node => {
          // Skip if this node is already handled in tempInstances loop above
          if (tempInstanceIdsSet.has(node.id)) return;

          const position = positionMap.get(node.id);
          if (position) {
            ops.push({
              type: 'moveNodeInstance',
              graphId,
              instanceId: node.id,
              position: { x: position.x, y: position.y }
            });
          }
        });
      }

      // Add edge ops
      // CRITICAL: Look up existing instances for edges that connect to existing nodes

      // Local cache for connection definition prototypes created in this batch
      const localConnectionProtoCache = new Map();

      edges.forEach(edge => {
        let sourceId = instanceIdByName.get(edge.source);
        let targetId = instanceIdByName.get(edge.target);

        // If source/target not in new nodes, look up existing instances by prototype name
        if (!sourceId && edge.source) {
          const proto = Array.isArray(store.nodePrototypes)
            ? store.nodePrototypes.find(p => p.name?.toLowerCase() === edge.source.toLowerCase())
            : null;
          if (proto) {
            const instance = existingInstances.find(inst => inst.prototypeId === proto.id);
            if (instance) sourceId = instance.id;
          }
        }
        if (!targetId && edge.target) {
          const proto = Array.isArray(store.nodePrototypes)
            ? store.nodePrototypes.find(p => p.name?.toLowerCase() === edge.target.toLowerCase())
            : null;
          if (proto) {
            const instance = existingInstances.find(inst => inst.prototypeId === proto.id);
            if (instance) targetId = instance.id;
          }
        }

        if (sourceId && targetId) {
          const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          // Determine directionality from edge spec
          let arrowsToward = [targetId]; // Default: unidirectional arrow to target
          if (edge.directionality === 'bidirectional') {
            arrowsToward = [sourceId, targetId]; // Arrows on both ends
          } else if (edge.directionality === 'none' || edge.directionality === 'undirected') {
            arrowsToward = []; // No arrows
          } else if (edge.directionality === 'reverse') {
            arrowsToward = [sourceId]; // Arrow points back to source
          }
          // else: default unidirectional to target

          // Handle connection definition node if specified
          let definitionNodeIds = [];
          if (edge.definitionNode && typeof edge.definitionNode === 'object') {
            const defNode = edge.definitionNode;
            // Normalize connection name to Title Case
            const rawName = String(defNode.name || '').trim();
            const defNodeName = toTitleCase(rawName);

            if (defNodeName) {
              // Check local cache first to avoid duplicates in same batch
              if (localConnectionProtoCache.has(defNodeName)) {
                const cachedId = localConnectionProtoCache.get(defNodeName);
                definitionNodeIds = [cachedId];
                // console.log(`[Executor] Reusing locally cached connection definition: "${defNodeName}" (${cachedId})`);
              } else {
                // Search for existing prototype with same name (deduplication)
                const store = getBridgeStore();
                const existingProto = Array.isArray(store.nodePrototypes)
                  ? store.nodePrototypes.find(p => p.name?.toLowerCase() === defNodeName.toLowerCase())
                  : null;

                if (existingProto) {
                  // Reuse existing prototype
                  definitionNodeIds = [existingProto.id];
                  localConnectionProtoCache.set(defNodeName, existingProto.id);
                  console.log(`[Executor] Reusing existing connection definition prototype: "${defNodeName}" (${existingProto.id})`);
                } else {
                  // Create a new prototype for the connection definition
                  const defProtoId = `prototype-def-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  ops.push({
                    type: 'addNodePrototype',
                    prototypeData: {
                      id: defProtoId,
                      name: defNodeName,
                      description: defNode.description || `Defines the "${edge.relation || edge.type || 'connection'}" relationship`,
                      color: defNode.color || generateConnectionColor(defNodeName),
                      typeNodeId: null,
                      definitionGraphIds: []
                    }
                  });
                  definitionNodeIds = [defProtoId];
                  localConnectionProtoCache.set(defNodeName, defProtoId);
                  console.log(`[Executor] Created new connection definition prototype: "${defNodeName}" (${defProtoId})`);
                }
              }
            }
          }

          ops.push({
            type: 'addEdge',
            graphId,
            edgeData: {
              id: edgeId,
              sourceId,
              destinationId: targetId,
              name: toTitleCase(edge.relation || edge.type || ''),
              typeNodeId: edge.typeNodeId || 'base-connection-prototype',
              directionality: { arrowsToward },
              definitionNodeIds
            }
          });
        }
      });
    } else if (task.toolName === 'create_populated_graph') {
      // Atomic operation: create graph + populate with auto-layout in single patch
      const { applyLayout } = await import('../graphLayoutService.js');
      const name = validation.sanitized.name;
      const description = validation.sanitized.description || '';
      const graphSpec = validation.sanitized.graph_spec || {};
      const layoutAlgorithm = validation.sanitized.layout_algorithm || 'force';
      const layoutMode = validation.sanitized.layout_mode || 'auto';
      const providedGraphId = validation.sanitized.graph_id;

      // 1. Create the graph
      const graphId = providedGraphId || `graph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ops.push({
        type: 'createNewGraph',
        initialData: {
          id: graphId,
          name,
          description,
          createdAt: new Date().toISOString(),
          nodes: [],
          edges: []
        }
      });

      // 2. Create prototypes, instances, and edges with auto-layout
      const nodes = Array.isArray(graphSpec.nodes) ? graphSpec.nodes : [];
      const edges = Array.isArray(graphSpec.edges) ? graphSpec.edges : [];

      const protoIdByName = new Map();
      const instanceIdByName = new Map();
      const tempInstances = [];

      nodes.forEach((node, idx) => {
        const nodeName = String(node?.name || '').trim() || `Concept ${idx + 1}`;
        const prototypeId = `prototype-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
        const instanceId = `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;

        protoIdByName.set(nodeName, prototypeId);
        instanceIdByName.set(nodeName, instanceId);

        ops.push({
          type: 'addNodePrototype',
          prototypeData: {
            id: prototypeId,
            name: nodeName,
            description: node.description || '',
            color: node.color || '#5B6CFF',
            typeNodeId: null,
            definitionGraphIds: []
          }
        });

        tempInstances.push({
          id: instanceId,
          prototypeId,
          name: nodeName
        });
      });

      const tempEdges = edges.map(edge => ({
        sourceId: instanceIdByName.get(edge.source),
        destinationId: instanceIdByName.get(edge.target)
      })).filter(e => e.sourceId && e.destinationId);

      // Use same layout settings as UI Auto-Layout button
      const { getAutoLayoutSettings } = await import('../bridgeStoreAccessor.js');
      const autoSettings = getAutoLayoutSettings();

      // Force 'force-directed' if 'force' is requested
      const algorithmToUse = layoutAlgorithm === 'force' ? 'force-directed' : layoutAlgorithm;

      // Dynamic layout sizing based on node count
      const nodeCount = tempInstances.length;
      const layoutWidth = Math.max(2000, Math.sqrt(nodeCount) * 400);
      const layoutHeight = Math.max(2000, Math.sqrt(nodeCount) * 400);
      const layoutPadding = Math.max(300, Math.min(layoutWidth, layoutHeight) * 0.08);

      // Update tempInstances with estimated dimensions for layout
      const layoutNodes = tempInstances.map(n => {
        const nameLen = (n.name || '').length;
        const width = Math.max(160, nameLen * 10 + 40);
        const height = nameLen > 30 ? 140 : 100;
        return {
          ...n,
          width,
          height,
          x: 0, y: 0
        };
      });

      const positions = applyLayout(layoutNodes, tempEdges, algorithmToUse, {
        layoutMode,
        layoutScale: autoSettings.layoutScale,
        layoutScaleMultiplier: autoSettings.layoutScaleMultiplier,
        iterationPreset: autoSettings.iterationPreset,
        width: layoutWidth,
        height: layoutHeight,
        padding: layoutPadding
      });

      // RECENTERING: Shift layout to center around (0,0)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let hasPos = false;
      positions.forEach(p => {
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
          hasPos = true;
        }
      });

      if (hasPos) {
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const offsetX = -centerX;
        const offsetY = -centerY;

        positions.forEach(p => {
          p.x += offsetX;
          p.y += offsetY;
        });
      }

      const positionMap = new Map();
      positions.forEach(pos => {
        positionMap.set(pos.instanceId, { x: pos.x, y: pos.y });
      });

      tempInstances.forEach(inst => {
        const position = positionMap.get(inst.id) || { x: 500, y: 300 };
        ops.push({
          type: 'addNodeInstance',
          graphId,
          prototypeId: inst.prototypeId,
          position,
          instanceId: inst.id
        });
      });

      // Local cache for connection definition prototypes created in this batch
      const localConnectionProtoCache = new Map();

      edges.forEach(edge => {
        const sourceId = instanceIdByName.get(edge.source);
        const targetId = instanceIdByName.get(edge.target);
        if (sourceId && targetId) {
          const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          // Determine directionality from edge spec
          let arrowsToward = [targetId]; // Default: unidirectional arrow to target
          if (edge.directionality === 'bidirectional') {
            arrowsToward = [sourceId, targetId]; // Arrows on both ends
          } else if (edge.directionality === 'none' || edge.directionality === 'undirected') {
            arrowsToward = []; // No arrows
          } else if (edge.directionality === 'reverse') {
            arrowsToward = [sourceId]; // Arrow points back to source
          }
          // else: default unidirectional to target

          // Handle connection definition node if specified
          let definitionNodeIds = [];
          if (edge.definitionNode && typeof edge.definitionNode === 'object') {
            const defNode = edge.definitionNode;
            const defNodeName = toTitleCase(String(defNode.name || '').trim());

            if (defNodeName) {
              // Check local cache first
              if (localConnectionProtoCache.has(defNodeName)) {
                definitionNodeIds = [localConnectionProtoCache.get(defNodeName)];
              } else {
                const store = getBridgeStore();
                const existingProto = Array.isArray(store.nodePrototypes)
                  ? store.nodePrototypes.find(p => p.name?.toLowerCase() === defNodeName.toLowerCase())
                  : null;

                if (existingProto) {
                  definitionNodeIds = [existingProto.id];
                  localConnectionProtoCache.set(defNodeName, existingProto.id);
                  console.log(`[Executor] Reusing existing connection definition prototype: "${defNodeName}" (${existingProto.id})`);
                } else {
                  const defProtoId = `prototype-def-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  ops.push({
                    type: 'addNodePrototype',
                    prototypeData: {
                      id: defProtoId,
                      name: defNodeName,
                      description: defNode.description || `Defines the "${edge.relation || edge.type || 'connection'}" relationship`,
                      color: defNode.color || generateConnectionColor(defNodeName),
                      typeNodeId: null,
                      definitionGraphIds: []
                    }
                  });
                  definitionNodeIds = [defProtoId];
                  localConnectionProtoCache.set(defNodeName, defProtoId);
                  console.log(`[Executor] Created new connection definition prototype: "${defNodeName}" (${defProtoId})`);
                }
              }
            }
          }

          ops.push({
            type: 'addEdge',
            graphId,
            edgeData: {
              id: edgeId,
              sourceId,
              destinationId: targetId,
              name: toTitleCase(edge.relation || edge.type || ''),
              typeNodeId: edge.typeNodeId || 'base-connection-prototype',
              directionality: { arrowsToward },
              definitionNodeIds
            }
          });
        }
      });
    } else if (task.toolName === 'create_subgraph_in_new_graph') {
      // Create subgraph in a newly created graph (graph was created by previous task in DAG)
      // Need to find the graph ID by name since it was just created
      const { applyLayout } = await import('../graphLayoutService.js');
      const graphName = validation.sanitized.graph_name;
      const graphSpec = validation.sanitized.graph_spec || {};
      const layoutAlgorithm = validation.sanitized.layout_algorithm || 'force';

      // This will be resolved by the committer after the graph is created
      // For now, use a placeholder that the committer will replace
      const graphId = `NEW_GRAPH:${graphName}`;

      const nodes = Array.isArray(graphSpec.nodes) ? graphSpec.nodes : [];
      const edges = Array.isArray(graphSpec.edges) ? graphSpec.edges : [];

      // Create prototype IDs and temporary instance IDs for layout
      // SYNTHESIS: Get store to check for existing prototypes
      const store = getBridgeStore();
      const protoIdByName = new Map();
      const instanceIdByName = new Map();
      const tempInstances = [];

      nodes.forEach((node, idx) => {
        // CRITICAL: Node MUST have a name - check common field names (LLMs use different ones)
        const name = String(node?.name || node?.title || node?.label || node?.id || '').trim();

        if (!name) {
          throw new Error(`Node at index ${idx} missing required name field (checked: name, title, label, id). Node data: ${JSON.stringify(node)}`);
        }

        // FUZZY DEDUPLICATION: Check for exact or similar existing prototype
        const match = findExistingPrototype(name, store);

        let prototypeId;
        if (match) {
          // Reuse existing prototype (exact or fuzzy match)
          prototypeId = match.proto.id;
          if (match.matchType === 'fuzzy') {
            console.log(`[Executor] 🧬 FUZZY MATCH: "${name}" → "${match.proto.name}" (${Math.round(match.similarity * 100)}% similar)`);
          } else {
            console.log(`[Executor] ♻️  EXACT MATCH: Reusing prototype "${match.proto.name}" (${prototypeId})`);
          }
        } else {
          // Create new prototype
          prototypeId = `prototype-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
          ops.push({
            type: 'addNodePrototype',
            prototypeData: {
              id: prototypeId,
              name,
              description: node.description || '',
              color: node.color || '#5B6CFF',
              typeNodeId: null,
              definitionGraphIds: []
            }
          });
          console.log(`[Executor] ✨ NEW PROTOTYPE: Created "${name}" (${prototypeId})`);
        }

        const instanceId = `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
        protoIdByName.set(name, prototypeId);
        instanceIdByName.set(name, instanceId);

        // Store temp instance for layout calculation
        tempInstances.push({
          id: instanceId,
          prototypeId,
          name
        });
      });

      // Build edge list for layout algorithm
      const tempEdges = edges.map(edge => ({
        sourceId: instanceIdByName.get(edge.source),
        destinationId: instanceIdByName.get(edge.target)
      })).filter(e => e.sourceId && e.destinationId);

      // DETERMINISTIC LAYOUT: Use same parameters as Edit menu's Auto-Layout button
      const { getAutoLayoutSettings } = await import('../bridgeStoreAccessor.js');
      const autoSettings = getAutoLayoutSettings();

      // Dynamic layout sizing based on node count (heuristic since we don't have canvas size)
      const nodeCount = tempInstances.length;
      const layoutWidth = Math.max(2000, Math.sqrt(nodeCount) * 400);
      const layoutHeight = Math.max(2000, Math.sqrt(nodeCount) * 400);
      const layoutPadding = Math.max(300, Math.min(layoutWidth, layoutHeight) * 0.08);

      // Initialize layoutNodes from tempInstances
      let layoutNodes = tempInstances;

      // Update layout nodes with estimated dimensions
      layoutNodes = layoutNodes.map(n => {
        const nameLen = (n.name || '').length;
        // Estimate width: ~10px per char + padding, min 160
        const width = Math.max(160, nameLen * 10 + 40);
        // Estimate height: fixed 100 for now, or more if long text
        const height = nameLen > 30 ? 140 : 100;
        return {
          ...n,
          width,
          height,
          // Ensure x/y are numbers
          x: Number.isFinite(n.x) ? n.x : 0,
          y: Number.isFinite(n.y) ? n.y : 0
        };
      });

      const layoutOptions = {
        width: layoutWidth,
        height: layoutHeight,
        padding: layoutPadding,
        layoutMode,
        layoutScale: autoSettings.layoutScale,
        layoutScaleMultiplier: autoSettings.layoutScaleMultiplier,
        iterationPreset: autoSettings.iterationPreset,
        useExistingPositions: false  // Full re-layout by default
      };
      // Apply auto-layout to get positions
      const positions = applyLayout(layoutNodes, tempEdges, layoutAlgorithm, layoutOptions);

      // Create position map
      const positionMap = new Map();
      positions.forEach(pos => {
        positionMap.set(pos.instanceId, { x: pos.x, y: pos.y });
      });

      // Add node instance ops with calculated positions (graphId will be resolved by committer)
      tempInstances.forEach(inst => {
        const position = positionMap.get(inst.id) || { x: 500, y: 300 };
        ops.push({
          type: 'addNodeInstance',
          graphId,
          prototypeId: inst.prototypeId,
          position,
          instanceId: inst.id
        });
      });

      // Add edge ops
      // Local cache for connection definition prototypes created in this batch
      const localConnectionProtoCache = new Map();

      edges.forEach(edge => {
        const sourceId = instanceIdByName.get(edge.source);
        const targetId = instanceIdByName.get(edge.target);
        if (sourceId && targetId) {
          const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          // Determine directionality from edge spec
          let arrowsToward = [targetId]; // Default: unidirectional arrow to target
          if (edge.directionality === 'bidirectional') {
            arrowsToward = [sourceId, targetId]; // Arrows on both ends
          } else if (edge.directionality === 'none' || edge.directionality === 'undirected') {
            arrowsToward = []; // No arrows
          } else if (edge.directionality === 'reverse') {
            arrowsToward = [sourceId]; // Arrow points back to source
          }
          // else: default unidirectional to target

          // Handle connection definition node if specified
          let definitionNodeIds = [];
          if (edge.definitionNode && typeof edge.definitionNode === 'object') {
            const defNode = edge.definitionNode;
            const defNodeName = toTitleCase(String(defNode.name || '').trim());

            if (defNodeName) {
              // Check local cache first
              if (localConnectionProtoCache.has(defNodeName)) {
                definitionNodeIds = [localConnectionProtoCache.get(defNodeName)];
              } else {
                const store = getBridgeStore();
                const existingProto = Array.isArray(store.nodePrototypes)
                  ? store.nodePrototypes.find(p => p.name?.toLowerCase() === defNodeName.toLowerCase())
                  : null;

                if (existingProto) {
                  definitionNodeIds = [existingProto.id];
                  localConnectionProtoCache.set(defNodeName, existingProto.id);
                  console.log(`[Executor] Reusing existing connection definition prototype: "${defNodeName}" (${existingProto.id})`);
                } else {
                  const defProtoId = `prototype-def-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  ops.push({
                    type: 'addNodePrototype',
                    prototypeData: {
                      id: defProtoId,
                      name: defNodeName,
                      description: defNode.description || `Defines the "${edge.relation || edge.type || 'connection'}" relationship`,
                      color: defNode.color || generateConnectionColor(defNodeName),
                      typeNodeId: null,
                      definitionGraphIds: []
                    }
                  });
                  definitionNodeIds = [defProtoId];
                  localConnectionProtoCache.set(defNodeName, defProtoId);
                  console.log(`[Executor] Created new connection definition prototype: "${defNodeName}" (${defProtoId})`);
                }
              }
            }
          }

          ops.push({
            type: 'addEdge',
            graphId,
            edgeData: {
              id: edgeId,
              sourceId,
              destinationId: targetId,
              name: toTitleCase(edge.relation || edge.type || ''),
              typeNodeId: edge.typeNodeId || 'base-connection-prototype',
              directionality: { arrowsToward },
              definitionNodeIds
            }
          });
        }
      });
    } else if (task.toolName === 'define_connections') {
      const store = getBridgeStore();
      const graphId = validation.sanitized.graph_id || store.activeGraphId;
      const edges = (Array.isArray(store.graphEdges) ? store.graphEdges : []).filter(edge => edge.graphId === graphId);
      const generalTypes = new Set(['connects', 'relates to', 'links', 'associates', 'connection', 'related to']);
      const limit = validation.sanitized.limit || 32;
      const includeGeneral = validation.sanitized.include_general_types !== false;

      const toDefine = edges.filter(edge => !Array.isArray(edge.definitionNodeIds) || edge.definitionNodeIds.length === 0)
        .filter(edge => includeGeneral || !generalTypes.has(((edge.type || edge.name || '').trim().toLowerCase())))
        .slice(0, limit);

      const existingProtos = new Map();
      (Array.isArray(store.nodePrototypes) ? store.nodePrototypes : []).forEach(proto => {
        if (proto?.name) existingProtos.set(proto.name.toLowerCase(), proto.id);
      });

      const addOps = [];
      const updateOps = [];
      const defMapping = new Map();

      toDefine.forEach(edge => {
        const rawLabel = (edge.type || edge.name || 'Connection').trim() || 'Connection';
        const label = toTitleCase(rawLabel);
        const key = label.toLowerCase();
        let protoId = defMapping.get(key) || existingProtos.get(key);
        if (!protoId) {
          protoId = `prototype-conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          addOps.push({
            type: 'addNodePrototype',
            prototypeData: {
              id: protoId,
              name: label,
              description: edge.description || `Defines the "${label}" relationship`,
              color: edge.definitionNode?.color || '#000000',
              typeNodeId: null,
              definitionGraphIds: []
            }
          });
          defMapping.set(key, protoId);
        } else {
          defMapping.set(key, protoId);
        }
        updateOps.push({
          type: 'updateEdgeDefinition',
          edgeId: edge.id,
          definitionNodeIds: [protoId]
        });
      });

      if (addOps.length === 0 && updateOps.length === 0) {
        ops.push({
          type: 'readResponse',
          toolName: 'define_connections',
          data: { message: 'All visible edges already have connection definitions.' }
        });
      } else {
        ops.push(...addOps, ...updateOps);
        ops.push({
          type: 'readResponse',
          toolName: 'define_connections',
          data: { message: `Defined ${updateOps.length} edge connection type${updateOps.length === 1 ? '' : 's'}.` }
        });
      }
    } else if (task.toolName === 'read_graph_structure') {
      // Read-only tool: return semantic graph structure without spatial data
      // Uses abstracted graph query layer for consistency
      const store = getBridgeStore();
      const graphId = validation.sanitized.graph_id || store.activeGraphId;

      const result = getGraphSemanticStructure(store, graphId, {
        includeDescriptions: validation.sanitized.include_descriptions !== false,
        includeColors: true
      });

      if (result.error) {
        console.warn(`[Executor] read_graph_structure: ${result.error} (${graphId})`);
      } else {
        console.log(`[Executor] read_graph_structure: Read ${result.nodeCount} nodes, ${result.edgeCount} edges from "${result.name}"`);
      }

      // Create a response op that the UI can interpret
      ops.push({
        type: 'readResponse',
        toolName: 'read_graph_structure',
        data: result
      });
    } else if (task.toolName === 'update_node_prototype') {
      // Update an existing node prototype
      ops.push({
        type: 'updateNodePrototype',
        prototypeId: validation.sanitized.prototype_id,
        updates: {
          name: validation.sanitized.name,
          description: validation.sanitized.description,
          color: validation.sanitized.color
        }
      });
      console.log(`[Executor] update_node_prototype: Updating prototype ${validation.sanitized.prototype_id}`);
    } else if (task.toolName === 'delete_node_instance') {
      // Delete a node instance from a graph
      ops.push({
        type: 'deleteNodeInstance',
        graphId: validation.sanitized.graph_id,
        instanceId: validation.sanitized.instance_id
      });
      console.log(`[Executor] delete_node_instance: Deleting instance ${validation.sanitized.instance_id} from graph ${validation.sanitized.graph_id}`);
    } else if (task.toolName === 'delete_graph') {
      // Delete an entire graph
      const store = getBridgeStore();
      let graphId = validation.sanitized.graph_id || store.activeGraphId;

      // Robust resolution: if graphId is not a valid ID, check if it's a name
      const graphs = Array.isArray(store.graphs) ? store.graphs : [];
      const directMatch = graphs.find(g => g.id === graphId);

      if (!directMatch && graphId) {
        // Try finding by name (case-insensitive)
        const nameMatch = graphs.find(g => (g.name || '').toLowerCase() === graphId.toLowerCase());
        if (nameMatch) {
          console.log(`[Executor] delete_graph: Resolved name "${graphId}" to ID "${nameMatch.id}"`);
          graphId = nameMatch.id;
        }
      }

      if (!graphId) {
        throw new Error('No graph ID specified and no active graph found to delete.');
      }

      ops.push({
        type: 'deleteGraph',
        graphId
      });
      console.log(`[Executor] delete_graph: Deleting graph ${graphId}`);
    } else if (task.toolName === 'get_edge_info') {
      // Find specific edges between two named nodes
      const store = getBridgeStore();
      const graphId = validation.sanitized.graph_id || store.activeGraphId;
      const sourceName = validation.sanitized.source_name;
      const targetName = validation.sanitized.target_name;

      if (!sourceName || !targetName) {
        ops.push({
          type: 'readResponse',
          toolName: 'get_edge_info',
          data: { error: 'Both source_name and target_name are required' }
        });
      } else {
        const graph = getGraphById(graphId);
        if (!graph) {
          ops.push({
            type: 'readResponse',
            toolName: 'get_edge_info',
            data: { error: `Graph ${graphId} not found` }
          });
        } else {
          // Get node instances to find IDs by name
          const instancesArray = graph.instances instanceof Map
            ? Array.from(graph.instances.values())
            : Array.isArray(graph.instances)
              ? graph.instances
              : Object.values(graph.instances || {});

          const sourceProto = store.nodePrototypes?.find(p => p.name?.toLowerCase() === sourceName.toLowerCase());
          const targetProto = store.nodePrototypes?.find(p => p.name?.toLowerCase() === targetName.toLowerCase());

          if (!sourceProto || !targetProto) {
            ops.push({
              type: 'readResponse',
              toolName: 'get_edge_info',
              data: { error: `Could not find prototypes for "${sourceName}" or "${targetName}"` }
            });
          } else {
            const sourceInstances = instancesArray.filter(inst => inst.prototypeId === sourceProto.id);
            const targetInstances = instancesArray.filter(inst => inst.prototypeId === targetProto.id);

            // Find edges between any source and target instances
            const matchingEdges = [];
            const edgeIds = graph.edgeIds || [];

            for (const edgeId of edgeIds) {
              const edge = store.edges instanceof Map
                ? store.edges.get(edgeId)
                : Array.isArray(store.edges)
                  ? store.edges.find(e => e.id === edgeId)
                  : store.edges?.[edgeId];

              if (edge) {
                const sourceMatches = sourceInstances.some(inst => inst.id === edge.sourceId);
                const targetMatches = targetInstances.some(inst => inst.id === edge.destinationId);

                if (sourceMatches && targetMatches) {
                  matchingEdges.push({
                    id: edge.id,
                    sourceId: edge.sourceId,
                    destinationId: edge.destinationId,
                    sourceName,
                    targetName,
                    name: edge.name || edge.type || 'Connection',
                    definitionNodeIds: edge.definitionNodeIds || []
                  });
                }
              }
            }

            ops.push({
              type: 'readResponse',
              toolName: 'get_edge_info',
              data: {
                graphId,
                sourceName,
                targetName,
                edges: matchingEdges,
                count: matchingEdges.length
              }
            });
          }
        }
      }
    } else if (task.toolName === 'get_node_definition') {
      // Check if a node has a definition graph
      const store = getBridgeStore();
      const nodeId = validation.sanitized.node_id;

      if (!nodeId) {
        ops.push({
          type: 'readResponse',
          toolName: 'get_node_definition',
          data: { error: 'node_id is required' }
        });
      } else {
        // Find the instance to get its prototype
        const graphId = validation.sanitized.graph_id || store.activeGraphId;
        const graph = getGraphById(graphId);

        if (!graph) {
          ops.push({
            type: 'readResponse',
            toolName: 'get_node_definition',
            data: { error: `Graph ${graphId} not found` }
          });
        } else {
          const instancesArray = graph.instances instanceof Map
            ? Array.from(graph.instances.values())
            : Array.isArray(graph.instances)
              ? graph.instances
              : Object.values(graph.instances || {});

          const instance = instancesArray.find(inst => inst.id === nodeId);

          if (!instance) {
            ops.push({
              type: 'readResponse',
              toolName: 'get_node_definition',
              data: { error: `Node instance ${nodeId} not found in graph ${graphId}` }
            });
          } else {
            const proto = store.nodePrototypes?.find(p => p.id === instance.prototypeId);

            if (!proto) {
              ops.push({
                type: 'readResponse',
                toolName: 'get_node_definition',
                data: { error: `Prototype for node ${nodeId} not found` }
              });
            } else {
              const definitionGraphIds = proto.definitionGraphIds || [];
              ops.push({
                type: 'readResponse',
                toolName: 'get_node_definition',
                data: {
                  nodeId,
                  prototypeId: proto.id,
                  nodeName: proto.name,
                  hasDefinition: definitionGraphIds.length > 0,
                  definitionGraphIds
                }
              });
            }
          }
        }
      }
    } else if (task.toolName === 'create_edge') {
      // Create an edge between two instances
      const sourceInstanceId = validation.sanitized.source_instance_id;
      const targetInstanceId = validation.sanitized.target_instance_id;
      const graphId = validation.sanitized.graph_id;
      const name = validation.sanitized.name || '';
      const description = validation.sanitized.description || '';
      const directionality = validation.sanitized.directionality || { arrowsToward: [] };
      const definitionNode = validation.sanitized.definitionNode || task.args?.definitionNode || null;

      if (!sourceInstanceId || !targetInstanceId || !graphId) {
        throw new Error('source_instance_id, target_instance_id, and graph_id are required for create_edge');
      }

      const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      
      // Convert arrowsToward array to Set if needed
      let arrowsTowardSet = new Set();
      if (Array.isArray(directionality.arrowsToward)) {
        arrowsTowardSet = new Set(directionality.arrowsToward);
      } else if (directionality.arrowsToward instanceof Set) {
        arrowsTowardSet = directionality.arrowsToward;
      }

      // Handle definition node - find or create prototype
      let definitionNodeIds = [];
      let typeNodeId = validation.sanitized.edge_prototype_id || 'base-connection-prototype';

      if (definitionNode && definitionNode.name) {
        const defNodeName = definitionNode.name;
        const store = getBridgeStore();
        
        // Search for existing prototype with same name (deduplication)
        const existingProto = Array.isArray(store.nodePrototypes)
          ? store.nodePrototypes.find(p => p.name?.toLowerCase() === defNodeName.toLowerCase())
          : null;

        if (existingProto) {
          // Reuse existing prototype
          definitionNodeIds = [existingProto.id];
          typeNodeId = existingProto.id;
          console.log(`[Executor] create_edge: Reusing existing definition prototype: "${defNodeName}" (${existingProto.id})`);
        } else {
          // Create a new prototype for the connection definition
          const defProtoId = `prototype-def-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          ops.push({
            type: 'addNodePrototype',
            prototypeData: {
              id: defProtoId,
              name: defNodeName,
              description: definitionNode.description || `Defines the "${name || 'connection'}" relationship`,
              color: definitionNode.color || '#708090',
              typeNodeId: 'base-connection-prototype',
              definitionGraphIds: []
            }
          });
          definitionNodeIds = [defProtoId];
          typeNodeId = defProtoId;
          console.log(`[Executor] create_edge: Created new definition prototype: "${defNodeName}" (${defProtoId})`);
        }
      }

      ops.push({
        type: 'addEdge',
        graphId,
        edgeData: {
          id: edgeId,
          sourceId: sourceInstanceId,
          destinationId: targetInstanceId,
          name,
          typeNodeId,
          directionality: { arrowsToward: arrowsTowardSet },
          definitionNodeIds
        }
      });
      console.log(`[Executor] create_edge: Creating edge ${edgeId} from ${sourceInstanceId} to ${targetInstanceId} in graph ${graphId}`);
    } else if (task.toolName === 'delete_edge') {
      // Delete a specific edge
      const graphId = validation.sanitized.graph_id;
      const edgeId = validation.sanitized.edge_id;

      if (!graphId || !edgeId) {
        throw new Error('Both graph_id and edge_id are required for delete_edge');
      }

      ops.push({
        type: 'deleteEdge',
        graphId,
        edgeId
      });
      console.log(`[Executor] delete_edge: Deleting edge ${edgeId} from graph ${graphId}`);
    } else if (task.toolName === 'delete_node_prototype') {
      // Delete a node prototype (hard delete - removes the concept)
      const prototypeId = validation.sanitized.prototype_id;

      if (!prototypeId) {
        throw new Error('prototype_id is required for delete_node_prototype');
      }

      ops.push({
        type: 'deleteNodePrototype',
        prototypeId
      });
      console.log(`[Executor] delete_node_prototype: Deleting prototype ${prototypeId}`);
    } else if (task.toolName === 'create_group') {
      // Create a visual group
      const graphId = validation.sanitized.graph_id;
      const name = validation.sanitized.name || 'Group';
      const memberInstanceIds = validation.sanitized.memberInstanceIds || [];

      if (!graphId) {
        throw new Error('graph_id is required for create_group');
      }

      ops.push({
        type: 'createGroup',
        graphId,
        groupData: {
          name,
          color: validation.sanitized.color || '#8B0000',
          memberInstanceIds
        }
      });
      console.log(`[Executor] create_group: Creating group "${name}" with ${memberInstanceIds.length} members`);
    } else if (task.toolName === 'convert_to_node_group') {
      // Convert a group into a Node with a nested graph definition
      const graphId = validation.sanitized.graph_id;
      const groupId = validation.sanitized.group_id;
      const nodePrototypeId = validation.sanitized.node_prototype_id;
      const createNewPrototype = validation.sanitized.create_new_prototype || false;
      const newPrototypeName = validation.sanitized.new_prototype_name || '';
      const newPrototypeColor = validation.sanitized.new_prototype_color || '#8B0000';

      if (!graphId || !groupId) {
        throw new Error('Both graph_id and group_id are required for convert_to_node_group');
      }

      ops.push({
        type: 'convertToNodeGroup',
        graphId,
        groupId,
        nodePrototypeId,
        createNewPrototype,
        newPrototypeName,
        newPrototypeColor
      });
      console.log(`[Executor] convert_to_node_group: Converting group ${groupId} to node-group`);
    } else if (task.toolName === 'set_active_graph') {
      // Switch the active view to a specific graph
      const graphId = validation.sanitized.graph_id;

      if (!graphId) {
        throw new Error('graph_id is required for set_active_graph');
      }

      ops.push({
        type: 'setActiveGraph',
        graphId
      });
      console.log(`[Executor] set_active_graph: Setting active graph to ${graphId}`);
    } else if (task.toolName === 'sparql_query') {
      // Execute raw SPARQL query
      const query = validation.sanitized.query;
      const endpoint = validation.sanitized.endpoint || 'https://query.wikidata.org/sparql';

      if (!query) {
        ops.push({
          type: 'readResponse',
          toolName: 'sparql_query',
          data: { error: 'SPARQL query is required' }
        });
      } else {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Accept': 'application/sparql-results+json',
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Redstring-SemanticWeb/1.0'
            },
            body: `query=${encodeURIComponent(query)}`,
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`SPARQL endpoint returned ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();

          ops.push({
            type: 'readResponse',
            toolName: 'sparql_query',
            data: {
              endpoint,
              results: data.results?.bindings || [],
              head: data.head || {}
            }
          });
        } catch (error) {
          ops.push({
            type: 'readResponse',
            toolName: 'sparql_query',
            data: { error: error.message || 'SPARQL query failed' }
          });
        }
      }
    } else if (task.toolName === 'semantic_search') {
      // High-level concept discovery via enhancedSemanticSearch
      const query = validation.sanitized.query;

      if (!query) {
        ops.push({
          type: 'readResponse',
          toolName: 'semantic_search',
          data: { error: 'Search query is required' }
        });
      } else {
        try {
          const { enhancedSemanticSearch } = await import('../semanticWebQuery.js');
          const results = await enhancedSemanticSearch(query, {
            timeout: 45000,
            limit: 50
          });

          // Convert Map to array for JSON serialization
          const entitiesArray = Array.from(results.entities.entries()).map(([id, entity]) => ({
            id,
            ...entity
          }));

          ops.push({
            type: 'readResponse',
            toolName: 'semantic_search',
            data: {
              query,
              entities: entitiesArray,
              relationships: results.relationships || [],
              metadata: results.metadata || {}
            }
          });
        } catch (error) {
          ops.push({
            type: 'readResponse',
            toolName: 'semantic_search',
            data: { error: error.message || 'Semantic search failed' }
          });
        }
      }
    }
    // Fallback: executor could be richer; keep empty ops acceptable
    const patch = {
      patchId: `patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: task.threadId,
      graphId: validation.sanitized.graph_id || validation.sanitized.graphId || 'unknown',
      baseHash: null,
      ops,
      meta: task.meta || {}  // Propagate meta from task to patch
    };

    // Record executor success
    executionTracer.completeStage(cid, 'executor', 'success', {
      toolName: task.toolName,
      operationCount: ops.length,
      operationTypes: [...new Set(ops.map(o => o.type))],
      graphId: patch.graphId
    });

    queueManager.enqueue('patchQueue', patch, { partitionKey: patch.threadId || 'default' });
    queueManager.ack('taskQueue', task.leaseId);
  } catch (e) {
    console.error('[Executor] Task execution failed:', e);

    // Record executor error
    executionTracer.recordError(cid, 'executor', e);

    // CRITICAL: Distinguish between permanent and transient errors
    // Validation errors are PERMANENT - retrying won't fix them, so we must ACK (drop) the task
    // Transient errors (network, resource) should NACK (retry)
    const isPermanentError = e.message?.includes('Validation failed')
      || e.message?.includes('Tool not allowed')
      || e.message?.includes('not found')
      || e.message?.includes('Invalid')
      || e.message?.includes('missing required');

    if (isPermanentError) {
      console.error(`[Executor] PERMANENT ERROR: Dropping task to prevent infinite retry. Task: ${task.toolName}, Error: ${e.message}`);
      queueManager.ack('taskQueue', task.leaseId); // Drop the task permanently

      // CRITICAL: Send detailed error to chat for AI visibility
      // The AI needs to see what went wrong so it can adjust its plan
      const threadId = task.threadId || 'unknown';
      const errorDetails = {
        tool: task.toolName,
        error: e.message,
        args: task.args,
        timestamp: new Date().toISOString()
      };

      // Format error message for AI comprehension
      let errorText = `⚠️ TOOL EXECUTION ERROR\n\n`;
      errorText += `Tool: ${task.toolName}\n`;
      errorText += `Error: ${e.message}\n`;
      if (task.args && Object.keys(task.args).length > 0) {
        errorText += `Arguments: ${JSON.stringify(task.args, null, 2)}\n`;
      }
      errorText += `\nThis error prevented the operation from completing. `;

      // Add actionable guidance based on error type
      if (e.message.includes('graphId')) {
        errorText += `The graphId was missing or invalid. Please ensure you're targeting an existing graph.`;
      } else if (e.message.includes('Validation failed')) {
        errorText += `The arguments provided did not match the expected schema. Check the tool's requirements.`;
      } else {
        errorText += `Please review the error and adjust your approach accordingly.`;
      }

      try {
        await fetch('http://localhost:3001/api/bridge/chat/append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'system',
            text: errorText,
            cid: threadId,
            channel: 'agent',
            metadata: { errorDetails, severity: 'error' }
          })
        });
      } catch (fetchErr) {
        console.warn('[Executor] Failed to send error to chat:', fetchErr.message);
      }
    } else {
      console.warn('[Executor] TRANSIENT ERROR: Re-queuing task for retry');
      queueManager.nack('taskQueue', task.leaseId); // Retry transient errors
    }
  }
}

// Agent Executor: runs agent graph tasks
export async function runAgentOnce() {
  const items = queueManager.pull('agentQueue', { max: 1 });
  if (items.length === 0) return;
  const item = items[0];

  try {
    const { agentGraphId, nodeId, input, workingMemoryId, apiKey, apiConfig } = item.data;

    // Import AgentExecutor dynamically to avoid circular dependencies
    const { default: AgentExecutor } = await import('../../services/agent/AgentExecutor.js');
    
    // Get agent graph from store
    const bridgeStore = getBridgeStore();
    const agentGraph = bridgeStore.graphs?.get(agentGraphId);
    
    if (!agentGraph) {
      throw new Error(`Agent graph ${agentGraphId} not found`);
    }

    // Create executor
    const executor = new AgentExecutor(agentGraph, apiKey, apiConfig);
    
    // Execute
    const output = await executor.execute(input, nodeId);
    
    // Store result in working memory or return via queue
    queueManager.enqueue('agentResults', {
      workingMemoryId,
      output,
      trace: executor.getTrace()
    });
    
    queueManager.ack('agentQueue', item.leaseId);
  } catch (e) {
    console.error('[Agent Executor] Error:', e);
    queueManager.nack('agentQueue', item.leaseId);
  }
}

// Auditor: pulls patches and validates, then enqueues a review item
export async function runAuditorOnce() {
  const pulled = queueManager.pull('patchQueue', { max: 1 });
  if (pulled.length === 0) return;
  const item = pulled[0];
  try {
    // Basic checks: ops schema-compatible, references present, etc.
    const ok = Array.isArray(item.ops);
    const decision = ok ? 'approved' : 'rejected';
    // Use a distinct field that won't be overwritten by queue wrapper
    // Propagate meta to review queue for Committer access
    queueManager.enqueue('reviewQueue', {
      reviewStatus: decision,
      graphId: item.graphId,
      patch: item,
      meta: item.meta || {}  // Propagate meta for agentic loop
    });
    // Ack original patch item now that mirrored
    queueManager.ack('patchQueue', item.leaseId);
  } catch (e) {
    queueManager.nack('patchQueue', item.leaseId);
  }
}


