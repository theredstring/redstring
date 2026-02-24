/**
 * AgentLoop - Main agent runtime loop
 * One LLM conversation that loops until task is complete (max 10 iterations)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLLM, streamLLM } from './LLMClient.js';
import { buildContext } from './ContextBuilder.js';
import { executeTool, getToolDefinitions } from './tools/index.js';
import { WIZARD_SYSTEM_PROMPT } from '../services/agent/WizardPrompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load system prompt
let SYSTEM_PROMPT = WIZARD_SYSTEM_PROMPT;

/**
 * Keep graphState in sync after mutating tool calls so subsequent
 * tools within the same agent loop see up-to-date state.
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
    console.log('[updateGraphState] createGraph: activeGraphId =', result.graphId);
  } else if (result.action === 'createNode') {
    // Add the new node to the active graph's instances so name-based lookups work
    const activeGraph = (graphState.graphs || []).find(g => g.id === graphState.activeGraphId);
    if (activeGraph) {
      const protoId = `proto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const instId = `inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      activeGraph.instances = activeGraph.instances || [];
      activeGraph.instances.push({
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
      console.log('[updateGraphState] createNode:', result.name, '→ instances:', activeGraph.instances.length, 'protos:', graphState.nodePrototypes.length);
    } else {
      console.warn('[updateGraphState] createNode FAILED: no active graph for id', graphState.activeGraphId, '| available:', (graphState.graphs || []).map(g => g.id));
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
    const activeGraph = (graphState.graphs || []).find(g => g.id === graphState.activeGraphId);
    if (activeGraph) {
      const inst = (activeGraph.instances || []).find(i => i.id === result.instanceId);
      if (inst && result.updates.name) {
        inst.name = result.updates.name;
      }
    }
    console.log('[updateGraphState] updateNode:', result.originalName, '→', result.updates.name || '(no name change)', '| proto found:', !!proto);
  } else if (result.action === 'deleteNode') {
    // Remove the node from graphState so it's no longer findable
    const activeGraph = (graphState.graphs || []).find(g => g.id === graphState.activeGraphId);
    const beforeCount = activeGraph?.instances?.length || 0;
    if (activeGraph && activeGraph.instances) {
      if (result.instanceId) {
        activeGraph.instances = activeGraph.instances.filter(i => i.id !== result.instanceId);
      } else if (result.name) {
        // Fallback: remove by name when instanceId wasn't resolved
        const nameLower = result.name.toLowerCase().trim();
        activeGraph.instances = activeGraph.instances.filter(i => {
          const instName = (i.name || '').toLowerCase().trim();
          return instName !== nameLower;
        });
      }
    }
    console.log('[updateGraphState] deleteNode:', result.name, '| before:', beforeCount, '→ after:', activeGraph?.instances?.length || 0);
  } else if (result.action === 'createPopulatedGraph' && result.spec) {
    // New populated graph — update activeGraphId and add graph + nodes
    graphState.activeGraphId = result.graphId;
    graphState.graphs = graphState.graphs || [];
    const newInstances = (result.spec.nodes || []).map((n, idx) => ({
      id: `inst-${Date.now()}-${idx}`,
      prototypeId: `proto-${Date.now()}-${idx}`,
      name: n.name
    }));
    graphState.graphs.push({
      id: result.graphId,
      name: result.graphName,
      instances: newInstances,
      edgeIds: [],
      groups: []
    });
  } else if (result.action === 'expandGraph' && result.spec) {
    // Nodes added to active graph
    const activeGraph = (graphState.graphs || []).find(g => g.id === graphState.activeGraphId);
    if (activeGraph) {
      activeGraph.instances = activeGraph.instances || [];
      (result.spec.nodes || []).forEach((n, idx) => {
        activeGraph.instances.push({
          id: `inst-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          prototypeId: `proto-${Date.now()}-${idx}`,
          name: n.name
        });
      });
    }
  } else if (result.action === 'createEdge') {
    const activeGraph = (graphState.graphs || []).find(g => g.id === graphState.activeGraphId);
    if (activeGraph) {
      activeGraph.edgeIds = activeGraph.edgeIds || [];
      activeGraph.edgeIds.push(`edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    }
  } else if (result.action === 'updateEdge' && result.updates) {
    // Predictive state for updateEdge could update the edge in local state, but we only store edgeIds here
    // So nothing to deeply change structurally unless we want to maintain an edges map in AgentLoop
  } else if (result.action === 'deleteEdge') {
    const activeGraph = (graphState.graphs || []).find(g => g.id === graphState.activeGraphId);
    if (activeGraph && result.edgeId) {
      activeGraph.edgeIds = (activeGraph.edgeIds || []).filter(id => id !== result.edgeId);
    }
  } else if (result.action === 'createGroup') {
    const activeGraph = (graphState.graphs || []).find(g => g.id === graphState.activeGraphId);
    if (activeGraph) {
      activeGraph.groups = activeGraph.groups || [];
      activeGraph.groups.push({
        id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: result.name,
        color: result.color,
        memberInstanceIds: result.memberInstanceIds || []
      });
    }
  } else if (result.action === 'updateGroup' && result.updates) {
    const activeGraph = (graphState.graphs || []).find(g => g.id === graphState.activeGraphId);
    if (activeGraph && activeGraph.groups) {
      const gObj = activeGraph.groups.find(g => g.id === result.groupId || (result.groupName && g.name === result.groupName));
      if (gObj) {
        if (result.updates.name) gObj.name = result.updates.name;
        if (result.updates.color) gObj.color = result.updates.color;
      }
    }
  } else if (result.action === 'deleteGroup') {
    const activeGraph = (graphState.graphs || []).find(g => g.id === graphState.activeGraphId);
    if (activeGraph && activeGraph.groups) {
      if (result.groupId) {
        activeGraph.groups = activeGraph.groups.filter(g => g.id !== result.groupId);
      } else if (result.groupName) {
        activeGraph.groups = activeGraph.groups.filter(g => g.name !== result.groupName);
      }
    }
  }
}

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Run the agent loop
 * @param {string} userMessage - User's message
 * @param {Object} graphState - Current graph state from UI
 * @param {Object} config - LLM config (provider, apiKey, etc.)
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {AsyncGenerator} Yields events: { type, ... }
 */
export async function* runAgent(userMessage, graphState, config = {}, ensureSchedulerStarted) {
  const cid = config.cid || `wizard-${Date.now()}`;

  // Build context
  const contextStr = buildContext(graphState);

  // Debug logging for graph context
  const activeGraph = graphState?.graphs?.find(g => g.id === graphState.activeGraphId);
  const instanceCount = activeGraph?.instances
    ? (Array.isArray(activeGraph.instances) ? activeGraph.instances.length : Object.keys(activeGraph.instances).length)
    : 0;
  console.log('[AgentLoop] Graph context:', {
    activeGraphId: graphState?.activeGraphId,
    activeGraphName: activeGraph?.name,
    instanceCount,
    edgeCount: activeGraph?.edgeIds?.length || 0,
    graphCount: graphState?.graphs?.length || 0,
    contextPreview: contextStr.substring(0, 300)
  });

  const baseSystemPrompt = config.systemPrompt || SYSTEM_PROMPT || 'You are The Wizard, a helpful assistant for building knowledge graphs.';
  const fullSystemPrompt = baseSystemPrompt.replace('{graphName}', graphState.activeGraphId ? (graphState.graphs?.find(g => g.id === graphState.activeGraphId)?.name || 'Unknown') : 'None')
    .replace('{nodeList}', contextStr.includes('Existing Things') ? contextStr.split('Existing Things:')[1]?.split('\n')[0] || '' : '')
    .replace('{edgeList}', ''); // Can be enhanced later

  // Build messages array with conversation history
  const conversationHistory = config.conversationHistory || [];
  const historyMessages = conversationHistory
    .filter(msg => msg.content && msg.content.trim()) // Filter out empty messages
    .map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    }));

  console.log('[AgentLoop] Conversation history:', historyMessages.length, 'messages');

  const messages = [
    { role: 'system', content: fullSystemPrompt + '\n\n' + contextStr },
    ...historyMessages, // Include prior conversation for context
    { role: 'user', content: userMessage }
  ];

  const tools = getToolDefinitions();

  const maxIterations = config.maxIterations || DEFAULT_MAX_ITERATIONS;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    try {
      let iterationContent = '';
      let iterationToolCalls = [];

      // Stream LLM response for this iteration
      // Track what we've yielded to prevent duplicates
      let yieldedChars = 0;

      for await (const chunk of streamLLM(messages, tools, config)) {
        if (chunk.type === 'text') {
          // Only yield new content (dedupe in case of stream issues)
          const newContent = chunk.content;
          if (newContent) {
            iterationContent += newContent;
            console.log('[AgentLoop] Yielding text chunk:', JSON.stringify(newContent));
            yield { type: 'response', content: newContent };
          }
        } else if (chunk.type === 'tool_call') {
          iterationToolCalls.push(chunk);
          console.log('[AgentLoop] Yielding tool_call:', chunk.name);
          yield chunk;
        }
      }

      console.log('[AgentLoop] Iteration', iteration, 'complete. Content length:', iterationContent.length);

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

      // If no tool calls, LLM decided task is complete
      if (iterationToolCalls.length === 0) {
        yield { type: 'done', iterations: iteration + 1 };
        return;
      }

      // Execute tools sequentially
      for (const toolCall of iterationToolCalls) {
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
      yield { type: 'error', message: error.message };
      yield { type: 'done', iterations: iteration + 1 };
      return;
    }
  }

  // Max iterations reached
  yield { type: 'response', content: 'Reached maximum iterations. Task may be incomplete.' };
  yield { type: 'done', iterations: maxIterations };
}
