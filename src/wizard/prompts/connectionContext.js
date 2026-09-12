/**
 * Everything an ask about a Connection needs to know before it can say anything.
 *
 * Split out of buildWizardConnectionPrompt so the intents that ASK about a
 * Connection ("explain this", "is there anything else between these two?") see
 * exactly the same picture as the one that CHANGES it. Two intents disagreeing
 * about what is on the canvas is a bug waiting to be written.
 */
import useGraphStore from '../../store/graphStore.js';

export function connectionContext(edges) {
  const st = useGraphStore.getState();
  const graphs = st.graphs;
  const nodePrototypesMap = st.nodePrototypes;
  const activeId = st.activeGraphId;
  const activeGraph = activeId ? graphs.get(activeId) : null;
  const activeGraphName = activeGraph?.name || 'the active graph';
  const instances = activeGraph?.instances;

  const resolveTypeForEdge = (edge) => {
    if (edge?.definitionNodeIds && edge.definitionNodeIds.length > 0) {
      const def = nodePrototypesMap.get(edge.definitionNodeIds[0]);
      return {
        id: edge.definitionNodeIds[0],
        name: def?.name || 'Connection',
        isDefault: false,
        source: 'definitionNodeIds'
      };
    }
    if (edge?.typeNodeId) {
      const proto = nodePrototypesMap.get(edge.typeNodeId);
      return {
        id: edge.typeNodeId,
        name: proto?.name || 'Connection',
        isDefault: edge.typeNodeId === 'base-connection-prototype',
        source: 'typeNodeId'
      };
    }
    return { id: 'base-connection-prototype', name: 'Connection', isDefault: true, source: 'fallback' };
  };

  const nodeLabelForInstance = (instId) => {
    if (!instances) return `instance ${instId}`;
    const inst = instances.get(instId);
    if (!inst) return `instance ${instId}`;
    const proto = nodePrototypesMap.get(inst.prototypeId);
    return proto?.name || inst.name || 'Node';
  };

  const nodeContextForInstance = (instId) => {
    if (!instances) return null;
    const inst = instances.get(instId);
    if (!inst) return null;
    const proto = nodePrototypesMap.get(inst.prototypeId);
    if (!proto) return null;
    const typeProto = proto.typeNodeId ? nodePrototypesMap.get(proto.typeNodeId) : null;
    return {
      name: proto.name || 'Node',
      description: (proto.description || '').trim(),
      typeName: typeProto?.name || null
    };
  };

  // Connection prototypes already used in the active graph
  const activeGraphTypeIds = new Set();
  if (activeGraph?.edges) {
    activeGraph.edges.forEach((edge) => {
      const t = resolveTypeForEdge(edge);
      if (t.id) activeGraphTypeIds.add(t.id);
    });
  }
  const activeGraphConnectionTypes = Array.from(activeGraphTypeIds)
    .map((id) => {
      const proto = nodePrototypesMap.get(id);
      return proto?.name ? `"${proto.name}"` : null;
    })
    .filter(Boolean);

  // All connection prototypes used anywhere in the project
  const allTypeIds = new Set();
  graphs.forEach((g) => {
    g?.edges?.forEach((edge) => {
      const t = resolveTypeForEdge(edge);
      if (t.id) allTypeIds.add(t.id);
    });
  });
  const allConnectionTypes = Array.from(allTypeIds)
    .map((id) => {
      const proto = nodePrototypesMap.get(id);
      if (!proto) return null;
      const desc = proto.description ? ` — ${proto.description.slice(0, 120)}` : '';
      return `"${proto.name}"${desc}`;
    })
    .filter(Boolean);

  // Sibling connections between the same endpoint pairs (across both directions) in active graph
  const targetEdgeIds = new Set(edges.map((e) => e.id));
  const pairKey = (a, b) => [a, b].sort().join('::');
  const targetPairs = new Set(
    edges.map((e) => pairKey(e.sourceId, e.destinationId || e.targetId))
  );
  const siblings = [];
  if (activeGraph?.edges) {
    activeGraph.edges.forEach((edge) => {
      if (targetEdgeIds.has(edge.id)) return;
      const k = pairKey(edge.sourceId, edge.destinationId || edge.targetId);
      if (!targetPairs.has(k)) return;
      const t = resolveTypeForEdge(edge);
      siblings.push(
        `- "${nodeLabelForInstance(edge.sourceId)}" --[${t.name}${t.isDefault ? ' (default)' : ''}]--> "${nodeLabelForInstance(edge.destinationId || edge.targetId)}"`
      );
    });
  }

  const edgeLines = edges.map((edge, idx) => {
    const t = resolveTypeForEdge(edge);
    const sourceName = nodeLabelForInstance(edge.sourceId);
    const targetName = nodeLabelForInstance(edge.destinationId || edge.targetId);
    const arrowsToward = edge.directionality?.arrowsToward;
    let dir = 'undirected';
    if (arrowsToward && typeof arrowsToward.has === 'function') {
      const toSource = arrowsToward.has(edge.sourceId);
      const toTarget = arrowsToward.has(edge.destinationId || edge.targetId);
      if (toSource && toTarget) dir = 'bidirectional';
      else if (toTarget) dir = 'source → target';
      else if (toSource) dir = 'target → source';
    }
    return `${idx + 1}. "${sourceName}" --[${t.name}${t.isDefault ? ' (default Connection — undefined type)' : ''}]--> "${targetName}" (${dir})`;
  });

  return {
    activeGraph,
    activeGraphName,
    nodePrototypesMap,
    resolveTypeForEdge,
    nodeLabelForInstance,
    nodeContextForInstance,
    activeGraphConnectionTypes,
    allConnectionTypes,
    siblings,
    edgeLines
  };
}
