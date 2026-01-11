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

        // Edge Actions
        case 'edge_create':
            return `Connected "${sourceName}" → "${targetName}"`;
        case 'edge_delete':
            return `Deleted connection`;

        // Group Actions
        case 'group_create':
            return `Created group "${groupName || 'Group'}"`;
        case 'group_update':
            return `Updated group`;
        case 'group_delete':
            return `Deleted group`;

        // Position updates (usually bulk)
        case 'position_update':
        case 'node_position':
            return nodeCount > 1 ? `Moved ${nodeCount} nodes` : `Moved node`;

        // Prototype Actions (Global)
        case 'prototype_create':
            return `Created type "${prototypeName || 'Type'}"`;
        case 'prototype_update':
            return `Updated type "${prototypeName || 'Type'}"`;
        case 'prototype_delete':
            return `Deleted type`;

        // Graph Actions (Global)
        case 'graph_create':
            return `Created graph "${context.graphName || 'Graph'}"`;
        case 'graph_delete':
            return `Deleted graph`;

        // Catch-all
        default:
            // Helper to format unknown types: 'some_action_type' -> 'Some action type'
            return type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
    }
}
