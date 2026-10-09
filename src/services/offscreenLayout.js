import useGraphStore from '../store/graphStore.js';
import { applyLayout, FORCE_LAYOUT_DEFAULTS } from './graphLayoutService.js';
import { resolveEdgeLabelFontSize } from './layoutGeometry.js';
import { getNodeDimensions } from '../utils.js';
import useImageCache from './imageCache.js';
import { snapPositionToGrid } from '../utils/canvas/geometryUtils.js';
import { withEmptyGroupPlaceholders } from './groupLayout.js';

/**
 * Compute and persist a force-directed layout for any graph, active or not.
 * Uses estimated node dimensions (no DOM access required). The 2000×2000
 * virtual canvas is a floor — the layout engine grows the box to fit the
 * graph's content, so the result is intrinsic to the data rather than
 * molded by a fixed container. Positions are written directly to the store.
 */
export function applyOffscreenLayout(graphId) {
  const st = useGraphStore.getState();
  const updates = computeOffscreenLayout(graphId, st);
  if (!updates) return;
  st.updateMultipleNodeInstancePositions(graphId, updates, {
    finalize: true, source: 'auto-layout', algorithm: 'force-directed', historyLabel: 'Auto layout'
  });
}

/**
 * Lay out webs of a universe state that isn't in the store yet (an import
 * about to be merged), writing positions straight onto its instances. The
 * store's layout and text settings still apply. One store update per web is
 * what made laying out thousands of small webs slow, and this makes none.
 *
 * @param {Object} state - a deserialized universe state (Maps of graphs, prototypes, edges)
 * @param {string[]} graphIds - the webs to lay out
 * @param {Object} [options]
 * @param {Function} [options.onProgress] - (done, total), every `yieldEvery` webs
 * @param {number} [options.yieldEvery=50] - webs between yields to the UI
 * @returns {Promise<number>} how many webs were laid out (or had nothing to place)
 */
export async function layOutStateWebs(state, graphIds, { onProgress = null, yieldEvery = 50 } = {}) {
  const st = useGraphStore.getState();
  const view = {
    ...st,
    graphs: state.graphs,
    nodePrototypes: state.nodePrototypes,
    edges: state.edges || new Map(),
    edgePrototypes: state.edgePrototypes || new Map(),
  };
  let laidOut = 0;
  for (let i = 0; i < graphIds.length; i++) {
    const graph = state.graphs.get(graphIds[i]);
    try {
      const updates = computeOffscreenLayout(graphIds[i], view);
      if (updates && graph?.instances) {
        for (const { instanceId, x, y } of updates) {
          const instance = graph.instances.get(instanceId);
          if (instance) { instance.x = x; instance.y = y; }
        }
      }
      laidOut++;
    } catch (e) {
      console.warn('[offscreenLayout] Layout failed for', graphIds[i], e);
    }
    if (i % yieldEvery === yieldEvery - 1) {
      onProgress?.(i + 1, graphIds.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return laidOut;
}

/**
 * The layout applyOffscreenLayout would write, as instance position updates,
 * or null when the web has nothing to place.
 *
 * @param {string} graphId
 * @param {Object} st - store state, or a view of one (graphs, nodePrototypes, edges, settings)
 */
export function computeOffscreenLayout(graphId, st) {
  const graph = st.graphs.get(graphId);
  if (!graph) return null;

  const instances = Array.from(graph.instances?.values() || []);
  if (instances.length === 0) return null;

  const nodeSpacing = FORCE_LAYOUT_DEFAULTS.nodeSpacing || 140;

  let layoutNodes = instances.map(inst => {
    const proto = st.nodePrototypes.get(inst.prototypeId);
    let labelWidth = nodeSpacing, labelHeight = nodeSpacing, imageHeight = 0;
    try {
      // sizeMul must ride along: a resized instance occupies a different
      // footprint, and omitting it here lays out an XL node as if it were
      // medium, so its neighbors get packed underneath it.
      // So must imageAspectRatio — it drives node height, so omitting it lays a
      // graph out against square nodes that then render tall or short. An
      // auto-enriched prototype carries no thumbnailSrc of its own, so fall back
      // to the image cache the same way NodeCanvas's hydration does.
      const cached = useImageCache.getState().getImage(inst.prototypeId);
      const useCached = cached && !proto?.thumbnailSrc;
      const dims = getNodeDimensions({
        name: proto?.name || '',
        thumbnailSrc: useCached ? cached.thumbnailSrc : proto?.thumbnailSrc,
        imageAspectRatio: useCached ? cached.imageAspectRatio : proto?.imageAspectRatio,
        sizeMul: inst.sizeMul,
      }, false, null);
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
      // id retained for Lombardi's per-edge tangent fan (see lombardiEdgeKey).
      // directionality as a plain array — topology detection orients trees by
      // the arrow, not by the order the connection happened to be drawn in.
      return {
        id: e.id,
        sourceId: e.sourceId,
        destinationId: e.destinationId,
        name: connName,
        directionality: { arrowsToward: [...(e.directionality?.arrowsToward || [])] }
      };
    });

  // Memberless node-groups get a synthetic body so their shells travel with the
  // layout rather than stranding at their last dragged position — see
  // withEmptyGroupPlaceholders.
  const augmented = withEmptyGroupPlaceholders(
    layoutNodes,
    Array.from(graph.groups?.values() || []),
    (anchorId) => {
      const node = layoutNodes.find(n => n.id === anchorId);
      return node ? { width: node.width, height: node.height } : null;
    }
  );
  layoutNodes = augmented.nodes;
  const groups = augmented.groups;

  // Resolve the real rendered label font so labeled edges reserve the space
  // the canvas actually draws (NodeCanvas base × user text settings)
  const edgeLabelFontSize = resolveEdgeLabelFontSize(st.textSettings, st.connectionLabelSize);
  // Same for a group's title tab, which NodeCanvas draws at
  // 45 × fontSize × nodeScale (see groupLabelFontSize in its group render).
  const groupLabelScale = st.textSettings?.nodeScale ?? 1.0;
  const groupLabelFontSize = 45 * (st.textSettings?.fontSize ?? 1.0) * groupLabelScale;
  // Member padding inside a group rect is derived from the grid, so the solver
  // needs the real value or it enforces against a rect narrower than the drawn
  // one. Only the snapping below used to read this.
  const gridSize = st.gridSettings?.size || 200;

  // Honor the user's chosen layout algorithm here too — otherwise definition
  // graphs built offscreen (AI generation, auto-created definitions) would
  // always come back force-directed regardless of the setting.
  const algorithm = st.autoLayoutSettings?.groupLayoutAlgorithm || 'best';

  let updates = applyLayout(layoutNodes, layoutEdges, algorithm, {
    width: 2000,
    height: 2000,
    padding: 300,
    useExistingPositions: false,
    groups,
    edgeLabelFontSize,
    groupLabelFontSize,
    groupLabelScale,
    gridSize,
    // Lombardi draws arcs, which changes both which layout fits a shape and how
    // much room each edge needs. The conditional dispatcher reads these.
    routingStyle: st.autoLayoutSettings?.routingStyle || 'straight',
    lombardiCurvature: st.autoLayoutSettings?.lombardiCurvature ?? 1.0,
  });

  if (!updates || updates.length === 0) return null;

  // Recenter so the bounding box center lands at (0, 0) — the canvas center
  // (NodeCanvas world coordinates span ±50000 around the origin)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  updates.forEach(u => {
    if (u.x < minX) minX = u.x;
    if (u.y < minY) minY = u.y;
    if (u.x > maxX) maxX = u.x;
    if (u.y > maxY) maxY = u.y;
  });
  if (Number.isFinite(minX)) {
    const shiftX = 0 - (minX + maxX) / 2;
    const shiftY = 0 - (minY + maxY) / 2;
    updates = updates.map(u => ({ ...u, x: Math.round(u.x + shiftX), y: Math.round(u.y + shiftY) }));
  }

  // Grid snapping (same resolution as interactive auto-layout): snap when the
  // user's preference is 'always', or 'if-enabled' and the grid isn't off.
  const gridMode = st.gridSettings?.mode || 'off';
  const snapMode = st.gridSettings?.snapMode || 'if-enabled';
  const shouldSnap = snapMode === 'always' || (snapMode === 'if-enabled' && gridMode !== 'off');
  if (shouldSnap && gridSize > 0) {
    const dimsById = new Map(layoutNodes.map(n => [n.id, { w: n.width, h: n.height }]));
    updates = updates.map(u => {
      const dims = dimsById.get(u.instanceId) || { w: 0, h: 0 };
      const snapped = snapPositionToGrid(u.x, u.y, dims.w, dims.h, gridSize);
      return { ...u, x: Math.round(snapped.x), y: Math.round(snapped.y) };
    });
  }

  return updates;
}
