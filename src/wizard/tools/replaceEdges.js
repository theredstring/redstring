/**
 * replaceEdges - Bulk-replace connections between existing nodes
 *
 * Finds existing edges between each source/target pair and updates their type
 * and directionality. If no existing edge is found, creates a new one.
 * This is the correct tool for "refine connections" workflows.
 */

import { resolveGraphId } from './resolveGraphId.js';

function resolveNodeByName(name, nodePrototypes, graphs, graphId) {
    const queryLower = (name || '').toLowerCase().trim();
    if (!queryLower) return null;
    const targetGraph = graphs.find(g => g.id === graphId);
    if (!targetGraph) return null;
    const instances = Array.isArray(targetGraph.instances)
        ? targetGraph.instances
        : Object.values(targetGraph.instances || {});
    let match = null;
    for (const inst of instances) {
        const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
        const nodeName = (inst.name || proto?.name || '').toLowerCase().trim();
        if (nodeName === queryLower) match = inst.name || proto?.name;
    }
    return match;
}

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
 * Replace edges between existing nodes in bulk
 * @param {Object} args - { edges: [{ source, target, type, directionality? }], targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { action, replacements }
 */
export async function replaceEdges(args, graphState, cid, ensureSchedulerStarted) {
    const { edges = [], targetGraphId } = args;

    if (!edges || edges.length === 0) {
        throw new Error('At least one edge is required');
    }

    const { activeGraphId, graphs = [], nodePrototypes = [] } = graphState;
    // Resolve targetGraphId tolerantly — the model frequently passes a graph NAME
    // here. Disambiguation favors the active graph and parent-graph lineage.
    const resolved = targetGraphId ? resolveGraphId(targetGraphId, graphs, { activeGraphId }) : null;
    const graphId = resolved || activeGraphId;

    if (!graphId) {
        throw new Error('No target graph specified and no active graph available.');
    }

    // Validate all source/target names before building specs — fail explicitly
    // so the model gets actionable feedback rather than silent no-ops on the client.
    const unresolvable = [];
    for (const e of edges) {
        if (!resolveNodeByName(e.source, nodePrototypes, graphs, graphId)) {
            unresolvable.push(`"${e.source}" (source)`);
        }
        if (!resolveNodeByName(e.target, nodePrototypes, graphs, graphId)) {
            unresolvable.push(`"${e.target}" (target)`);
        }
    }
    if (unresolvable.length > 0) {
        const graph = graphs.find(g => g.id === graphId);
        const instances = Array.isArray(graph?.instances) ? graph.instances : Object.values(graph?.instances || {});
        const available = instances
            .map(i => nodePrototypes.find(p => p.id === i.prototypeId)?.name || i.name)
            .filter(Boolean)
            .slice(0, 8)
            .join(', ');
        throw new Error(`Could not resolve nodes: ${[...new Set(unresolvable)].join(', ')}. Available nodes: ${available || '(none)'}. Use readGraph to see all nodes.`);
    }

    // Build edge specs with proper title casing and definition nodes
    const edgeSpecs = edges.map(e => {
        const typeName = e.type || '';
        const titleCaseName = toTitleCase(typeName);

        return {
            source: e.source,
            target: e.target,
            type: titleCaseName || 'Connection',
            directionality: e.directionality || 'unidirectional',
            definitionNode: titleCaseName ? {
                name: titleCaseName,
                color: generateConnectionColor(titleCaseName),
                description: ''
            } : null
        };
    });

    return {
        action: 'replaceEdges',
        graphId,
        edgeCount: edgeSpecs.length,
        replacements: edgeSpecs
    };
}
