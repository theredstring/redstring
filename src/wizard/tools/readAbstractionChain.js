/**
 * readAbstractionChain - Read a node's abstraction chains (carousel spectrums)
 */

/**
 * Resolve a node prototype by name (fuzzy match)
 */
function resolveProtoByName(name, nodePrototypes) {
    const queryLower = (name || '').toLowerCase().trim();
    if (!queryLower) return null;

    for (const proto of nodePrototypes) {
        if ((proto.name || '').toLowerCase().trim() === queryLower) return proto;
    }
    for (const proto of nodePrototypes) {
        const protoName = (proto.name || '').toLowerCase().trim();
        if (protoName.includes(queryLower) || queryLower.includes(protoName)) return proto;
    }
    return null;
}

/**
 * Read abstraction chains for a node
 * @param {Object} args - { nodeName }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Chain data for LLM consumption
 */
export async function readAbstractionChain(args, graphState) {
    const { nodeName } = args;

    if (!nodeName) {
        throw new Error('nodeName is required');
    }

    const { nodePrototypes = [] } = graphState;

    const proto = resolveProtoByName(nodeName, nodePrototypes);
    if (!proto) {
        throw new Error(`Node "${nodeName}" not found. Check the name and try again.`);
    }

    const protoMap = new Map();
    for (const p of nodePrototypes) {
        if (p.id) protoMap.set(p.id, p);
    }

    const chains = proto.abstractionChains || {};
    const dimensionKeys = Object.keys(chains);

    if (dimensionKeys.length === 0) {
        return {
            nodeName: proto.name,
            nodeId: proto.id,
            chainCount: 0,
            dimensions: [],
            message: `"${proto.name}" has no abstraction chains. Use editAbstractionChain to create one.`
        };
    }

    const dimensions = dimensionKeys.map(dim => {
        const chain = Array.isArray(chains[dim]) ? chains[dim] : [];
        const chainNodes = chain.map(nodeId => {
            const chainProto = protoMap.get(nodeId);
            return {
                id: nodeId,
                name: chainProto?.name || nodeId,
                isOwner: nodeId === proto.id
            };
        });

        // Find the owner's position in the chain
        const ownerIndex = chain.indexOf(proto.id);

        return {
            dimension: dim,
            nodeCount: chain.length,
            ownerPosition: ownerIndex >= 0 ? ownerIndex : null,
            chain: chainNodes,
            spectrum: chainNodes.map((n, i) => {
                const label = n.isOwner ? `**${n.name}** (this node)` : n.name;
                const level = ownerIndex >= 0 ? i - ownerIndex : i;
                const direction = level < 0 ? '(more specific)' : level > 0 ? '(more generic)' : '(current)';
                return `  ${level >= 0 ? '+' : ''}${level}: ${label} ${direction}`;
            }).join('\n')
        };
    });

    return {
        nodeName: proto.name,
        nodeId: proto.id,
        chainCount: dimensionKeys.length,
        dimensions,
        message: `"${proto.name}" has ${dimensionKeys.length} abstraction chain${dimensionKeys.length !== 1 ? 's' : ''}.`
    };
}
