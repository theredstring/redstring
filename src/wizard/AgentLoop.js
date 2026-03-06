/**
 * AgentLoop - Main agent runtime loop
 * One LLM conversation that loops until task is complete (max 10 iterations)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLLM, streamLLM } from './LLMClient.js';
import { buildContext } from './ContextBuilder.js';
import { executeTool, getToolDefinitions, getLocalToolDefinitions } from './tools/index.js';
import { WIZARD_SYSTEM_PROMPT } from '../services/agent/WizardPrompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load system prompt
let SYSTEM_PROMPT = WIZARD_SYSTEM_PROMPT;

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
      groups: []
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
        description: result.description
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
    // New populated graph — update activeGraphId and add graph + nodes
    graphState.activeGraphId = result.graphId;
    graphState.graphs = graphState.graphs || [];
    graphState.nodePrototypes = graphState.nodePrototypes || [];

    // Helper to extract and track inline types
    const typeMap = new Map();
    (result.spec.nodes || []).forEach(n => {
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
            console.error('[updateGraphState] Auto-created inline type node (predictive):', n.type, '→', newProtoId);
          }
        }
      }
    });

    const newInstances = (result.spec.nodes || []).map((n, idx) => {
      const protoId = `proto-${Date.now()}-${idx}`;

      // Add prototype to global registry
      graphState.nodePrototypes.push({
        id: protoId,
        name: n.name,
        color: n.color || '#5B6CFF',
        description: n.description || '',
        typeNodeId: n.type ? typeMap.get(n.type.toLowerCase().trim()) : null,
        definitionGraphIds: []
      });

      return {
        id: `inst-${Date.now()}-${idx}`,
        prototypeId: protoId,
        name: n.name
      };
    });

    graphState.graphs.push({
      id: result.graphId,
      name: result.graphName,
      instances: newInstances,
      edgeIds: [],
      groups: []
    });

    console.error('[updateGraphState] createPopulatedGraph: added', newInstances.length, 'nodes with prototypes to new graph', result.graphId);
  } else if (result.action === 'expandGraph' && result.spec) {
    // Nodes added to target graph
    const targetGraphId = result.graphId || graphState.activeGraphId;
    const targetGraph = (graphState.graphs || []).find(g => g.id === targetGraphId);
    if (targetGraph) {
      targetGraph.instances = targetGraph.instances || [];
      graphState.nodePrototypes = graphState.nodePrototypes || [];

      // Helper to extract and track inline types
      const typeMap = new Map();
      (result.spec.nodes || []).forEach(n => {
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
              console.error('[updateGraphState] Auto-created inline type node (predictive):', n.type, '→', newProtoId);
            }
          }
        }
      });

      (result.spec.nodes || []).forEach((n, idx) => {
        const protoId = `proto-${Date.now()}-${idx}`;
        const instId = `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;

        // Add instance to target graph
        targetGraph.instances.push({
          id: instId,
          prototypeId: protoId,
          name: n.name
        });

        // Add prototype to global registry so subsequent tools can find it by name
        graphState.nodePrototypes.push({
          id: protoId,
          name: n.name,
          color: n.color || '#5B6CFF',
          description: n.description || '',
          typeNodeId: n.type ? typeMap.get(n.type.toLowerCase().trim()) : null,
          definitionGraphIds: []
        });
      });

      console.error('[updateGraphState] expandGraph: added', (result.spec.nodes || []).length, 'nodes with prototypes to', targetGraphId);
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
      groups: []
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
      groups: []
    });

    // 2. Update prototype's definitionGraphIds array
    const proto = (graphState.nodePrototypes || []).find(p => p.id === result.prototypeId);
    if (proto) {
      proto.definitionGraphIds = proto.definitionGraphIds || [];
      proto.definitionGraphIds.push(result.graphId);
    }

    // 3. Add nodes to this new graph
    const targetGraph = graphState.graphs[graphState.graphs.length - 1];

    // Helper to extract and track inline types
    const typeMap = new Map();
    (result.spec.nodes || []).forEach(n => {
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

    (result.spec.nodes || []).forEach((n, idx) => {
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
    });

    console.error('[updateGraphState] populateDefinitionGraph: created', result.graphId, 'and expanded with', (result.spec.nodes || []).length, 'nodes');
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
  }
}

const DEFAULT_MAX_ITERATIONS = 10;
const LOCAL_MAX_ITERATIONS = 4;
const MAX_TOOL_CALLS_PER_ITERATION = 10;

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

  // Build context
  const contextStr = buildContext(graphState);

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
    contextPreview: contextStr.substring(0, 300)
  });

  const baseSystemPrompt = config.systemPrompt || SYSTEM_PROMPT || 'You are The Wizard, a helpful assistant for building knowledge graphs.';

  const isLocalModel = config.provider === 'local';
  const tools = isLocalModel ? getLocalToolDefinitions() : getToolDefinitions();
  const maxIterations = config.maxIterations || (isLocalModel ? LOCAL_MAX_ITERATIONS : DEFAULT_MAX_ITERATIONS);

  if (isLocalModel) {
    console.error('[AgentLoop] Local model detected — using filtered tools (' + tools.length + ' tools), maxIterations=' + maxIterations + ', maxToolCallsPerIteration=' + MAX_TOOL_CALLS_PER_ITERATION);
  }

  const fullSystemPrompt = baseSystemPrompt
    .replace('{graphName}', graphState.activeGraphId ? (graphState.graphs?.find(g => g.id === graphState.activeGraphId)?.name || 'Unknown') : 'None')
    .replace('{nodeList}', contextStr.includes('Existing Things') ? contextStr.split('Existing Things:')[1]?.split('\n')[0] || '' : '')
    .replace('{edgeList}', '')
    .replace(/{maxIterations}/g, String(maxIterations));

  // Build messages array with conversation history
  const conversationHistory = config.conversationHistory || [];
  const historyMessages = conversationHistory
    .filter(msg => msg.content && msg.content.trim()) // Filter out empty messages
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    }));

  console.error('[AgentLoop] Conversation history:', historyMessages.length, 'messages');

  const messages = [
    { role: 'system', content: fullSystemPrompt + '\n\n' + contextStr },
    ...historyMessages, // Include prior conversation for context
    { role: 'user', content: userMessage }
  ];


  // Loop detection: track tool call signatures per iteration to detect cycles
  const iterationSignatures = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (abortSignal?.aborted) {
      yield { type: 'done', iterations: iteration };
      return;
    }
    try {
      let iterationContent = '';
      let iterationToolCalls = [];

      // Stream LLM response for this iteration
      // Track what we've yielded to prevent duplicates
      let yieldedChars = 0;

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
          console.error('[AgentLoop] Yielding tool_call_start:', chunk.name);
          yield chunk;
        } else if (chunk.type === 'tool_call') {
          iterationToolCalls.push(chunk);
          console.error('[AgentLoop] Yielding tool_call (final):', chunk.name);
          yield chunk;
        }
      }

      // Cap tool calls per iteration for local models (they can spam dozens)
      if (isLocalModel && iterationToolCalls.length > MAX_TOOL_CALLS_PER_ITERATION) {
        const dropped = iterationToolCalls.length - MAX_TOOL_CALLS_PER_ITERATION;
        console.error(`[AgentLoop] Local model emitted ${iterationToolCalls.length} tool calls — capping at ${MAX_TOOL_CALLS_PER_ITERATION}, dropping ${dropped}`);
        iterationToolCalls = iterationToolCalls.slice(0, MAX_TOOL_CALLS_PER_ITERATION);
      }

      console.error('[AgentLoop] Iteration', iteration, 'complete. Content length:', iterationContent.length, 'Tool calls:', iterationToolCalls.length);

      // Loop detection: build a signature from tool names this iteration
      if (iterationToolCalls.length > 0) {
        const sig = iterationToolCalls.map(tc => tc.name).sort().join(',');
        iterationSignatures.push(sig);

        // Detect if the last 2 iterations called the exact same set of tools
        if (iterationSignatures.length >= 2) {
          const prev = iterationSignatures[iterationSignatures.length - 2];
          if (sig === prev) {
            console.error(`[AgentLoop] Loop detected: iteration ${iteration} repeated the same tool pattern as iteration ${iteration - 1}: [${sig}]. Stopping.`);
            yield { type: 'response', content: 'I noticed I was repeating the same actions. Stopping to avoid an infinite loop.' };
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

      // If no tool calls, check if the model stopped mid-batch
      if (iterationToolCalls.length === 0) {
        // For local models, never auto-continue — they need to stop and let
        // the user respond, especially when they ask "shall I continue?"
        if (!isLocalModel) {
          const hadPriorToolCalls = messages.some(m => m.tool_calls && m.tool_calls.length > 0);
          const textSuggestsContinuation = iterationContent && /\b(shall|will|proceed|continue|remaining|next|rest)\b/i.test(iterationContent);

          if (hadPriorToolCalls && textSuggestsContinuation && iteration < maxIterations - 1) {
            console.error('[AgentLoop] Model stopped mid-batch with continuation language. Nudging to continue.');
            messages.push({
              role: 'user',
              content: 'Continue — call the tools now for the remaining items. Do not narrate, just call them.'
            });
            continue; // Skip to next iteration
          }
        }
        yield { type: 'done', iterations: iteration + 1 };
        return;
      }

      // Execute tools sequentially
      for (const toolCall of iterationToolCalls) {
        if (abortSignal?.aborted) break;
        try {
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

          // Add tool result to conversation for LLM to verify
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        } catch (error) {
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
        console.error('[AgentLoop] Agent loop aborted gracefully');
        return;
      }
      yield { type: 'error', message: error.message };
      yield { type: 'done', iterations: iteration + 1 };
      return;
    }
  }

  // Max iterations reached
  yield { type: 'response', content: 'Reached maximum iterations. Task may be incomplete.' };
  yield { type: 'done', iterations: maxIterations };
}
