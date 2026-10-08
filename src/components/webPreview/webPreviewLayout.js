/**
 * A web laid out for a preview, the way the canvas lays it out: node boxes,
 * groups (services/groupLayout.js), Thing-group anchors as their title pills,
 * and every connection's resting geometry in the user's connection style
 * (utils/canvas/settledConnection.js). Drawn by InnerNetwork (a node's
 * decomposition preview on the canvas, and through WebCard a definition in the
 * right panel and an expanded Open Webs row); the canvas parity test checks it
 * against the canvas.
 *
 * Everything is in world units; each preview fits it into its own box.
 */
import { getNodeDimensions } from '../../utils.js';
import { measureTextWidth } from '../../services/textMeasurement.js';
import {
  GROUP_LAYOUT_CONSTANTS,
  computeGroupLayout,
  buildGroupsByMemberIdIndex,
  buildChildGroupIdsIndex,
  computeGroupDepths,
  buildEdgeZSlotIndex,
  edgeZSlotFor,
} from '../../services/groupLayout.js';
import {
  anchorInfoFromGroupLayout,
  buildConnectionScene,
  settledConnectionGeometry,
} from '../../utils/canvas/settledConnection.js';

/**
 * Nodes and groups: boxes, group shapes, anchors, bounds.
 *
 * @returns {null | {
 *   dimsById: Map, boxes: Map, groupShapes: Array, anchors: Map, hiddenIds: Set,
 *   edgeSlots: Map, topSlot: number, groupFontSize: number, groupLabelScale: number,
 *   bounds: { minX, minY, maxX, maxY },
 * }}
 */
export function layoutWebPreview({ nodes, groups, nodePrototypes, textSettings, gridSize }) {
  if (!nodes?.length) return null;

  const dimsById = new Map();
  const boxes = new Map();
  const layoutNodes = new Map();
  for (const node of nodes) {
    const dims = getNodeDimensions(node, false, null);
    dimsById.set(node.id, dims);
    boxes.set(node.id, { x: node.x, y: node.y, w: dims.currentWidth, h: dims.currentHeight });
    layoutNodes.set(node.id, { id: node.id, x: node.x, y: node.y });
  }

  // Groups, laid out as the canvas lays them out (canvas/groups/groupLayouts.js).
  const groupsById = groups instanceof Map ? groups : new Map(Object.entries(groups || {}));
  const groupLabelScale = textSettings?.nodeScale ?? 1.0;
  const groupFontSize = 45 * (textSettings?.fontSize ?? 1.0) * groupLabelScale;
  const groupShapes = [];
  const anchors = new Map(); // anchor instance id -> the canvas's anchorPositions record
  let edgeSlots = new Map();
  if (groupsById.size > 0) {
    const groupsByMemberId = buildGroupsByMemberIdIndex(groupsById);
    const childGroupIdsByGroupId = buildChildGroupIdsIndex(groupsById, groupsByMemberId);
    const depths = computeGroupDepths(groupsById, groupsByMemberId, childGroupIdsByGroupId);
    edgeSlots = buildEdgeZSlotIndex(groupsById, depths);
    const labelFont = `bold ${groupFontSize}px "EmOne", sans-serif`;
    // A Thing-group is named and coloured by its Thing; resolve the name into
    // the map every nested layout call reads, as the canvas does.
    const namedGroups = new Map();
    for (const [id, group] of groupsById) {
      const proto = group.linkedNodePrototypeId ? nodePrototypes?.get(group.linkedNodePrototypeId) : null;
      const name = proto?.name || group.name || 'Group';
      namedGroups.set(id, name === group.name ? group : { ...group, name });
    }
    const context = {
      nodesById: layoutNodes,
      dimsById,
      groupsById: namedGroups,
      groupsByMemberId,
      childGroupIdsByGroupId,
      gridSize,
      measureLabelWidth: (text) => measureTextWidth(text || 'Group', labelFont),
      labelScale: groupLabelScale,
      labelFontSize: groupFontSize,
      _cache: new Map(),
    };
    for (const group of namedGroups.values()) {
      if (!group.memberInstanceIds?.length && !group.linkedNodePrototypeId) continue;
      const result = computeGroupLayout(group, context);
      if (!result.ok) continue;
      const proto = group.linkedNodePrototypeId ? nodePrototypes?.get(group.linkedNodePrototypeId) : null;
      groupShapes.push({
        ...result,
        id: group.id,
        name: group.name,
        depth: depths.get(group.id) ?? 0,
        color: proto?.color || group.color || '#8B0000',
        labelScale: groupLabelScale,
      });
      if (result.isNodeGroup && group.anchorInstanceId) {
        // On the canvas the anchor IS the title: connections meet the pill and
        // are cut along the shell.
        anchors.set(group.anchorInstanceId, anchorInfoFromGroupLayout(result, GROUP_LAYOUT_CONSTANTS.nodeGroupCornerRadius));
      }
    }
    // Shallowest first, so nested shells paint above their parents.
    groupShapes.sort((a, b) => a.depth - b.depth);
  }

  // Bounds: every drawn node plus every group's whole shell.
  const hiddenIds = new Set(anchors.keys());
  for (const node of nodes) if (node.isGroupAnchor) hiddenIds.add(node.id);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y, w, h) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  };
  for (const [id, box] of boxes) if (!hiddenIds.has(id)) grow(box.x, box.y, box.w, box.h);
  for (const shape of groupShapes) grow(shape.visualBounds.x, shape.visualBounds.y, shape.visualBounds.w, shape.visualBounds.h);
  if (!isFinite(minX)) return null;

  const topSlot = groupShapes.reduce((m, g) => Math.max(m, g.depth), -1) + 1;
  return {
    dimsById, boxes, groupShapes, anchors, hiddenIds, edgeSlots, topSlot,
    groupFontSize, groupLabelScale, bounds: { minX, minY, maxX, maxY },
  };
}

/**
 * Every connection's resting geometry, with the z-slot it paints in.
 *
 * @param {object} layout - layoutWebPreview's result.
 * @param {Array} nodes
 * @param {Array} edges
 * @param {object} settings - connectionRoutingSettings(state).
 * @param {number} zoom - Screen px per world unit in the preview.
 * @returns {Array<{ edge, geometry, slot }>}
 */
export function layoutPreviewConnections(layout, nodes, edges, settings, zoom) {
  if (!layout || !edges?.length) return [];
  const drawable = edges.filter(e => e?.sourceId && e?.destinationId);
  const scene = buildConnectionScene({
    nodes, edges: drawable, dimsById: layout.dimsById, anchors: layout.anchors, settings, zoom,
  });
  const connections = [];
  for (const edge of drawable) {
    const geometry = settledConnectionGeometry(edge, scene);
    if (!geometry) continue;
    connections.push({
      edge,
      geometry,
      slot: layout.groupShapes.length ? edgeZSlotFor(edge, layout.edgeSlots, layout.topSlot) : layout.topSlot,
    });
  }
  return connections;
}
