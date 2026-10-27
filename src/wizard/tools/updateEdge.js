import { resolveGraphId } from './resolveGraphId.js';
import { readWeb, resolvePlace, connectionsBetween } from './utils/webView.js';

// Every tool field is sent as required (see LLMClient makeAllRequired), so
// models fill the ones they aren't changing with "". A blank string is "not
// given", never "set to empty": treating it as an edit blanked descriptions
// the model only meant to leave alone.
const given = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/**
 * Update the properties of an existing edge.
 * @param {Object} args - { sourceName, targetName, type, directionality, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} Edge spec for UI application
 */
export async function updateEdge(args, graphState, cid, ensureSchedulerStarted) {
    const { sourceName, targetName, type, directionality, targetGraphId } = args;

    if (!sourceName || !targetName) {
        throw new Error('sourceName and targetName are required');
    }

    const { graphs = [], activeGraphId } = graphState;
    const graphId = resolveGraphId(targetGraphId, graphs, { activeGraphId }) || activeGraphId;

    if (!graphId) {
        throw new Error('No target graph specified and no active graph available.');
    }

    // The ends, and the connection, by the names the web was shown under (webView.js).
    const web = readWeb(graphState, graphId);
    const resolvedSource = (await resolvePlace(web, sourceName, 'updateEdge')).match;
    const resolvedTarget = (await resolvePlace(web, targetName, 'updateEdge')).match;
    const available = () => web.places.filter(p => !p.inFormula).map(p => p.name).filter(Boolean).slice(0, 8).join(', ');

    if (!resolvedSource) {
        throw new Error(`Source node "${sourceName}" not found in graph. Available nodes: ${available() || '(none)'}. Use readGraph to see all nodes.`);
    }
    if (!resolvedTarget) {
        throw new Error(`Target node "${targetName}" not found in graph. Available nodes: ${available() || '(none)'}. Use readGraph to see all nodes.`);
    }
    if (web.cover.internal({ sourceId: resolvedSource.instanceId, destinationId: resolvedTarget.instanceId })) {
        throw new Error(`"${resolvedSource.name}" and "${resolvedTarget.name}" are both inside a formula; the connection between them is one of its operations. Use the formula tool to rewrite it.`);
    }
    const matches = connectionsBetween(web, resolvedSource.name, resolvedTarget.name);
    const edge = matches.length === 1 ? matches[0] : null;

    const updates = {};
    if (given(type)) updates.type = type;
    if (given(directionality)) updates.directionality = directionality;

    return {
        action: 'updateEdge',
        graphId,
        // The store falls back to these names when an id made this ask is only predicted.
        sourceName: resolvedSource.thing || resolvedSource.name,
        targetName: resolvedTarget.thing || resolvedTarget.name,
        sourceInstanceId: edge ? edge.sourceId : resolvedSource.instanceId,
        targetInstanceId: edge ? (edge.destinationId || edge.targetId) : resolvedTarget.instanceId,
        ...(edge ? { edgeId: edge.id } : {}),
        updates,
        updated: true
    };
}
