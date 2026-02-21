/**
 * Tool registry and executor
 * Maps tool names to implementations and executes them
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

const TOOLS = {
  createNode,
  updateNode,
  deleteNode,
  createEdge,
  updateEdge,
  deleteEdge,
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
      description: 'Update an existing node\'s properties. Use the current node name to identify which node to update.',
      parameters: {
        type: 'object',
        properties: {
          nodeName: { type: 'string', description: 'Current name of the node to update (fuzzy matched)' },
          name: { type: 'string', description: 'New name for the node' },
          color: { type: 'string', description: 'New color' },
          description: { type: 'string', description: 'New description' }
        },
        required: ['nodeName']
      }
    },
    {
      name: 'deleteNode',
      description: 'Remove a node and its connections. Use the node name to identify which node to delete.',
      parameters: {
        type: 'object',
        properties: {
          nodeName: { type: 'string', description: 'Name of the node to delete (fuzzy matched)' }
        },
        required: ['nodeName']
      }
    },
    {
      name: 'createEdge',
      description: 'Connect two nodes by name. Use node names (not IDs) to specify source and target.',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Name of the source node (fuzzy matched)' },
          targetId: { type: 'string', description: 'Name of the target node (fuzzy matched)' },
          type: { type: 'string', description: 'Relationship type like "contains", "relates to"' }
        },
        required: ['sourceId', 'targetId']
      }
    },
    {
      name: 'updateEdge',
      description: 'Update the properties of an existing connection between two nodes. Use node names to identify the edge.',
      parameters: {
        type: 'object',
        properties: {
          sourceName: { type: 'string', description: 'Name of the source node' },
          targetName: { type: 'string', description: 'Name of the target node' },
          type: { type: 'string', description: 'New relationship type' },
          directionality: { type: 'string', description: '"unidirectional", "bidirectional", "reverse", or "none"' }
        },
        required: ['sourceName', 'targetName']
      }
    },
    {
      name: 'deleteEdge',
      description: 'Remove a connection between nodes. Can use edge ID or source/target node names.',
      parameters: {
        type: 'object',
        properties: {
          edgeId: { type: 'string', description: 'The edge ID to delete (if known)' },
          sourceName: { type: 'string', description: 'Name of the source node (fuzzy matched)' },
          targetName: { type: 'string', description: 'Name of the target node (fuzzy matched)' }
        },
        required: []
      }
    },
    {
      name: 'searchNodes',
      description: 'Search for nodes in the active graph using natural language. Supports fuzzy matching - you can use general terms, individual words, or phrases. Returns nodes ranked by relevance. Use this to find nodes before modifying or connecting them.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query - can be a name, keyword, or general term (e.g., "frontal", "memory", "cell"). Individual words work best for broad searches.' }
        },
        required: ['query']
      }
    },
    {
      name: 'searchConnections',
      description: 'Search for connections/edges in the active graph by type or node names. Supports fuzzy matching. Use to find existing relationships between nodes.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query - can be a connection type (e.g., "contains"), node name, or general term (e.g., "love", "parent")' }
        },
        required: ['query']
      }
    },
    {
      name: 'selectNode',
      description: 'Find and select a specific node on the canvas by name. The node will be highlighted and focused. Use this when the user asks to "find", "show me", "focus on", or "select" a specific node.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the node to select (supports fuzzy matching, e.g., "frontal" will find "Frontal Lobe")' }
        },
        required: ['name']
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
      description: 'Add multiple nodes and/or edges at once to the ACTIVE graph (bulk operation). Must provide at least one node or at least one edge.',
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
        }
      }
    },
    {
      name: 'createPopulatedGraph',
      description: 'Create a NEW graph with nodes, edges, AND groups in one operation. You MUST always provide a "name" for the graph. ALWAYS include edges with definitionNode to show relationships! ALWAYS include meaningful groups when they exist (factions, categories, houses, teams, departments, etc). CONNECTION DENSITY: Every node should have 2-3 edges minimum.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'REQUIRED: A descriptive name for the new graph workspace (e.g., "Solar System", "Romeo and Juliet Characters"). Must always be provided.' },
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

