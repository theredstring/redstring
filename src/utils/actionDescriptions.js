/**
 * Generates human-readable descriptions for actions based on context and state.
 * 
 * @param {Object} context - The change context object (type, target, ids, etc.)
 * @param {Object} state - The current state object (for looking up names)
 * @returns {string} Human-readable description
 */
export function generateDescription(context, state) {
    const { type, prototypeId, graphId, nodeCount, groupName, prototypeName, sourceName, targetName, isWizard } = context;

    let desc = '';
    switch (type) {
        // Node Actions
        case 'node_place': {
            const proto = state.nodePrototypes?.get(prototypeId);
            desc = `Added "${proto?.name || 'node'}" to canvas`;
            break;
        }
        case 'node_delete': {
            const proto = state.nodePrototypes?.get(prototypeId);
            desc = `Deleted "${proto?.name || 'node'}"`;
            break;
        }
        case 'node_type_change': {
            const proto = state.nodePrototypes?.get(context.nodeId);
            const typeNode = context.typeNodeId ? state.nodePrototypes?.get(context.typeNodeId) : null;
            const targetName = typeNode?.name || 'Nothing';
            desc = `Changed type of "${proto?.name || 'node'}" to "${targetName}"`;
            break;
        }

        // Edge Actions
        case 'edge_create':
            desc = `Connected "${sourceName}" → "${targetName}"`;
            break;
        case 'edge_delete':
            desc = `Deleted connection`;
            break;

        // Group Actions
        case 'group_create':
            desc = `Created group "${groupName || 'Group'}"`;
            break;
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
            desc = `Updated "${name}"`;
            break;
        }
        case 'group_delete':
            desc = `Deleted group`;
            break;

        // Position updates (usually bulk)
        // Position updates (usually bulk)
        case 'position_update':
        case 'node_position': {
            if (context.groupId) {
                desc = `Moved group "${context.groupName || 'Group'}"`;
                break;
            }
            if (nodeCount > 1) {
                desc = `Moved ${nodeCount} nodes`;
                break;
            }
            // Try to find the single node name if possible
            const targetId = context.nodeId || context.ids?.[0];
            if (targetId) {
                // Check active graph first
                const graph = state.graphs?.get(state.activeGraphId);

                // 1. Try finding as Node Instance
                const instance = graph?.instances?.get(targetId);
                if (instance) {
                    const protoId = instance.prototypeId;
                    const proto = state.nodePrototypes?.get(protoId);

                    // Special case: If it's a Node Group, try to get the real group name
                    // (Assuming we can link back or just use proto name which might be the group name if synced)
                    const name = proto?.name || 'node';
                    desc = `Moved "${name}"`;
                    break;
                }

                // 2. Try finding as Group (if groups can be moved directly and logged as node_position)
                const group = graph?.groups?.get(targetId);
                if (group) {
                    desc = `Moved group "${group.name}"`;
                    break;
                }

                desc = `Moved item`;
                break;
            }
            desc = `Moved node`;
            break;
        }

        // Prototype Actions (Global)
        case 'prototype_create':
            desc = `Created type "${prototypeName || 'Type'}"`;
            break;
        case 'prototype_update': {
            const proto = state.nodePrototypes?.get(prototypeId);
            desc = `Updated "${proto?.name || prototypeName || 'Type'}"`;
            break;
        }
        case 'prototype_delete':
            desc = `Deleted type`;
            break;

        // Graph Actions (Global)
        case 'graph_create':
            desc = `Created graph "${context.graphName || 'Graph'}"`;
            break;
        case 'graph_update': {
            const graph = state.graphs?.get(graphId);
            desc = `Updated "${graph?.name || context.graphName || 'Graph'}"`;
            break;
        }
        case 'graph_delete':
            desc = `Deleted graph`;
            break;

        // Catch-all
        default:
            // Helper to format unknown types: 'some_action_type' -> 'Some action type'
            desc = type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
            break;
    }

    if (isWizard) desc = `Wizard: ${desc}`;
    return desc;
}
