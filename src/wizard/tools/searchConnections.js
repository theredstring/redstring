import { resolveGraphId } from './resolveGraphId.js';
import { readWeb } from './utils/webView.js';

/**
 * searchConnections - Find connections/edges by type, node names, or general query
 *
 * Searches through all edges in the active graph, matching against
 * connection types, source/target node names, and descriptions.
 * Returns results ranked by relevance.
 */

export async function searchConnections(args, graphState, cid, ensureSchedulerStarted) {
    const { query } = args;

    const { nodePrototypes = [], graphs = [], activeGraphId } = graphState;

    const explicitWeb = args.targetGraphId != null && String(args.targetGraphId).trim() !== '';
    const targetGraphId = explicitWeb
        ? resolveGraphId(args.targetGraphId, graphs, { activeGraphId, openGraphIds: graphState.openGraphIds })
        : activeGraphId;
    if (explicitWeb && !graphs.some(g => g.id === targetGraphId)) {
        const available = graphs.map(g => g.name).filter(Boolean).slice(0, 8).join(', ');
        return {
            results: [],
            total: 0,
            message: `No web named or with id "${args.targetGraphId}". Webs: ${available || '(none)'}. Omit targetGraphId for the active web.`
        };
    }

    // protoMap used to resolve connection type from definitionNodeIds
    const protoMap = new Map();
    for (const proto of nodePrototypes) {
        if (proto.id) protoMap.set(proto.id, proto);
    }

    // The web's own connections, named as the context names them (webView.js):
    // an end kept in another web (a definition or formula opened in place) by
    // its name there, a formula's symbol as "Thing (in Formula)", and a
    // formula's operations not among them.
    const web = readWeb(graphState, targetGraphId);
    const activeEdges = web.connections;
    const endName = (id) => web.nameOfEnd(id);

    const totalEdges = activeEdges.length;
    const limit = typeof args.limit === 'number' ? args.limit : 100;
    const offset = typeof args.offset === 'number' ? args.offset : 0;

    if (!query || query.trim() === '') {
        const allFormatted = activeEdges.map(edge => {
            // Resolve type from definition node prototype first
            let type = 'relates to';
            if (Array.isArray(edge.definitionNodeIds) && edge.definitionNodeIds.length > 0) {
                const defProto = protoMap.get(edge.definitionNodeIds[0]);
                if (defProto?.name) type = defProto.name;
            } else if (edge.type) {
                type = edge.type;
            } else if (edge.connectionType) {
                type = edge.connectionType;
            }
            return {
                id: edge.id,
                type,
                sourceId: edge.sourceId,
                targetId: edge.destinationId || edge.targetId,
                sourceName: endName(edge.sourceId),
                targetName: endName(edge.destinationId || edge.targetId),
            };
        });
        const page = allFormatted.slice(offset, offset + limit);
        const hasMore = offset + limit < totalEdges;
        return {
            results: page,
            total: totalEdges,
            returned: page.length,
            offset,
            hasMore,
            message: hasMore
                ? `Showing connections ${offset + 1}–${offset + page.length} of ${totalEdges}. Use offset=${offset + limit} to see more.`
                : `Showing all ${page.length} connection(s) in the graph.`
        };
    }

    if (activeEdges.length === 0) {
        return { results: [], total: 0, message: 'No connections found in the current graph.' };
    }

    // Split query into individual words for flexible matching
    const queryLower = query.toLowerCase();
    const queryWords = queryLower
        .split(/\s+/)
        .filter(w => w.length > 1);

    // Score each edge by relevance
    const scored = activeEdges.map(edge => {
        const edgeType = (() => {
            if (Array.isArray(edge.definitionNodeIds) && edge.definitionNodeIds.length > 0) {
                return (protoMap.get(edge.definitionNodeIds[0])?.name || edge.type || edge.connectionType || '').toLowerCase();
            }
            return (edge.type || edge.connectionType || '').toLowerCase();
        })();
        const sourceName = endName(edge.sourceId).toLowerCase();
        const targetName = endName(edge.destinationId || edge.targetId).toLowerCase();
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
            type: (() => {
                if (Array.isArray(edge.definitionNodeIds) && edge.definitionNodeIds.length > 0) {
                    return protoMap.get(edge.definitionNodeIds[0])?.name || edge.type || edge.connectionType || 'relates to';
                }
                return edge.type || edge.connectionType || 'relates to';
            })(),
            sourceId: edge.sourceId,
            targetId: edge.destinationId || edge.targetId,
            sourceName: endName(edge.sourceId),
            targetName: endName(edge.destinationId || edge.targetId),
            score
        };
    });

    const totalMatched = scored.filter(e => e.score > 0).length;
    const results = scored
        .filter(e => e.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map(({ score, ...edge }) => edge);

    if (results.length === 0) {
        // If no word matches, try character-level fuzzy match as last resort
        const fuzzyResults = scored
            .map(edge => {
                const combined = `${edge.type} ${edge.sourceName} ${edge.targetName}`.toLowerCase();
                const similarity = jaccardSimilarity(queryLower, combined);
                return { ...edge, similarity };
            })
            .filter(e => e.similarity > 0.2)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 10)
            .map(({ similarity, score, ...edge }) => edge);

        if (fuzzyResults.length > 0) {
            return { results: fuzzyResults, total: totalEdges, message: `Found ${fuzzyResults.length} similar connection(s) (fuzzy match). Graph has ${totalEdges} connections total.` };
        }

        return { results: [], total: 0, message: `No connections matched "${query}". The graph has ${totalEdges} connection(s) total. Try omitting query to browse all connections.` };
    }

    const hasMore = totalMatched > results.length;
    return {
        results,
        total: totalEdges,
        matched: totalMatched,
        returned: results.length,
        hasMore,
        message: hasMore
            ? `Showing top ${results.length} of ${totalMatched} matching connection(s) for "${query}". Graph has ${totalEdges} connections total.`
            : `Found ${results.length} connection(s) matching "${query}". Graph has ${totalEdges} connections total.`
    };
}


/**
 * Simple Jaccard similarity between two strings (character bigram based)
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
