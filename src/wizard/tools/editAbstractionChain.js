/**
 * editAbstractionChain - Add or remove nodes from a node's abstraction chain (carousel spectrum)
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
 * Edit an abstraction chain
 * @param {Object} args - { nodeName, dimension, editAction, targetNodeName, direction?, relativeTo? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Action spec for UI application
 */
export async function editAbstractionChain(args, graphState) {
    const { nodeName, dimension, editAction, targetNodeName, direction, relativeTo } = args;

    if (!nodeName) throw new Error('nodeName is required');
    if (!dimension) throw new Error('dimension is required (e.g., "Generalization Axis")');
    if (!editAction) throw new Error('editAction is required ("add" or "remove")');

    const { nodePrototypes = [] } = graphState;

    // Resolve the chain owner
    const ownerProto = resolveProtoByName(nodeName, nodePrototypes);
    if (!ownerProto) {
        throw new Error(`Node "${nodeName}" not found.`);
    }

    if (editAction === 'add') {
        if (!targetNodeName) throw new Error('targetNodeName is required when adding to a chain');

        const targetProto = resolveProtoByName(targetNodeName, nodePrototypes);
        if (!targetProto) {
            throw new Error(`Target node "${targetNodeName}" not found. Create it first with createNode.`);
        }

        // Resolve the relativeTo node if provided
        let insertRelativeToNodeId = null;
        if (relativeTo) {
            const relativeProto = resolveProtoByName(relativeTo, nodePrototypes);
            if (relativeProto) {
                insertRelativeToNodeId = relativeProto.id;
            }
        }

        return {
            action: 'editAbstractionChain',
            operationType: 'addToAbstractionChain',
            nodeId: ownerProto.id,
            dimension,
            direction: direction || 'above',
            newNodeId: targetProto.id,
            insertRelativeToNodeId,
            message: `Added "${targetProto.name}" ${direction || 'above'} in "${dimension}" chain of "${ownerProto.name}".`
        };
    }

    if (editAction === 'remove') {
        if (!targetNodeName) throw new Error('targetNodeName is required when removing from a chain');

        const targetProto = resolveProtoByName(targetNodeName, nodePrototypes);
        if (!targetProto) {
            throw new Error(`Target node "${targetNodeName}" not found.`);
        }

        return {
            action: 'editAbstractionChain',
            operationType: 'removeFromAbstractionChain',
            nodeId: ownerProto.id,
            dimension,
            nodeToRemove: targetProto.id,
            message: `Removed "${targetProto.name}" from "${dimension}" chain of "${ownerProto.name}".`
        };
    }

    throw new Error(`Unknown editAction "${editAction}". Use "add" or "remove".`);
}
