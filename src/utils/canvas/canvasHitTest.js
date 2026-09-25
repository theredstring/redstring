/**
 * Pointer hit tests on canvas-space data (P4.01), moved from NodeCanvas. The
 * client-space wrappers that read the container rect and the camera refs stay
 * there.
 */
import { getNodeDimensions } from '../../utils.js';
import { placeholderIdForGroup } from '../../services/groupLayout.js';

/**
 * Which instances a live selection box covers, merged with whatever was
 * already selected when the box began.
 *
 * Additive against `baseSelection`, not absolute: dragging a box while
 * holding a prior selection extends it, and shrinking the box back off a node
 * only deselects nodes the box itself added. Anchors are skipped — they are
 * invisible bookkeeping instances for node-groups, and selecting one selects
 * something the user cannot see.
 *
 * Shared by the mouse's live marquee and the controller's, so the two cannot
 * drift into selecting different things from the same rectangle.
 */
export function selectionInRect(rect, nodes, baseSelection, previewingNodeId) {
  const base = baseSelection || new Set();
  const final = new Set([...base]);
  nodes.forEach(nd => {
    if (nd.isGroupAnchor) return;
    if (base.has(nd.id)) return;
    const dims = getNodeDimensions(nd, previewingNodeId === nd.id, null);
    const intersects = !(rect.x > nd.x + dims.currentWidth ||
      rect.x + rect.width < nd.x ||
      rect.y > nd.y + dims.currentHeight ||
      rect.y + rect.height < nd.y);
    if (intersects) final.add(nd.id);
    else final.delete(nd.id);
  });
  return final;
}

/**
 * The thing group whose title pill contains a canvas point, or null.
 * @param {Map<string, { x: number, y: number, width: number, height: number, groupId: string }>} titleRects
 *   anchor instance id → title pill rect (NodeCanvas's anchorPositionUpdatesRef)
 * @returns {{ anchorInstanceId: string, groupId: string } | null}
 */
export function groupTitleAtCanvasPoint(canvasX, canvasY, titleRects) {
  for (const [anchorId, info] of titleRects.entries()) {
    if (canvasX >= info.x && canvasX <= info.x + info.width &&
      canvasY >= info.y && canvasY <= info.y + info.height) {
      return { anchorInstanceId: anchorId, groupId: info.groupId };
    }
  }
  return null;
}

/**
 * The member/anchor/placeholder offsets a group drag needs, measured from one
 * canvas-space grab point.
 *
 * Hoisted out of the title pill's long-press handler so the controller can
 * start the SAME drag rather than a parallel reimplementation of it. The list
 * is not obvious — an empty node-group tracks its placeholder rather than its
 * anchor, and nested EMPTY child groups need explicit entries or a parent drag
 * leaves their shells behind — which is exactly why there must only be one
 * copy of it.
 */
export function groupDragOffsets(group, members, isNodeGroup, canvasX, canvasY, { nodes, childGroupIdsByGroupId, groupsById }) {
  const offsets = members.map(m => ({ id: m.id, dx: canvasX - m.x, dy: canvasY - m.y }));
  if (group.anchorInstanceId) {
    const anchorNode = nodes.find(n => n.id === group.anchorInstanceId);
    if (anchorNode) {
      offsets.push({ id: anchorNode.id, dx: canvasX - anchorNode.x, dy: canvasY - anchorNode.y });
    }
  }
  // Empty node-group placeholder: track its own independent position (never
  // the anchor's) so it drags live using the exact same offset-preserving
  // math as a real member — see groupLayout.js for why deriving it from the
  // anchor's position doesn't work.
  if (isNodeGroup && !(group.memberInstanceIds?.length > 0) && group.emptyPlaceholderOrigin) {
    offsets.push({
      id: placeholderIdForGroup(group.id),
      dx: canvasX - group.emptyPlaceholderOrigin.x,
      dy: canvasY - group.emptyPlaceholderOrigin.y
    });
  }
  // Nested EMPTY child groups ride along too: their box position lives in
  // emptyPlaceholderOrigin (no member instance to move), so without an
  // explicit placeholder offset a parent drag would leave their shells
  // behind. Non-empty children need nothing — their members are already in
  // the parent's offset list.
  const nestedChildIds = childGroupIdsByGroupId.get(group.id);
  if (nestedChildIds) {
    nestedChildIds.forEach(childId => {
      const childGroup = groupsById.get(childId);
      if (!childGroup || childGroup.memberInstanceIds?.length > 0 || !childGroup.emptyPlaceholderOrigin) return;
      offsets.push({
        id: placeholderIdForGroup(childId),
        dx: canvasX - childGroup.emptyPlaceholderOrigin.x,
        dy: canvasY - childGroup.emptyPlaceholderOrigin.y
      });
    });
  }
  return offsets;
}
