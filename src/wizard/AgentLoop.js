/**
 * AgentLoop - Main agent runtime loop
 * One LLM conversation that loops until task is complete (max 10 iterations)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLLM, streamLLM } from './LLMClient.js';
import { buildContext, buildPersistentContextHeader, buildPlanContext } from './ContextBuilder.js';
import { executeTool, getToolDefinitions } from './tools/index.js';
import { WIZARD_SYSTEM_PROMPT } from '../services/agent/WizardPrompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load system prompt
let SYSTEM_PROMPT = WIZARD_SYSTEM_PROMPT;

/**
 * Shared helper: apply a bulk graph spec (nodes + edges) to the agent's internal
 * graphState. Used by createPopulatedGraph, expandGraph, and populateDefinitionGraph.
 *
 * 1. Creates type prototypes for inline node types
 * 2. Creates node instances + prototypes, builds name→instanceId map
 * 3. Creates edges (previously missing!) with synthetic IDs
 *
 * @param {Object} graphState - The agent's mutable in-memory graph state
 * @param {Object} targetGraph - The graph object within graphState.graphs to populate
 * @param {Object} spec - { nodes: [...], edges: [...], groups: [...] }
 * @returns {{ nodesAdded: number, edgesAdded: number }}
 */
function applyBulkSpecToInternalState(graphState, targetGraph, spec) {
  const nodeSpecs = spec.nodes || [];
  const edgeSpecs = spec.edges || [];

  graphState.nodePrototypes = graphState.nodePrototypes || [];
  graphState.edges = graphState.edges || [];
  targetGraph.instances = targetGraph.instances || [];
  targetGraph.edgeIds = targetGraph.edgeIds || [];

  // 1. Extract and track inline type prototypes
  const typeMap = new Map();
  nodeSpecs.forEach(n => {
    if (n.type) {
      const tLower = n.type.toLowerCase().trim();
      if (!typeMap.has(tLower)) {
        let existingProtoId = null;
        for (const proto of graphState.nodePrototypes) {
          if ((proto.name || '').toLowerCase().trim() === tLower) {
            existingProtoId = proto.id;
            break;
          }
        }
        if (existingProtoId) {
          typeMap.set(tLower, existingProtoId);
        } else {
          const newProtoId = `proto-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          typeMap.set(tLower, newProtoId);
          graphState.nodePrototypes.push({
            id: newProtoId,
            name: n.type,
            color: n.typeColor || '#A0A0A0',
            description: n.typeDescription || '',
            typeNodeId: null,
            definitionGraphIds: []
          });
        }
      }
    }
  });

  // 2. Create node instances + prototypes, build name→instanceId map
  const nameToInstId = new Map();

  // Pre-populate from existing instances (critical for expandGraph where edges connect to existing nodes)
  for (const inst of targetGraph.instances) {
    const proto = graphState.nodePrototypes.find(p => p.id === inst.prototypeId);
    if (proto?.name) {
      nameToInstId.set(proto.name, inst.id);
      nameToInstId.set(proto.name.toLowerCase().trim(), inst.id);
    }
    if (inst.name) {
      nameToInstId.set(inst.name, inst.id);
      nameToInstId.set(inst.name.toLowerCase().trim(), inst.id);
    }
  }

  nodeSpecs.forEach((n, idx) => {
    const protoId = `proto-${Date.now()}-${idx}`;
    const instId = `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;

    targetGraph.instances.push({
      id: instId,
      prototypeId: protoId,
      name: n.name
    });

    graphState.nodePrototypes.push({
      id: protoId,
      name: n.name,
      color: n.color || '#5B6CFF',
      description: n.description || '',
      typeNodeId: n.type ? typeMap.get(n.type.toLowerCase().trim()) : null,
      definitionGraphIds: []
    });

    nameToInstId.set(n.name, instId);
    nameToInstId.set((n.name || '').toLowerCase().trim(), instId);
  });

  // 3. Create edges — resolve source/target by name, add to graphState.edges + targetGraph.edgeIds
  let edgesAdded = 0;
  edgeSpecs.forEach(e => {
    const sourceId = nameToInstId.get(e.source) || nameToInstId.get((e.source || '').toLowerCase().trim());
    const destId = nameToInstId.get(e.target) || nameToInstId.get((e.target || '').toLowerCase().trim());

    if (sourceId && destId) {
      const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Resolve definitionNodeIds for readGraph to display the connection type
      let definitionNodeIds = [];
      const typeName = e.definitionNode?.name || e.type;
      if (typeName) {
        const tLower = typeName.toLowerCase().trim();
        for (const proto of graphState.nodePrototypes) {
          if ((proto.name || '').toLowerCase().trim() === tLower) {
            definitionNodeIds = [proto.id];
            break;
          }
        }
      }

      targetGraph.edgeIds.push(edgeId);
      graphState.edges.push({
        id: edgeId,
        sourceId,
        destinationId: destId,
        type: e.type || 'relates to',
        definitionNodeIds
      });
      edgesAdded++;
    }
  });

  return { nodesAdded: nodeSpecs.length, edgesAdded };
}

/**
 * Keep graphState in sync after mutating tool calls so subsequent
 * tools within the same agent loop see up-to-date state.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ADDING A NEW TOOL? You MUST add a handler here! This is step 4 of 5. ║
 * ║  Read .agent/workflows/add-wizard-tool.md for the full checklist.      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
function updateGraphState(graphState, _toolName, _args, result) {
  if (!result || result.error) return;

  if (result.action === 'createGraph') {
    graphState.activeGraphId = result.graphId;
    graphState.graphs = graphState.graphs || [];
    graphState.graphs.push({
      id: result.graphId,
      name: result.graphName,
      instances: [],
      edgeIds: [],
      groups: [],
      definingNodeIds: []
    });
    console.error('[updateGraphState] createGraph: activeGraphId =', result.graphId);
  } else if (result.action === 'createNode') {
    // Add the new node to the target graph's instances so name-based lookups work
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph) {
      const protoId = `proto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const instId = `inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      targetGraph.instances = targetGraph.instances || [];
      targetGraph.instances.push({
        id: instId,
        prototypeId: protoId,
        name: result.name
      });
      graphState.nodePrototypes = graphState.nodePrototypes || [];
      graphState.nodePrototypes.push({
        id: protoId,
        name: result.name,
        color: result.color,
        description: result.description,
        definitionGraphIds: []
      });
      console.error('[updateGraphState] createNode:', result.name, '→ instances:', targetGraph.instances.length, 'protos:', graphState.nodePrototypes.length, '| graph:', targetGraphId);
    } else {
      console.warn('[updateGraphState] createNode FAILED: no graph for id', targetGraphId, '| available:', (graphState.graphs || []).map(g => g.id));
    }
  } else if (result.action === 'updateNode' && result.updates) {
    // Update the node's name/properties in graphState so subsequent lookups use the new name
    const proto = (graphState.nodePrototypes || []).find(p => p.id === result.prototypeId);
    if (proto) {
      if (result.updates.name) proto.name = result.updates.name;
      if (result.updates.color) proto.color = result.updates.color;
      if (result.updates.description !== undefined) proto.description = result.updates.description;
    }
    // Also update instance name if present
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph) {
      const inst = (targetGraph.instances || []).find(i => i.id === result.instanceId);
      if (inst && result.updates.name) {
        inst.name = result.updates.name;
      }
    }
    console.error('[updateGraphState] updateNode:', result.originalName, '→', result.updates.name || '(no name change)', '| proto found:', !!proto, '| graph:', targetGraphId);
  } else if (result.action === 'deleteNode') {
    // Remove the node from graphState so it's no longer findable
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    const beforeCount = targetGraph?.instances?.length || 0;
    if (targetGraph && targetGraph.instances) {
      if (result.instanceId) {
        targetGraph.instances = targetGraph.instances.filter(i => i.id !== result.instanceId);
      } else if (result.name) {
        // Fallback: remove by name when instanceId wasn't resolved
        const nameLower = result.name.toLowerCase().trim();
        targetGraph.instances = targetGraph.instances.filter(i => {
          const instName = (i.name || '').toLowerCase().trim();
          return instName !== nameLower;
        });
      }
    }
    console.error('[updateGraphState] deleteNode:', result.name, '| before:', beforeCount, '→ after:', targetGraph?.instances?.length || 0, '| graph:', targetGraphId);
  } else if (result.action === 'createPopulatedGraph' && result.spec) {
    // New populated graph — update activeGraphId and add graph + nodes + edges
    graphState.activeGraphId = result.graphId;
    graphState.graphs = graphState.graphs || [];

    graphState.graphs.push({
      id: result.graphId,
      name: result.graphName,
      instances: [],
      edgeIds: [],
      groups: [],
      definingNodeIds: Array.isArray(result.definingNodeIds) ? result.definingNodeIds : []
    });
    const targetGraph = graphState.graphs[graphState.graphs.length - 1];
    const counts = applyBulkSpecToInternalState(graphState, targetGraph, result.spec);

    console.error('[updateGraphState] createPopulatedGraph: added', counts.nodesAdded, 'nodes +', counts.edgesAdded, 'edges to new graph', result.graphId);
  } else if (result.action === 'expandGraph' && result.spec) {
    // Nodes + edges added to target graph
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph) {
      const counts = applyBulkSpecToInternalState(graphState, targetGraph, result.spec);
      console.error('[updateGraphState] expandGraph: added', counts.nodesAdded, 'nodes +', counts.edgesAdded, 'edges to', targetGraphId);
    }
  } else if (result.action === 'createEdge') {
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph) {
      targetGraph.edgeIds = targetGraph.edgeIds || [];
      targetGraph.edgeIds.push(`edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    }
  } else if (result.action === 'updateEdge' && result.updates) {
    // Predictive state for updateEdge could update the edge in local state, but we only store edgeIds here
    // So nothing to deeply change structurally unless we want to maintain an edges map in AgentLoop
  } else if (result.action === 'deleteEdge') {
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph && result.edgeId) {
      targetGraph.edgeIds = (targetGraph.edgeIds || []).filter(id => id !== result.edgeId);
    }
  } else if (result.action === 'createGroup') {
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph) {
      targetGraph.groups = targetGraph.groups || [];
      targetGraph.groups.push({
        id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: result.name,
        color: result.color,
        memberInstanceIds: result.memberInstanceIds || []
      });
    }
  } else if (result.action === 'updateGroup' && result.updates) {
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph && targetGraph.groups) {
      const gObj = targetGraph.groups.find(g => g.id === result.groupId || (result.groupName && g.name === result.groupName));
      if (gObj) {
        if (result.updates.name) gObj.name = result.updates.name;
        if (result.updates.color) gObj.color = result.updates.color;
      }
    }
  } else if (result.action === 'deleteGroup') {
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph && targetGraph.groups) {
      if (result.groupId) {
        targetGraph.groups = targetGraph.groups.filter(g => g.id !== result.groupId);
      } else if (result.groupName) {
        targetGraph.groups = targetGraph.groups.filter(g => g.name !== result.groupName);
      }
    }
  } else if (result.action === 'convertToThingGroup') {
    // Mark group as thing-group in predictive state
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph && targetGraph.groups) {
      const group = targetGraph.groups.find(g =>
        g.id === result.groupId || (result.groupName && g.name === result.groupName)
      );
      if (group) {
        group.linkedNodePrototypeId = result.prototypeId || 'proto-thing-group';
        group.isThingGroup = true;
      }
    }
  } else if (result.action === 'combineThingGroup') {
    // Remove group, add single node instance in its place
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph && targetGraph.groups) {
      const groupIndex = targetGraph.groups.findIndex(g =>
        g.id === result.groupId || (result.groupName && g.name === result.groupName)
      );
      if (groupIndex >= 0) {
        const group = targetGraph.groups[groupIndex];
        targetGraph.groups.splice(groupIndex, 1);
        // Add a single instance representing the combined node
        targetGraph.instances = targetGraph.instances || [];
        targetGraph.instances.push({
          id: `inst-combined-${Date.now()}`,
          prototypeId: group.linkedNodePrototypeId || 'proto-combined',
          name: group.name
        });
      }
    }
  } else if (result.action === 'addDefinitionGraph') {
    // Add new definition graph for a node (WITHOUT changing activeGraphId)
    graphState.graphs = graphState.graphs || [];
    graphState.graphs.push({
      id: result.graphId,
      name: result.nodeName || 'Definition',
      instances: [],
      edgeIds: [],
      groups: [],
      definingNodeIds: [result.prototypeId]
    });

    // Update prototype's definitionGraphIds array
    const proto = (graphState.nodePrototypes || []).find(p => p.id === result.prototypeId);
    if (proto) {
      proto.definitionGraphIds = proto.definitionGraphIds || [];
      proto.definitionGraphIds.push(result.graphId);
    }

    console.error('[updateGraphState] addDefinitionGraph: created', result.graphId, 'for', result.nodeName, '| activeGraphId unchanged');
  } else if (result.action === 'populateDefinitionGraph' && result.spec) {
    // 1. Add new definition graph for a node
    graphState.graphs = graphState.graphs || [];
    graphState.graphs.push({
      id: result.graphId,
      name: result.nodeName || 'Definition',
      instances: [],
      edgeIds: [],
      groups: [],
      definingNodeIds: [result.prototypeId]
    });

    // 2. Update prototype's definitionGraphIds array
    const defProto = (graphState.nodePrototypes || []).find(p => p.id === result.prototypeId);
    if (defProto) {
      defProto.definitionGraphIds = defProto.definitionGraphIds || [];
      defProto.definitionGraphIds.push(result.graphId);
    }

    // 3. Add nodes + edges to this new graph
    const targetGraph = graphState.graphs[graphState.graphs.length - 1];
    const counts = applyBulkSpecToInternalState(graphState, targetGraph, result.spec);

    console.error('[updateGraphState] populateDefinitionGraph: created', result.graphId, 'with', counts.nodesAdded, 'nodes +', counts.edgesAdded, 'edges');
  } else if (result.action === 'removeDefinitionGraph') {
    // Remove definition graph from node's definitionGraphIds
    const proto = (graphState.nodePrototypes || []).find(p => p.id === result.prototypeId);
    if (proto && Array.isArray(proto.definitionGraphIds)) {
      proto.definitionGraphIds = proto.definitionGraphIds.filter(id => id !== result.graphId);
    }

    // Optionally remove the graph from graphs array
    graphState.graphs = (graphState.graphs || []).filter(g => g.id !== result.graphId);

    console.error('[updateGraphState] removeDefinitionGraph: removed', result.graphId, 'from', result.nodeName);
  } else if (result.action === 'switchToGraph') {
    // Explicitly change active graph (user requested navigation)
    graphState.activeGraphId = result.graphId;
    console.error('[updateGraphState] switchToGraph: activeGraphId =', result.graphId);
  } else if (result.action === 'navigateDefinition') {
    // Legacy support for navigateDefinition (will be removed in Phase 5)
    if (result.created) {
      // New definition graph was created - generate predictive ID and add to state
      const newGraphId = `graph-def-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      graphState.activeGraphId = newGraphId;
      graphState.graphs = graphState.graphs || [];
      graphState.graphs.push({
        id: newGraphId,
        name: result.nodeName || 'Definition',
        instances: [],
        edgeIds: [],
        groups: []
      });
      console.error('[updateGraphState] navigateDefinition: created new definition graph', newGraphId, 'for', result.nodeName);
    } else if (result.graphId) {
      graphState.activeGraphId = result.graphId;
      console.error('[updateGraphState] navigateDefinition: activeGraphId =', result.graphId);
    }
  } else if (result.action === 'condenseToNode') {
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph) {
      if (result.collapse) {
        // Remove member instances, add single condensed node
        const removedNames = new Set((result.memberNames || []).map(n => n.toLowerCase().trim()));
        targetGraph.instances = (targetGraph.instances || []).filter(i => {
          const name = (i.name || '').toLowerCase().trim();
          return !removedNames.has(name);
        });
        targetGraph.instances.push({
          id: `inst-condensed-${Date.now()}`,
          prototypeId: `proto-condensed-${Date.now()}`,
          name: result.nodeName
        });
      } else {
        // Just add the group (members remain)
        targetGraph.groups = targetGraph.groups || [];
        targetGraph.groups.push({
          id: result.groupId || `group-${Date.now()}`,
          name: result.nodeName,
          color: result.nodeColor,
          memberInstanceIds: result.resolvedMemberIds || [],
          linkedNodePrototypeId: 'proto-condensed',
          isThingGroup: true
        });
      }
    }
  } else if (result.action === 'decomposeNode') {
    // Remove original instance, add decomposed instances from definition graph, add group
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph) {
      // Remove the original instance
      if (result.originalInstanceId) {
        const beforeCount = (targetGraph.instances || []).length;
        targetGraph.instances = (targetGraph.instances || []).filter(i => i.id !== result.originalInstanceId);
        console.error('[updateGraphState] decomposeNode: Removed original instance', result.originalInstanceId, '| before:', beforeCount, '→ after:', targetGraph.instances.length);
      }

      // Add decomposed instances from definition graph
      targetGraph.instances = targetGraph.instances || [];
      for (const defInst of result.definitionInstances || []) {
        const newInstId = `inst-decomp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        targetGraph.instances.push({
          id: newInstId,
          prototypeId: defInst.prototypeId,
          name: defInst.name,
          x: defInst.x || 0,
          y: defInst.y || 0,
          scale: defInst.scale || 1
        });
      }

      // Add thing-group
      targetGraph.groups = targetGraph.groups || [];
      const decomposedInstIds = (result.definitionInstances || []).map(() =>
        `inst-decomp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      targetGraph.groups.push({
        id: `group-decomp-${Date.now()}`,
        name: result.nodeName,
        color: '#8B0000',
        memberInstanceIds: decomposedInstIds,
        linkedNodePrototypeId: result.prototypeId,
        isThingGroup: true
      });

      console.error('[updateGraphState] decomposeNode:', result.nodeName, '→ added', (result.definitionInstances || []).length, 'instances');
    }
  } else if (result.action === 'setNodeType') {
    // Update prototype's typeNodeId in predictive state
    const proto = (graphState.nodePrototypes || []).find(p => p.id === result.nodeId);

    // If auto-creating a type node, add it to predictive state
    if (result.autoCreate) {
      const newProtoId = `proto-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      graphState.nodePrototypes = graphState.nodePrototypes || [];
      graphState.nodePrototypes.push({
        id: newProtoId,
        name: result.autoCreate.name,
        color: result.autoCreate.color || '#A0A0A0',
        description: result.autoCreate.description || ''
      });
      if (proto) proto.typeNodeId = newProtoId;
      console.error('[updateGraphState] setNodeType (auto-created prototype only):', result.autoCreate.name, '→', newProtoId);
    } else if (proto) {
      proto.typeNodeId = result.typeNodeId || null;
      console.error('[updateGraphState] setNodeType:', proto.name, '→', result.typeNodeId);
    }
  } else if (result.action === 'editAbstractionChain') {
    // Update prototype's abstractionChains in predictive state
    const proto = (graphState.nodePrototypes || []).find(p => p.id === result.nodeId);
    if (proto) {
      proto.abstractionChains = proto.abstractionChains || {};
      if (result.operationType === 'addToAbstractionChain') {
        proto.abstractionChains[result.dimension] = proto.abstractionChains[result.dimension] || [];
        if (!proto.abstractionChains[result.dimension].includes(result.newNodeId)) {
          proto.abstractionChains[result.dimension].push(result.newNodeId);
        }
      } else if (result.operationType === 'removeFromAbstractionChain') {
        if (Array.isArray(proto.abstractionChains[result.dimension])) {
          proto.abstractionChains[result.dimension] = proto.abstractionChains[result.dimension].filter(id => id !== result.nodeToRemove);
        }
      }
      console.error('[updateGraphState] editAbstractionChain:', result.operationType, proto.name);
    }
  } else if (result.action === 'themeGraph' && result.updates) {
    for (const update of result.updates) {
      const proto = (graphState.nodePrototypes || []).find(p => p.id === update.prototypeId);
      if (proto) {
        proto.color = update.color;
      }
    }
  } else if (result.action === 'enrichFromWikipedia') {
    // No-op for predictive state — enrichment is async and happens client-side.
    // The node's description/image will be updated after Wikipedia fetch completes.
    console.error('[updateGraphState] enrichFromWikipedia: queued for', result.nodeName, '(async client-side)');
  } else if (result.action === 'planTask') {
    // Store plan state on graphState for context injection (not real graph data)
    graphState._currentPlan = result.steps;
    const done = result.steps.filter(s => s.status === 'done').length;
    console.error('[updateGraphState] planTask: updated plan', done + '/' + result.steps.length, 'complete');
  }
}

const DEFAULT_MAX_ITERATIONS = 33;

/**
 * Sanitize tool results before sending to LLM conversation history.
 * Strips UI-only data (spec field, verbose arrays) to save tokens.
 * The original result is still yielded to the UI and used by updateGraphState.
 */
function sanitizeResultForLLM(result) {
  if (!result || !result.action) return result;
  const cleaned = { ...result };
  // Remove spec field — it's for UI rendering, not LLM consumption
  delete cleaned.spec;
  // Simplify edge arrays to just counts when counts are available
  if (Array.isArray(cleaned.edgesAdded) && cleaned.edgeCount !== undefined) {
    delete cleaned.edgesAdded;
  }
  if (Array.isArray(cleaned.groupsAdded) && cleaned.groupCount !== undefined) {
    delete cleaned.groupsAdded;
  }
  return cleaned;
}

/**
 * Run the agent loop
 * @param {string} userMessage - User's message
 * @param {Object} graphState - Current graph state from UI
 * @param {Object} config - LLM config (provider, apiKey, etc.)
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {AsyncGenerator} Yields events: { type, ... }
 */
export async function* runAgent(userMessage, graphState, config = {}, ensureSchedulerStarted, abortSignal = null) {
  const cid = config.cid || `wizard-${Date.now()}`;
  const contextItems = config.contextItems || [];

  // Build initial context (respects contextItems toggles from UI)
  const initialContext = buildPersistentContextHeader(graphState, contextItems);

  // Debug logging for graph context
  const activeGraph = graphState?.graphs?.find(g => g.id === graphState.activeGraphId);
  const instanceCount = activeGraph?.instances
    ? (Array.isArray(activeGraph.instances) ? activeGraph.instances.length : Object.keys(activeGraph.instances).length)
    : 0;
  console.error('[AgentLoop] Graph context:', {
    activeGraphId: graphState?.activeGraphId,
    activeGraphName: activeGraph?.name,
    instanceCount,
    edgeCount: activeGraph?.edgeIds?.length || 0,
    graphCount: graphState?.graphs?.length || 0,
    contextPreview: initialContext.substring(0, 300)
  });

  const baseSystemPrompt = config.systemPrompt || SYSTEM_PROMPT || 'You are The Wizard, a helpful assistant for building knowledge graphs.';

  const tools = getToolDefinitions();
  const maxIterations = config.maxIterations || DEFAULT_MAX_ITERATIONS;

  // Build static system prompt template (context will be appended fresh each iteration)
  const systemPromptTemplate = baseSystemPrompt
    .replace('{graphName}', graphState.activeGraphId ? (graphState.graphs?.find(g => g.id === graphState.activeGraphId)?.name || 'Unknown') : 'None')
    .replace(/{maxIterations}/g, String(maxIterations));

  // Build messages array with conversation history (sliding window)
  const conversationHistory = config.conversationHistory || [];
  const MAX_HISTORY_MESSAGES = 20;
  const historyMessages = conversationHistory
    .filter(msg => (msg.content && msg.content.trim()) || (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0)) // Include non-empty messages OR tool calls
    .slice(-MAX_HISTORY_MESSAGES) // Keep only recent history
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content || null,
      tool_calls: msg.role === 'assistant' ? msg.tool_calls : undefined
    }));

  console.error('[AgentLoop] Conversation history:', historyMessages.length, 'messages');

  const messages = [
    { role: 'system', content: systemPromptTemplate.replace('{context}', initialContext) },
    ...historyMessages, // Include prior conversation for context
    { role: 'user', content: userMessage }
  ];


  // Loop detection: track tool call signatures per iteration to detect cycles
  const iterationSignatures = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Rebuild context from (potentially mutated) graphState so LLM sees current state
    {
      const freshContext = iteration > 0 ? buildPersistentContextHeader(graphState, contextItems) : initialContext;
      const planCtx = graphState._currentPlan ? buildPlanContext(graphState._currentPlan, iteration, maxIterations) : '';
      messages[0] = { role: 'system', content: systemPromptTemplate.replace('{context}', freshContext + planCtx) };
    }
    if (abortSignal?.aborted) {
      console.error(`[AgentLoop] ✓ Abort signal detected at iteration ${iteration}. Stopping.`);
      yield { type: 'done', iterations: iteration, reason: 'aborted' };
      return;
    }
    try {
      let iterationContent = '';
      let iterationToolCalls = [];

      // Stream LLM response for this iteration
      // Track what we've yielded to prevent duplicates
      let yieldedChars = 0;
      const emittedToolStarts = new Set();  // Deduplicate tool_call_start events

      for await (const chunk of streamLLM(messages, tools, config, abortSignal)) {
        if (chunk.type === 'text') {
          // Only yield new content (dedupe in case of stream issues)
          const newContent = chunk.content;
          if (newContent) {
            iterationContent += newContent;
            console.error('[AgentLoop] Yielding text chunk:', JSON.stringify(newContent));
            yield { type: 'response', content: newContent };
          }
        } else if (chunk.type === 'tool_call_start') {
          // Deduplicate tool_call_start events (LLMClient may emit duplicates during streaming)
          const dedupKey = chunk.id;
          if (emittedToolStarts.has(dedupKey)) {
            console.error('[AgentLoop] ⚠️ Skipping duplicate tool_call_start:', chunk.name, chunk.id);
            continue;
          }
          emittedToolStarts.add(dedupKey);
          console.error('[AgentLoop] Yielding tool_call_start:', chunk.name, chunk.id);
          yield chunk;
        } else if (chunk.type === 'tool_call') {
          iterationToolCalls.push(chunk);
          console.error('[AgentLoop] Yielding tool_call (final):', chunk.name);
          yield chunk;
        }
      }

      const planStatus = graphState._currentPlan
        ? `plan: ${graphState._currentPlan.filter(s => s.status === 'done').length}/${graphState._currentPlan.length} done`
        : 'no plan';
      console.error(`[AgentLoop] Iteration ${iteration}/${maxIterations} complete. Text: ${iterationContent.length} chars, Tools: ${iterationToolCalls.length}, ${planStatus}`);

      // Loop detection: build a signature from tools and their arguments this iteration
      if (iterationToolCalls.length > 0) {
        const sig = iterationToolCalls
          .map(tc => `${tc.name}:${JSON.stringify(tc.args)}`)
          .sort()
          .join('|');
        iterationSignatures.push(sig);

        // Stop if the EXACT same tool call pattern (names AND arguments) repeats 3 times consecutively
        if (iterationSignatures.length >= 3) {
          const last = iterationSignatures[iterationSignatures.length - 1];
          const prev1 = iterationSignatures[iterationSignatures.length - 2];
          const prev2 = iterationSignatures[iterationSignatures.length - 3];

          if (last === prev1 && last === prev2) {
            console.error(`[AgentLoop] Infinite loop detected: iteration ${iteration} repeated the exact same tool calls and arguments for 3 iterations: [${sig}]. Stopping.`);
            yield { type: 'response', content: 'I noticed I was repeating the exact same actions multiple times. Stopping to avoid an infinite loop.' };
            yield { type: 'done', iterations: iteration + 1, reason: 'loop_detected' };
            return;
          }
        }
      }

      // Add this iteration's response to history for the next iteration
      if (iterationContent || iterationToolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: iterationContent || null,
          tool_calls: iterationToolCalls.length > 0 ? iterationToolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args)
            }
          })) : undefined
        });
      }

      // Empty response (no text AND no tools) — always nudge regardless of plan state
      if (iterationContent.length === 0 && iterationToolCalls.length === 0) {
        console.error(`[AgentLoop] ⚠️ Model returned empty response (no text, no tools) at iteration ${iteration}. Nudging.`);
        messages.push({
          role: 'user',
          content: 'Your previous response was empty. Please continue — either respond to the user or call the appropriate tools.'
        });
        continue;
      }

      // No tool calls — check if the model should keep going or if it's truly done
      if (iterationToolCalls.length === 0) {
        const plan = graphState._currentPlan;
        const planIncomplete = plan && plan.length > 0 && !plan.every(s => s.status === 'done');

        if (planIncomplete) {
          // Plan has incomplete steps — nudge the model to continue instead of stopping
          const doneCount = plan.filter(s => s.status === 'done').length;
          console.error(`[AgentLoop] ⚠️ Model returned text-only but plan is incomplete (${doneCount}/${plan.length} done). Nudging to continue.`);
          messages.push({
            role: 'user',
            content: 'You still have incomplete plan steps. Continue working through your plan — do not stop until all steps are done.'
          });
          continue; // Skip termination, continue the loop
        }

        console.error(`[AgentLoop] ✓ Model returned text-only with no active plan. Stopping. (iteration ${iteration + 1})`);
        yield { type: 'done', iterations: iteration + 1, reason: 'model_done' };
        return;
      }

      // Execute tools sequentially
      for (const toolCall of iterationToolCalls) {
        if (abortSignal?.aborted) break;
        try {
          console.error('[AgentLoop] Executing tool:', toolCall.name);

          // Execute tool
          const result = await executeTool(
            toolCall.name,
            toolCall.args,
            graphState,
            cid,
            ensureSchedulerStarted
          );

          // Update graphState so subsequent tool calls see the latest state
          updateGraphState(graphState, toolCall.name, toolCall.args, result);

          // Stream tool result event
          yield {
            type: 'tool_result',
            name: toolCall.name,
            result,
            id: toolCall.id
          };

          // Add sanitized tool result to conversation (strip UI-only data to save tokens)
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(sanitizeResultForLLM(result))
          });
        } catch (error) {
          console.error(`[AgentLoop] Tool "${toolCall.name}" failed:`, error.message);
          console.error('[AgentLoop] Failed tool args:', JSON.stringify(toolCall.args, null, 2));

          // Stream error event
          yield {
            type: 'tool_result',
            name: toolCall.name,
            result: { error: error.message },
            id: toolCall.id
          };

          // Add error to conversation
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: error.message })
          });
        }
      }

      // Loop continues - LLM will verify results and decide: more work or respond
    } catch (error) {
      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        console.error('[AgentLoop] ✓ Agent loop aborted gracefully (user cancelled)');
        yield { type: 'done', iterations: iteration + 1, reason: 'aborted' };
        return;
      }
      console.error(`[AgentLoop] ✗ Unexpected error at iteration ${iteration}:`, error.message);
      yield { type: 'error', message: error.message };
      yield { type: 'done', iterations: iteration + 1, reason: 'error' };
      return;
    }
  }

  // Max iterations reached
  const planStatus = graphState._currentPlan
    ? `Plan: ${graphState._currentPlan.filter(s => s.status === 'done').length}/${graphState._currentPlan.length} done.`
    : '';
  console.error(`[AgentLoop] ✗ Max iterations (${maxIterations}) reached. ${planStatus}`);
  yield { type: 'response', content: `Reached maximum iterations (${maxIterations}). ${planStatus} Task may be incomplete.` };
  yield { type: 'done', iterations: maxIterations, reason: 'max_iterations' };
}
