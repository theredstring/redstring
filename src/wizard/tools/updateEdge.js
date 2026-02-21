/**
 * Resolve a node by name from graph state
 */
function resolveNodeByName(name, nodePrototypes, graphs, activeGraphId) {
    const queryLower = (name || '').toLowerCase().trim();
    if (!queryLower) return null;

    const activeGraph = graphs.find(g => g.id === activeGraphId);
    if (!activeGraph) return null;

    const instances = Array.isArray(activeGraph.instances)
        ? activeGraph.instances
        : activeGraph.instances instanceof Map
            ? Array.from(activeGraph.instances.values())
            : Object.values(activeGraph.instances || {});

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
 * @param {Object} args - { sourceName, targetName, type, directionality }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Edge spec for UI application
 */
export async function updateEdge(args, graphState, cid, ensureSchedulerStarted) {
    const { sourceName, targetName, type, directionality } = args;

    if (!sourceName || !targetName) {
        throw new Error('sourceName and targetName are required');
    }

    const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;
    if (!activeGraphId) {
        throw new Error('No active graph');
    }

    // Resolve source and target by name
    const resolvedSource = resolveNodeByName(sourceName, nodePrototypes, graphs, activeGraphId);
    const resolvedTarget = resolveNodeByName(targetName, nodePrototypes, graphs, activeGraphId);

    if (!resolvedSource) {
        console.warn('[updateEdge] Source not found in graphState, delegating to client:', sourceName);
    }
    if (!resolvedTarget) {
        console.warn('[updateEdge] Target not found in graphState, delegating to client:', targetName);
    }

    const updates = {};
    if (type !== undefined) updates.type = type;
    if (directionality !== undefined) updates.directionality = directionality;

    return {
        action: 'updateEdge',
        graphId: activeGraphId,
        sourceName: resolvedSource?.name || sourceName,
        targetName: resolvedTarget?.name || targetName,
        sourceInstanceId: resolvedSource?.instanceId || null,
        targetInstanceId: resolvedTarget?.instanceId || null,
        updates,
        updated: true
    };
}
