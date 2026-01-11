/**
 * Generates human-readable descriptions for actions based on context and state.
 * 
 * @param {Object} context - The change context object (type, target, ids, etc.)
 * @param {Object} state - The current state object (for looking up names)
 * @returns {string} Human-readable description
 */
export function generateDescription(context, state) {
    const { type, prototypeId, graphId, nodeCount, groupName, prototypeName, sourceName, targetName } = context;

    switch (type) {
        // Node Actions
        case 'node_place': {
            const proto = state.nodePrototypes?.get(prototypeId);
            return `Added "${proto?.name || 'node'}" to canvas`;
        }
        case 'node_delete': {
            const proto = state.nodePrototypes?.get(prototypeId);
            return `Deleted "${proto?.name || 'node'}"`;
        }
        case 'node_type_change': {
            const proto = state.nodePrototypes?.get(context.nodeId);
            const typeNode = context.typeNodeId ? state.nodePrototypes?.get(context.typeNodeId) : null;
            const targetName = typeNode?.name || 'Nothing';
            return `Changed type of "${proto?.name || 'node'}" to "${targetName}"`;
        }

        // Edge Actions
        case 'edge_create':
            return `Connected "${sourceName}" → "${targetName}"`;
        case 'edge_delete':
            return `Deleted connection`;

        // Group Actions
        case 'group_create':
            return `Created group "${groupName || 'Group'}"`;
        case 'group_update': {
            // Try to resolve group name
            let name = 'group';
            if (context.groupId && state.graphs) {
                // We need to find which graph has this group. Try active graph first.
                // Or look through all graphs if necessary (but that's expensive).
                // Usually group_update happens on active graph.
                const graph = state.graphs.get(state.activeGraphId);
                const group = graph?.groups?.get(context.groupId);
                if (group) name = group.name;
            }
            return `Updated "${name}"`;
        }
        case 'group_delete':
            return `Deleted group`;

        // Position updates (usually bulk)
        // Position updates (usually bulk)
        case 'position_update':
        case 'node_position': {
            if (nodeCount > 1) {
                return `Moved ${nodeCount} nodes`;
            }
            // Try to find the single node name if possible
            const targetId = context.nodeId || context.ids?.[0];
            if (targetId) {
                // Check active graph first
                const graph = state.graphs?.get(state.activeGraphId);
                const node = graph?.nodes?.find(n => n.id === targetId);
                const protoId = node?.prototypeId;
                const proto = state.nodePrototypes?.get(protoId);
                const name = proto?.name || 'node';
                return `Moved "${name}"`;
            }
            return `Moved node`;
        }

        // Prototype Actions (Global)
        case 'prototype_create':
            return `Created type "${prototypeName || 'Type'}"`;
        case 'prototype_update': {
            const proto = state.nodePrototypes?.get(prototypeId);
            return `Updated "${proto?.name || prototypeName || 'Type'}"`;
        }
        case 'prototype_delete':
            return `Deleted type`;

        // Graph Actions (Global)
        case 'graph_create':
            return `Created graph "${context.graphName || 'Graph'}"`;
        case 'graph_update': {
            const graph = state.graphs?.get(graphId);
            return `Updated "${graph?.name || context.graphName || 'Graph'}"`;
        }
        case 'graph_delete':
            return `Deleted graph`;

        // Catch-all
        default:
            // Helper to format unknown types: 'some_action_type' -> 'Some action type'
            return type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
    }
}
