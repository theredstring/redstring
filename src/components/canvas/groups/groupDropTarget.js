/**
 * Which group a Thing landing at a canvas point would join, and the "Add to
 * group?" dialog that asks. Shared by the drag drop (pointerHandlers) and the
 * plus sign (plusSignMorph), so a Thing made inside a group is offered the same
 * group a Thing dragged to that point would be.
 */
import { getNodeDimensions } from '../../../utils.js';
import { collectAncestorGroupIds } from '../../../services/groupLayout.js';

/**
 * The innermost group whose drop box contains `point` (a node centre, in canvas
 * coordinates), skipping groups `excludeNodeId` already belongs to. Null if none.
 */
export function findGroupDropTarget({ point, excludeNodeId, groups, nodes, groupDepths, gridSize }) {
  // Innermost hit wins. Insertion order says nothing about nesting, so
  // score by containment depth — otherwise dropping onto a plain group
  // that sits inside a node-group lands in whichever of the two happens
  // to come later in the Map, usually the outer one.
  let targetGroup = null;
  let targetDepth = -1;
  for (const group of groups) {
    if (excludeNodeId && group.memberInstanceIds.includes(excludeNodeId)) continue;
    const depth = groupDepths.get(group.id) ?? 0;
    // `>=` so a later sibling at the same depth still wins, preserving
    // the previous reverse-insertion tie-break.
    if (depth < targetDepth) continue;

    const members = nodes.filter(n => group.memberInstanceIds.includes(n.id));
    const margin = Math.max(24, Math.round(gridSize * 0.2));

    let groupMinX, groupMinY, groupMaxX, groupMaxY;
    if (members.length) {
      const memberDims = members.map(n => getNodeDimensions(n, false, null));
      const xs = members.map((n) => n.x);
      const ys = members.map((n) => n.y);
      const rights = members.map((n, idx) => n.x + memberDims[idx].currentWidth);
      const bottoms = members.map((n, idx) => n.y + memberDims[idx].currentHeight);
      groupMinX = Math.min(...xs) - margin;
      groupMinY = Math.min(...ys) - margin;
      groupMaxX = Math.max(...rights) + margin;
      groupMaxY = Math.max(...bottoms) + margin;
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

/** The addToGroupDialog payload for adding `nodeIds` to `targetGroup`. */
export function groupDropDialogFor(targetGroup, nodeIds, parentGroupIds, position) {
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
  };
}
