/**
 * Tool registry and executor
 * Maps tool names to implementations and executes them
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ADDING A NEW TOOL? Read .agent/workflows/add-wizard-tool.md   ║
 * ║  There are 5 files you must update. This file is step 3.       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { createNode } from './createNode.js';
import { updateNode } from './updateNode.js';
import { deleteNode } from './deleteNode.js';
import { createEdge } from './createEdge.js';
import { deleteEdge } from './deleteEdge.js';
import { searchNodes } from './searchNodes.js';
import { searchConnections } from './searchConnections.js';
import { selectNode } from './selectNode.js';
import { getNodeContext } from './getNodeContext.js';
import { readGraph } from './readGraph.js';
import { createGraph } from './createGraph.js';
import { expandGraph } from './expandGraph.js';
import { createPopulatedGraph } from './createPopulatedGraph.js';
import { createGroup } from './createGroup.js';
import { listGroups } from './listGroups.js';
import { updateGroup } from './updateGroup.js';
import { deleteGroup } from './deleteGroup.js';
import { convertToThingGroup } from './convertToThingGroup.js';
import { combineThingGroup } from './combineThingGroup.js';
import { updateEdge } from './updateEdge.js';
import { replaceEdges } from './replaceEdges.js';
import { listDefinitionGraphs } from './listDefinitionGraphs.js';
import { addDefinitionGraph } from './addDefinitionGraph.js';
import { removeDefinitionGraph } from './removeDefinitionGraph.js';
import { switchToGraph } from './switchToGraph.js';
import { condenseToNode } from './condenseToNode.js';
import { decomposeNode } from './decomposeNode.js';
import { askMultipleChoice } from './askMultipleChoice.js';
import { setNodeType } from './setNodeType.js';
import { readAbstractionChain } from './readAbstractionChain.js';
import { editAbstractionChain } from './editAbstractionChain.js';
import { populateDefinitionGraph } from './populateDefinitionGraph.js';

import { getPrototype } from './getPrototype.js';
import { getInstancesOfPrototype } from './getInstancesOfPrototype.js';
import { getGraphInstances } from './getGraphInstances.js';
import { inspectWorkspace } from './inspectWorkspace.js';
import { themeGraph } from './themeGraph.js';
import { enrichFromWikipedia } from './enrichFromWikipedia.js';
import { planTask } from './planTask.js';
import { sketchGraph } from './sketchGraph.js';
import { getToolDefinitions } from './schemas.js';

const TOOLS = {
  createNode,
  updateNode,
  deleteNode,
  createEdge,
  updateEdge,
  deleteEdge,
  readGraph,
  searchNodes,
  searchConnections,
  selectNode,
  getNodeContext,
  createGraph,
  expandGraph,
  createPopulatedGraph,
  createGroup,
  listGroups,
  updateGroup,
  deleteGroup,
  convertToThingGroup,
  combineThingGroup,
  replaceEdges,
  listDefinitionGraphs,
  addDefinitionGraph,
  removeDefinitionGraph,
  switchToGraph,
  condenseToNode,
  decomposeNode,
  askMultipleChoice,
  setNodeType,
  readAbstractionChain,
  editAbstractionChain,
  populateDefinitionGraph,
  getPrototype,
  getInstancesOfPrototype,
  getGraphInstances,
  inspectWorkspace,
  themeGraph,
  enrichFromWikipedia,
  planTask,
  sketchGraph
};

/**
 * Execute a tool by name
 * @param {string} name - Tool name
 * @param {Object} args - Tool arguments
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Tool result
 */
export async function executeTool(name, args, graphState, cid, ensureSchedulerStarted) {
  const tool = TOOLS[name];
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  // Validate required args against schema before execution
  const schema = getToolDefinitions().find(t => t.name === name);
  if (schema?.parameters?.required?.length > 0) {
    const missing = schema.parameters.required.filter(key =>
      args[key] === undefined || args[key] === null || args[key] === ''
    );
    if (missing.length > 0) {
      throw new Error(`Tool "${name}" requires these arguments: ${missing.join(', ')}. You provided: ${JSON.stringify(args)}`);
    }
  }

  return await tool(args, graphState, cid, ensureSchedulerStarted);
}

/**
 * Get tool definitions for LLM
 * @returns {Array} Tool definitions
 */
export { getToolDefinitions, getLocalToolDefinitions } from './schemas.js';

