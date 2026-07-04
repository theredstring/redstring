import useGraphStore from '../store/graphStore.js';
import { applyLayout, FORCE_LAYOUT_DEFAULTS } from './graphLayoutService.js';
import { getNodeDimensions } from '../utils.js';

/**
 * Compute and persist a force-directed layout for any graph, active or not.
 * Uses estimated node dimensions (no DOM access required) and a fixed
 * 2000×2000 virtual canvas. Positions are written directly to the store.
 */
export function applyOffscreenLayout(graphId) {
  const st = useGraphStore.getState();
  const graph = st.graphs.get(graphId);
  if (!graph) return;

  const instances = Array.from(graph.instances?.values() || []);
  if (instances.length === 0) return;

  const nodeSpacing = FORCE_LAYOUT_DEFAULTS.nodeSpacing || 140;

  const layoutNodes = instances.map(inst => {
    const proto = st.nodePrototypes.get(inst.prototypeId);
    let labelWidth = nodeSpacing, labelHeight = nodeSpacing, imageHeight = 0;
    try {
      const dims = getNodeDimensions({ name: proto?.name || '', thumbnailSrc: proto?.thumbnailSrc }, false, null);
      if (dims) {
        labelWidth = dims.currentWidth ?? nodeSpacing;
        labelHeight = dims.currentHeight ?? nodeSpacing;
        imageHeight = dims.calculatedImageHeight ?? 0;
      }
    } catch { /* canvas/OffscreenCanvas unavailable (Node.js) — use estimated size */ }
    return {
      id: inst.id,
      prototypeId: inst.prototypeId,
      x: typeof inst.x === 'number' ? inst.x : 0,
      y: typeof inst.y === 'number' ? inst.y : 0,
      width: labelWidth,
      height: labelHeight,
      labelWidth,
      labelHeight,
      imageHeight,
      nodeSize: Math.max(labelWidth, labelHeight, nodeSpacing)
    };
  });

  const layoutEdges = (graph.edgeIds || [])
    .map(eId => st.edges.get(eId))
    .filter(e => e && e.sourceId && e.destinationId)
    .map(e => {
      let connName = e.connectionName || '';
      if (!connName && e.definitionNodeIds?.length > 0) {
        const defNode = st.nodePrototypes.get(e.definitionNodeIds[0]);
        if (defNode?.name) connName = defNode.name;
      }
      if (!connName && e.typeNodeId) {
        const proto = (st.edgePrototypes || new Map()).get(e.typeNodeId);
        if (proto?.name) connName = proto.name;
      }
      return { sourceId: e.sourceId, destinationId: e.destinationId, name: connName };
    });

  const groups = Array.from(graph.groups?.values() || []);

  let updates = applyLayout(layoutNodes, layoutEdges, 'force-directed', {
    width: 2000,
    height: 2000,
    padding: 300,
    useExistingPositions: false,
    groups,
  });

  if (!updates || updates.length === 0) return;

  // Recenter so the bounding box center lands at (1000, 1000)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  updates.forEach(u => {
    if (u.x < minX) minX = u.x;
    if (u.y < minY) minY = u.y;
    if (u.x > maxX) maxX = u.x;
    if (u.y > maxY) maxY = u.y;
  });
  if (Number.isFinite(minX)) {
    const shiftX = 1000 - (minX + maxX) / 2;
    const shiftY = 1000 - (minY + maxY) / 2;
    updates = updates.map(u => ({ ...u, x: Math.round(u.x + shiftX), y: Math.round(u.y + shiftY) }));
  }

  st.updateMultipleNodeInstancePositions(graphId, updates, {
    finalize: true, source: 'auto-layout', algorithm: 'force-directed'
  });
}
