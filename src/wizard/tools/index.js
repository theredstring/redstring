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
import { createPopulatedGraph } from './createPopulatedGraph.js';
import { createGroup } from './createGroup.js';
import { listGroups } from './listGroups.js';
import { updateGroup } from './updateGroup.js';
import { deleteGroup } from './deleteGroup.js';
import { convertToThingGroup } from './convertToThingGroup.js';
import { combineThingGroup } from './combineThingGroup.js';

const TOOLS = {
  createNode,
  updateNode,
  deleteNode,
  createEdge,
  deleteEdge,
  searchNodes,
  getNodeContext,
  createGraph,
  expandGraph,
  createPopulatedGraph,
  createGroup,
  listGroups,
  updateGroup,
  deleteGroup,
  convertToThingGroup,
  combineThingGroup
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
      description: 'Add multiple nodes and edges at once to the ACTIVE graph (bulk operation)',
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
    },
    {
      name: 'createPopulatedGraph',
      description: 'Create a NEW graph with nodes, edges, AND groups in one operation. ALWAYS include edges with definitionNode to show relationships! ALWAYS include meaningful groups when they exist (factions, categories, houses, teams, departments, etc). CONNECTION DENSITY: Every node should have 2-3 edges minimum.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name for the new graph workspace' },
          description: { type: 'string', description: 'Optional description of the graph' },
          nodes: {
            type: 'array',
            description: 'Array of nodes to create. Give each node a brief description!',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Node name - use Title Case (e.g., "Romeo Montague", not "romeo_montague")' },
                color: { type: 'string', description: 'Hex color like "#8B0000"' },
                description: { type: 'string', description: 'Brief description of what this node represents - ALWAYS include this!' }
              },
              required: ['name']
            }
          },
          edges: {
            type: 'array',
            description: 'REQUIRED: Array of edges connecting nodes. Each edge MUST have definitionNode with name and color. Every node should have 2-3 edges minimum!',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string', description: 'Source node name - must EXACTLY match a name in the nodes array' },
                target: { type: 'string', description: 'Target node name - must EXACTLY match a name in the nodes array' },
                directionality: { 
                  type: 'string', 
                  enum: ['unidirectional', 'bidirectional', 'none', 'reverse'],
                  description: 'Arrow direction: unidirectional (→), bidirectional (↔), none (—), reverse (←). Default: unidirectional'
                },
                definitionNode: {
                  type: 'object',
                  description: 'REQUIRED: Defines what this connection type means. Use Title Case for name!',
                  properties: {
                    name: { type: 'string', description: 'Connection type name in Title Case (e.g., "Loves", "Parent Of", "Orbits")' },
                    color: { type: 'string', description: 'Hex color for this connection type' },
                    description: { type: 'string', description: 'What this connection means' }
                  },
                  required: ['name']
                }
              },
              required: ['source', 'target', 'definitionNode']
            }
          },
          groups: {
            type: 'array',
            description: 'Groups to organize nodes (factions, houses, categories, teams). INCLUDE THESE when natural groupings exist!',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Group name (e.g., "House Montague", "Engineering Team")' },
                color: { type: 'string', description: 'Group color' },
                memberNames: { type: 'array', items: { type: 'string' }, description: 'Names of nodes that belong to this group - must EXACTLY match names in the nodes array' }
              },
              required: ['name', 'memberNames']
            }
          }
        },
        required: ['name', 'nodes', 'edges']
      }
    },
    {
      name: 'createGroup',
      description: 'Create a visual Group to organize nodes together. Use this for loose associations within the current graph. For formal decomposition of a concept, create the group first then use convertToThingGroup.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name for the group' },
          memberNames: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Names of existing nodes to include in the group'
          },
          color: { type: 'string', description: 'Hex color like "#8B0000"' }
        },
        required: ['name', 'memberNames']
      }
    },
    {
      name: 'listGroups',
      description: 'List all groups in the active graph, showing which are regular Groups vs Thing-Groups',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'updateGroup',
      description: 'Update a group - rename it, change color, or add/remove members',
      parameters: {
        type: 'object',
        properties: {
          groupName: { type: 'string', description: 'Current name of the group to update' },
          newName: { type: 'string', description: 'New name for the group' },
          newColor: { type: 'string', description: 'New hex color' },
          addMembers: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Names of nodes to add to the group'
          },
          removeMembers: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Names of nodes to remove from the group'
          }
        },
        required: ['groupName']
      }
    },
    {
      name: 'deleteGroup',
      description: 'Delete a group (the member nodes are kept, just ungrouped)',
      parameters: {
        type: 'object',
        properties: {
          groupName: { type: 'string', description: 'Name of the group to delete' }
        },
        required: ['groupName']
      }
    },
    {
      name: 'convertToThingGroup',
      description: 'Convert a regular Group into a Thing-Group, making it a formal decomposition of a Thing/concept. This creates a definition graph for that Thing. Use when the grouping represents "what X is made of" or should be reusable.',
      parameters: {
        type: 'object',
        properties: {
          groupName: { type: 'string', description: 'Name of the group to convert' },
          thingName: { type: 'string', description: 'Name for the Thing that defines this group (can be existing or new)' },
          createNewThing: { type: 'boolean', description: 'If true, creates a new Thing. If false, tries to find existing Thing by thingName.' },
          newThingColor: { type: 'string', description: 'Color for the new Thing if creating one' }
        },
        required: ['groupName']
      }
    },
    {
      name: 'combineThingGroup',
      description: 'Collapse a Thing-Group back into a single node representing the Thing. All member nodes are removed and replaced with one node of the linked Thing type.',
      parameters: {
        type: 'object',
        properties: {
          groupName: { type: 'string', description: 'Name of the Thing-Group to collapse' }
        },
        required: ['groupName']
      }
    }
  ];
}

