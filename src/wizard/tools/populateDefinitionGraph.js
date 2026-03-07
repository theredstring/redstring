/**
 * populateDefinitionGraph - Create a definition graph for a node and populate it in one step
 *
 * This creates a new graph that defines what a node is made of, WITHOUT changing
 * the user's active graph, and immediately populates it with nodes and edges.
 * Combining these two steps solves issue with small LLM models getting lost finding targetGraphId.
 */

import { resolvePaletteColor, getRandomPalette } from '../../ai/palettes.js';
import { validateEdges } from './edgeValidator.js';

/**
 * Convert string to Title Case
 */
function toTitleCase(str) {
    if (!str) return '';
    // Split camelCase: "isPartOf" → "is Part Of"
    const spaced = str.replace(/([a-z])([A-Z])/g, '$1 $2');
    return spaced.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Generate a deterministic color from a name
 */
function generateConnectionColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 60%, 45%)`;
}

/**
 * Fuzzy match node name against prototypes
 */
function findPrototypeByName(nodeName, nodePrototypes) {
    const nameLower = String(nodeName || '').toLowerCase().trim();
    if (!nameLower) return null;

    // Exact match first
    for (const proto of nodePrototypes) {
        if (String(proto.name || '').toLowerCase().trim() === nameLower) {
            return proto;
        }
    }

    // Partial match (contains)
    for (const proto of nodePrototypes) {
        if (String(proto.name || '').toLowerCase().trim().includes(nameLower)) {
            return proto;
        }
    }

    return null;
}

/**
 * Add a new definition graph to a node and immediately expand it
 * @param {Object} args - { nodeName, nodes, edges, groups, palette }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Action spec with new graph ID and added spec
 */
export async function populateDefinitionGraph(args, graphState, cid, ensureSchedulerStarted) {
    const { nodeName, nodes = [], edges = [], groups = [], palette } = args;

    if (!nodeName) {
        throw new Error('nodeName is required');
    }
    if ((!nodes || nodes.length === 0) && (!edges || edges.length === 0)) {
        throw new Error('At least one node or edge is required to populate the definition graph');
    }

    const { nodePrototypes = [] } = graphState;

    // Find the prototype
    const prototype = findPrototypeByName(nodeName, nodePrototypes);

    if (!prototype) {
        throw new Error(`Node "${nodeName}" not found. Cannot add definition graph to a node that doesn't exist.`);
    }

    // Generate a predictive ID for the new definition graph
    const newGraphId = `graph-def-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    console.error('[populateDefinitionGraph] Creating new definition graph for', nodeName, '→', newGraphId);

    // Pick a palette if none provided
    const activePalette = palette || getRandomPalette();

    // Build node specs
    const nodeSpecs = nodes.map(n => ({
        name: n.name,
        color: resolvePaletteColor(activePalette, n.color),
        description: n.description || '',
        type: n.type || null,
        typeColor: resolvePaletteColor(activePalette, n.typeColor || '#A0A0A0'),
        typeDescription: n.typeDescription || ''
    }));

    // Validate edges: strip any that reference nodes not in the nodes array
    const { validEdges, droppedEdges } = validateEdges(nodeSpecs, edges || []);

    // Build edge specs with definitionNode handling (same as createPopulatedGraph)
    const edgeSpecs = validEdges.map(e => {
        const inputDefNode = e.definitionNode;
        const typeName = inputDefNode?.name || e.type || '';
        const titleCaseName = toTitleCase(typeName);

        return {
            source: e.source,
            target: e.target,
            directionality: e.directionality || 'unidirectional',
            type: titleCaseName || 'Connection',
            definitionNode: titleCaseName ? {
                name: titleCaseName,
                color: resolvePaletteColor(activePalette, inputDefNode?.color || generateConnectionColor(titleCaseName)),
                description: inputDefNode?.description || ''
            } : null
        };
    });

    const groupSpecs = (groups || []).map(g => ({
        name: g.name,
        color: resolvePaletteColor(activePalette, g.color || '#8B0000'),
        memberNames: g.memberNames || []
    }));

    return {
        action: 'populateDefinitionGraph',
        prototypeId: prototype.id,
        nodeName: prototype.name,
        graphId: newGraphId,
        // For ToolCallCard summary (counts)
        nodesAdded: nodeSpecs.map(n => n.name),
        edgesAdded: edgeSpecs,
        groupsAdded: groupSpecs.map(g => g.name),
        nodeCount: nodeSpecs.length,
        edgeCount: edgeSpecs.length,
        groupCount: groupSpecs.length,
        // Edge validation feedback for LLM
        droppedEdges,
        edgeWarning: droppedEdges.length > 0
            ? `${droppedEdges.length} edge(s) were dropped because they referenced nodes not in the nodes array: ${droppedEdges.map(d => `${d.source} → ${d.target} (${d.reason})`).join('; ')}`
            : null,
        // Include full spec for UI to apply
        spec: {
            nodes: nodeSpecs,
            edges: edgeSpecs,
            groups: groupSpecs
        }
    };
}
