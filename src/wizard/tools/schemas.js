/**
 * Get tool definitions for LLM
 * @returns {Array} Tool definitions
 */
export function getToolDefinitions() {
    return [
        {
            name: 'createNode',
            description: 'Create a single node in the active or target graph.',
            parameters: {
                type: 'object',
                properties: {
                    palette: { type: 'string', description: 'Palette name (see system prompt for options). If omitted, a random palette is chosen.' },
                    name: {
                        type: 'string', description: 'The node\'s display name'
                    },
                    color: { type: 'string', description: 'Color name from palette (e.g. "tan"). DO NOT use hex codes.' },
                    description: { type: 'string', description: 'What this node represents' },
                    targetGraphId: { type: 'string', description: 'Graph ID to create in. If omitted, uses active graph.' },
                    typeNodeId: { type: 'string', description: 'Prototype ID of type node. Use setNodeType for name-based assignment.' },
                    enrich: { type: 'boolean', description: 'If true (default), auto-enrich from Wikipedia after creation.' },
                    overwriteDescription: { type: 'boolean', description: 'If true, replace existing description with Wikipedia description during enrichment. Default: false.' }
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
                    nodeName: { type: 'string', description: 'Current name of the node to update (fuzzy matched)' },
                    name: { type: 'string', description: 'New name for the node' },
                    color: { type: 'string', description: 'New color' },
                    description: { type: 'string', description: 'New description' },
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' },
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
                    nodeName: { type: 'string', description: 'Name of the node to delete (fuzzy matched)' },
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' }
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
                    sourceId: { type: 'string', description: 'Name of the source node (fuzzy matched)' },
                    targetId: { type: 'string', description: 'Name of the target node (fuzzy matched)' },
                    type: { type: 'string', description: 'Relationship type like "contains", "relates to"' },
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph to create edge in. If omitted, uses active graph.' }
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
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' }
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
                    targetName: { type: 'string', description: 'Name of the target node (fuzzy matched)' },
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' }
                },
                required: []
            }
        },
        {
            name: 'searchNodes',
            description: 'Search for nodes by keyword in active or target graph. Omit query to list all.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Optional. Search keyword or name. Omit to return all nodes. Individual words work best for broad searches.' },
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' },
                    limit: { type: 'number', description: 'Max results to return. Defaults to 100.' },
                    offset: { type: 'number', description: 'Skips this many results for pagination. Use with hasMore=true responses.' }
                },
                required: []
            }
        },
        {
            name: 'searchConnections',
            description: 'Search for connections by keyword in active or target graph. Omit query to list all.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Optional. Search keyword - can be a connection type (e.g., "contains") or node name. Omit to return all connections.' },
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' },
                    limit: { type: 'number', description: 'Max results to return. Defaults to 100.' },
                    offset: { type: 'number', description: 'Skips this many results for pagination. Use with hasMore=true responses.' }
                },
                required: []
            }
        },
        {
            name: 'selectNode',
            description: 'Select and highlight a node on the canvas by name (fuzzy matched).',
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
            description: 'Read all nodes, edges, and groups from a graph.',
            parameters: {
                type: 'object',
                properties: {
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' }
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
                    palette: { type: 'string', description: 'Palette name (see system prompt for options).' },
                    nodes: {
                        type: 'array',
                        description: 'Array of nodes to create',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                color: { type: 'string', description: 'Color name from chosen palette. DO NOT use hex codes.' },
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
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' },
                    enrich: { type: 'boolean', description: 'If true (default), auto-enrich new nodes from Wikipedia.' },
                    overwriteDescription: { type: 'boolean', description: 'If true, replace node descriptions with Wikipedia descriptions during enrichment. Default: false.' }
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
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' }
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
                    palette: { type: 'string', description: 'Palette name (see system prompt for options).' },
                    name: { type: 'string', description: 'Name for the new graph workspace.' },
                    color: { type: 'string', description: 'Optional color for the node that defines this graph, from the chosen palette. DO NOT use hex codes.' },
                    description: { type: 'string', description: 'High-level bio of this graph/concept — becomes the defining node\'s description visible in the parent graph. Required.' },
                    nodes: {
                        type: 'array',
                        description: 'Array of nodes to create. Give each node a brief description!',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Node name - use Title Case (e.g., "Romeo Montague", not "romeo_montague")' },
                                color: { type: 'string', description: 'Color name from chosen palette. DO NOT use hex codes.' },
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
                                        color: { type: 'string', description: 'Color name from chosen palette.' },
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
                                color: { type: 'string', description: 'Color name from chosen palette.' },
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
                    enrich: { type: 'boolean', description: 'If true (default), auto-enrich all created nodes and the defining node from Wikipedia.' },
                    overwriteDescription: { type: 'boolean', description: 'If true, replace node descriptions with Wikipedia descriptions during enrichment. Default: false.' }
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
                    color: { type: 'string', description: 'Color name from palette (e.g. "tan").' },
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' }
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
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' }
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
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' }
                },
                required: ['groupName']
            }
        },
        {
            name: 'convertToThingGroup',
            description: 'Convert a Group into a Thing-Group, creating a definition graph for that Thing.',
            parameters: {
                type: 'object',
                properties: {
                    groupName: { type: 'string', description: 'Name of the group to convert' },
                    thingName: { type: 'string', description: 'Name for the Thing that defines this group (can be existing or new)' },
                    createNewThing: { type: 'boolean', description: 'If true, creates a new Thing. If false, tries to find existing Thing by thingName.' },
                    newThingColor: { type: 'string', description: 'Color for the new Thing if creating one' },
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' }
                },
                required: ['groupName']
            }
        },
        {
            name: 'combineThingGroup',
            description: 'Collapse a Thing-Group back into a single node.',
            parameters: {
                type: 'object',
                properties: {
                    groupName: { type: 'string', description: 'Name of the Thing-Group to collapse' },
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' }
                },
                required: ['groupName']
            }
        },
        {
            name: 'listDefinitionGraphs',
            description: 'List a node\'s definition graphs with their node/edge counts.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node whose definition graphs to inspect (fuzzy matched)' }
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
                    nodeName: { type: 'string', description: 'Name of the node to add a definition graph to (fuzzy matched)' },
                    palette: { type: 'string', description: 'Palette name (see system prompt for options).' },
                    nodes: {
                        type: 'array',
                        description: 'Array of nodes to create inside the definition graph',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                color: { type: 'string', description: 'Color name from chosen palette.' },
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
                                        color: { type: 'string', description: 'Color name from chosen palette.' },
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
                                color: { type: 'string', description: 'Color name from chosen palette.' },
                                memberNames: { type: 'array', items: { type: 'string' }, description: 'Names of nodes that belong to this group - must EXACTLY match names in the nodes array' }
                            },
                            required: ['name', 'memberNames']
                        }
                    },
                    enrich: { type: 'boolean', description: 'If true (default), auto-enrich created nodes and the defining node from Wikipedia.' },
                    overwriteDescription: { type: 'boolean', description: 'If true, replace node descriptions with Wikipedia descriptions during enrichment. Default: false.' }
                },
                required: ['nodeName', 'nodes', 'edges']
            }
        },
        {
            name: 'removeDefinitionGraph',
            description: 'Remove a definition graph from a node.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node to remove definition graph from (fuzzy matched)' },
                    definitionIndex: { type: 'number', description: 'Which definition graph to remove (0-based index). Default: 0.' }
                },
                required: ['nodeName']
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
                    nodeName: { type: 'string', description: 'Name of the node to set the type on (fuzzy matched)' },
                    typeName: {
                        type: 'string', description: 'Name of the type/category node. If it doesn\'t exist, it will be auto - created.Omit if clearing.'
                    },
                    typeColor: { type: 'string', description: 'Color for the type node if it needs to be created (palette name). Use a muted/neutral tone for category nodes.' },
                    typeDescription: { type: 'string', description: 'Description for the type node if it needs to be created.' },
                    palette: { type: 'string', description: 'Palette name for typeColor resolution.' },
                    clearType: { type: 'boolean', description: 'If true, removes the type from the node. Omit typeName when clearing.' }
                },
                required: ['nodeName']
            }
        },
        {
            name: 'readAbstractionChain',
            description: 'Read a node\'s abstraction chains across all dimensions.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node to read chains for (fuzzy matched)' }
                },
                required: ['nodeName']
            }
        },
        {
            name: 'editAbstractionChain',
            description: 'Add or remove nodes from an abstraction chain dimension.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the chain owner node (fuzzy matched)' },
                    dimension: { type: 'string', description: 'Dimension name, e.g., "Generalization Axis"' },
                    editAction: { type: 'string', enum: ['add', 'remove'], description: '"add" to insert a node, "remove" to take one out' },
                    targetNodeName: { type: 'string', description: 'Name of the node to add or remove (fuzzy matched)' },
                    direction: { type: 'string', enum: ['above', 'below'], description: 'For "add": "above" inserts toward more generic, "below" inserts toward more specific. Defaults to "above".' },
                    relativeTo: { type: 'string', description: 'Optional: Name of a node already in the chain to insert relative to (fuzzy matched)' }
                },
                required: ['nodeName', 'dimension', 'editAction', 'targetNodeName']
            }
        },
        {
            name: 'getPrototype',
            description: 'Get the detailed properties of a Node Prototype directly (name, description, color, type properties, definition graphs).',
            parameters: {
                type: 'object',
                properties: {
                    prototypeId: { type: 'string', description: 'Exact ID of the prototype' },
                    nodeName: { type: 'string', description: 'Fuzzy matched name of the node (if ID is unknown)' }
                },
                required: []
            }
        },
        {
            name: 'getInstancesOfPrototype',
            description: 'Find all instances of a specific prototype across the entire workspace. Useful for seeing where a concept is used.',
            parameters: {
                type: 'object',
                properties: {
                    prototypeId: { type: 'string', description: 'Exact ID of the prototype' },
                    nodeName: { type: 'string', description: 'Fuzzy matched name of the node (if ID is unknown)' }
                },
                required: []
            }
        },
        {
            name: 'getGraphInstances',
            description: 'List all raw instances inside a specific graph, showing their instanceId and the prototypeId they refer to.',
            parameters: {
                type: 'object',
                properties: {
                    graphId: { type: 'string', description: 'Optional: ID of the graph to inspect, defaults to active graph if omitted' }
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
                    nodeName: { type: 'string', description: 'Name of the node to enrich from Wikipedia (fuzzy matched)' },
                    targetGraphId: { type: 'string', description: 'Graph ID. If omitted, uses active graph.' },
                    overwriteDescription: { type: 'boolean', description: 'If true, replace the node\'s existing description with the Wikipedia description. Defaults to false (preserves existing descriptions).' }
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
                    targetGraphId: { type: 'string', description: 'Optional: ID of the graph to theme. Defaults to the active graph.' }
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
        {
            name: 'sketchGraph',
            description: 'Sketch a graph structure in lightweight shorthand before building it. Returns a quality preview (orphans, connectivity) and an expanded spec ready to pass to createPopulatedGraph or populateDefinitionGraph. Use this to validate structure cheaply before committing.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Graph/node name this sketch is for' },
                    palette: { type: 'string', description: 'Color palette to use for expansion' },
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
        }
    ];
}

/**
 * Tools that are too complex for small local LLMs (7B parameter models).
 * These tools cause infinite loops and misuse when exposed to models
 * that lack the reasoning ability to use them correctly.
 */
const ADVANCED_TOOLS = new Set([
    'condenseToNode',
    'decomposeNode',
    'convertToThingGroup',
    'combineThingGroup',
    'editAbstractionChain',
    'readAbstractionChain',
    'listNodeDefinitions',
    'removeDefinitionGraph',
    'switchToGraph',
    'getNodeContext',
    'searchConnections',
    'updateEdge',
    'updateGroup',
    'listGroups',
]);

/**
 * Get filtered tool definitions for local/small LLMs.
 * Removes advanced composition and navigation tools that cause spiraling.
 * @returns {Array} Filtered tool definitions
 */
export function getLocalToolDefinitions() {
    return getToolDefinitions().filter(t => !ADVANCED_TOOLS.has(t.name));
}
