import { PALETTES } from '../../ai/palettes.js';
import { NODE_SIZE_NAMES, NODE_SIZE_FIELD_DESC } from './utils/nodeSize.js';

// Build a compact palette listing for tool descriptions
const PALETTE_LIST = Object.entries(PALETTES).map(([key, p]) => `"${key}" (${Object.keys(p.colors).join(', ')})`).join('; ');
const PALETTE_DESC = `Palette name. Available: ${PALETTE_LIST}. If omitted, a random palette is chosen.`;
const COLOR_DESC = 'Color name from the chosen palette (e.g., "red", "tan", "navy-blue"). No hex codes.';
const SIZE_SCHEMA = { type: 'string', enum: NODE_SIZE_NAMES, description: NODE_SIZE_FIELD_DESC };

// Inline is-a ladder. Kept to a flat array of strings and a short description on
// purpose: LLMClient's flattenDeepNesting collapses every array-of-objects param into
// one hand-escaped JSON string summarized field-by-field, so this text is repeated at
// each of the ~8 sites it appears and a nested object here would degrade to
// "object with {…}". The real "when is a ladder warranted" guidance lives in the
// Abstraction Carousel section of PromptFragments.js, where it costs nothing per call.
const IS_A_SCHEMA = {
    type: 'array',
    items: { type: 'string' },
    description: 'Optional is-a ladder, broadest last: ["Automaker","Company","Organization"]. Only where the generalization is uncontested. Omit for most nodes.'
};

/**
 * Compact `layers` parameter for the flat build tools.
 *
 * Composition used to be reachable only through buildComposition, which meant the
 * model had to consciously switch tools to get any depth — and the quality-repair
 * loop, which runs expandGraph, could only ever flatten what a build had composed.
 * Offering layers on the default path is what makes nesting the natural output
 * rather than something that has to be asked for.
 *
 * The schema shows one level explicitly and says deeper nesting is allowed rather
 * than spelling out the full recursion: the normalizer handles arbitrary depth
 * either way, and repeating buildComposition's whole nested block in three more
 * tools would add thousands of tokens to every single request.
 */
const LAYERS_PARAM = {
    type: 'array',
    description: 'Optional LAYERS — clusters that are themselves concepts. A layer creates a Thing, populates the web inside it, and (when display is "decomposed") spreads that web open here as a node-group. Its members go INSIDE `definition`, never in the top-level `nodes` array. Prefer a layer over a plain group whenever the cluster has a name that means something on its own. A `definition` may itself contain `layers` for deeper nesting.',
    items: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Name of the Thing / node-group. It must make sense away from this graph — a layer is reusable, so qualify it when the bare name would be ambiguous elsewhere (e.g. "Back of House for Texas Roadhouse", not "Back of House"). Leave genuinely universal concepts unqualified ("Engine", "Mitochondria").' },
            color: { type: 'string', description: COLOR_DESC },
            description: { type: 'string', description: 'What this Thing is' },
            display: {
                type: 'string',
                enum: ['decomposed', 'collapsed'],
                description: '"decomposed" (default): spread the web open here as a visible node-group. "collapsed": defined but closed — the user navigates in.'
            },
            use: { type: 'string', description: 'Name of an EXISTING Thing whose web should be invoked here instead of authoring a new one. Provide this OR definition, not both.' },
            isA: IS_A_SCHEMA,
            definition: {
                type: 'object',
                description: 'The web inside this Thing. Its nodes ARE this layer\'s members.',
                properties: {
                    nodes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                color: { type: 'string', description: COLOR_DESC },
                                description: { type: 'string' },
                                type: { type: 'string' },
                                size: SIZE_SCHEMA,
                                isA: IS_A_SCHEMA
                            },
                            required: ['name']
                        }
                    },
                    edges: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                source: { type: 'string' },
                                target: { type: 'string' },
                                type: { type: 'string', description: 'Connection type in Title Case' }
                            },
                            required: ['source', 'target']
                        }
                    },
                    layers: {
                        type: 'array',
                        description: 'Deeper layers nested inside this web (same shape as this one).',
                        items: { type: 'object' }
                    }
                }
            }
        },
        required: ['name']
    }
};

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
                    size: SIZE_SCHEMA,
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
            name: 'setNodeSize',
            description: 'Change the visual size of one existing node on the canvas. Size is per-instance — the same Thing can be large in one Web and medium in another. Sizes are discrete: "extra-small", "small", "medium" (the default), "large", "extra-large". Size by real scale when the subject has one (a Galaxy vs. a Grain of Sand), otherwise by importance within the graph. Use this to rebalance a graph that came out uniformly medium, or to correct one node. When you are CREATING nodes, pass `size` inline in sketchGraph / createNode / createPopulatedGraph / expandGraph / populateDefinitionGraph / buildComposition instead — that is one call rather than one per node.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node to resize' },
                    size: {
                        type: 'string',
                        enum: NODE_SIZE_NAMES,
                        description: 'Target size. "medium" is the default and restores a resized node to normal.'
                    },
                    targetGraphId: { type: 'string', description: 'Graph to target (default: active).' }
                },
                required: ['nodeName', 'size']
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
            description: 'Update the properties of an existing connection between two nodes. Identify the edge by source and target NODE NAMES — never pass an edge ID, those are not visible to you and will be ignored.',
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
            description: 'Remove a connection between nodes. ALWAYS provide sourceName and targetName — edgeId is only used if it matches a real edge in the active graph, otherwise it is ignored and the name fallback runs.',
            parameters: {
                type: 'object',
                properties: {
                    edgeId: { type: 'string', description: 'Optional. Only used if it matches a real edge in the active graph; otherwise ignored. Prefer sourceName + targetName.' },
                    sourceName: { type: 'string', description: 'Name of the source node (recommended primary identifier).' },
                    targetName: { type: 'string', description: 'Name of the target node (recommended primary identifier).' },
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
            description: 'Read all nodes, edges, and groups from a graph. Primarily for NON-active graphs: pass targetGraphId for the one you need. The active graph is already described in full in your context header and refreshed every turn, so calling this with no arguments just re-reads what you can already see.',
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
                                size: SIZE_SCHEMA,
                                isA: IS_A_SCHEMA,
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
                        description: 'Plain visual groups: loose clustering ONLY, for a label nobody would point at as a concept. If the cluster has a name that means something on its own, use `layers` instead.',
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
                    layers: LAYERS_PARAM,
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
                                size: SIZE_SCHEMA,
                                isA: IS_A_SCHEMA,
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
                                type: { type: 'string', description: 'Connection type name (e.g., "Loves", "Parent Of"). Simpler alternative to definitionNode — provide either this OR definitionNode.' },
                                definitionNode: {
                                    type: 'object',
                                    description: 'Defines the connection type with extra metadata. Use Title Case for name. Provide this OR a `type` string.',
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
                        description: 'Plain visual groups: loose clustering ONLY, for a label nobody would point at as a concept. If the cluster has a name that means something on its own, use `layers` instead.',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Group name (e.g., "House Montague", "Engineering Team")' },
                                color: { type: 'string', description: COLOR_DESC },
                                memberNames: { type: 'array', items: { type: 'string' }, description: 'Names of nodes that belong to this group - must match names in the nodes array' }
                            },
                            required: ['name', 'memberNames']
                        }
                    },
                    layers: LAYERS_PARAM,
                    enrich: { type: 'boolean', description: 'Auto-enrich from Wikipedia (default: true).' },
                    overwriteDescription: { type: 'boolean', description: 'Overwrite description from Wikipedia (default: false).' }
                },
                required: ['name', 'description', 'nodes', 'edges']
            }
        },
        {
            name: 'buildComposition',
            description: 'Build nested node-group LAYERS in one call. A layer is a Thing that also has a web inside it: the Thing is created, its definition web is populated, and (when display is "decomposed") that web is spread open in the parent graph as a node-group you can see through. IMPORTANT: a layer\'s members go INSIDE its `definition.nodes` — never in the parent\'s `nodes` array. Layers nest: a definition can contain further layers. Use `use: "Existing Thing"` to invoke an existing web as a layer instead of authoring it again. This is the ONLY way to create node-groups — never orchestrate thingGroup/decomposeNode by hand.',
            parameters: {
                type: 'object',
                properties: {
                    targetGraphId: { type: 'string', description: 'Graph to build into (default: active graph).' },
                    nodes: {
                        type: 'array',
                        description: 'Optional plain nodes at the top level, alongside the layers.',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                color: { type: 'string', description: COLOR_DESC },
                                description: { type: 'string' },
                                type: { type: 'string', description: 'Optional type/category name for this node' },
                                size: SIZE_SCHEMA,
                                isA: IS_A_SCHEMA
                            },
                            required: ['name']
                        }
                    },
                    edges: {
                        type: 'array',
                        description: 'Connections at the top level. Endpoints may name a top-level node OR a layer (an edge to a layer attaches to the layer\'s Thing).',
                        items: {
                            type: 'object',
                            properties: {
                                source: { type: 'string' },
                                target: { type: 'string' },
                                type: { type: 'string', description: 'Connection type name in Title Case (e.g., "Powers", "Feeds Into")' },
                                directionality: { type: 'string', enum: ['unidirectional', 'bidirectional', 'none', 'reverse'] }
                            },
                            required: ['source', 'target']
                        }
                    },
                    groups: {
                        type: 'array',
                        description: 'Optional PLAIN visual groups at the top level (loose clustering, no web inside). For a cluster that is itself a concept, use a layer.',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                color: { type: 'string', description: COLOR_DESC },
                                memberNames: { type: 'array', items: { type: 'string' } }
                            },
                            required: ['name', 'memberNames']
                        }
                    },
                    layers: {
                        type: 'array',
                        description: 'The node-group layers to build. Each layer is a Thing + the web inside it. Provide EITHER `definition` (author fresh contents) OR `use` (invoke an existing Thing\'s web).',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Name of the Thing / node-group (e.g., "Engine")' },
                                color: { type: 'string', description: COLOR_DESC },
                                description: { type: 'string', description: 'What this Thing is' },
                                display: {
                                    type: 'string',
                                    enum: ['decomposed', 'collapsed'],
                                    description: '"decomposed" (default): spread the web open in the parent graph as a visible node-group. "collapsed": the Thing has its web but stays closed — the user can navigate into it.'
                                },
                                use: { type: 'string', description: 'Name of an EXISTING Thing whose web should be invoked here instead of authoring a new one. Provide this OR definition, not both.' },
                                isA: IS_A_SCHEMA,
                                definition: {
                                    type: 'object',
                                    description: 'The web inside this Thing. Its nodes ARE this layer\'s members.',
                                    properties: {
                                        nodes: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    name: { type: 'string' },
                                                    color: { type: 'string', description: COLOR_DESC },
                                                    description: { type: 'string' },
                                                    type: { type: 'string' },
                                                    size: SIZE_SCHEMA,
                                                    isA: IS_A_SCHEMA
                                                },
                                                required: ['name']
                                            }
                                        },
                                        edges: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    source: { type: 'string' },
                                                    target: { type: 'string' },
                                                    type: { type: 'string' },
                                                    directionality: { type: 'string', enum: ['unidirectional', 'bidirectional', 'none', 'reverse'] }
                                                },
                                                required: ['source', 'target']
                                            }
                                        },
                                        groups: {
                                            type: 'array',
                                            description: 'Plain visual groups inside this web.',
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
                                        layers: {
                                            type: 'array',
                                            description: 'Deeper layers nested inside this web (same shape as a top-level layer).',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    name: { type: 'string' },
                                                    color: { type: 'string' },
                                                    description: { type: 'string' },
                                                    display: { type: 'string', enum: ['decomposed', 'collapsed'] },
                                                    use: { type: 'string' },
                                                    definition: {
                                                        type: 'object',
                                                        properties: {
                                                            nodes: {
                                                                type: 'array',
                                                                items: {
                                                                    type: 'object',
                                                                    properties: {
                                                                        name: { type: 'string' },
                                                                        color: { type: 'string' },
                                                                        description: { type: 'string' },
                                                                        type: { type: 'string' },
                                                                        size: SIZE_SCHEMA
                                                                    },
                                                                    required: ['name']
                                                                }
                                                            },
                                                            edges: {
                                                                type: 'array',
                                                                items: {
                                                                    type: 'object',
                                                                    properties: {
                                                                        source: { type: 'string' },
                                                                        target: { type: 'string' },
                                                                        type: { type: 'string' }
                                                                    },
                                                                    required: ['source', 'target']
                                                                }
                                                            }
                                                        }
                                                    }
                                                },
                                                required: ['name']
                                            }
                                        }
                                    }
                                }
                            },
                            required: ['name']
                        }
                    },
                    enrich: { type: 'boolean', description: 'Auto-enrich from Wikipedia (default: true).' },
                    overwriteDescription: { type: 'boolean', description: 'Overwrite description from Wikipedia (default: false).' }
                },
                required: ['layers']
            }
        },
        {
            name: 'createGroup',
            description: 'Create a plain visual group to loosely cluster nodes together. The group is NOT a concept and has no web inside it — for that, use buildComposition layers.',
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
                                size: SIZE_SCHEMA,
                                isA: IS_A_SCHEMA,
                                type: { type: 'string', description: 'Optional: name of the category/type this node falls under (e.g., "Mammal" for a "Dog" node).' },
                                typeColor: { type: 'string', description: 'Optional: color for the type node, supports palettes. Use muted colors.' },
                                typeDescription: { type: 'string', description: 'Optional: brief description of the type itself.' }
                            },
                            required: ['name', 'description']
                        }
                    },
                    edges: {
                        type: 'array',
                        description: 'Array of edges to create inside the definition graph — you can have multiple edges between the same pair with different connection types. Highly recommended unless creating a simple Set or Collection. Every edge needs a connection type — provide EITHER a `type` string (simpler) OR a `definitionNode` object (richer, with description/color).',
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
                                type: { type: 'string', description: 'Connection type name (e.g., "Loves", "Parent Of"). Simpler alternative to definitionNode — provide either this OR definitionNode.' },
                                definitionNode: {
                                    type: 'object',
                                    description: 'Defines the connection type with extra metadata. Provide this OR a `type` string.',
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
                        description: 'Plain visual groups: loose clustering ONLY, for a label nobody would point at as a concept. If the cluster has a name that means something on its own, use `layers` instead.',
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
                    layers: LAYERS_PARAM,
                    enrich: { type: 'boolean', description: 'Auto-enrich from Wikipedia (default: true).' },
                    overwriteDescription: { type: 'boolean', description: 'Overwrite description from Wikipedia (default: false).' }
                },
                required: ['nodeName', 'nodes', 'edges']
            }
        },
        {
            name: 'switchToGraph',
            description: 'Navigate to a different graph. Only use when the user explicitly asks to navigate ("show me", "go into", "open"). If the result says alreadyActive, you are already there — do not call it again.',
            parameters: {
                type: 'object',
                properties: {
                    graphName: { type: 'string', description: 'PREFERRED: name of the graph to switch to.' },
                    nodeName: { type: 'string', description: 'Name of a node — switches to its first definition graph.' },
                    graphId: { type: 'string', description: 'Only pass this when you got the id from a readGraph result. Do not guess ids; use graphName instead.' }
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
            description: 'Read or build a node\'s abstraction chains (the carousel\'s generalization ladders). To build a ladder, use action "build" and pass the whole thing at once as a list of names — it reuses existing nodes where the name already matches (plurals included) and creates the rest for you, correctly ordered and colored. Prefer "build" over adding levels one at a time.',
            parameters: {
                type: 'object',
                properties: {
                    nodeName: { type: 'string', description: 'Name of the node the ladder is built around' },
                    action: { type: 'string', enum: ['read', 'build', 'add', 'remove'], description: '"read" (default): view all chains. "build": lay down a whole ladder from moreGeneric/moreSpecific in one call — the normal way to build. "add"/"remove": adjust a single level of an existing chain.' },
                    moreGeneric: {
                        type: 'array',
                        description: 'For build: the rungs BROADER than the node, ordered nearest-first — e.g. for "Ford Motor Company": ["Automaker", "Manufacturing Company", "Company", "Organization"]. Prefer objects { name, description } over bare names: the description is what the node shows in the carousel. Name the rungs to agree grammatically with nodeName — a plural node ("Merchants") takes plural categories above it, a singular one takes singular. Nodes that already exist are reused (matching tolerates minor wording differences), the rest created.',
                        items: { type: 'string' }
                    },
                    moreSpecific: {
                        type: 'array',
                        description: 'For build: rungs NARROWER than the node, ordered nearest-first. Usually empty — this end is for concrete examples and is rarely needed.',
                        items: { type: 'string' }
                    },
                    dimension: { type: 'string', description: 'Dimension name, e.g., "Generalization Axis"' },
                    targetNodeName: { type: 'string', description: 'For add/remove: name of the node to add or remove' },
                    direction: { type: 'string', enum: ['above', 'below'], description: 'For add: "above" = one step MORE SPECIFIC (the concrete end, shown higher in the carousel); "below" = one step MORE GENERIC (the abstract end, shown lower). Adding a broader category is "below". Default: "above".' },
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
            description: 'Look at the workspace three ways. mode "map": the composition structure of the whole universe — which webs live inside which Things — with the current position marked; use this to orient before building. mode "graph" (default): structure and IDs (instance IDs, prototype IDs, group IDs) for one graph; use it when a tool needs identifiers. mode "reusable": Things that ALREADY have webs, so you can invoke one with buildComposition `use:` instead of authoring it again — check this before building a web whose name you recognise. Do NOT use this to find out what the active graph contains; its names, types, descriptions and connections are already in your context header, refreshed every turn.',
            parameters: {
                type: 'object',
                properties: {
                    mode: { type: 'string', description: '"map" (universe composition tree), "graph" (one graph with IDs, default), or "reusable" (Things with existing webs).' },
                    graphId: { type: 'string', description: 'For mode "graph": which graph to inspect. Defaults to the active graph.' },
                    depth: { type: 'number', description: 'For mode "map": how many levels of nesting to expand (default 3, max 6). The path to the active graph is always fully expanded regardless.' },
                    query: { type: 'string', description: 'For mode "reusable": filter Things by name substring.' },
                    includeAllGraphs: { type: 'boolean', description: 'Deprecated alias for mode "map".' }
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
                                status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'skipped'], description: 'Current status of this step. Use "skipped" for a step you have decided is not needed — it settles the step without claiming the work was done, and lets the plan finish.' },
                                substeps: {
                                    type: 'array',
                                    description: 'Optional breakdown of this step into smaller chunks. Add substeps right before executing a step to plan the specific nodes, edges, or actions.',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            description: { type: 'string', description: 'Specific action within this step' },
                                            status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'skipped'] }
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
            description: 'Sketch a graph structure in lightweight shorthand before building it — including its LAYERS (depth of composition). Returns a quality preview (orphans, connectivity, nesting depth) and an expandedSpec that is DIRECTLY EXECUTABLE: pass it to buildComposition when the sketch has layers, or to createPopulatedGraph/populateDefinitionGraph when it is flat. Do not re-author the expandedSpec.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Graph/node name this sketch is for' },
                    palette: { type: 'string', description: PALETTE_DESC },
                    nodes: {
                        type: 'array',
                        description: 'Node names. Optionally add a [Type] suffix and/or a {size} marker, in either order: ["Engine Block {large}", "Pistons [Component]", "Oil Pump [System] {small}"]. Sizes are "extra-small", "small", "medium" (the default — omit it), "large", "extra-large". Decide sizes HERE, in the sketch, alongside the layers: size by real scale when the subject has one, otherwise by importance within this web. The expandedSpec carries them straight into the build.',
                        items: { type: 'string' }
                    },
                    edges: {
                        type: 'array',
                        description: 'Edges as "Source -> Relation -> Target" strings: ["Pistons -> Housed In -> Engine Block"]',
                        items: { type: 'string' }
                    },
                    groups: {
                        type: 'array',
                        description: 'Plain groups as "GroupName: member1, member2". A DOUBLE colon makes it a LAYER (a Thing with a web inside it): "Engine:: Pistons, Crankshaft". Add "(collapsed)" to keep the layer closed: "Drivetrain:: Gearbox, Axles (collapsed)". Use "Engine:: use" to invoke an EXISTING Thing\'s web.',
                        items: { type: 'string' }
                    },
                    layers: {
                        type: 'array',
                        description: 'Layers with real nesting (2+ levels). Each layer is a Thing plus the web inside it, in the same shorthand as the top level.',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                display: { type: 'string', enum: ['decomposed', 'collapsed'], description: '"decomposed" (default) spreads the web open in the parent; "collapsed" keeps the Thing closed.' },
                                use: { type: 'string', description: 'Name of an existing Thing whose web to invoke here instead of authoring one.' },
                                definition: {
                                    type: 'object',
                                    description: 'The web inside this layer — its nodes ARE the layer\'s members.',
                                    properties: {
                                        nodes: { type: 'array', items: { type: 'string' }, description: 'Node names, same shorthand as the top level — [Type] and {size} markers both work here' },
                                        edges: { type: 'array', items: { type: 'string' }, description: '"Source -> Relation -> Target" strings' },
                                        groups: { type: 'array', items: { type: 'string' }, description: 'Plain groups inside this web' },
                                        layers: { type: 'array', items: { type: 'object' }, description: 'Deeper layers nested inside this web (same shape)' }
                                    }
                                }
                            },
                            required: ['name']
                        }
                    }
                },
                required: ['name']
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
            description: 'Merge two nodes into one. The primary node survives; the secondary is absorbed (metadata, descriptions, connections, definition graphs combined) and deleted. Use findDuplicates first to identify which node to keep. Accepts prototypeId (preferred for disambiguation when names collide) or name.',
            parameters: {
                type: 'object',
                properties: {
                    primaryNodeName: { type: 'string', description: 'Name of the node to keep (used if primaryPrototypeId is not provided)' },
                    secondaryNodeName: { type: 'string', description: 'Name of the node to merge into primary (used if secondaryPrototypeId is not provided)' },
                    primaryPrototypeId: { type: 'string', description: 'Prototype ID of the node to keep (preferred, avoids name ambiguity)' },
                    secondaryPrototypeId: { type: 'string', description: 'Prototype ID of the node to merge into primary (preferred, avoids name ambiguity)' },
                    targetGraphId: { type: 'string', description: 'Graph context for resolving nodes (default: active).' }
                },
                required: []
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

    // listTools: self-referential catalog tool
    allTools.push({
        name: 'listTools',
        description: 'List ALL available tools with descriptions, organized by Things/Webs/Connections. Calling this unlocks every tool for the rest of this turn.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    });

    return allTools;
}

/**
 * Tool selection tiers for dynamic per-turn filtering.
 * - 1: Always included (core tools every LLM needs)
 * - string: Tier 2, included when the named context flag is true
 * - string[]: Tier 3, included when user message contains any keyword
 */
const TOOL_TIERS = {
    // Tier 1: Always included (~15 core tools)
    createNode: 1, updateNode: 1, deleteNode: 1,
    createEdge: 1, updateEdge: 1, deleteEdge: 1,
    readGraph: 1, search: 1, selectNode: 1,
    createGraph: 1, createPopulatedGraph: 1, expandGraph: 1,
    sketchGraph: 1, planTask: 1, askMultipleChoice: 1, listTools: 1,
    populateDefinitionGraph: 1, switchToGraph: 1, inspectWorkspace: 1,
    // Tier 1 on purpose: composition must be reachable on a blank canvas.
    // Gating it behind hasGroups/hasDefinitions (as the older thingGroup and
    // decomposeNode are) meant node-groups could only be built once node-groups
    // already existed — so the model never built the first one.
    buildComposition: 1,

    // Tier 2: Context-triggered (included when graph has relevant content)
    createGroup: 'has3PlusNodes', updateGroup: 'hasGroups',
    deleteGroup: 'hasGroups', thingGroup: 'hasGroups',
    replaceEdges: 'hasEdges',
    manageDefinitions: 'hasDefinitions', decomposeNode: 'hasDefinitions',
    condenseToNode: 'has3PlusNodes', themeGraph: 'has3PlusNodes',
    setNodeType: 'hasNodes', abstractionChain: 'hasNodes',
    // Sizing is a normal part of composing a web, so it has to be reachable
    // without the user naming it. Gating it on the word "size" (the old Tier 3
    // placement) meant the wizard could never rebalance an existing graph's
    // sizes on its own — it only ever saw the tool after being asked.
    setNodeSize: 'hasNodes',
    inspectPrototype: 'hasNodes',
    getNodeContext: 'hasNodes', enrichFromWikipedia: 'hasNodes',
    findDuplicates: 'has5PlusNodes', mergeNodes: 'has5PlusNodes',
    mergeGraphs: 'multipleGraphs',

    // Tier 3: Keyword-triggered (semantic web, tabular data)
    discoverOrbit: ['semantic', 'wikidata', 'dbpedia', 'discover', 'orbit'],
    semanticSearch: ['semantic', 'wikidata', 'dbpedia', 'linked data'],
    materializeSemanticEntities: ['semantic', 'materialize', 'wikidata'],
    importKnowledgeCluster: ['import', 'cluster', 'wikidata', 'crawl'],
    querySparql: ['sparql', 'wikidata', 'dbpedia'],
    analyzeTabularData: 'hasTabularData',
    importTabularAsGraph: 'hasTabularData',
};

/**
 * Select relevant tools for a given turn based on graph state and user message.
 * Tier 1 tools are always included. Tier 2 tools are included when the graph
 * has relevant content. Tier 3 tools are included when the user's message
 * contains relevant keywords. This reduces tool count from ~42 to ~15-25,
 * improving accuracy for small models and staying within Gemini's state limit.
 */
export function selectToolsForTurn({ graphState, userMessage, hasTabularData = false, modelTier = 'large' }) {
    const allTools = getToolDefinitions();

    // Small model whitelist: only the atomic ops they can reliably generate.
    // planTask is deliberately excluded — plans are model-maintained state and small
    // models cannot maintain it (observed: plan replaced/shrunk each resend, steps marked
    // done without any tool running, producing a churn loop). Code-side planning
    // (shape → fill → unfold → review) already covers builds.
    if (modelTier === 'small') {
        // buildComposition is included even though it takes the richest args in the
        // toolset: it is ONE call for a whole nested structure, which is easier for
        // a small model than orchestrating populate → define → decompose by hand.
        const SMALL_MODEL_TOOLS = new Set(['createGraph', 'expandGraph', 'populateDefinitionGraph', 'buildComposition', 'sketchGraph', 'readGraph', 'updateNode', 'askMultipleChoice', 'switchToGraph']);
        return allTools.filter(t => SMALL_MODEL_TOOLS.has(t.name));
    }

    // If listTools was called, all tools are unlocked for the rest of this turn
    if (graphState?._unlockAllTools) {
        return allTools;
    }

    const activeGraph = (graphState?.graphs || []).find(g => g.id === graphState?.activeGraphId);
    const nodeCount = activeGraph?.instances?.length || 0;
    const edgeCount = activeGraph?.edgeIds?.length || 0;
    const groupCount = (activeGraph?.groups || []).length;
    const graphCount = (graphState?.graphs || []).length;
    const hasDefinitions = (graphState?.nodePrototypes || []).some(
        p => Array.isArray(p.definitionGraphIds) && p.definitionGraphIds.length > 0
    );

    const flags = {
        hasNodes: nodeCount > 0,
        has3PlusNodes: nodeCount >= 3,
        has5PlusNodes: nodeCount >= 5,
        hasEdges: edgeCount > 0,
        hasGroups: groupCount > 0,
        multipleGraphs: graphCount > 1,
        hasDefinitions,
        hasTabularData,
    };

    const msgLower = (typeof userMessage === 'string' ? userMessage : '').toLowerCase();

    return allTools.filter(tool => {
        const tier = TOOL_TIERS[tool.name];
        if (tier === undefined) return false;
        if (tier === 1) return true;
        if (typeof tier === 'string') return flags[tier] === true;
        if (Array.isArray(tier)) return tier.some(kw => msgLower.includes(kw));
        return false;
    });
}

