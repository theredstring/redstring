/**
 * readGraph - Return the full active graph as a clean LLM-readable snapshot.
 *
 * Returns all nodes (with name, description, color, id) and all edges
 * (with sourceName, targetName, type, id), plus groups. This is the
 * recommended first action before auditing or editing a graph.
 */

export async function readGraph(args, graphState) {
    const { nodePrototypes = [], graphs = [], edges = [], activeGraphId } = graphState;

    if (!activeGraphId) {
        return { error: 'No active graph. Create or open a graph first.' };
    }

    const activeGraph = graphs.find(g => g.id === activeGraphId);
    if (!activeGraph) {
        return { error: `Active graph "${activeGraphId}" not found in state.` };
    }

    // --- Build node name/desc/color lookup AND a general prototype map ---------
    const nodeNameById = new Map();
    const nodeDescById = new Map();
    const nodeColorById = new Map();
    // protoMap is used to resolve definitionNodeIds on edges
    const protoMap = new Map();

    for (const proto of nodePrototypes) {
        if (proto.id) {
            nodeNameById.set(proto.id, proto.name || '');
            nodeDescById.set(proto.id, proto.description || '');
            nodeColorById.set(proto.id, proto.color || '');
            protoMap.set(proto.id, proto);
        }
    }

    // Pull instances from active graph — instance name overrides prototype name
    const instances = Array.isArray(activeGraph.instances)
        ? activeGraph.instances
        : activeGraph.instances instanceof Map
            ? Array.from(activeGraph.instances.values())
            : Object.values(activeGraph.instances || {});

    for (const inst of instances) {
        if (inst.id) {
            const protoName = nodeNameById.get(inst.prototypeId) || '';
            nodeNameById.set(inst.id, inst.name || protoName || '');
            // Carry description/color from prototype if instance doesn't override
            if (inst.description) nodeDescById.set(inst.id, inst.description);
            else if (inst.prototypeId) nodeDescById.set(inst.id, nodeDescById.get(inst.prototypeId) || '');
            if (inst.color) nodeColorById.set(inst.id, inst.color);
            else if (inst.prototypeId) nodeColorById.set(inst.id, nodeColorById.get(inst.prototypeId) || '');
        }
    }

    // --- Nodes output ---------------------------------------------------------
    const nodeList = instances.map(inst => {
        const name = nodeNameById.get(inst.id) || inst.id;
        const description = nodeDescById.get(inst.id) || '';
        const color = nodeColorById.get(inst.id) || '';
        return { id: inst.id, name, description, color };
    });

    // --- Edges output ---------------------------------------------------------
    const edgeIds = new Set(activeGraph.edgeIds || []);
    const graphEdges = edges.filter(e => edgeIds.has(e.id) || edgeIds.has(e.edgeId));

    const edgeList = graphEdges.map(e => {
        const sourceId = e.sourceId || e.source;
        const targetId = e.destinationId || e.targetId || e.target;

        // Resolve connection type from the definition node prototype (most accurate)
        // definitionNodeIds[0] points to the node prototype whose name IS the connection type
        let type = 'relates to';
        if (Array.isArray(e.definitionNodeIds) && e.definitionNodeIds.length > 0) {
            const defProto = protoMap.get(e.definitionNodeIds[0]);
            if (defProto?.name) type = defProto.name;
        } else if (e.type) {
            type = e.type;
        } else if (e.connectionType) {
            type = e.connectionType;
        }

        return {
            id: e.id,
            sourceName: nodeNameById.get(sourceId) || sourceId || '?',
            targetName: nodeNameById.get(targetId) || targetId || '?',
            type,
            sourceId,
            targetId,
        };
    });

    // --- Groups output --------------------------------------------------------
    const groupList = (activeGraph.groups || []).map(g => ({
        id: g.id,
        name: g.name || 'Unnamed',
        color: g.color || '',
        memberCount: (g.memberInstanceIds || g.members || []).length,
        members: (g.memberInstanceIds || g.members || [])
            .map(mid => nodeNameById.get(mid) || mid)
            .filter(Boolean),
    }));

    // --- Size warning for very large graphs -----------------------------------
    const LARGE_NODE_THRESHOLD = 100;
    const LARGE_EDGE_THRESHOLD = 150;
    const isLarge = nodeList.length > LARGE_NODE_THRESHOLD || edgeList.length > LARGE_EDGE_THRESHOLD;

    const warning = isLarge
        ? `Large graph (${nodeList.length} nodes, ${edgeList.length} edges). Consider using searchNodes or searchConnections with a query to narrow focus.`
        : null;

    return {
        graphName: activeGraph.name,
        graphId: activeGraphId,
        nodeCount: nodeList.length,
        edgeCount: edgeList.length,
        groupCount: groupList.length,
        nodes: nodeList,
        edges: edgeList,
        groups: groupList,
        ...(warning ? { warning } : {}),
        summary: `Graph "${activeGraph.name}": ${nodeList.length} node(s), ${edgeList.length} connection(s), ${groupList.length} group(s).`,
    };
}
