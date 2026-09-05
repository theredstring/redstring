/**
 * editAbstractionChain - Add or remove nodes from a node's abstraction chain (carousel spectrum)
 */

import { resolveNodeSmart } from './utils/resolveNodeSmart.js';

const norm = (s) => String(s || '').toLowerCase().trim();

/**
 * Resolve the node that OWNS the chain, via the shared smart resolver.
 * Naming the wrong owner starts a second, competing chain rather than extending
 * the one on screen, so this leans on the resolver's exact→model→ranked path
 * instead of the old "first loose substring hit wins".
 */
async function resolveOwnerByName(name, nodePrototypes) {
    const { match } = await resolveNodeSmart(name, nodePrototypes, {
        callSite: 'editAbstractionChain:owner',
        substringMode: 'loose'
    });
    return match;
}

/**
 * Find the LAST exact (case-insensitive) name match. Last, not first: Maps
 * iterate oldest-first and stale prototypes accumulate, so the newest node with
 * a given name is the one the user just made — project convention.
 */
function findExact(name, protos) {
    const q = norm(name);
    if (!q) return null;
    let match = null;
    for (const proto of protos) {
        if (norm(proto?.name) === q) match = proto;
    }
    return match;
}

/**
 * Names close enough to `name` to be worth showing in a "did you mean" error.
 * Deliberately only used for the error message — never to auto-bind.
 */
function nearMisses(name, protos, limit = 6) {
    const q = norm(name);
    if (!q) return [];
    const hits = [];
    for (const proto of protos) {
        const n = norm(proto?.name);
        if (!n || n === q) continue;
        if (n.includes(q) || q.includes(n)) hits.push(proto.name);
        if (hits.length >= limit) break;
    }
    return hits;
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
    const ownerProto = await resolveOwnerByName(nodeName, nodePrototypes);
    if (!ownerProto) {
        throw new Error(`Node "${nodeName}" not found.`);
    }

    // Members of the chain being edited, for error messages. Not used to scope
    // resolution: relativeTo may legitimately name a node that isn't on the chain
    // yet (addToAbstractionChain inserts both), and the first add to a dimension
    // happens when the chain doesn't exist at all.
    const chainIds = ownerProto.abstractionChains?.[dimension];
    const chainMembers = (Array.isArray(chainIds) ? chainIds : [])
        .map((id) => nodePrototypes.find((p) => p?.id === id))
        .filter(Boolean);

    if (editAction === 'add') {
        if (!targetNodeName) throw new Error('targetNodeName is required when adding to a chain');

        // EXACT match only. A chain level is a claim that one category generalizes
        // another, and the old loose substring fallback made that claim about
        // whatever node happened to share a word: asking for "Company" bound to an
        // existing "Company Town", and "Grain Trading Company" bound to "Grain".
        // If the category doesn't exist yet, the right move is to create it, not to
        // press the nearest-named node into service.
        const targetProto = findExact(targetNodeName, nodePrototypes);
        if (!targetProto) {
            const near = nearMisses(targetNodeName, nodePrototypes);
            const hint = near.length > 0
                ? ` Similarly-named existing nodes: ${near.map((n) => `"${n}"`).join(', ')} — use one of those ONLY if it genuinely means the same category, by passing its exact name.`
                : '';
            throw new Error(
                `No node named exactly "${targetNodeName}" exists. Create it first with createNode, then add it to the chain.${hint}`
            );
        }

        // relativeTo is exact-only for the same reason: a loose hit here doesn't just
        // mis-order the chain, it can splice that unrelated node onto the chain too
        // (see addToAbstractionChain's "relative node not found" branch).
        let insertRelativeToNodeId = null;
        if (relativeTo) {
            const relativeProto = findExact(relativeTo, nodePrototypes);
            if (!relativeProto) {
                throw new Error(
                    `No node named exactly "${relativeTo}" exists, so it can't be used as relativeTo.` +
                    (chainMembers.length > 0
                        ? ` Nodes currently on the "${dimension}" chain of "${ownerProto.name}": ${chainMembers.map((p) => `"${p.name}"`).join(', ')}.`
                        : ` The "${dimension}" chain of "${ownerProto.name}" is empty — omit relativeTo for the first level.`)
                );
            }
            insertRelativeToNodeId = relativeProto.id;
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

        // Exact-only as well: removal names a specific chain member, and the loose
        // fallback could name a different node than the one the model meant.
        const targetProto = findExact(targetNodeName, nodePrototypes);
        if (!targetProto) {
            throw new Error(
                `No node named exactly "${targetNodeName}" exists.` +
                (chainMembers.length > 0
                    ? ` Nodes currently on the "${dimension}" chain of "${ownerProto.name}": ${chainMembers.map((p) => `"${p.name}"`).join(', ')}.`
                    : '')
            );
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
