/**
 * Get tool definitions for LLM
 * @returns {Array} Tool definitions
 */
export function getToolDefinitions() {
    return [
        {
            name: 'createNode',
            description: 'Create a single node (Thing). By default creates in the active graph, but you can specify targetGraphId to create in any graph (e.g., definition graphs) without changing what the user sees.',
            parameters: {
                type: 'object',
                properties: {
                    palette: { type: 'string', description: 'Palette name (see system prompt for options). If omitted, a random palette is chosen.' },
                    name: {
                        type: 'string', description: 'The node\'s display name'
                    },
                    color: { type: 'string', description: 'Color name from the chosen palette (e.g. "tan", "navy-blue"), OR a hex color. Prefer palette names unless a custom color is strictly required.' },
                    description: { type: 'string', description: 'What this node represents' },
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph to create node in. Use this to populate definition graphs non-disruptively. If omitted, uses active graph.' },
                    typeNodeId: { type: 'string', description: 'Optional: Prototype ID of the type node to assign. Sets the node\'s type/ category.Use setNodeType tool for name - based assignment.' }
                },
                required: ['name']
            }
        },
        {
            name: 'updateNode',
            description: 'Update an existing node\'s properties.Use the current node name to identify which node to update.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Current name of the node to update (fuzzy matched)' },
                    name: { type: 'string', description: 'New name for the node' },
                    color: { type: 'string', description: 'New color' },
                    description: { type: 'string', description: 'New description' },
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph containing the node. If omitted, uses active graph.' },
                    typeNodeId: {
                        type: 'string', description: 'Optional: Prototype ID of the type node to assign. Sets the node\'s type / category.'
                    }
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
                    nodeName: { type: 'string', description: 'Name of the node to delete (fuzzy matched)' },
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph containing the node. If omitted, uses active graph.' }
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
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph containing the edge. If omitted, uses active graph.' }
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
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph containing the edge. If omitted, uses active graph.' }
                },
                required: []
            }
        },
        {
            name: 'searchNodes',
            description: 'Search for nodes. By default searches the active graph, but you can specify targetGraphId to search any graph. Omit query to browse ALL nodes. Provide a query to filter by keyword or name. Supports limit/offset for large graphs.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Optional. Search keyword or name. Omit to return all nodes. Individual words work best for broad searches.' },
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph to search within. If omitted, uses active graph.' },
                    limit: { type: 'number', description: 'Max results to return. Defaults to 100.' },
                    offset: { type: 'number', description: 'Skips this many results for pagination. Use with hasMore=true responses.' }
                },
                required: []
            }
        },
        {
            name: 'searchConnections',
            description: 'Search for connections/edges. By default searches the active graph, but you can specify targetGraphId to search any graph. Omit query to browse ALL connections. Provide a query to filter by connection type or node name. Supports limit/offset.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Optional. Search keyword - can be a connection type (e.g., "contains") or node name. Omit to return all connections.' },
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph to search within. If omitted, uses active graph.' },
                    limit: { type: 'number', description: 'Max results to return. Defaults to 100.' },
                    offset: { type: 'number', description: 'Skips this many results for pagination. Use with hasMore=true responses.' }
                },
                required: []
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
            name: 'readGraph',
            description: 'Read a FULL graph (active graph by default, or provide targetGraphId). Returns all nodes, edges, and groups. Use this to inspect any graph without hijacking the user\'s view.',
            parameters: {
                type: 'object',
                properties: {
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph to read. If omitted, uses active graph.' }
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
                    color: { type: 'string', description: 'Optional color for the node that defines this graph, from the chosen palette OR hex color.' }
                },
                required: ['name']
            }
        },
        {
            name: 'expandGraph',
            description: 'Add multiple nodes, edges, and/or groups at once to an EXISTING graph. By default adds to active graph, but you can specify targetGraphId to populate any graph non-disruptively. Do NOT use this to create new graph workspaces. Must provide at least one node or edge.',
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
                                color: { type: 'string', description: 'Color name from chosen palette, OR hex color if using a custom theme.' },
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
                    },
                    groups: {
                        type: 'array',
                        description: 'Optional: Array of groups to create',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                color: { type: 'string' },
                                memberNames: { type: 'array', items: { type: 'string' } }
                            },
                            required: ['name', 'memberNames']
                        }
                    },
                    targetGraphId: { type: 'string', description: 'Optional: ID of existing graph to add items to. If omitted, uses active graph.' }
                }
            }
        },
        {
            name: 'replaceEdges',
            description: 'Bulk-replace connections between existing nodes. Finds existing edges between each source/target pair and updates them, or creates new ones if none exist. Use this INSTEAD of expandGraph when refining or correcting connection types on an existing graph.',
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
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph containing the edges. If omitted, uses active graph.' }
                },
                required: ['edges']
            }
        },
        {
            name: 'createPopulatedGraph',
            description: 'Create a BRAND NEW graph workspace with nodes, edges, and groups. ONLY use this when creating a new graph. Do NOT use this to populate an existing graph.',
            parameters: {
                type: 'object',
                properties: {
                    palette: { type: 'string', description: 'Palette name (see system prompt for options).' },
                    name: { type: 'string', description: 'REQUIRED: A descriptive name for the new graph workspace.' },
                    color: { type: 'string', description: 'Optional color for the node that defines this graph, from the chosen palette OR hex color.' },
                    description: { type: 'string', description: 'Optional description of the graph' },
                    nodes: {
                        type: 'array',
                        description: 'Array of nodes to create. Give each node a brief description!',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Node name - use Title Case (e.g., "Romeo Montague", not "romeo_montague")' },
                                color: { type: 'string', description: 'Color name from chosen palette, OR hex color if using a custom theme.' },
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
                        description: 'REQUIRED: Array of edges connecting nodes. Each edge MUST have definitionNode with name and color. Every node should have 2-3 edges minimum!',
                        items: {
                            type: 'object',
                            properties: {
                                source: { type: 'string', description: 'Source node name - MUST match a name in the nodes array or edge will be dropped' },
                                target: { type: 'string', description: 'Target node name - MUST match a name in the nodes array or edge will be dropped' },
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
                                        color: { type: 'string', description: 'Color name from chosen palette, OR hex color.' },
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
                                color: { type: 'string', description: 'Color name from chosen palette, OR hex color.' },
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
                    color: { type: 'string', description: 'Hex color like "#8B0000"' },
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph to create group in. If omitted, uses active graph.' }
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
                    },
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph containing the group. If omitted, uses active graph.' }
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
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph containing the group. If omitted, uses active graph.' }
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
                    newThingColor: { type: 'string', description: 'Color for the new Thing if creating one' },
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph containing the group. If omitted, uses active graph.' }
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
                    groupName: { type: 'string', description: 'Name of the Thing-Group to collapse' },
                    targetGraphId: { type: 'string', description: 'Optional: ID of graph containing the group. If omitted, uses active graph.' }
                },
                required: ['groupName']
            }
        },
        {
            name: 'listNodeDefinitions',
            description: 'Inspect a node\'s definition graphs(read - only).Shows which definition graphs exist, whether they\'re empty, and their node/edge counts. Use this before navigating or decomposing to understand what definition graphs are available.',
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
            description: 'Creates a definition graph for a node and populates it with components in one step. Use this instead of addDefinitionGraph + expandGraph to avoid execution disruption. By building definitions this way, the user\'s view stays unchanged while you edit definition graphs.',
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
                                color: { type: 'string', description: 'Color name from chosen palette, OR hex color if using a custom theme.' },
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
                        description: 'Array of edges to create inside the definition graph. Highly recommended unless creating a simple Set or Collection. Every edge MUST have a definitionNode.',
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
                                        color: { type: 'string', description: 'Color name from chosen palette, OR hex color.' },
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
                                color: { type: 'string', description: 'Color name from chosen palette, OR hex color.' },
                                memberNames: { type: 'array', items: { type: 'string' }, description: 'Names of nodes that belong to this group - must EXACTLY match names in the nodes array' }
                            },
                            required: ['name', 'memberNames']
                        }
                    }
                },
                required: ['nodeName', 'nodes', 'edges']
            }
        },
        {
            name: 'removeDefinitionGraph',
            description: 'Remove a definition graph from a node\'s definitionGraphIds array.Optionally deletes the graph entirely.',
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
            description: 'Change the active graph (explicit navigation). Use ONLY when the user explicitly requests navigation (e.g., "show me", "go into", "navigate to", "open"). For editing definition graphs without disrupting the user\'s view, use addDefinitionGraph + targetGraphId pattern instead.',
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
            description: 'Package selected nodes into a new concept with a definition graph. Creates a group from the member nodes, converts it to a Thing-Group (which creates the definition graph), and optionally collapses to a single node. This is how you create new compositional abstractions. Inverse of decomposeNode.',
            parameters: {
                type: 'object',
                properties: {
                    memberNames: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Names of existing nodes in the active graph to condense into the new concept'
                    },
                    nodeName: { type: 'string', description: 'Name for the new concept/Thing' },
                    nodeColor: { type: 'string', description: 'Optional hex color for the new concept' },
                    collapse: { type: 'boolean', description: 'If true, replaces member nodes with single node. If false, keeps members visible as a Thing-Group. Default: false.' }
                },
                required: ['memberNames', 'nodeName']
            }
        },
        {
            name: 'decomposeNode',
            description: 'Replace a node with a Thing-Group containing its definition graph contents. The node instance is removed and its definition graph\'s components are materialized in its place - like unpacking a box, the box goes away and the parts appear.The node prototype still exists globally.Inverse of condenseToNode.',
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
            description: 'Set or clear a node\'s type(categorization).Types create a hierarchy: e.g., "Dog" typed as "Mammal". If the type node doesn\'t exist yet, it will be AUTO-CREATED. Always provide typeColor and typeDescription when the type node might not exist yet.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node to set the type on (fuzzy matched)' },
                    typeName: {
                        type: 'string', description: 'Name of the type/category node. If it doesn\'t exist, it will be auto - created.Omit if clearing.'
                    },
                    typeColor: { type: 'string', description: 'Color for the type node if it needs to be created (palette name or hex). Use a muted/neutral tone for category nodes.' },
                    typeDescription: { type: 'string', description: 'Description for the type node if it needs to be created.' },
                    palette: { type: 'string', description: 'Palette name for typeColor resolution.' },
                    clearType: { type: 'boolean', description: 'If true, removes the type from the node. Omit typeName when clearing.' }
                },
                required: ['nodeName']
            }
        },
        {
            name: 'readAbstractionChain',
            description: 'Read a node\'s abstraction chains(carousel spectrums).Shows all dimensions with their chain of nodes from more specific to more generic.Use this to understand a node\'s position in abstraction hierarchies.',
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
            description: 'Add or remove nodes from a node\'s abstraction chain(carousel spectrum).Chains represent spectrums of abstraction across a dimension(e.g., "Generalization Axis").Nodes above are more generic; nodes below are more specific.',
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
