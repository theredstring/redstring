/**
 * Which group a Thing landing at a canvas point would join, and the "Add to
 * group?" dialog that asks. Shared by the drag drop (pointerHandlers) and the
 * plus sign (plusSignMorph), so a Thing made inside a group is offered the same
 * group a Thing dragged to that point would be.
 *
 * A Thing-group, or a formula, dropped whole is offered the group it landed in
 * the same way, and joins it as its Thing (its anchor), which is how a
 * Thing-group sits inside another (groupLayout.isGroupInsideGroup).
 */
import { getNodeDimensions } from '../../../utils.js';
import { collectAncestorGroupIds, collectDescendantGroupIds } from '../../../services/groupLayout.js';
import { isReplacedGroup, isReplacedInstance, formatOfAnchor } from '../formats/replaced.js';

// What of a member is on the canvas: a formula's anchor is its band; a Thing a
// format draws (a formula's term) isn't where it stands, so it is not counted.
function memberBox(n) {
  const drawn = formatOfAnchor(n.id);
  if (drawn) return { x: drawn.x, y: drawn.y, right: drawn.x + drawn.w, bottom: drawn.y + drawn.h };
  if (isReplacedInstance(n.id)) return null;
  const dims = getNodeDimensions(n, false, null);
  return { x: n.x, y: n.y, right: n.x + dims.currentWidth, bottom: n.y + dims.currentHeight };
}

/**
 * The innermost group whose drop box contains `point` (a node centre, in canvas
 * coordinates), skipping groups `excludeNodeId` already belongs to. Null if none.
 */
export function findGroupDropTarget({ point, excludeNodeId, excludeGroupIds = null, groups, nodes, groupDepths, gridSize }) {
  // Innermost hit wins. Insertion order says nothing about nesting, so
  // score by containment depth — otherwise dropping onto a plain group
  // that sits inside a node-group lands in whichever of the two happens
  // to come later in the Map, usually the outer one.
  let targetGroup = null;
  let targetDepth = -1;
  for (const group of groups) {
    if (excludeNodeId && group.memberInstanceIds.includes(excludeNodeId)) continue;
    if (excludeGroupIds?.has(group.id)) continue;
    // A group drawn as a formula (and its parts) is written, not joined by landing on it.
    if (isReplacedGroup(group.id)) continue;
    const depth = groupDepths.get(group.id) ?? 0;
    // `>=` so a later sibling at the same depth still wins, preserving
    // the previous reverse-insertion tie-break.
    if (depth < targetDepth) continue;

    const boxes = nodes.filter(n => group.memberInstanceIds.includes(n.id)).map(memberBox).filter(Boolean);
    const margin = Math.max(24, Math.round(gridSize * 0.2));

    let groupMinX, groupMinY, groupMaxX, groupMaxY;
    if (boxes.length) {
      groupMinX = Math.min(...boxes.map(b => b.x)) - margin;
      groupMinY = Math.min(...boxes.map(b => b.y)) - margin;
      groupMaxX = Math.max(...boxes.map(b => b.right)) + margin;
      groupMaxY = Math.max(...boxes.map(b => b.bottom)) + margin;
    } else if (group.linkedNodePrototypeId && group.anchorInstanceId) {
      // Empty node-group placeholder: hold open a drop target at the
      // group's frozen placeholder origin — the same position the box
      // actually renders at (see groupLayout.js) — not the anchor's live
      // x/y, which tracks the rendered title-tab spot instead.
      const anchorNode = nodes.find(n => n.id === group.anchorInstanceId);
      const origin = group.emptyPlaceholderOrigin || anchorNode;
      if (!origin || !anchorNode) continue;
      const anchorDims = getNodeDimensions(anchorNode, false, null);
      groupMinX = origin.x - margin;
      groupMinY = origin.y - margin;
      groupMaxX = origin.x + anchorDims.currentWidth + margin;
      groupMaxY = origin.y + anchorDims.currentHeight + margin;
    } else {
      continue;
    }

    if (point.x >= groupMinX && point.x <= groupMaxX &&
      point.y >= groupMinY && point.y <= groupMaxY) {
      targetGroup = group;
      targetDepth = depth;
    }
  }
  return targetGroup;
}

/**
 * The "Add to group?" a drag's release offers (useNodeDrag.handleDragEnd's
 * result), or null. Things dropped: by the primary Thing's middle, as always.
 * A Thing-group or formula dropped whole: by the middle of what was dragged.
 */
export function groupDropAfterDrag(dragResult, { graphData, nodes, groupStructure, gridSize, position }) {
  const groups = graphData?.groups ? Array.from(graphData.groups.values()) : [];
  if (!groups.length) return null;
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const at = (id) => {
    const n = nodeById.get(id);
    const fp = dragResult.finalPositions?.get(id);
    return n ? (fp ? { ...n, x: fp.x, y: fp.y } : n) : null;
  };
  const find = (point, excludeNodeId, excludeGroupIds) => findGroupDropTarget({
    point, excludeNodeId, excludeGroupIds, groups, nodes, groupDepths: groupStructure.groupDepths, gridSize,
  });

  if (dragResult.wasGroupDrag) {
    const dragged = graphData.groups.get(dragResult.groupId);
    // A plain group has no Thing to join with; its Things are where it is.
    if (!dragged?.linkedNodePrototypeId || !dragged.anchorInstanceId) return null;
    const boxes = (dragged.memberInstanceIds || []).map(id => at(id)).filter(Boolean)
      .filter(n => !nodeById.get(n.id)?.isGroupAnchor)
      .map(n => { const d = getNodeDimensions(n, false, null); return { x: n.x, y: n.y, right: n.x + d.currentWidth, bottom: n.y + d.currentHeight }; });
    if (!boxes.length) return null;
    const point = {
      x: (Math.min(...boxes.map(b => b.x)) + Math.max(...boxes.map(b => b.right))) / 2,
      y: (Math.min(...boxes.map(b => b.y)) + Math.max(...boxes.map(b => b.bottom))) / 2,
    };
    // Not into itself, what is inside it, or what it is in already.
    const exclude = new Set([dragged.id,
      ...collectDescendantGroupIds(dragged.id, groupStructure.childGroupIds),
      ...collectAncestorGroupIds(dragged.id, groupStructure.parentGroupIds)]);
    const target = find(point, dragged.anchorInstanceId, exclude);
    if (!target) return null;
    const what = formatOfAnchor(dragged.anchorInstanceId) ? 'this formula' : 'this Thing-group';
    return groupDropDialogFor(target, [dragged.anchorInstanceId], groupStructure.parentGroupIds, position, what);
  }

  if (!dragResult.checkGroupDrop || !dragResult.draggedNodeIds.length) return null;
  const primary = at(dragResult.primaryNodeId);
  if (!primary) return null;
  // A formula in the selection goes as its Thing; the Things it draws go with it, not on their own.
  const nodeIds = dragResult.draggedNodeIds.filter(id => !isReplacedInstance(id) || formatOfAnchor(id));
  const drawn = formatOfAnchor(primary.id);
  let point;
  if (drawn) {
    // Where the formula was let go: its band, carried as far as its Things were.
    const proxy = drawn.memberIds?.find(id => dragResult.finalPositions?.has(id) && nodeById.has(id));
    const dx = proxy ? dragResult.finalPositions.get(proxy).x - nodeById.get(proxy).x : 0;
    const dy = proxy ? dragResult.finalPositions.get(proxy).y - nodeById.get(proxy).y : 0;
    point = { x: drawn.x + drawn.w / 2 + dx, y: drawn.y + drawn.h / 2 + dy };
  } else {
    const dims = getNodeDimensions(primary, false, null);
    point = { x: primary.x + dims.currentWidth / 2, y: primary.y + dims.currentHeight / 2 };
  }
  const target = find(point, primary.id, null);
  return target && nodeIds.length ? groupDropDialogFor(target, nodeIds, groupStructure.parentGroupIds, position) : null;
}

/** The addToGroupDialog payload for adding `nodeIds` to `targetGroup`. `what`: how the dialog names them. */
export function groupDropDialogFor(targetGroup, nodeIds, parentGroupIds, position, what = null) {
  // The node joins every group this one sits inside, so shells the
  // user didn't drop onto will visibly take it in. Say so when
  // there's actually a chain above the target.
  const ancestorCount = collectAncestorGroupIds(targetGroup.id, parentGroupIds).size;
  return {
    nodeIds,
    groupId: targetGroup.id,
    groupName: (targetGroup.name || 'Unnamed Group') + (ancestorCount > 0 ? ' (and others)' : ''),
    isNodeGroup: !!targetGroup.linkedNodePrototypeId,
    position,
    ...(what ? { what } : {}),
  };
}
