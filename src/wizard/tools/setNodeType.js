/**
 * setNodeType - Set or clear a node's type (categorization)
 *
 * Auto-creates the type node if it doesn't exist, so the AI can type nodes
 * in a single call without needing to pre-create type nodes.
 */

import { resolvePaletteColor } from '../../ai/palettes.js';

/**
 * Resolve a node prototype by name.
 * Uses strict matching for type resolution to prevent partial name collisions.
 */
function resolveProtoByName(name, nodePrototypes, strict = false) {
    const queryLower = (name || '').toLowerCase().trim();
    if (!queryLower) return null;

    // Exact match first (case-insensitive)
    for (const proto of nodePrototypes) {
        if ((proto.name || '').toLowerCase().trim() === queryLower) {
            return proto;
        }
    }

    // Substring match fallback
    for (const proto of nodePrototypes) {
        const protoName = (proto.name || '').toLowerCase().trim();
        if (!protoName) continue;

        if (strict) {
            // Strict: only match if the query CONTAINS the proto name (query is more specific)
            // Prevents "membrane" from matching "outer membrane"
            if (queryLower.includes(protoName) && queryLower !== protoName) {
                return proto;
            }
        } else {
            // Loose: match if either contains the other
            if (protoName.includes(queryLower) || queryLower.includes(protoName)) {
                return proto;
            }
        }
    }

    return null;
}

/**
 * Set or clear a node's type. Auto-creates the type node if it doesn't exist.
 * @param {Object} args - { nodeName, typeName?, typeColor?, typeDescription?, palette?, clearType? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Action spec for UI application
 */
export async function setNodeType(args, graphState) {
    const { nodeName, typeName, typeColor, typeDescription, palette, clearType } = args;

    if (!nodeName) {
        throw new Error('nodeName is required');
    }

    const { nodePrototypes = [], activeGraphId } = graphState;

    // Resolve the target node (loose matching — user is naming a node they can see)
    const targetProto = resolveProtoByName(nodeName, nodePrototypes, false);
    if (!targetProto) {
        throw new Error(`Node "${nodeName}" not found. Check the name and try again.`);
    }

    // Clear type
    if (clearType) {
        return {
            action: 'setNodeType',
            nodeId: targetProto.id,
            typeNodeId: null,
            message: `Cleared type from "${targetProto.name}".`
        };
    }

    // Set type
    if (!typeName) {
        throw new Error('typeName is required (or set clearType to true)');
    }

    // Resolve the type node (STRICT matching to prevent partial collisions)
    const typeProto = resolveProtoByName(typeName, nodePrototypes, true);

    // Circular check (only if type node already exists)
    if (typeProto && typeProto.id === targetProto.id) {
        throw new Error(
            `Cannot set "${targetProto.name}" as its own type. ` +
            `Provide a different typeName for the category.`
        );
    }

    // Type node exists — simple assignment
    if (typeProto) {
        return {
            action: 'setNodeType',
            nodeId: targetProto.id,
            typeNodeId: typeProto.id,
            message: `Set type of "${targetProto.name}" to "${typeProto.name}".`
        };
    }

    // Type node doesn't exist — auto-create it, then assign
    const graphId = activeGraphId;
    if (!graphId) {
        throw new Error('No active graph for auto-creating type node.');
    }

    return {
        action: 'setNodeType',
        nodeId: targetProto.id,
        typeNodeId: null, // Will be filled in by BridgeClient after creation
        autoCreate: {
            name: typeName,
            color: resolvePaletteColor(palette, typeColor) || null,
            description: typeDescription || `A type/category for ${typeName}.`,
            graphId
        },
        message: `Creating "${typeName}" and setting it as type of "${targetProto.name}".`
    };
}
