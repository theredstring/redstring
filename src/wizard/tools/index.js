/**
 * Tool registry and executor
 * Maps tool names to implementations and executes them
 */

import queueManager from '../../services/queue/Queue.js';
import { createNode } from './createNode.js';
import { updateNode } from './updateNode.js';
import { deleteNode } from './deleteNode.js';
import { createEdge } from './createEdge.js';
import { deleteEdge } from './deleteEdge.js';
import { searchNodes } from './searchNodes.js';
import { getNodeContext } from './getNodeContext.js';
import { createGraph } from './createGraph.js';
import { expandGraph } from './expandGraph.js';

const TOOLS = {
  createNode,
  updateNode,
  deleteNode,
  createEdge,
  deleteEdge,
  searchNodes,
  getNodeContext,
  createGraph,
  expandGraph
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
export function getToolDefinitions() {
  return [
    {
      name: 'createNode',
      description: 'Create a single node (Thing) in the active graph',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The node\'s display name' },
          color: { type: 'string', description: 'Hex color like "#8B0000"' },
          description: { type: 'string', description: 'What this node represents' }
        },
        required: ['name']
      }
    },
    {
      name: 'updateNode',
      description: 'Update an existing node\'s properties',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'The node ID to update' },
          name: { type: 'string', description: 'New name' },
          color: { type: 'string', description: 'New color' },
          description: { type: 'string', description: 'New description' }
        },
        required: ['nodeId']
      }
    },
    {
      name: 'deleteNode',
      description: 'Remove a node and its connections',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'The node ID to delete' }
        },
        required: ['nodeId']
      }
    },
    {
      name: 'createEdge',
      description: 'Connect two nodes',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Starting node ID' },
          targetId: { type: 'string', description: 'Ending node ID' },
          type: { type: 'string', description: 'Relationship type like "contains"' }
        },
        required: ['sourceId', 'targetId']
      }
    },
    {
      name: 'deleteEdge',
      description: 'Remove a connection between nodes',
      parameters: {
        type: 'object',
        properties: {
          edgeId: { type: 'string', description: 'The edge ID to delete' }
        },
        required: ['edgeId']
      }
    },
    {
      name: 'searchNodes',
      description: 'Find nodes by semantic meaning or name',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for' }
        },
        required: ['query']
      }
    },
    {
      name: 'getNodeContext',
      description: 'Get a node and its neighbors',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'The node ID to examine' }
        },
        required: ['nodeId']
      }
    },
    {
      name: 'createGraph',
      description: 'Create a new graph workspace',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Graph name' }
        },
        required: ['name']
      }
    },
    {
      name: 'expandGraph',
      description: 'Add multiple nodes and edges at once (bulk operation)',
      parameters: {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            description: 'Array of nodes to create',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                color: { type: 'string' },
                description: { type: 'string' }
              },
              required: ['name']
            }
          },
          edges: {
            type: 'array',
            description: 'Array of edges to create',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string', description: 'Source node name' },
                target: { type: 'string', description: 'Target node name' },
                type: { type: 'string', description: 'Relationship type' }
              },
              required: ['source', 'target']
            }
          }
        },
        required: ['nodes']
      }
    }
  ];
}

