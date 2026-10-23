/**
 * Group layout as data (P3.03a). This was computed inline by the groups pass
 * of NodeCanvas's JSX on every render; NodeCanvas now memoizes it, and the pass
 * only builds elements from the result and publishes `titleRects` and
 * `anchorPositions` to the refs the rest of the canvas reads.
 *
 * The code below is that pass's computation, moved verbatim.
 */
import { computeGroupLayout, groupLabelSizing, GROUP_LAYOUT_CONSTANTS } from '../../../services/groupLayout.js';
import { isReplacedGroup, isReplacedInstance, formatEndOf, connectionEndInfo, anchorBoxOf, formatAnchorOfGroup, formatOfAnchor } from '../formats/replaced.js';

/**
 * Publish a layout to the refs the rest of the canvas reads (drag, gamepad,
 * edges, the anchor flush). Rebuilt, not accumulated: a group that is gone (or
 * has become undrawable — emptied, or its layout bailed) must leave no rect
 * behind, or the controller keeps aiming at a pill nobody draws.
 *
 * A group drawn as a format (formats/replaced.js) has no pill to aim at, and
 * its anchor is where the format draws it: a formula's own anchor is its
 * title, with the formula's band as the box a connection stops at, the way a
 * node group's shell is; a part's anchor inside it is its token. So drawing,
 * hit testing and dragging all put a connection into it in the same place.
 */
export function publishGroupLayouts(layouts, titleRectsRef, anchorPositionsRef) {
  titleRectsRef.current.clear();
  for (const [id, r] of layouts.titleRects) if (!isReplacedGroup(id)) titleRectsRef.current.set(id, r);
  for (const [id, a] of layouts.anchorPositions) {
    anchorPositionsRef.current.set(id, isReplacedGroup(a.groupId) ? formatAnchorPosition(id, a) : a);
  }
}

/**
 * Where a format draws a group's anchor, as an anchorPositions record (the
 * pill: its title or token; outerBounds and shellRect: the formula's band), or
 * `pill` when no format draws it. `dx`/`dy`: how far a drag has carried it.
 */
export function formatAnchorPosition(anchorId, pill, dx = 0, dy = 0) {
  const end = formatEndOf(anchorId, dx, dy);
  if (!end) return pill;
  return { ...end, groupId: pill?.groupId ?? anchorBoxOf(anchorId, null)?.groupId ?? null };
}

/**
 * Where a connection's end is drawn, as the routers take it ({ node, dims }):
 * a Thing-group's anchor at its title pill, a format's end at its stand-in
 * (connectionEndInfo), else the node as stored. Mirrors renderConnectionEdge
 * exactly: the pill's box and nothing else. Carrying the node's own
 * scaledCornerRadius over would round the pill by a radius taken from a
 * different shape.
 */
export function connectionEndGeometry(node, dims, anchors) {
  const info = connectionEndInfo(node, anchors);
  if (!info) return { node, dims };
  return { node: { ...node, x: info.x, y: info.y }, dims: { currentWidth: info.width, currentHeight: info.height } };
}

/**
 * How a group around a format measures it (computeGroupLayout's
 * `drawnBoundsOf` and `isDrawnElsewhere`): a group inside it drawn as a
 * formula is the formula's band; the Things drawn in it aren't where they
 * stand. One rule for the settled layout and the drag's live one, so a group's
 * box is the same while it moves and once it lands. `dragDelta(memberIds)`:
 * how far the drag has carried a formula, by its Things ({ dx, dy }), or null.
 */
export function formatLayoutHooks(dragDelta = null) {
  return {
    drawnBoundsOf: (groupId) => {
      const drawn = formatOfAnchor(formatAnchorOfGroup(groupId));
      if (!drawn) return null;
      const d = dragDelta?.(drawn.memberIds || []);
      return d ? { x: drawn.x + d.dx, y: drawn.y + d.dy, w: drawn.w, h: drawn.h } : drawn;
    },
    isDrawnElsewhere: isReplacedInstance,
  };
}

/**
 * @returns {{
 *   entries: Array<{ group, members, layout, effectiveGroupName, effectiveGroupColor }>,
 *   groupCount: number,
 *   titleRects: Map<string, object>,
 *   anchorPositions: Map<string, object>,
 *   thingGroupMemberIds: Set<string>,
 *   anchorIds: Set<string>,
 *   groupLabelScale: number,
 *   groupLabelFontSize: number,
 * }}
 */
export function computeGroupLayouts({
  graphData, groupStructure, hydratedNodes, textSettings, editingGroupId, tempGroupName,
  nodePrototypesMap, baseDimsById, gridSize, getTextWidth,
}) {
  // Shallowest-first so nested shells/titles emit after (above) their
  // parents within each z-layer; stable sort keeps insertion order
  // among siblings at the same depth.
  const groupDepths = groupStructure.groupDepths;
  const groups = graphData?.groups
    ? Array.from(graphData.groups.values())
      .sort((a, b) => (groupDepths.get(a.id) ?? 0) - (groupDepths.get(b.id) ?? 0))
    : [];
  const entries = [];
  const titleRects = new Map();
  const anchorPositions = new Map();
  const tgMemberIds = new Set();
  const anchorIds = new Set();
  // Group labels scale with node size and read at a node title's size.
  const { labelScale: groupLabelScale, labelFontSize: groupLabelFontSize, measureLabelWidth } = groupLabelSizing(textSettings, getTextWidth);
  const result = {
    entries, groupCount: groups.length, titleRects, anchorPositions,
    thingGroupMemberIds: tgMemberIds, anchorIds, groupLabelScale, groupLabelFontSize,
  };
  if (!groups.length) return result;

  // Build layout context once for the whole pass. computeGroupLayout uses
  // this for both bbox math (orphan-skipping, nested overhang) and label
  // sizing. Shared cache means each group's layout is computed once even
  // when referenced as a child by multiple parents.
  const layoutNodesById = new Map();
  for (let i = 0; i < hydratedNodes.length; i++) {
    const n = hydratedNodes[i];
    layoutNodesById.set(n.id, { id: n.id, x: n.x, y: n.y });
  }

  // The name every part of the layout pass measures against, resolved
  // ONCE into the map itself rather than at each group's own top-level
  // call. A parent folds its children in by reading `groupsById`, and
  // the shared `_cache` means whichever call runs first wins — so a
  // nested group whose parent was laid out before it got served its
  // parent's view of the name. Renaming a nested group then sized its
  // tab from the OLD name while the text drew the new one, and a title
  // that had grown a line spilled up out of the tab into the shell.
  // Two readers, two names; one map, one name.
  const effectiveNameFor = (g) => {
    if (editingGroupId === g.id) return tempGroupName;
    const proto = g.linkedNodePrototypeId ? nodePrototypesMap.get(g.linkedNodePrototypeId) : null;
    return proto?.name || g.name || 'Group';
  };
  let groupsForLayout = graphData.groups;
  const renamedForLayout = groups
    .map(g => [g, effectiveNameFor(g)])
    .filter(([g, name]) => name !== g.name);
  if (renamedForLayout.length) {
    groupsForLayout = new Map(graphData.groups);
    for (const [g, name] of renamedForLayout) groupsForLayout.set(g.id, { ...g, name });
  }

  const layoutContext = {
    nodesById: layoutNodesById,
    dimsById: baseDimsById,
    groupsById: groupsForLayout,
    groupsByMemberId: groupStructure.groupsByNodeId,
    childGroupIdsByGroupId: groupStructure.childGroupIds,
    gridSize,
    measureLabelWidth,
    labelScale: groupLabelScale,
    labelFontSize: groupLabelFontSize,
    ...formatLayoutHooks(),
    _cache: new Map(),
  };

  groups.forEach(group => {
    const memberIdSet = new Set(group.memberInstanceIds);
    const members = hydratedNodes.filter(n => memberIdSet.has(n.id));
    // Empty node-groups (no members yet) still render as a held-open
    // placeholder anchored at their own instance — computeGroupLayout
    // synthesizes a box for that case. Plain (non-prototype) groups have
    // no anchor to fall back to, so they still skip when empty.
    if (!members.length && !group.linkedNodePrototypeId) return;

    // A node-group's identity IS its linked prototype's — editing the
    // group's title or color edits the Thing itself. The group record
    // keeps mirrored name/color fields (that's what serializes), but the
    // prototype is authoritative, so read through to it here and the
    // title tracks prototype edits made from any other surface.
    const nodeGroupPrototype = group.linkedNodePrototypeId
      ? nodePrototypesMap.get(group.linkedNodePrototypeId)
      : null;
    const effectiveGroupName = nodeGroupPrototype?.name || group.name || 'Group';
    const effectiveGroupColor = nodeGroupPrototype?.color || group.color || '#8B0000';

    // The same override-named copy the rest of the pass reads (see
    // groupsForLayout above), so a nested group and its parent can
    // never disagree about what this group is called.
    const groupForLayout = groupsForLayout.get(group.id) || group;
    const layout = computeGroupLayout(groupForLayout, layoutContext);
    if (!layout.ok) return;

    const { rect, label, nodeGroupRect, isNodeGroup } = layout;
    const labelX = label.x, labelY = label.y;
    const labelWidth = label.w, labelHeight = label.h;

    // Sync anchor instance position to group title center. Also record the
    // group's full outer bounds (title tab + member box) so a connection label
    // can clip against the whole group box and center on the visible segment.
    // Every group records its pill here, including plain ones — this is
    // the map the controller aims at. Rebuilt from scratch each pass, so a
    // deleted group leaves nothing behind.
    titleRects.set(group.id, {
      x: labelX, y: labelY,
      width: labelWidth, height: labelHeight,
      groupId: group.id,
      anchorInstanceId: isNodeGroup ? (group.anchorInstanceId || null) : null,
    });

    if (isNodeGroup && group.anchorInstanceId) {
      const vb = layout.visualBounds;
      anchorPositions.set(group.anchorInstanceId, {
        x: labelX, y: labelY,
        width: labelWidth, height: labelHeight,
        groupId: group.id,
        outerBounds: vb ? { x: vb.x, y: vb.y, width: vb.w, height: vb.h } : null,
        // The shell exactly as drawn (rounded rect, not the AABB above), so a
        // connection clipped against it is cut along the same curve the rim
        // paints. See buildShellCutoutPath.
        shellRect: { x: rect.x, y: nodeGroupRect.y, w: rect.w, h: nodeGroupRect.h, r: GROUP_LAYOUT_CONSTANTS.nodeGroupCornerRadius },
      });
    }

    // Collect thing-group member IDs (including anchor) for edge/node z-splitting
    if (isNodeGroup) {
      group.memberInstanceIds.forEach(id => tgMemberIds.add(id));
      if (group.anchorInstanceId) {
        tgMemberIds.add(group.anchorInstanceId);
        anchorIds.add(group.anchorInstanceId);
      }
    }

    entries.push({ group, members, layout, effectiveGroupName, effectiveGroupColor });
  });
  return result;
}
