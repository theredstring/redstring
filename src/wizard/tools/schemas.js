import { PALETTES } from '../../ai/palettes.js';

// Build a compact palette listing for tool descriptions
const PALETTE_LIST = Object.entries(PALETTES).map(([key, p]) => `"${key}" (${Object.keys(p.colors).join(', ')})`).join('; ');
const PALETTE_DESC = `Palette name. Available: ${PALETTE_LIST}. If omitted, a random palette is chosen.`;
const COLOR_DESC = 'Color name from the chosen palette (e.g., "red", "tan", "navy-blue"). No hex codes.';

/**
 * Get tool definitions for LLM
 * @returns {Array} Tool definitions
 */
export function getToolDefinitions(options = {}) {
    const { hasTabularData = false } = options;
    const allTools = [
        {
            name: 'createNode',
            description: 'Create a single node in the active or target graph.',
            parameters: {
                type: 'object',
                properties: {
                    palette: { type: 'string', description: PALETTE_DESC },
                    name: {
                        type: 'string', description: 'The node\'s display name'
                    },
                    color: { type: 'string', description: COLOR_DESC },
                    description: { type: 'string', description: 'What this node represents' },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' },
                    typeNodeId: { type: 'string', description: 'Prototype ID of type node. Use setNodeType for name-based assignment.' },
                    enrich: { type: 'boolean', description: 'Auto-enrich from Wikipedia (default: true).' },
                    overwriteDescription: { type: 'boolean', description: 'Overwrite description from Wikipedia (default: false).' }
                },
                required: ['name']
            }
        },
        {
            name: 'updateNode',
            description: 'Update an existing node\'s properties by name.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Current name of the node to update' },
                    name: { type: 'string', description: 'New name for the node' },
                    color: { type: 'string', description: 'New color' },
                    description: { type: 'string', description: 'New description' },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' },
                    typeNodeId: {
                        type: 'string', description: 'Optional: Prototype ID of the type node to assign. Sets the node\'s type / category.'
                    }
                },
                required: ['nodeName']
            }
        },
        {
            name: 'deleteNode',
            description: 'Remove a node and its connections by name.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node to delete' },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' }
                },
                required: ['nodeName']
            }
        },
        {
            name: 'createEdge',
            description: 'Connect two existing nodes by name. Creates a single edge. For multiple connections at once, prefer expandGraph with an edges array.',
            parameters: {
                type: 'object',
                properties: {
                    sourceId: { type: 'string', description: 'Name of the source node' },
                    targetId: { type: 'string', description: 'Name of the target node' },
                    type: { type: 'string', description: 'Relationship type like "contains", "relates to"' },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' }
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
                    directionality: { type: 'string', description: '"unidirectional", "bidirectional", "reverse", or "none"' },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' }
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
                    sourceName: { type: 'string', description: 'Name of the source node' },
                    targetName: { type: 'string', description: 'Name of the target node' },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' }
                },
                required: []
            }
        },
        {
            name: 'search',
            description: 'Search for nodes or connections by keyword. Omit query to list all.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Optional. Search keyword or name. Omit to return all.' },
                    searchType: { type: 'string', enum: ['nodes', 'connections'], description: '"nodes" (default) or "connections".' },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' },
                    limit: { type: 'number', description: 'Max results to return. Defaults to 100.' },
                    offset: { type: 'number', description: 'Skips this many results for pagination.' }
                },
                required: []
            }
        },
        {
            name: 'selectNode',
            description: 'Select and highlight a node on the canvas by name.',
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
            name: 'readGraph',
            description: 'Read all nodes, edges, and groups from the active graph. Call with NO arguments to read what the user currently sees. Only pass targetGraphId if you need a specific non-active graph.',
            parameters: {
                type: 'object',
                properties: {
                    targetGraphId: { type: 'string', description: 'Only needed for non-active graphs. Omit to read the active graph.' }
                },
                required: []
            }
        },

        {
            name: 'createGraph',
            description: 'Create a new graph workspace',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Graph name' },
                    color: { type: 'string', description: 'Optional color for the node that defines this graph, from the chosen palette. DO NOT use hex codes.' }
                },
                required: ['name']
            }
        },
        {
            name: 'expandGraph',
            description: 'Add nodes, edges, and groups to an existing graph. You can create multiple different connections between the same two nodes (e.g., A→B "Loves" and A→B "Rivals With"). Nodes referenced in edges can be existing nodes already in the graph OR new nodes in the nodes array. Provide at least one node or edge.',
            parameters: {
                type: 'object',
                properties: {
                    palette: { type: 'string', description: PALETTE_DESC },
                    nodes: {
                        type: 'array',
                        description: 'Array of nodes to create',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                color: { type: 'string', description: COLOR_DESC },
                                description: { type: 'string' },
                                type: { type: 'string', description: 'Optional: name of the category/type this node falls under (e.g., "Mammal" for a "Dog" node).' },
                                typeColor: { type: 'string', description: 'Optional: color for the type node, supports palettes. Use muted colors.' },
                                typeDescription: { type: 'string', description: 'Optional: brief description of the type itself.' }
                            },
                            required: ['name']
                        }
                    },
                    edges: {
                        type: 'array',
                        description: 'Array of edges to create. You can include multiple edges between the same two nodes as long as each has a different type/definitionNode.',
                        items: {
                            type: 'object',
                            properties: {
                                source: { type: 'string', description: 'Source node name' },
                                target: { type: 'string', description: 'Target node name' },
                                type: { type: 'string', description: 'Relationship type' }
                            },
                            required: ['source', 'target']
                        }
                    },
                    groups: {
                        type: 'array',
                        description: 'Optional: Array of groups to create. Add definedBy to make a Thing-Group.',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                color: { type: 'string' },
                                memberNames: { type: 'array', items: { type: 'string' } },
                                definedBy: {
                                    type: 'object',
                                    description: 'Optional. Makes this a Thing-Group backed by a node. Creates the node if needed.',
                                    properties: {
                                        name: { type: 'string', description: 'Name of the backing node' },
                                        color: { type: 'string', description: 'Color for the node' },
                                        description: { type: 'string', description: 'What this node represents' }
                                    },
                                    required: ['name']
                                }
                            },
                            required: ['name', 'memberNames']
                        }
                    },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' },
                    enrich: { type: 'boolean', description: 'Auto-enrich from Wikipedia (default: true).' },
                    overwriteDescription: { type: 'boolean', description: 'Overwrite description from Wikipedia (default: false).' }
                }
            }
        },
        {
            name: 'replaceEdges',
            description: 'Bulk-replace or update connections between existing nodes.',
            parameters: {
                type: 'object',
                properties: {
                    edges: {
                        type: 'array',
                        description: 'Array of edge replacements. Each identifies a source/target pair and the desired new type.',
                        items: {
                            type: 'object',
                            properties: {
                                source: { type: 'string', description: 'Source node name' },
                                target: { type: 'string', description: 'Target node name' },
                                type: { type: 'string', description: 'New relationship type (e.g., "contains", "attached to")' },
                                directionality: {
                                    type: 'string',
                                    enum: ['unidirectional', 'bidirectional', 'none', 'reverse'],
                                    description: 'Arrow direction. Default: unidirectional'
                                }
                            },
                            required: ['source', 'target', 'type']
                        }
                    },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' }
                },
                required: ['edges']
            }
        },
        {
            name: 'createPopulatedGraph',
            description: 'Create a new graph workspace with nodes, edges, and groups. Triggers auto-layout. Auto-enriches all nodes and the defining node from Wikipedia by default.',
            parameters: {
                type: 'object',
                properties: {
                    palette: { type: 'string', description: PALETTE_DESC },
                    name: { type: 'string', description: 'Name for the new graph workspace.' },
                    color: { type: 'string', description: COLOR_DESC + ' Applied to the defining node of this graph.' },
                    description: { type: 'string', description: 'High-level bio of this graph/concept — becomes the defining node\'s description visible in the parent graph. Required.' },
                    nodes: {
                        type: 'array',
                        description: 'Array of nodes to create. Give each node a brief description!',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Node name - use Title Case (e.g., "Romeo Montague", not "romeo_montague")' },
                                color: { type: 'string', description: COLOR_DESC },
                                description: { type: 'string', description: 'Very brief summary of what this node represents' },
                                type: { type: 'string', description: 'Highly recommended: name of the category/type this node falls under (e.g., "Character" or "Location").' },
                                typeColor: { type: 'string', description: 'Optional: color for the type node, supports palettes. Use muted colors for types.' },
                                typeDescription: { type: 'string', description: 'Optional: brief description of the type itself.' }
                            },
                            required: ['name', 'description']
                        }
                    },
                    edges: {
                        type: 'array',
                        description: 'Array of edges — you can have multiple edges between the same pair with different definitionNodes. Each must have a definitionNode.',
                        items: {
                            type: 'object',
                            properties: {
                                source: { type: 'string', description: 'Source node name (must match a node in the nodes array)' },
                                target: { type: 'string', description: 'Target node name (must match a node in the nodes array)' },
                                directionality: {
                                    type: 'string',
                                    enum: ['unidirectional', 'bidirectional', 'none', 'reverse'],
                                    description: 'Arrow direction: unidirectional (→), bidirectional (↔), none (—), reverse (←). Default: unidirectional'
                                },
                                definitionNode: {
                                    type: 'object',
                                    description: 'Defines the connection type. Use Title Case for name.',
                                    properties: {
                                        name: { type: 'string', description: 'Connection type name in Title Case (e.g., "Loves", "Parent Of", "Orbits")' },
                                        color: { type: 'string', description: COLOR_DESC },
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
                        description: 'Groups to organize nodes. Add definedBy to make a Thing-Group.',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Group name (e.g., "House Montague", "Engineering Team")' },
                                color: { type: 'string', description: COLOR_DESC },
                                memberNames: { type: 'array', items: { type: 'string' }, description: 'Names of nodes that belong to this group - must match names in the nodes array' },
                                definedBy: {
                                    type: 'object',
                                    description: 'Optional. Makes this a Thing-Group backed by a node. Creates the node if needed.',
                                    properties: {
                                        name: { type: 'string', description: 'Name of the backing node' },
                                        color: { type: 'string', description: 'Color for the node' },
                                        description: { type: 'string', description: 'What this node represents' }
                                    },
                                    required: ['name']
                                }
                            },
                            required: ['name', 'memberNames']
                        }
                    },
                    enrich: { type: 'boolean', description: 'Auto-enrich from Wikipedia (default: true).' },
                    overwriteDescription: { type: 'boolean', description: 'Overwrite description from Wikipedia (default: false).' }
                },
                required: ['name', 'description', 'nodes', 'edges']
            }
        },
        {
            name: 'createGroup',
            description: 'Create a visual group to organize nodes together.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Name for the group' },
                    memberNames: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Names of existing nodes to include in the group'
                    },
                    color: { type: 'string', description: COLOR_DESC },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' }
                },
                required: ['name', 'memberNames']
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
                    newColor: { type: 'string', description: 'New color name from palette' },
                    addMembers: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Names of nodes to add to the group'
                    },
                    removeMembers: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Names of nodes to remove from the group'
                    },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' }
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
                    groupName: { type: 'string', description: 'Name of the group to delete' },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' }
                },
                required: ['groupName']
            }
        },
        {
            name: 'thingGroup',
            description: 'Convert a Group into a Thing-Group, or collapse a Thing-Group back into a single node.',
            parameters: {
                type: 'object',
                properties: {
                    groupName: { type: 'string', description: 'Name of the group' },
                    action: { type: 'string', enum: ['convert', 'collapse'], description: '"convert" (default): make a Group into a Thing-Group. "collapse": collapse a Thing-Group into a single node.' },
                    thingName: { type: 'string', description: 'For convert: name for the Thing that defines this group' },
                    createNewThing: { type: 'boolean', description: 'For convert: if true, creates a new Thing. If false, finds existing.' },
                    newThingColor: { type: 'string', description: 'For convert: color for the new Thing' },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' }
                },
                required: ['groupName']
            }
        },
        {
            name: 'manageDefinitions',
            description: 'List or remove definition graphs for a node.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node' },
                    action: { type: 'string', enum: ['list', 'remove'], description: '"list" (default): show definition graphs with node/edge counts. "remove": delete a definition graph.' },
                    definitionIndex: { type: 'number', description: 'For remove: which definition graph to remove (0-based index). Default: 0.' }
                },
                required: ['nodeName']
            }
        },
        {
            name: 'populateDefinitionGraph',
            description: 'Create and populate a definition graph for a node in one step. Non-disruptive. Auto-enriches all created nodes and the defining node from Wikipedia by default.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node to add a definition graph to' },
                    palette: { type: 'string', description: PALETTE_DESC },
                    nodes: {
                        type: 'array',
                        description: 'Array of nodes to create inside the definition graph',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                color: { type: 'string', description: COLOR_DESC },
                                description: { type: 'string', description: 'Very brief summary of what this node represents' },
                                type: { type: 'string', description: 'Optional: name of the category/type this node falls under (e.g., "Mammal" for a "Dog" node).' },
                                typeColor: { type: 'string', description: 'Optional: color for the type node, supports palettes. Use muted colors.' },
                                typeDescription: { type: 'string', description: 'Optional: brief description of the type itself.' }
                            },
                            required: ['name', 'description']
                        }
                    },
                    edges: {
                        type: 'array',
                        description: 'Array of edges to create inside the definition graph — you can have multiple edges between the same pair with different definitionNodes. Highly recommended unless creating a simple Set or Collection. Every edge MUST have a definitionNode.',
                        items: {
                            type: 'object',
                            properties: {
                                source: { type: 'string', description: 'Source node name' },
                                target: { type: 'string', description: 'Target node name' },
                                directionality: {
                                    type: 'string',
                                    enum: ['unidirectional', 'bidirectional', 'none', 'reverse'],
                                    description: 'Arrow direction: unidirectional (→), bidirectional (↔), none (—), reverse (←). Default: unidirectional'
                                },
                                type: { type: 'string', description: 'Relationship type' },
                                definitionNode: {
                                    type: 'object',
                                    description: 'Defines what this connection type means.',
                                    properties: {
                                        name: { type: 'string', description: 'Connection type name in Title Case (e.g., "Loves", "Parent Of", "Orbits")' },
                                        color: { type: 'string', description: COLOR_DESC },
                                        description: { type: 'string', description: 'What this connection means' }
                                    },
                                    required: ['name']
                                }
                            },
                            required: ['source', 'target']
                        }
                    },
                    groups: {
                        type: 'array',
                        description: 'Groups to organize nodes.',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Group name (e.g., "Engineering Team")' },
                                color: { type: 'string', description: COLOR_DESC },
                                memberNames: { type: 'array', items: { type: 'string' }, description: 'Names of nodes that belong to this group - must EXACTLY match names in the nodes array' }
                            },
                            required: ['name', 'memberNames']
                        }
                    },
                    enrich: { type: 'boolean', description: 'Auto-enrich from Wikipedia (default: true).' },
                    overwriteDescription: { type: 'boolean', description: 'Overwrite description from Wikipedia (default: false).' }
                },
                required: ['nodeName', 'nodes', 'edges']
            }
        },
        {
            name: 'switchToGraph',
            description: 'Navigate to a different graph. Only use when user explicitly asks to navigate.',
            parameters: {
                type: 'object',
                properties: {
                    graphId: { type: 'string', description: 'ID of the graph to switch to' },
                    graphName: { type: 'string', description: 'Name of the graph to switch to (alternative to graphId)' },
                    nodeName: { type: 'string', description: 'Name of a node - switches to its first definition graph (alternative to graphId/graphName)' }
                }
            }
        },
        {
            name: 'condenseToNode',
            description: 'Package selected nodes into a new concept with a definition graph. Inverse of decomposeNode.',
            parameters: {
                type: 'object',
                properties: {
                    memberNames: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Names of existing nodes in the active graph to condense into the new concept'
                    },
                    nodeName: { type: 'string', description: 'Name for the new concept/Thing' },
                    nodeColor: { type: 'string', description: 'Optional color name from palette for the new concept' },
                    collapse: { type: 'boolean', description: 'If true, replaces member nodes with single node. If false, keeps members visible as a Thing-Group. Default: false.' }
                },
                required: ['memberNames', 'nodeName']
            }
        },
        {
            name: 'decomposeNode',
            description: 'Unpack a node into its definition graph contents as a Thing-Group. Inverse of condenseToNode.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node to decompose (must have a non-empty definition graph)' },
                    definitionIndex: { type: 'number', description: 'Optional: which definition graph to decompose (0-based index). Default: 0.' }
                },
                required: ['nodeName']
            }
        },
        {
            name: 'askMultipleChoice',
            description: 'Ask the user a multiple-choice question. Execution will pause until the user answers.',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'The question to ask the user' },
                    options: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of specific choices to offer'
                    }
                },
                required: ['question', 'options']
            }
        },
        {
            name: 'setNodeType',
            description: 'Set or clear a node\'s type/category. Auto-creates type node if needed.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node to set the type on' },
                    typeName: {
                        type: 'string', description: 'Name of the type/category node. If it doesn\'t exist, it will be auto - created.Omit if clearing.'
                    },
                    typeColor: { type: 'string', description: 'Color for the type node if it needs to be created (palette name). Use a muted/neutral tone for category nodes.' },
                    typeDescription: { type: 'string', description: 'Description for the type node if it needs to be created.' },
                    palette: { type: 'string', description: PALETTE_DESC.replace(' If omitted, a random palette is chosen.', '') },
                    clearType: { type: 'boolean', description: 'If true, removes the type from the node. Omit typeName when clearing.' }
                },
                required: ['nodeName']
            }
        },
        {
            name: 'abstractionChain',
            description: 'Read, add to, or remove from a node\'s abstraction chains (carousel spectrums).',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node' },
                    action: { type: 'string', enum: ['read', 'add', 'remove'], description: '"read" (default): view all chains. "add"/"remove": modify a chain.' },
                    dimension: { type: 'string', description: 'For add/remove: dimension name, e.g., "Generalization Axis"' },
                    targetNodeName: { type: 'string', description: 'For add/remove: name of the node to add or remove' },
                    direction: { type: 'string', enum: ['above', 'below'], description: 'For add: "above" = more generic, "below" = more specific. Default: "above".' },
                    relativeTo: { type: 'string', description: 'For add: name of a node already in the chain to insert relative to' }
                },
                required: ['nodeName']
            }
        },
        {
            name: 'inspectPrototype',
            description: 'Get detailed properties of a node prototype and optionally find all its instances across the workspace.',
            parameters: {
                type: 'object',
                properties: {
                    prototypeId: { type: 'string', description: 'Exact ID of the prototype' },
                    nodeName: { type: 'string', description: 'Fuzzy matched name of the node (if ID is unknown)' },
                    includeInstances: { type: 'boolean', description: 'If true, also returns all instances across the workspace. Default: false.' }
                },
                required: []
            }
        },
        {
            name: 'inspectWorkspace',
            description: 'Quick comprehensive overview of the workspace. Returns all nodes, edges, and groups with their important IDs, organized by type. Much faster than searchNodes + searchConnections for getting a complete picture.',
            parameters: {
                type: 'object',
                properties: {
                    graphId: { type: 'string', description: 'Optional: ID of a specific graph to inspect, defaults to active graph' },
                    includeAllGraphs: { type: 'boolean', description: 'If true, returns summaries for ALL graphs in the workspace' }
                },
                required: []
            }
        },
        {
            name: 'enrichFromWikipedia',
            description: 'Pull Wikipedia data for a node: fetches the Wikipedia image, description, and link. Use this to enrich nodes with real-world knowledge and imagery. By default, existing descriptions are preserved — set overwriteDescription to true to replace them with the Wikipedia description.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node to enrich from Wikipedia' },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' },
                    overwriteDescription: { type: 'boolean', description: 'Overwrite description from Wikipedia (default: false).' }
                },
                required: ['nodeName']
            }
        },
        {
            name: 'themeGraph',
            description: 'Quickly re-color all nodes and connection definitions in a graph conceptually based on a palette or specific color.',
            parameters: {
                type: 'object',
                properties: {
                    palette: { type: 'string', description: 'Optional: Name of a known palette (e.g., "retro", "rainbow"). If omitted, it will pick one or use baseColor.' },
                    baseColor: { type: 'string', description: 'Optional: A specific hex color to base the theme around if no palette is supplied.' },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' }
                },
                required: []
            }
        },
        {
            name: 'planTask',
            description: 'Create or update a step-by-step task plan. ONLY use when building/populating graphs or coordinating 3+ tool calls. Do NOT use for greetings, questions, conversation, or single edits. Update step statuses as you complete them.',
            parameters: {
                type: 'object',
                properties: {
                    steps: {
                        type: 'array',
                        description: 'Array of plan steps. Send the FULL plan each time (not just changed steps). Add substeps to break down each step before executing it.',
                        items: {
                            type: 'object',
                            properties: {
                                description: { type: 'string', description: 'What this step accomplishes' },
                                status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: 'Current status of this step' },
                                substeps: {
                                    type: 'array',
                                    description: 'Optional breakdown of this step into smaller chunks. Add substeps right before executing a step to plan the specific nodes, edges, or actions.',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            description: { type: 'string', description: 'Specific action within this step' },
                                            status: { type: 'string', enum: ['pending', 'in_progress', 'done'] }
                                        },
                                        required: ['description', 'status']
                                    }
                                }
                            },
                            required: ['description', 'status']
                        }
                    }
                },
                required: ['steps']
            }
        },
        // ── Semantic Web Tools ──────────────────────────────────────────
        {
            name: 'discoverOrbit',
            description: 'SEMANTIC WEB TOOL: Discover linked-data connections for an entity from Wikidata/DBpedia. Returns ranked relationships in 4 quality rings. Only use when user explicitly wants semantic web exploration — not for general graph building. Use before materializeSemanticEntities.',
            parameters: {
                type: 'object',
                properties: {
                    entityName: { type: 'string', description: 'Entity name to discover connections for (e.g., "Albert Einstein", "Machine Learning")' },
                    sources: {
                        type: 'array',
                        items: { type: 'string', enum: ['dbpedia', 'wikidata'] },
                        description: 'Which sources to query. Default: both.'
                    },
                    minConfidence: { type: 'number', description: 'Minimum confidence threshold (0-1). Default: 0.3.' },
                    limit: { type: 'number', description: 'Max results. Default: 30.' }
                },
                required: ['entityName']
            }
        },
        {
            name: 'semanticSearch',
            description: 'SEMANTIC WEB TOOL: Search Wikidata/DBpedia for entity data. "enrich" mode: entity lookup with descriptions/links. "related" mode: find related concepts via SPARQL. Only use when user explicitly wants semantic web data — not for general graph building.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Entity name or search term' },
                    mode: { type: 'string', enum: ['enrich', 'related'], description: '"enrich" (default): entity lookup with descriptions/links. "related": find related concepts.' },
                    limit: { type: 'number', description: 'Max results for "related" mode. Default: 15.' }
                },
                required: ['query']
            }
        },
        {
            name: 'materializeSemanticEntities',
            description: 'SEMANTIC WEB TOOL: Turn semantic web discoveries into Redstring nodes and edges. Use after discoverOrbit/semanticSearch — not for general graph building.',
            parameters: {
                type: 'object',
                properties: {
                    entities: {
                        type: 'array',
                        description: 'Entities to create as nodes',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Entity name' },
                                description: { type: 'string', description: 'Optional description' },
                                color: { type: 'string', description: 'Optional color from palette' }
                            },
                            required: ['name']
                        }
                    },
                    connections: {
                        type: 'array',
                        description: 'Optional: semantic connections to create as edges',
                        items: {
                            type: 'object',
                            properties: {
                                source: { type: 'string', description: 'Source entity name' },
                                target: { type: 'string', description: 'Target entity name' },
                                relation: { type: 'string', description: 'Relationship type (e.g., "developed by", "genre", "influenced by")' },
                                directionality: { type: 'string', enum: ['unidirectional', 'bidirectional', 'none'], description: 'Arrow direction. Default: unidirectional.' }
                            },
                            required: ['source', 'target']
                        }
                    },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' },
                    enrich: { type: 'boolean', description: 'Auto-enrich from Wikipedia (default: true).' },
                    palette: { type: 'string', description: PALETTE_DESC }
                },
                required: ['entities']
            }
        },
        {
            name: 'importKnowledgeCluster',
            description: 'SPECIALIZED: BFS crawl of Wikidata/DBpedia linked data around a seed entity. Only use when the user explicitly asks to explore or import from the semantic web. Do NOT use this for general "build a graph about X" requests — use createPopulatedGraph with your own knowledge instead. This tool returns whatever relationships happen to exist in linked data, which are often shallow and arbitrary compared to a curated graph you build yourself.',
            parameters: {
                type: 'object',
                properties: {
                    seedEntity: { type: 'string', description: 'Starting entity name (e.g., "Quantum Computing", "Renaissance")' },
                    maxDepth: { type: 'number', description: 'BFS traversal depth (1-2). Default: 1. Use 2 for broader exploration.' },
                    maxEntitiesPerLevel: { type: 'number', description: 'Max entities per BFS level (1-15). Default: 5.' },
                    sources: {
                        type: 'array',
                        items: { type: 'string', enum: ['wikidata', 'dbpedia'] },
                        description: 'Sources to query. Default: both.'
                    },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' },
                    enrich: { type: 'boolean', description: 'Auto-enrich from Wikipedia (default: true).' },
                    palette: { type: 'string', description: PALETTE_DESC }
                },
                required: ['seedEntity']
            }
        },
        {
            name: 'querySparql',
            description: 'SEMANTIC WEB TOOL: Execute a raw SPARQL SELECT query against Wikidata, DBpedia, or Schema.org. Advanced tool for precise semantic web queries. Only use when user explicitly wants semantic web data.',
            parameters: {
                type: 'object',
                properties: {
                    endpoint: { type: 'string', enum: ['wikidata', 'dbpedia', 'schema'], description: 'SPARQL endpoint to query' },
                    query: { type: 'string', description: 'SPARQL SELECT query string' },
                    limit: { type: 'number', description: 'Optional result limit (max 100). Applied if query lacks LIMIT clause.' }
                },
                required: ['endpoint', 'query']
            }
        },
        {
            name: 'sketchGraph',
            description: 'Sketch a graph structure in lightweight shorthand before building it. Returns a quality preview (orphans, connectivity) and an expanded spec ready to pass to createPopulatedGraph or populateDefinitionGraph. Use this to validate structure cheaply before committing.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Graph/node name this sketch is for' },
                    palette: { type: 'string', description: PALETTE_DESC },
                    nodes: {
                        type: 'array',
                        description: 'Node names. Optionally add [Type] suffix: ["Engine Block", "Pistons [Component]"]',
                        items: { type: 'string' }
                    },
                    edges: {
                        type: 'array',
                        description: 'Edges as "Source -> Relation -> Target" strings: ["Pistons -> Housed In -> Engine Block"]',
                        items: { type: 'string' }
                    },
                    groups: {
                        type: 'array',
                        description: 'Groups as "GroupName: member1, member2" strings',
                        items: { type: 'string' }
                    }
                },
                required: ['name', 'nodes', 'edges']
            }
        },
        {
            name: 'findDuplicates',
            description: 'Find potential duplicate nodes by name similarity. Returns groups of similar nodes with a recommendation for which to keep based on richness (connections, description length, semantic metadata, definition graphs). Use this before mergeNodes to make informed merge decisions.',
            parameters: {
                type: 'object',
                properties: {
                    threshold: { type: 'number', description: 'Name similarity threshold 0.0-1.0 (default: 0.8). Higher = stricter matching.' },
                    targetGraphId: { type: 'string', description: 'Limit search to nodes in this graph. If omitted, searches all nodes.' }
                },
                required: []
            }
        },
        {
            name: 'mergeNodes',
            description: 'Merge two nodes into one. The primary node survives; the secondary is absorbed (metadata, descriptions, connections, definition graphs combined) and deleted. Use findDuplicates first to identify which node to keep.',
            parameters: {
                type: 'object',
                properties: {
                    primaryNodeName: { type: 'string', description: 'Name of the node to keep' },
                    secondaryNodeName: { type: 'string', description: 'Name of the node to merge into primary (will be deleted)' },
                    targetGraphId: { type: 'string', description: 'Graph context for resolving nodes (default: active).' }
                },
                required: ['primaryNodeName', 'secondaryNodeName']
            }
        },
        {
            name: 'mergeGraphs',
            description: 'Find and merge duplicate nodes between two graphs. Identifies nodes with similar names across both graphs and merges them, unifying references. Uses richness scoring to pick which node to keep. Set dryRun=true to preview without merging.',
            parameters: {
                type: 'object',
                properties: {
                    sourceGraphId: { type: 'string', description: 'First graph ID (or name) to compare' },
                    targetGraphId: { type: 'string', description: 'Second graph ID (or name) to compare. Defaults to active graph.' },
                    threshold: { type: 'number', description: 'Name similarity threshold 0-1 (default: 0.85)' },
                    dryRun: { type: 'boolean', description: 'If true, only preview matches without merging (default: false)' }
                },
                required: ['sourceGraphId']
            }
        },
        {
            name: 'analyzeTabularData',
            description: 'Analyze an attached tabular data file (CSV, TSV, XLSX, JSON). Returns column info, data types, sample rows, detected data shape, and suggested mapping. Call this BEFORE importTabularAsGraph to understand the data structure.',
            parameters: {
                type: 'object',
                properties: {
                    fileIndex: { type: 'number', description: 'Index of the tabular file in attachments (0-based). Default: 0 (first tabular file).' },
                    sheetName: { type: 'string', description: 'For XLSX files with multiple sheets, specify which sheet to analyze.' }
                },
                required: []
            }
        },
        {
            name: 'importTabularAsGraph',
            description: 'Import tabular data as a graph. Creates nodes from rows, edges from relationships, and groups from categories. Call analyzeTabularData first. Supports entity_list, edge_list, adjacency_matrix, and relational data shapes.',
            parameters: {
                type: 'object',
                properties: {
                    graphName: { type: 'string', description: 'Name for the new graph.' },
                    description: { type: 'string', description: 'Description for the graph.' },
                    dataShape: { type: 'string', enum: ['entity_list', 'edge_list', 'adjacency_matrix', 'relational'], description: 'How to interpret the data.' },
                    mapping: {
                        type: 'object',
                        description: 'Column-to-graph mapping. For entity_list: nodeNameColumn (required), nodeDescriptionColumns, nodeTypeColumn, groupByColumn. For edge_list: sourceColumn, targetColumn, edgeLabelColumn. For relational: nodeNameColumn + foreignKeyMappings array.',
                        properties: {
                            nodeNameColumn: { type: 'string', description: 'Column to use as node names.' },
                            nodeDescriptionColumns: { type: 'array', items: { type: 'string' }, description: 'Columns to include in node description.' },
                            nodeTypeColumn: { type: 'string', description: 'Column for node type/category.' },
                            nodeColorColumn: { type: 'string', description: 'Column for color grouping.' },
                            groupByColumn: { type: 'string', description: 'Column to create groups from unique values.' },
                            sourceColumn: { type: 'string', description: 'For edge_list: source entity column.' },
                            targetColumn: { type: 'string', description: 'For edge_list: target entity column.' },
                            edgeLabelColumn: { type: 'string', description: 'For edge_list: relationship type column.' },
                            edgeWeightColumn: { type: 'string', description: 'For edge_list: numeric weight column.' },
                            foreignKeyMappings: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        column: { type: 'string', description: 'Column containing references to other entities.' },
                                        edgeLabel: { type: 'string', description: 'Label for the edge.' },
                                        directionality: { type: 'string', enum: ['unidirectional', 'bidirectional'], description: 'Edge direction.' }
                                    },
                                    required: ['column', 'edgeLabel']
                                },
                                description: 'For relational: columns that reference other entities.'
                            }
                        }
                    },
                    maxNodes: { type: 'number', description: 'Maximum nodes to create (default: 200). Use composition for larger datasets.' },
                    enrich: { type: 'boolean', description: 'Auto-enrich from Wikipedia (default: false for imported data).' },
                    fileIndex: { type: 'number', description: 'Index of the tabular file (default: 0).' },
                    sheetName: { type: 'string', description: 'Sheet to import (XLSX only).' },
                    targetGraphId: { type: 'string', description: 'Existing graph to import into (default: creates new graph).' }
                },
                required: ['graphName', 'description', 'dataShape', 'mapping']
            }
        }
    ];

    // Conditionally exclude tabular tools when no tabular data is attached.
    // These tools add significant schema complexity that can push Gemini over
    // its constraint state limit.
    if (!hasTabularData) {
        const tabularToolNames = new Set(['analyzeTabularData', 'importTabularAsGraph']);
        return allTools.filter(t => !tabularToolNames.has(t.name));
    }

    return allTools;
}

