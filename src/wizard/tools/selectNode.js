/**
 * selectNode - Find and select a node on the canvas by name
 * 
 * Uses fuzzy matching to find a node, returns its info, and
 * dispatches a UI action to select/focus it on the canvas.
 */

export async function selectNode(args, graphState, cid, ensureSchedulerStarted) {
    const { name } = args;
    if (!name) {
        throw new Error('name is required');
    }

    const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;

    // Build combined node list from prototypes + active graph instances
    const allNodes = [];

    const activeGraph = graphs.find(g => g.id === activeGraphId);
    if (activeGraph) {
        const instances = Array.isArray(activeGraph.instances)
            ? activeGraph.instances
            : activeGraph.instances instanceof Map
                ? Array.from(activeGraph.instances.values())
                : Object.values(activeGraph.instances || {});

        for (const inst of instances) {
            const proto = nodePrototypes.find(p => p.id === inst.prototypeId);
            allNodes.push({
                instanceId: inst.id,
                prototypeId: inst.prototypeId,
                name: inst.name || proto?.name || '',
                color: inst.color || proto?.color || '',
                description: inst.description || proto?.description || '',
                x: inst.x,
                y: inst.y
            });
        }
    }

    // Also check prototypes if no instances found
    if (allNodes.length === 0) {
        for (const proto of nodePrototypes) {
            allNodes.push({
                prototypeId: proto.id,
                name: proto.name || '',
                color: proto.color || '',
                description: proto.description || ''
            });
        }
    }

    if (allNodes.length === 0) {
        return { error: 'No nodes found in the active graph.' };
    }

    // Find best match using word-level + fuzzy matching
    const queryLower = name.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);

    const scored = allNodes.map(node => {
        const nodeName = (node.name || '').toLowerCase();
        let score = 0;

        // Exact match
        if (nodeName === queryLower) score += 100;
        // Full substring
        if (nodeName.includes(queryLower)) score += 20;
        if (queryLower.includes(nodeName)) score += 15;

        // Word matches
        for (const word of queryWords) {
            if (nodeName.includes(word)) score += 5;
        }

        // Node name words match query
        const nodeWords = nodeName.split(/\s+/);
        for (const nw of nodeWords) {
            if (queryLower.includes(nw) && nw.length > 2) score += 3;
        }

        return { ...node, score };
    });

    const best = scored
        .filter(n => n.score > 0)
        .sort((a, b) => b.score - a.score);

    if (best.length === 0) {
        // Try Jaccard fuzzy as last resort
        const fuzzy = allNodes
            .map(node => ({
                ...node,
                similarity: jaccardSimilarity(queryLower, (node.name || '').toLowerCase())
            }))
            .filter(n => n.similarity > 0.25)
            .sort((a, b) => b.similarity - a.similarity);

        if (fuzzy.length > 0) {
            const match = fuzzy[0];
            return {
                action: 'selectNode',
                found: true,
                fuzzyMatch: true,
                node: {
                    instanceId: match.instanceId,
                    prototypeId: match.prototypeId,
                    name: match.name,
                    color: match.color,
                    description: match.description
                },
                message: `Fuzzy match: selected "${match.name}" (closest to "${name}").`
            };
        }

        return { error: `No node found matching "${name}". Try a different name or use searchNodes to find candidates.` };
    }

    const match = best[0];
    return {
        action: 'selectNode',
        found: true,
        node: {
            instanceId: match.instanceId,
            prototypeId: match.prototypeId,
            name: match.name,
            color: match.color,
            description: match.description
        },
        message: `Selected "${match.name}" on the canvas.`
    };
}

/**
 * Simple Jaccard similarity (character bigram based)
 */
function jaccardSimilarity(a, b) {
    if (!a || !b) return 0;
    const bigramsA = new Set();
    const bigramsB = new Set();
    for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
    for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));
    if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
    let intersection = 0;
    for (const bg of bigramsA) {
        if (bigramsB.has(bg)) intersection++;
    }
    return intersection / (bigramsA.size + bigramsB.size - intersection);
}
