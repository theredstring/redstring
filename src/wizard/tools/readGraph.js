import { resolveGraphId, describeGraphAmbiguity } from './resolveGraphId.js';

/**
 * readGraph - Return the full active graph as a clean LLM-readable snapshot.
 *
 * Returns all nodes (with name, description, color, id) and all edges
 * (with sourceName, targetName, type, id), plus groups. This is the
 * recommended first action before auditing or editing a graph.
 */

export async function readGraph(args, graphState) {
    const { nodePrototypes = [], graphs = [], edges = [], activeGraphId, openGraphIds = [] } = graphState;

    let targetGraphId = resolveGraphId(args.targetGraphId, graphs, { activeGraphId, openGraphIds }) || activeGraphId;
    // Same-named graphs accumulate across sessions. Silently picking one and
    // returning its contents as though it were the obvious answer is how the
    // model ends up confidently reading a graph the user has never seen.
    const ambiguityNote = describeGraphAmbiguity(args.targetGraphId, graphs, targetGraphId);

    if (!targetGraphId) {
        return { error: 'No graph specified. Create or open a graph first.' };
    }

    const activeGraph = graphs.find(g => g.id === targetGraphId);
    if (!activeGraph) {
        return { error: `Graph "${targetGraphId}" not found in state.` };
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

        const proto = protoMap.get(inst.prototypeId);
        let type = null;
        if (proto?.typeNodeId) {
            type = nodeNameById.get(proto.typeNodeId) || protoMap.get(proto.typeNodeId)?.name || proto.typeNodeId;
        }

        let abstractionChainsSummary = undefined;
        if (proto?.abstractionChains && Object.keys(proto.abstractionChains).length > 0) {
            abstractionChainsSummary = Object.entries(proto.abstractionChains)
                .map(([dim, chain]) => `${dim} (${Array.isArray(chain) ? chain.length : 0} nodes)`)
                .join(', ');
        }

        const nodeObj = { id: inst.id, name, description, color };
        if (type) nodeObj.type = type;
        if (abstractionChainsSummary) nodeObj.abstractionChains = abstractionChainsSummary;
        return nodeObj;
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

        const sourceName = nodeNameById.get(sourceId) || sourceId || '?';
        const targetName = nodeNameById.get(targetId) || targetId || '?';

        return {
            id: e.id,
            triplet: `${sourceName} --[${type}]--> ${targetName}`,
            sourceName,
            targetName,
            type,
            sourceId,
            targetId,
        };
    });

    // --- Groups output --------------------------------------------------------
    const groupList = (activeGraph.groups || []).map(g => {
        const isThingGroup = !!g.linkedNodePrototypeId;
        const linkedThingName = isThingGroup
            ? (protoMap.get(g.linkedNodePrototypeId)?.name || 'Unknown Thing')
            : null;

        return {
            id: g.id,
            name: g.name || 'Unnamed',
            color: g.color || '',
            memberCount: (g.memberInstanceIds || g.members || []).length,
            members: (g.memberInstanceIds || g.members || [])
                .map(mid => nodeNameById.get(mid) || mid)
                .filter(Boolean),
            isThingGroup,
            linkedThingName,
        };
    });

    // --- Size warning for very large graphs -----------------------------------
    const LARGE_NODE_THRESHOLD = 100;
    const LARGE_EDGE_THRESHOLD = 150;
    const isLarge = nodeList.length > LARGE_NODE_THRESHOLD || edgeList.length > LARGE_EDGE_THRESHOLD;

    const warning = isLarge
        ? `Large graph (${nodeList.length} nodes, ${edgeList.length} edges). Consider using searchNodes or searchConnections with a query to narrow focus.`
        : null;

    // Reading the active graph is almost always redundant: the context header
    // already carries its nodes, types, descriptions and connection triplets, and
    // it is rebuilt from live state every iteration — so it is never staler than
    // this result. The data is still returned (the model may want the IDs), but
    // saying so is what stops the loop burning an iteration per re-read.
    const isActiveGraph = targetGraphId === activeGraphId;
    const redundancyNote = isActiveGraph
        ? 'This is the active graph. Its contents are already in your context header, '
        + 'refreshed every iteration — you do not need to call readGraph on it again. '
        + 'Use these IDs if you need them, then proceed with the actual work.'
        : null;

    return {
        graphName: activeGraph.name,
        graphId: targetGraphId,
        nodeCount: nodeList.length,
        edgeCount: edgeList.length,
        groupCount: groupList.length,
        nodes: nodeList,
        edges: edgeList,
        groups: groupList,
        ...(warning ? { warning } : {}),
        ...(redundancyNote ? { note: redundancyNote } : {}),
        ...(ambiguityNote ? { ambiguity: ambiguityNote } : {}),
        summary: `Graph "${activeGraph.name}": ${nodeList.length} node(s), ${edgeList.length} connection(s), ${groupList.length} group(s).`,
    };
}
