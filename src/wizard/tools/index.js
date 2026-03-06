/**
 * Tool registry and executor
 * Maps tool names to implementations and executes them
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ADDING A NEW TOOL? Read .agent/workflows/add-wizard-tool.md   ║
 * ║  There are 5 places you must update. This file is only step 2. ║
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
import { listNodeDefinitions } from './listNodeDefinitions.js';
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
  listNodeDefinitions,
  addDefinitionGraph,
  removeDefinitionGraph,
  switchToGraph,
  condenseToNode,
  decomposeNode,
  askMultipleChoice,
  setNodeType,
  readAbstractionChain,
  editAbstractionChain,
  populateDefinitionGraph
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

  return await tool(args, graphState, cid, ensureSchedulerStarted);
}

/**
 * Get tool definitions for LLM
 * @returns {Array} Tool definitions
 */
export { getToolDefinitions, getLocalToolDefinitions } from './schemas.js';

