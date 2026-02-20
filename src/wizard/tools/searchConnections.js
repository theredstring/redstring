/**
 * searchConnections - Find connections/edges by type, node names, or general query
 * 
 * Searches through all edges in the active graph, matching against
 * connection types, source/target node names, and descriptions.
 * Returns results ranked by relevance.
 */

export async function searchConnections(args, graphState, cid, ensureSchedulerStarted) {
    const { query } = args;
    if (!query) {
        throw new Error('query is required');
    }

    const { edges = [], nodePrototypes = [], graphs = [], activeGraphId } = graphState;

    // Build a node name lookup (by ID) for resolving edge endpoints
    const nodeNameById = new Map();

    for (const proto of nodePrototypes) {
        if (proto.id) nodeNameById.set(proto.id, proto.name || '');
    }

    // Also pull instance names from the active graph
    const activeGraph = graphs.find(g => g.id === activeGraphId);
    if (activeGraph) {
        const instances = Array.isArray(activeGraph.instances)
            ? activeGraph.instances
            : activeGraph.instances instanceof Map
                ? Array.from(activeGraph.instances.values())
                : Object.values(activeGraph.instances || {});

        for (const inst of instances) {
            if (inst.id) nodeNameById.set(inst.id, inst.name || nodeNameById.get(inst.prototypeId) || '');
        }
    }

    if (edges.length === 0) {
        return { results: [], message: 'No connections found in the current graph.' };
    }

    // Split query into individual words for flexible matching
    const queryLower = query.toLowerCase();
    const queryWords = queryLower
        .split(/\s+/)
        .filter(w => w.length > 1);

    // Score each edge by relevance
    const scored = edges.map(edge => {
        const edgeType = (edge.type || edge.connectionType || '').toLowerCase();
        const sourceName = (nodeNameById.get(edge.sourceId) || '').toLowerCase();
        const targetName = (nodeNameById.get(edge.targetId) || '').toLowerCase();
        const combined = `${edgeType} ${sourceName} ${targetName}`;
        let score = 0;

        // Full query substring match
        if (combined.includes(queryLower)) score += 10;

        // Individual word matches
        for (const word of queryWords) {
            if (edgeType.includes(word)) score += 4; // connection type is most relevant
            if (sourceName.includes(word)) score += 2;
            if (targetName.includes(word)) score += 2;
        }

        // Partial word matches (simple stemming)
        for (const word of queryWords) {
            if (word.length >= 3) {
                const stem = word.slice(0, -1);
                if (edgeType.includes(stem) && !edgeType.includes(word)) score += 2;
                if (sourceName.includes(stem) && !sourceName.includes(word)) score += 1;
                if (targetName.includes(stem) && !targetName.includes(word)) score += 1;
            }
        }

        return {
            id: edge.id,
            type: edge.type || edge.connectionType || 'relates to',
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            sourceName: nodeNameById.get(edge.sourceId) || edge.sourceId,
            targetName: nodeNameById.get(edge.targetId) || edge.targetId,
            score
        };
    });

    const results = scored
        .filter(e => e.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map(({ score, ...edge }) => edge);

    if (results.length === 0) {
        return { results: [], message: `No connections matched "${query}". The active graph has ${edges.length} connection(s).` };
    }

    return { results, message: `Found ${results.length} connection(s) matching "${query}".` };
}
