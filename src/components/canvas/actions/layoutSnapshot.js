/**
 * What the force-simulation tuner reads from the live canvas while it runs
 * (P2.06f): the nodes with their sizes, the connections with their names, and
 * the nodes being dragged. Moved verbatim from the useCanvasCommands call in
 * NodeCanvas, which passes the current render's values.
 */
import { getNodeDimensions } from '../../../utils.js';

export const layoutNodesOf = (hydratedNodes, baseDimsById) => hydratedNodes.map(n => {
  const dims = baseDimsById.get(n.id) || getNodeDimensions(n, false, null);
  return {
    id: n.id,
    x: n.x,
    y: n.y,
    name: n.name,
    width: dims?.currentWidth,
    height: dims?.currentHeight,
    imageHeight: dims?.calculatedImageHeight ?? 0
  };
});

export const layoutEdgesOf = (edges, nodePrototypesMap, edgePrototypesMap) => edges.map(e => {
  let connName = e.connectionName || '';
  if (!connName && e.definitionNodeIds?.length > 0) {
    const defNode = nodePrototypesMap.get(e.definitionNodeIds[0]);
    if (defNode?.name) connName = defNode.name;
  }
  if (!connName && e.typeNodeId) {
    const proto = edgePrototypesMap.get(e.typeNodeId);
    if (proto?.name) connName = proto.name;
  }
  return { sourceId: e.sourceId, destinationId: e.destinationId, name: connName };
});

export const draggedNodeIdsOf = (draggingNodeInfo) => {
  if (!draggingNodeInfo) return new Set();
  // Single node drag
  if (draggingNodeInfo.instanceId) return new Set([draggingNodeInfo.instanceId]);
  // Multi-select drag (primaryId + all selected)
  if (draggingNodeInfo.primaryId) return new Set([draggingNodeInfo.primaryId, ...Object.keys(draggingNodeInfo.relativeOffsets || {})]);
  // Group drag
  if (draggingNodeInfo.groupId && draggingNodeInfo.memberOffsets) {
    return new Set(draggingNodeInfo.memberOffsets.map(m => m.id));
  }
  return new Set();
};
