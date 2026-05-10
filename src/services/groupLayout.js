/**
 * Pure helper for computing the visual layout of a group (thing-group or
 * node-group). Used by both the static render in NodeCanvas.jsx and the
 * DOM-bypass drag updater in useNodeDrag.js so they share one source of truth.
 *
 * No React, no Zustand, no DOM access. Text measurement is injected via
 * `context.measureLabelWidth` so tests can stub it.
 *
 * Nesting handling: when a member instance also belongs to another node-group
 * in the same graph, the outer bbox folds in that nested group's
 * title-included `nodeGroupRect.y` rather than just the member's raw `n.y`.
 * Without this, the outer rect undershoots by ~labelHeight + 48px.
 */

export const GROUP_LAYOUT_CONSTANTS = Object.freeze({
  innerCanvasBorder: 32,
  titleToCanvasGap: 24,
  titlePaddingVertical: 12,
  titlePaddingHorizontal: 32,
  titleTopMargin: 24,
  titleBottomMargin: 24,
  cornerRadius: 12,
  nodeGroupCornerRadius: 24,
  strokeWidth: 2,
  fontSize: 36,
});

const FALLBACK_DIMS = { currentWidth: 200, currentHeight: 150 };
const EMPTY_SET = new Set();

const memberBoundaryPaddingFor = (gridSize) =>
  Math.max(24, Math.round((gridSize ?? 0) * 0.2));

function computeChildGroupIdsForGroup(group, groupsById, groupsByMemberId) {
  const memberIds = Array.isArray(group.memberInstanceIds) ? group.memberInstanceIds : [];
  if (memberIds.length === 0) return EMPTY_SET;
  const memberIdSet = new Set(memberIds);
  const childGroupIds = new Set();
  for (const memberId of memberIds) {
    const containingEntries = groupsByMemberId.get(memberId);
    if (!containingEntries) continue;
    for (const entry of containingEntries) {
      const otherGroupId = typeof entry === 'string' ? entry : entry?.groupId;
      if (!otherGroupId || otherGroupId === group.id) continue;
      if (childGroupIds.has(otherGroupId)) continue;
      const otherGroup = groupsById.get(otherGroupId);
      if (!otherGroup || !otherGroup.linkedNodePrototypeId) continue;
      const otherMembers = Array.isArray(otherGroup.memberInstanceIds) ? otherGroup.memberInstanceIds : [];
      if (otherMembers.length === 0 || otherMembers.length >= memberIds.length) continue;
      let isStrictSubset = true;
      for (const om of otherMembers) {
        if (!memberIdSet.has(om)) { isStrictSubset = false; break; }
      }
      if (isStrictSubset) childGroupIds.add(otherGroupId);
    }
  }
  return childGroupIds;
}

/**
 * Precompute the strict-subset child relationships for every group. The result
 * is suitable for caching and passing into `computeGroupLayout` via
 * `context.childGroupIdsByGroupId`. Recompute only when the structural shape
 * of the group set changes (member additions/removals, group create/delete).
 *
 * @param {Map<string, object>} groupsById
 * @param {Map<string, Array<{groupId: string} | string>>} groupsByMemberId
 * @returns {Map<string, Set<string>>}
 */
export function buildChildGroupIdsIndex(groupsById, groupsByMemberId) {
  const out = new Map();
  if (!groupsById || !groupsByMemberId) return out;
  for (const group of groupsById.values()) {
    out.set(group.id, computeChildGroupIdsForGroup(group, groupsById, groupsByMemberId));
  }
  return out;
}

const labelHeightConst = () => {
  const C = GROUP_LAYOUT_CONSTANTS;
  return Math.max(80, C.fontSize * 1.4 + C.titlePaddingVertical * 2);
};

const labelWidthFor = (text, measureLabelWidth) => {
  const C = GROUP_LAYOUT_CONSTANTS;
  const measured = measureLabelWidth(text);
  return Math.min(1000, Math.max(100, measured + C.titlePaddingHorizontal * 2 + C.strokeWidth * 2));
};

/**
 * @param {object} group
 * @param {object} context
 * @param {Map<string, {id: string, x: number, y: number}>} context.nodesById
 * @param {Map<string, {currentWidth: number, currentHeight: number}>} context.dimsById
 * @param {Map<string, object>} context.groupsById
 * @param {Map<string, Array<{groupId: string, memberInstanceIds?: string[]}> | string[]>} context.groupsByMemberId
 * @param {number} context.gridSize
 * @param {(text: string) => number} context.measureLabelWidth
 * @returns {{ok: true, ...} | {ok: false, reason: string}}
 */
export function computeGroupLayout(group, context) {
  if (!group) return { ok: false, reason: 'no-group' };

  const cache = context._cache || new Map();
  if (cache.has(group.id)) return cache.get(group.id);

  const visiting = context._visiting || new Set();
  if (visiting.has(group.id)) {
    return { ok: false, reason: 'cycle' };
  }
  visiting.add(group.id);

  const childContext = { ...context, _cache: cache, _visiting: visiting };

  const result = computeGroupLayoutInner(group, childContext);
  visiting.delete(group.id);
  cache.set(group.id, result);
  return result;
}

function computeGroupLayoutInner(group, context) {
  const {
    nodesById,
    dimsById,
    groupsById,
    groupsByMemberId,
    childGroupIdsByGroupId,
    gridSize,
    measureLabelWidth,
  } = context;

  const memberIds = Array.isArray(group.memberInstanceIds) ? group.memberInstanceIds : [];
  const droppedOrphanIds = [];
  const nestedContributors = [];

  // Strictly-contained child groups (the implicit containment hierarchy).
  // Only these should contribute title overhang to this group's bbox.
  // The set is structural — it depends only on which groups exist and who
  // their members are, not on positions — so callers can precompute it once
  // and pass it in via `childGroupIdsByGroupId` to avoid an O(M·K·L) scan
  // every layout call. We fall back to inline computation when not provided
  // (test paths and ad-hoc one-off calls).
  let childGroupIds;
  if (childGroupIdsByGroupId) {
    childGroupIds = childGroupIdsByGroupId.get(group.id) || EMPTY_SET;
  } else if (groupsByMemberId && groupsById) {
    childGroupIds = computeChildGroupIdsForGroup(group, groupsById, groupsByMemberId);
  } else {
    childGroupIds = EMPTY_SET;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const memberId of memberIds) {
    const node = nodesById.get(memberId);
    if (!node) {
      droppedOrphanIds.push(memberId);
      continue;
    }
    const dims = dimsById.get(memberId) || FALLBACK_DIMS;
    const memberX = node.x;
    const memberY = node.y;
    const memberRight = memberX + dims.currentWidth;
    const memberBottom = memberY + dims.currentHeight;

    let contributingY = memberY;
    if (childGroupIds.size > 0) {
      const containingEntries = groupsByMemberId.get(memberId);
      if (containingEntries) {
        for (const entry of containingEntries) {
          const otherGroupId = typeof entry === 'string' ? entry : entry?.groupId;
          if (!otherGroupId || !childGroupIds.has(otherGroupId)) continue;
          const otherGroup = groupsById.get(otherGroupId);
          if (!otherGroup) continue;
          const nested = computeGroupLayout(otherGroup, context);
          if (nested && nested.ok) {
            if (nested.nodeGroupRect.y < contributingY) {
              contributingY = nested.nodeGroupRect.y;
            }
            nestedContributors.push({
              memberId,
              nestedGroupId: otherGroupId,
              contributedMinY: nested.nodeGroupRect.y,
            });
          }
        }
      }
    }

    if (memberX < minX) minX = memberX;
    if (contributingY < minY) minY = contributingY;
    if (memberRight > maxX) maxX = memberRight;
    if (memberBottom > maxY) maxY = memberBottom;
  }

  if (!isFinite(minX)) {
    return { ok: false, reason: 'no-resolvable-members', droppedOrphanIds };
  }

  const C = GROUP_LAYOUT_CONSTANTS;
  const margin = memberBoundaryPaddingFor(gridSize) + C.innerCanvasBorder;
  const rectX = minX - margin;
  const rectY = minY - margin;
  const rectW = (maxX - minX) + margin * 2;
  const rectH = (maxY - minY) + margin * 2;

  const labelText = group.name || 'Group';
  const labelWidth = labelWidthFor(labelText, measureLabelWidth);
  const labelHeight = labelHeightConst();
  const labelX = rectX + (rectW - labelWidth) / 2;
  const labelY = rectY - labelHeight - C.titleToCanvasGap;

  const isNodeGroup = !!group.linkedNodePrototypeId;
  const nodeGroupRectY = isNodeGroup ? labelY - C.titleTopMargin : rectY;
  const nodeGroupRectH = isNodeGroup
    ? (rectY + rectH) - nodeGroupRectY
    : rectH;
  const innerCanvasY = isNodeGroup
    ? labelY + labelHeight + C.titleBottomMargin
    : rectY + C.innerCanvasBorder;

  const visualTop = isNodeGroup ? nodeGroupRectY : labelY;
  const visualBottom = isNodeGroup ? rectY + rectH : rectY + rectH;
  const visualLeft = Math.min(rectX, labelX);
  const visualRight = Math.max(rectX + rectW, labelX + labelWidth);

  return {
    ok: true,
    isNodeGroup,
    bbox: { minX, minY, maxX, maxY },
    rect: { x: rectX, y: rectY, w: rectW, h: rectH },
    label: { x: labelX, y: labelY, w: labelWidth, h: labelHeight },
    nodeGroupRect: { y: nodeGroupRectY, h: nodeGroupRectH },
    innerCanvasY,
    visualBounds: {
      x: visualLeft,
      y: visualTop,
      w: visualRight - visualLeft,
      h: visualBottom - visualTop,
    },
    droppedOrphanIds,
    nestedContributors,
  };
}
