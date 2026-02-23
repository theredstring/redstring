/**
 * replaceEdges - Bulk-replace connections between existing nodes
 *
 * Finds existing edges between each source/target pair and updates their type
 * and directionality. If no existing edge is found, creates a new one.
 * This is the correct tool for "refine connections" workflows.
 */

/**
 * Convert string to Title Case
 */
function toTitleCase(str) {
    if (!str) return '';
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Generate a deterministic color from a name
 */
function generateConnectionColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 60%, 45%)`;
}

/**
 * Replace edges between existing nodes in bulk
 * @param {Object} args - { edges: [{ source, target, type, directionality? }] }
 * @param {Object} graphState - Current graph state
 * @param {string} cid - Conversation ID
 * @param {Function} ensureSchedulerStarted - Function to start scheduler
 * @returns {Promise<Object>} { action, replacements }
 */
export async function replaceEdges(args, graphState, cid, ensureSchedulerStarted) {
    const { edges = [] } = args;

    if (!edges || edges.length === 0) {
        throw new Error('At least one edge is required');
    }

    const { activeGraphId } = graphState;

    if (!activeGraphId) {
        throw new Error('No active graph. Please open or create a graph first.');
    }

    // Build edge specs with proper title casing and definition nodes
    const edgeSpecs = edges.map(e => {
        const typeName = e.type || '';
        const titleCaseName = toTitleCase(typeName);

        return {
            source: e.source,
            target: e.target,
            type: titleCaseName || 'Connection',
            directionality: e.directionality || 'unidirectional',
            definitionNode: titleCaseName ? {
                name: titleCaseName,
                color: generateConnectionColor(titleCaseName),
                description: ''
            } : null
        };
    });

    return {
        action: 'replaceEdges',
        graphId: activeGraphId,
        edgeCount: edgeSpecs.length,
        replacements: edgeSpecs
    };
}
