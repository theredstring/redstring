/**
 * populateDefinitionGraph - Create a definition graph for a node and populate it in one step
 *
 * This creates a new graph that defines what a node is made of, WITHOUT changing
 * the user's active graph, and immediately populates it with nodes and edges.
 * Combining these two steps solves issue with small LLM models getting lost finding targetGraphId.
 */

import { resolvePaletteColor, getRandomPalette } from '../../ai/palettes.js';
import { validateEdges } from './edgeValidator.js';
import { analyzeGraphQuality } from './graphQuality.js';

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
function findPrototypeByName(nodeName, nodePrototypes, graphState = null) {
    const nameLower = String(nodeName || '').toLowerCase().trim();
    if (!nameLower) return null;

    let matches = [];

    // Exact match first
    for (const proto of nodePrototypes) {
        if (String(proto.name || '').toLowerCase().trim() === nameLower) {
            matches.push(proto);
        }
    }

    // Partial match (contains) if no exact matches
    if (matches.length === 0) {
        for (const proto of nodePrototypes) {
            if (String(proto.name || '').toLowerCase().trim().includes(nameLower)) {
                matches.push(proto);
            }
        }
    }

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    // Multiple matches found. If we have graph state, prefer the one actually visible in the active graph
    if (graphState && graphState.activeGraphId && graphState.graphs) {
        const activeGraph = graphState.graphs.find(g => g.id === graphState.activeGraphId);
        if (activeGraph && activeGraph.instances) {
            for (const match of matches) {
                if (activeGraph.instances.some(inst => inst.prototypeId === match.id)) {
                    return match;
                }
            }
        }
    }

    // Fallback: return the LAST match (most recently created)
    return matches[matches.length - 1];
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
    const { nodeName, nodes = [], edges = [], groups = [], palette, enrich, overwriteDescription } = args;

    if (!nodeName) {
        throw new Error('nodeName is required');
    }
    if ((!nodes || nodes.length === 0) && (!edges || edges.length === 0)) {
        throw new Error('At least one node or edge is required to populate the definition graph');
    }

    const { nodePrototypes = [] } = graphState;

    // Find the prototype
    const prototype = findPrototypeByName(nodeName, nodePrototypes, graphState);

    if (!prototype) {
        throw new Error(`Node "${nodeName}" not found. Cannot add definition graph to a node that doesn't exist.`);
    }

    // Check if the defining node has a description
    const definingNodeMissingBio = !prototype.description || prototype.description.trim() === '';

    // Generate or reuse a predictive ID for the definition graph
    let newGraphId;
    let alreadyPopulated = false;
    if (prototype.definitionGraphIds && prototype.definitionGraphIds.length > 0) {
        newGraphId = prototype.definitionGraphIds[0];
        // Check if this graph already has nodes in graphState
        const existingGraph = graphState.graphs && graphState.graphs.find
            ? graphState.graphs.find(g => g.id === newGraphId)
            : null;
        const existingNodeCount = existingGraph
            ? (Array.isArray(existingGraph.instances) ? existingGraph.instances.length : Object.keys(existingGraph.instances || {}).length)
            : 0;
        alreadyPopulated = existingNodeCount > 0;
        console.error('[populateDefinitionGraph] Reusing existing definition graph for', nodeName, '→', newGraphId, `(already has ${existingNodeCount} nodes)`);
    } else {
        newGraphId = `graph-def-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        console.error('[populateDefinitionGraph] Creating new definition graph for', nodeName, '→', newGraphId);
    }

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

    // Validation: each edge needs SOMETHING describing its connection type.
    // Accepted shapes (in order of preference):
    //   1. definitionNode: { name, color?, description? }    — preferred
    //   2. type: "<string>"                                  — auto-promoted to definitionNode
    // If both are missing or empty, error out so the LLM can self-correct.
    for (let i = 0; i < validEdges.length; i++) {
        const e = validEdges[i];
        const hasDefNode = e.definitionNode && typeof e.definitionNode === 'object' && typeof e.definitionNode.name === 'string' && e.definitionNode.name.trim().length > 0;
        const hasTypeString = typeof e.type === 'string' && e.type.trim().length > 0;
        if (!hasDefNode && !hasTypeString) {
            throw new Error(
                `Edge ${i + 1} (${e.source} → ${e.target}) needs a connection type. ` +
                `Provide either a 'type' string (e.g., type: "Establishes") or a 'definitionNode' object (e.g., definitionNode: { name: "Establishes", description: "..." }). ` +
                `Both shapes are accepted.`
            );
        }
    }

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

    // Analyze graph quality for LLM feedback
    const qualityReport = analyzeGraphQuality(nodeSpecs, edgeSpecs);

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
        // Warn when the model calls populateDefinitionGraph a second time for the same node
        alreadyPopulated,
        alreadyPopulatedWarning: alreadyPopulated
            ? `WARNING: "${prototype.name}" already has a definition graph with existing nodes. You called populateDefinitionGraph twice for the same node — this is almost always a mistake. Do NOT call populateDefinitionGraph again for this node. If you need to add more content to this definition graph, use expandGraph instead.`
            : null,
        // Edge validation feedback for LLM
        droppedEdges,
        edgeWarning: droppedEdges.length > 0
            ? `${droppedEdges.length} edge(s) were dropped because they referenced nodes not in the nodes array: ${droppedEdges.map(d => `${d.source} → ${d.target} (${d.reason})`).join('; ')}`
            : null,
        // Quality analysis — LLM should fix issues before responding
        qualityReport,
        // Hint: defining node bio check
        definingNodeMissingBio,
        bioHint: definingNodeMissingBio
            ? `The defining node "${prototype.name}" has no description. Call updateNode to add a bio explaining what "${prototype.name}" represents.`
            : null,
        // Enrichment control
        enrich: enrich !== false,
        overwriteDescription: overwriteDescription || false,
        // Include full spec for UI to apply
        spec: {
            nodes: nodeSpecs,
            edges: edgeSpecs,
            groups: groupSpecs
        }
    };
}
