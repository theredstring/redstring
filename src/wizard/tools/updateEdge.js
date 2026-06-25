import { resolveGraphId } from './resolveGraphId.js';

/**
 * Resolve a node by name from graph state
 */
function resolveNodeByName(name, nodePrototypes, graphs, graphId) {
    const queryLower = (name || '').toLowerCase().trim();
    if (!queryLower) return null;

    const targetGraph = graphs.find(g => g.id === graphId);
    if (!targetGraph) return null;

    const instances = Array.isArray(targetGraph.instances)
        ? targetGraph.instances
        : targetGraph.instances instanceof Map
            ? Array.from(targetGraph.instances.values())
            : Object.values(targetGraph.instances || {});

    // Try exact match first
    for (const inst of instances) {
        const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
        const nodeName = (inst.name || proto?.name || '').toLowerCase().trim();
        if (nodeName === queryLower) {
            return { instanceId: inst.id, prototypeId: proto.id, name: nodeName };
        }
    }

    // Try partial match
    for (const inst of instances) {
        const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
        const nodeName = (inst.name || proto?.name || '').toLowerCase().trim();
        if (nodeName.includes(queryLower) || queryLower.includes(nodeName)) {
            return { instanceId: inst.id, prototypeId: proto.id, name: nodeName };
        }
    }

    return null;
}

/**
 * Update the properties of an existing edge.
 * @param {Object} args - { sourceName, targetName, type, directionality, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Edge spec for UI application
 */
export async function updateEdge(args, graphState, cid, ensureSchedulerStarted) {
    const { sourceName, targetName, type, directionality, targetGraphId } = args;

    if (!sourceName || !targetName) {
        throw new Error('sourceName and targetName are required');
    }

    const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
    const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;

    if (!graphId) {
        throw new Error('No target graph specified and no active graph available.');
    }

    // Resolve source and target by name
    const resolvedSource = resolveNodeByName(sourceName, nodePrototypes, graphs, graphId);
    const resolvedTarget = resolveNodeByName(targetName, nodePrototypes, graphs, graphId);

    if (!resolvedSource) {
        const graph = graphs.find(g => g.id === graphId);
        const instances = Array.isArray(graph?.instances) ? graph.instances : Object.values(graph?.instances || {});
        const available = instances
            .map(i => nodePrototypes.find(p => p.id === i.prototypeId)?.name || i.name)
            .filter(Boolean)
            .slice(0, 8)
            .join(', ');
        throw new Error(`Source node "${sourceName}" not found in graph. Available nodes: ${available || '(none)'}. Use readGraph to see all nodes.`);
    }
    if (!resolvedTarget) {
        const graph = graphs.find(g => g.id === graphId);
        const instances = Array.isArray(graph?.instances) ? graph.instances : Object.values(graph?.instances || {});
        const available = instances
            .map(i => nodePrototypes.find(p => p.id === i.prototypeId)?.name || i.name)
            .filter(Boolean)
            .slice(0, 8)
            .join(', ');
        throw new Error(`Target node "${targetName}" not found in graph. Available nodes: ${available || '(none)'}. Use readGraph to see all nodes.`);
    }

    const updates = {};
    if (type !== undefined) updates.type = type;
    if (directionality !== undefined) updates.directionality = directionality;

    return {
        action: 'updateEdge',
        graphId,
        sourceName: resolvedSource.name,
        targetName: resolvedTarget.name,
        sourceInstanceId: resolvedSource.instanceId,
        targetInstanceId: resolvedTarget.instanceId,
        updates,
        updated: true
    };
}
