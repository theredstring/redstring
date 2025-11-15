import queueManager from '../queue/Queue.js';
// Avoid calling UI store from the daemon; generate ops directly here
import toolValidator from '../toolValidator.js';
import { RolePrompts, ToolAllowlists } from '../roles.js';
import { getBridgeStore, getGraphById, getActiveGraph } from '../bridgeStoreAccessor.js';

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
  const dag = item.dag || { tasks: [] };
  if (Array.isArray(dag.tasks) && dag.tasks.length > 0) {
    for (const t of dag.tasks) {
      queueManager.enqueue('taskQueue', { ...t, threadId: t.threadId || item.threadId, partitionKey: t.threadId || item.threadId || 'default' });
    }
  } else {
    queueManager.enqueue('taskQueue', { toolName: 'verify_state', args: {}, threadId: item.threadId, partitionKey: item.threadId || 'default' });
  }
  queueManager.ack('goalQueue', item.leaseId);
}

// Executor: pulls one task per thread and produces a patch
export async function runExecutorOnce() {
  const tasks = queueManager.pull('taskQueue', { max: 1 });
  if (tasks.length === 0) return;
  const task = tasks[0];
  try {
    const allow = new Set(ToolAllowlists.executor);
    if (!allow.has(task.toolName)) throw new Error(`Tool not allowed for executor: ${task.toolName}`);
    const validation = toolValidator.validateToolArgs(task.toolName, task.args || {});
    if (!validation.valid) throw new Error(`Validation failed: ${validation.error}`);
    // Convert task into ops without touching UI store (Committer + UI will apply)
    const ops = [];
    if (task.toolName === 'create_node_instance') {
      const instanceId = `inst-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      ops.push({ type: 'addNodeInstance', graphId: validation.sanitized.graph_id, prototypeId: validation.sanitized.prototype_id, position: { x: validation.sanitized.x, y: validation.sanitized.y }, instanceId });
    } else if (task.toolName === 'create_graph') {
      const newGraphId = `graph-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      ops.push({ type: 'createNewGraph', initialData: { id: newGraphId, name: validation.sanitized.name, description: validation.sanitized.description || '', color: validation.sanitized.color || '#4A90E2' } });
    } else if (task.toolName === 'create_subgraph') {
      // Use auto-layout to position nodes from LLM's semantic output
      const { applyLayout } = await import('../graphLayoutService.js');
      const graphId = validation.sanitized.graphId || validation.sanitized.graph_id;
      const graphSpec = validation.sanitized.graphSpec || {};
      const layoutAlgorithm = validation.sanitized.layoutAlgorithm || 'force';
      const layoutMode = validation.sanitized.layoutMode || 'auto';
      
      const nodes = Array.isArray(graphSpec.nodes) ? graphSpec.nodes : [];
      const edges = Array.isArray(graphSpec.edges) ? graphSpec.edges : [];
      
      // Create prototype IDs and temporary instance IDs for layout
      const protoIdByName = new Map();
      const instanceIdByName = new Map();
      const tempInstances = [];
      
      nodes.forEach((node, idx) => {
        const name = String(node?.name || '').trim() || `Concept ${idx + 1}`;
        const prototypeId = `prototype-${Date.now()}-${idx}-${Math.random().toString(36).slice(2,8)}`;
        const instanceId = `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2,8)}`;
        
        protoIdByName.set(name, prototypeId);
        instanceIdByName.set(name, instanceId);
        
        // Add prototype creation op
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
      
      // Determine layout nodes + options (partial layout uses existing positions)
      const partialContext = (layoutMode !== 'full') ? buildPartialLayoutContext(graphId) : null;
      const usePartialLayout = partialContext && (layoutMode === 'partial' || layoutMode === 'auto');
      const layoutNodes = [...tempInstances];
      const layoutOptions = {};
      let partialTranslation = null;

      if (usePartialLayout && partialContext) {
        layoutNodes.unshift(...partialContext.nodes);
        layoutOptions.useExistingPositions = true;
        layoutOptions.width = partialContext.width;
        layoutOptions.height = partialContext.height;
        partialTranslation = {
          x: partialContext.anchorCenter.x - (layoutOptions.width || 0) / 2,
          y: partialContext.anchorCenter.y - (layoutOptions.height || 0) / 2
        };
      }

      const positions = applyLayout(layoutNodes, tempEdges, layoutAlgorithm, layoutOptions);
      if (partialTranslation) {
        positions.forEach(pos => {
          pos.x += partialTranslation.x;
          pos.y += partialTranslation.y;
        });
      }
      
      // Create position map
      const positionMap = new Map();
      positions.forEach(pos => {
        positionMap.set(pos.instanceId, { x: pos.x, y: pos.y });
      });
      
      // Add node instance ops with calculated positions
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
      edges.forEach(edge => {
        const sourceId = instanceIdByName.get(edge.source);
        const targetId = instanceIdByName.get(edge.target);
        if (sourceId && targetId) {
          const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
          
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
            const defNodeName = String(defNode.name || '').trim();
            if (defNodeName) {
              // Search for existing prototype with same name (deduplication)
              const store = getBridgeStore();
              const existingProto = Array.isArray(store.nodePrototypes) 
                ? store.nodePrototypes.find(p => p.name?.toLowerCase() === defNodeName.toLowerCase())
                : null;
              
              if (existingProto) {
                // Reuse existing prototype
                definitionNodeIds = [existingProto.id];
                console.log(`[Executor] Reusing existing connection definition prototype: "${defNodeName}" (${existingProto.id})`);
              } else {
                // Create a new prototype for the connection definition
                const defProtoId = `prototype-def-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
                ops.push({
                  type: 'addNodePrototype',
                  prototypeData: {
                    id: defProtoId,
                    name: defNodeName,
                    description: defNode.description || `Defines the "${edge.relation || edge.type || 'connection'}" relationship`,
                    color: defNode.color || '#5B6CFF',
                    typeNodeId: null,
                    definitionGraphIds: []
                  }
                });
                definitionNodeIds = [defProtoId];
                console.log(`[Executor] Created new connection definition prototype: "${defNodeName}" (${defProtoId})`);
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
              name: edge.relation || edge.type || '',
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
      const graphSpec = validation.sanitized.graphSpec || {};
      const layoutAlgorithm = validation.sanitized.layoutAlgorithm || 'force';
      
      // 1. Create the graph
      const graphId = `graph-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
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
        const prototypeId = `prototype-${Date.now()}-${idx}-${Math.random().toString(36).slice(2,8)}`;
        const instanceId = `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2,8)}`;
        
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
      
      const positions = applyLayout(tempInstances, tempEdges, layoutAlgorithm, {});
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
      
      edges.forEach(edge => {
        const sourceId = instanceIdByName.get(edge.source);
        const targetId = instanceIdByName.get(edge.target);
        if (sourceId && targetId) {
          const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
          
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
          
          ops.push({
            type: 'addEdge',
            graphId,
            edgeData: {
              id: edgeId,
              sourceId,
              destinationId: targetId,
              name: edge.relation || edge.type || '',
              typeNodeId: edge.typeNodeId || 'base-connection-prototype',
              directionality: { arrowsToward }
            }
          });
        }
      });
    } else if (task.toolName === 'create_subgraph_in_new_graph') {
      // Create subgraph in a newly created graph (graph was created by previous task in DAG)
      // Need to find the graph ID by name since it was just created
      const { applyLayout } = await import('../graphLayoutService.js');
      const graphName = validation.sanitized.graphName;
      const graphSpec = validation.sanitized.graphSpec || {};
      const layoutAlgorithm = validation.sanitized.layoutAlgorithm || 'force';
      
      // This will be resolved by the committer after the graph is created
      // For now, use a placeholder that the committer will replace
      const graphId = `NEW_GRAPH:${graphName}`;
      
      const nodes = Array.isArray(graphSpec.nodes) ? graphSpec.nodes : [];
      const edges = Array.isArray(graphSpec.edges) ? graphSpec.edges : [];
      
      // Create prototype IDs and temporary instance IDs for layout
      const protoIdByName = new Map();
      const instanceIdByName = new Map();
      const tempInstances = [];
      
      nodes.forEach((node, idx) => {
        const name = String(node?.name || '').trim() || `Concept ${idx + 1}`;
        const prototypeId = `prototype-${Date.now()}-${idx}-${Math.random().toString(36).slice(2,8)}`;
        const instanceId = `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2,8)}`;
        
        protoIdByName.set(name, prototypeId);
        instanceIdByName.set(name, instanceId);
        
        // Add prototype creation op
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
      
      // Apply auto-layout to get positions
      const positions = applyLayout(tempInstances, tempEdges, layoutAlgorithm, {});
      
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
      edges.forEach(edge => {
        const sourceId = instanceIdByName.get(edge.source);
        const targetId = instanceIdByName.get(edge.target);
        if (sourceId && targetId) {
          const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
          
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
            const defNodeName = String(defNode.name || '').trim();
            if (defNodeName) {
              // Search for existing prototype with same name (deduplication)
              const store = getBridgeStore();
              const existingProto = Array.isArray(store.nodePrototypes) 
                ? store.nodePrototypes.find(p => p.name?.toLowerCase() === defNodeName.toLowerCase())
                : null;
              
              if (existingProto) {
                // Reuse existing prototype
                definitionNodeIds = [existingProto.id];
                console.log(`[Executor] Reusing existing connection definition prototype: "${defNodeName}" (${existingProto.id})`);
              } else {
                // Create a new prototype for the connection definition
                const defProtoId = `prototype-def-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
                ops.push({
                  type: 'addNodePrototype',
                  prototypeData: {
                    id: defProtoId,
                    name: defNodeName,
                    description: defNode.description || `Defines the "${edge.relation || edge.type || 'connection'}" relationship`,
                    color: defNode.color || '#5B6CFF',
                    typeNodeId: null,
                    definitionGraphIds: []
                  }
                });
                definitionNodeIds = [defProtoId];
                console.log(`[Executor] Created new connection definition prototype: "${defNodeName}" (${defProtoId})`);
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
              name: edge.relation || edge.type || '',
              typeNodeId: edge.typeNodeId || 'base-connection-prototype',
              directionality: { arrowsToward },
              definitionNodeIds
            }
          });
        }
      });
    } else if (task.toolName === 'define_connections') {
      const store = getBridgeStore();
      const graphId = validation.sanitized.graphId || store.activeGraphId;
      const edges = (Array.isArray(store.graphEdges) ? store.graphEdges : []).filter(edge => edge.graphId === graphId);
      const generalTypes = new Set(['connects', 'relates to', 'links', 'associates', 'connection', 'related to']);
      const limit = validation.sanitized.limit || 32;
      const includeGeneral = validation.sanitized.include_general_types !== false && validation.sanitized.includeGeneralTypes !== false;

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
        const label = (edge.type || edge.name || 'Connection').trim() || 'Connection';
        const key = label.toLowerCase();
        let protoId = defMapping.get(key) || existingProtos.get(key);
        if (!protoId) {
          protoId = `prototype-conn-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
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
      const store = getBridgeStore();
      const graphId = validation.sanitized.graph_id || store.activeGraphId;
      const graph = graphId ? getGraphById(graphId) : getActiveGraph();
      
      if (!graph) {
        console.warn(`[Executor] read_graph_structure: Graph not found (${graphId})`);
        // Create a response op that the UI can interpret
        ops.push({
          type: 'readResponse',
          toolName: 'read_graph_structure',
          data: { error: 'Graph not found', graphId }
        });
      } else {
        // Build semantic structure (nodes, edges, no x/y coordinates)
        const nodes = (graph.instances || []).map(inst => {
          const proto = store.nodePrototypes.find(p => p.id === inst.prototypeId);
          return {
            id: inst.id,
            prototypeId: inst.prototypeId,
            name: proto?.name || 'Unknown',
            description: validation.sanitized.include_descriptions !== false ? (proto?.description || '') : undefined,
            color: proto?.color || '#5B6CFF'
          };
        });
        
        const edges = validation.sanitized.include_edges !== false 
          ? (graph.edgeIds || []).map(edgeId => {
              const edge = store.edges?.find(e => e.id === edgeId);
              if (!edge) return null;
              return {
                id: edge.id,
                sourceId: edge.sourceId,
                destinationId: edge.destinationId,
                name: edge.name || '',
                description: validation.sanitized.include_descriptions !== false ? (edge.description || '') : undefined,
                directionality: edge.directionality
              };
            }).filter(Boolean)
          : [];
        
        const result = {
          graphId: graph.id,
          name: graph.name || 'Untitled',
          description: validation.sanitized.include_descriptions !== false ? (graph.description || '') : undefined,
          nodeCount: nodes.length,
          edgeCount: edges.length,
          nodes,
          edges
        };
        
        // Create a response op that the UI can interpret
        ops.push({
          type: 'readResponse',
          toolName: 'read_graph_structure',
          data: result
        });
        
        console.log(`[Executor] read_graph_structure: Read ${nodes.length} nodes, ${edges.length} edges from "${result.name}"`);
      }
    }
    // Fallback: executor could be richer; keep empty ops acceptable
    const patch = {
      patchId: `patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      threadId: task.threadId,
      graphId: validation.sanitized.graph_id || validation.sanitized.graphId || 'unknown',
      baseHash: null,
      ops
    };
    queueManager.enqueue('patchQueue', patch, { partitionKey: patch.threadId || 'default' });
    queueManager.ack('taskQueue', task.leaseId);
  } catch (e) {
    console.error('[Executor] Task execution failed:', e);
    queueManager.nack('taskQueue', task.leaseId);
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
    queueManager.enqueue('reviewQueue', { reviewStatus: decision, graphId: item.graphId, patch: item });
    // Ack original patch item now that mirrored
    queueManager.ack('patchQueue', item.leaseId);
  } catch (e) {
    queueManager.nack('patchQueue', item.leaseId);
  }
}


