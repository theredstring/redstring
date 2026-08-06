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
  // Corner radius of a node-group's interior (the canvas-bg inset).
  innerCanvasCornerRadius: 12,
  strokeWidth: 2,
  fontSize: 36,
});

const FALLBACK_DIMS = { currentWidth: 200, currentHeight: 150 };
const EMPTY_SET = new Set();

/**
 * Synthetic instance-id prefix for an empty node-group's held-open placeholder
 * box. These ids never resolve to a real instance — they exist so the drag
 * pipeline (offsets → position updates → layout → store commit) can move a
 * memberless group's box with exactly the same machinery as a real member.
 * `groupIdFromPlaceholderId` is the only sanctioned way to unwrap one.
 */
export const PLACEHOLDER_ID_PREFIX = '__placeholder__';

export const placeholderIdForGroup = (groupId) => `${PLACEHOLDER_ID_PREFIX}${groupId}`;

export const groupIdFromPlaceholderId = (id) =>
  (typeof id === 'string' && id.startsWith(PLACEHOLDER_ID_PREFIX))
    ? id.slice(PLACEHOLDER_ID_PREFIX.length)
    : null;

const roundedRectSubpath = (x, y, w, h, r) => {
  if (!(w > 0) || !(h > 0)) return '';
  const rr = Math.max(0, Math.min(r || 0, Math.min(w, h) / 2));
  if (rr === 0) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  return `M ${x + rr} ${y}`
    + ` H ${x + w - rr}`
    + ` A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr}`
    + ` V ${y + h - rr}`
    + ` A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}`
    + ` H ${x + rr}`
    + ` A ${rr} ${rr} 0 0 1 ${x} ${y + h - rr}`
    + ` V ${y + rr}`
    + ` A ${rr} ${rr} 0 0 1 ${x + rr} ${y} Z`;
};

/**
 * The `d` for a clip region covering `region` with each shell in `shells`
 * punched out. Render with `clipRule="evenodd"`.
 *
 * Why a clip and not just a shorter line: a connection to a node-group's title
 * is drawn to the anchor's CENTER — which is the title-pill center, deep inside
 * the group's box — and the stub is meant to be hidden by the shell, exactly
 * like a plain node hides the stub between its center and its border. That works
 * as long as the shell paints over the connection. It doesn't when the
 * connection's other end is deeper in the nesting and therefore paints above the
 * shell (see edgeZSlotFor).
 *
 * Ending the line at the box boundary instead is NOT equivalent: the stroke's
 * cap is perpendicular to the line, while the boundary it meets is not, so an
 * angled connection leaves a rounded nub and a sliver of background at the rim.
 * Occlusion cuts along the boundary. This clip reproduces that cut exactly,
 * independent of paint order.
 *
 * @param {{x: number, y: number, w: number, h: number}} region - covers everything drawable
 * @param {Array<{x: number, y: number, w: number, h: number, r?: number}>} shells
 * @returns {string}
 */
export function buildShellCutoutPath(region, shells) {
  const outer = roundedRectSubpath(region.x, region.y, region.w, region.h, 0);
  if (!outer) return '';
  const holes = (shells || [])
    .map(s => (s ? roundedRectSubpath(s.x, s.y, s.w, s.h, s.r) : ''))
    .filter(Boolean);
  return holes.length ? `${outer} ${holes.join(' ')}` : outer;
}

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
  // Empty node-group placeholders can never satisfy the strict-subset test
  // (no members to be a subset with), but they're still "inside" any group
  // that holds their anchor instance as a member — the anchor is the only
  // spatial tie they have. Without this they get no depth (z-order) and no
  // shell fold (boundary padding) from their containing group.
  if (groupsById) {
    for (const [otherGroupId, otherGroup] of groupsById) {
      if (otherGroupId === group.id || childGroupIds.has(otherGroupId)) continue;
      if (!otherGroup?.linkedNodePrototypeId || !otherGroup.anchorInstanceId) continue;
      if (Array.isArray(otherGroup.memberInstanceIds) && otherGroup.memberInstanceIds.length > 0) continue;
      if (memberIdSet.has(otherGroup.anchorInstanceId)) childGroupIds.add(otherGroupId);
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

/**
 * Inverts `buildChildGroupIdsIndex`: child group → the groups that contain it.
 *
 * @param {Map<string, Set<string>>} childGroupIdsByGroupId
 * @returns {Map<string, Set<string>>}
 */
export function buildParentGroupIdsIndex(childGroupIdsByGroupId) {
  const out = new Map();
  if (!childGroupIdsByGroupId) return out;
  for (const [parentId, childIds] of childGroupIdsByGroupId) {
    for (const childId of childIds) {
      let parents = out.get(childId);
      if (!parents) { parents = new Set(); out.set(childId, parents); }
      parents.add(parentId);
    }
  }
  return out;
}

/**
 * Every group whose box can change when the given instances move. Three
 * sources, all required — miss any one and a shell stays painted at stale
 * coordinates while the rest of the drag moves on:
 *
 *   1. Direct membership (`groupsByMemberId`).
 *   2. Synthetic `__placeholder__<groupId>` ids. An empty node-group has no
 *      member instance, so its box rides on a placeholder id that is NOT in
 *      `groupsByMemberId` — nested empty children were dragged along by a
 *      parent yet never had their own shell repositioned, which is what left
 *      them sitting outside the parent's box mid-drag.
 *   3. Containing ancestors, transitively. A parent folds its children's full
 *      shells into its bbox, so moving a child resizes every group above it.
 *
 * @param {Iterable<string>} instanceIds - Moved ids, real or placeholder.
 * @param {object} context
 * @param {Map<string, Array<{groupId: string} | string>>} context.groupsByMemberId
 * @param {Map<string, Set<string>>} [context.parentGroupIdsIndex]
 * @returns {Set<string>}
 */
export function collectAffectedGroupIds(instanceIds, { groupsByMemberId, parentGroupIdsIndex } = {}) {
  const affected = new Set();
  if (!instanceIds) return affected;
  const pending = [];
  const add = (groupId) => {
    if (!groupId || affected.has(groupId)) return;
    affected.add(groupId);
    pending.push(groupId);
  };
  for (const instanceId of instanceIds) {
    const placeholderGroupId = groupIdFromPlaceholderId(instanceId);
    if (placeholderGroupId) { add(placeholderGroupId); continue; }
    const entries = groupsByMemberId?.get(instanceId);
    if (!entries) continue;
    for (const entry of entries) add(typeof entry === 'string' ? entry : entry?.groupId);
  }
  while (pending.length > 0) {
    const parents = parentGroupIdsIndex?.get(pending.pop());
    if (parents) parents.forEach(add);
  }
  return affected;
}

/**
 * Nesting depth per group, derived from the strict-subset child index:
 * a group's depth is how many other groups contain it (0 = outermost).
 * Containment is transitive, so every ancestor of an ancestor is also
 * counted — depth(child) is always >= depth(parent) + 1, which makes this
 * safe to use as a paint order (sort ascending, deepest paints last/on top).
 *
 * Empty node-groups never appear as children in the subset scan (no members
 * to be a subset with), so they inherit depth from whichever group holds
 * their anchor instance as a member.
 *
 * @param {Map<string, object>} groupsById
 * @param {Map<string, Array<{groupId: string} | string>>} groupsByMemberId
 * @param {Map<string, Set<string>>} childGroupIdsByGroupId
 * @returns {Map<string, number>}
 */
export function computeGroupDepths(groupsById, groupsByMemberId, childGroupIdsByGroupId) {
  const depths = new Map();
  if (!childGroupIdsByGroupId) return depths;
  for (const groupId of childGroupIdsByGroupId.keys()) depths.set(groupId, 0);
  for (const childIds of childGroupIdsByGroupId.values()) {
    for (const childId of childIds) {
      depths.set(childId, (depths.get(childId) ?? 0) + 1);
    }
  }
  if (groupsById && groupsByMemberId) {
    for (const group of groupsById.values()) {
      if (!group.linkedNodePrototypeId || !group.anchorInstanceId) continue;
      if (Array.isArray(group.memberInstanceIds) && group.memberInstanceIds.length > 0) continue;
      const entries = groupsByMemberId.get(group.anchorInstanceId);
      if (!entries) continue;
      let maxParentDepth = -1;
      for (const entry of entries) {
        const gid = typeof entry === 'string' ? entry : entry?.groupId;
        if (!gid || gid === group.id) continue;
        maxParentDepth = Math.max(maxParentDepth, depths.get(gid) ?? 0);
      }
      if (maxParentDepth >= 0) depths.set(group.id, maxParentDepth + 1);
    }
  }
  return depths;
}

/**
 * Per-instance z-slot for the connections that touch it. Node-group shells are
 * opaque, so where a connection paints relative to them decides whether it is
 * visible at all:
 *
 *   • A group's ANCHOR is its title tab. Connections to it sit at the group's own
 *     depth, i.e. they emit before that group's shell and slide underneath its
 *     band — which is what makes an edge read as terminating at the title pill.
 *   • A MEMBER node is drawn above every shell, so connections to it sit one
 *     level above its deepest containing node-group.
 *
 * Only node-groups are considered: plain thing-groups render as a dashed outline
 * at the bottom of the stack and occlude nothing.
 *
 * @param {Map<string, object>} groupsById
 * @param {Map<string, number>} groupDepthsByGroupId - from computeGroupDepths
 * @returns {Map<string, number>} instanceId → slot (absent ⇒ 0)
 */
export function buildEdgeZSlotIndex(groupsById, groupDepthsByGroupId) {
  const slots = new Map();
  if (!groupsById) return slots;
  const raise = (instanceId, slot) => {
    if (!instanceId) return;
    const current = slots.get(instanceId);
    // Deepest wins: a node inside two nested node-groups must clear the inner
    // one's shell, which is the one painted last.
    if (current === undefined || slot > current) slots.set(instanceId, slot);
  };
  for (const group of groupsById.values()) {
    if (!group?.linkedNodePrototypeId) continue;
    const depth = groupDepthsByGroupId?.get(group.id) ?? 0;
    if (Array.isArray(group.memberInstanceIds)) {
      for (const memberId of group.memberInstanceIds) raise(memberId, depth + 1);
    }
    raise(group.anchorInstanceId, depth);
  }
  return slots;
}

/**
 * Z-slot for one connection: the deeper of its two endpoints, so it is never
 * hidden by a shell that doesn't contain BOTH ends. Keying the layer off "is
 * either end an anchor" instead (the older scheme) buried a node-group wired to
 * a node inside a SIBLING node-group — the edge went under every shell,
 * including the sibling's, and vanished.
 *
 * Self-loops bulge off a single node's corner and must never be occluded, so
 * they go straight to the top slot.
 *
 * @param {{sourceId: string, destinationId: string}} edge
 * @param {Map<string, number>} slotByInstanceId - from buildEdgeZSlotIndex
 * @param {number} topSlot - one above the deepest rendered shell
 * @returns {number}
 */
export function edgeZSlotFor(edge, slotByInstanceId, topSlot) {
  if (edge.sourceId === edge.destinationId) return topSlot;
  return Math.min(topSlot, Math.max(
    slotByInstanceId?.get(edge.sourceId) ?? 0,
    slotByInstanceId?.get(edge.destinationId) ?? 0
  ));
}

// Tab height is dictated by the label font: tall enough for the line box
// (font * 1.4) plus vertical padding, with a sane minimum. `fontSize` is the
// already-scaled px size; falls back to the fixed constant when not supplied.
const labelHeightConst = (scale = 1, fontSize = null) => {
  const C = GROUP_LAYOUT_CONSTANTS;
  const f = fontSize ?? C.fontSize * scale;
  return Math.max(80 * scale, f * 1.4 + C.titlePaddingVertical * scale * 2);
};

const labelWidthFor = (text, measureLabelWidth, scale = 1) => {
  const C = GROUP_LAYOUT_CONSTANTS;
  // `measureLabelWidth` already measures against the node-scaled font, so the
  // padding/floor/ceiling scale alongside it to keep the tab proportional.
  const measured = measureLabelWidth(text);
  return Math.min(1000 * scale, Math.max(100 * scale, measured + (C.titlePaddingHorizontal * 2 + C.strokeWidth * 2) * scale));
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
    labelScale = 1,
    labelFontSize = null,
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
    let contributingX = memberX;
    let contributingRight = memberRight;
    let contributingBottom = memberBottom;
    if (childGroupIds.size > 0) {
      const containingEntries = groupsByMemberId.get(memberId);
      if (containingEntries) {
        for (const entry of containingEntries) {
          const otherGroupId = typeof entry === 'string' ? entry : entry?.groupId;
          if (!otherGroupId || !childGroupIds.has(otherGroupId)) continue;
          const otherGroup = groupsById.get(otherGroupId);
          if (!otherGroup) continue;
          // Empty children have no member overlap with this loop — their
          // placeholder shells are folded in the dedicated pass below.
          if (!(otherGroup.memberInstanceIds?.length > 0)) continue;
          const nested = computeGroupLayout(otherGroup, context);
          if (nested && nested.ok) {
            // Fold the nested group's FULL shell (colored band + title tab)
            // into this bbox, not just its member nodes. The child's rect
            // extends the same margin beyond the shared members as ours
            // would, so treating members as the extent makes both shells
            // land on coincident left/right/bottom edges — overlapping with
            // zero clearance. Folding visualBounds instead means our margin
            // applies around the child's shell, keeping memberPadding of
            // daylight between the rims on every side.
            const vb = nested.visualBounds;
            if (vb) {
              if (vb.x < contributingX) contributingX = vb.x;
              if (vb.y < contributingY) contributingY = vb.y;
              if (vb.x + vb.w > contributingRight) contributingRight = vb.x + vb.w;
              if (vb.y + vb.h > contributingBottom) contributingBottom = vb.y + vb.h;
            } else if (nested.nodeGroupRect.y < contributingY) {
              contributingY = nested.nodeGroupRect.y;
            }
            nestedContributors.push({
              memberId,
              nestedGroupId: otherGroupId,
              contributedMinY: vb ? vb.y : nested.nodeGroupRect.y,
            });
          }
        }
      }
    }

    if (contributingX < minX) minX = contributingX;
    if (contributingY < minY) minY = contributingY;
    if (contributingRight > maxX) maxX = contributingRight;
    if (contributingBottom > maxY) maxY = contributingBottom;
  }

  // Empty node-group children (anchored placeholders — see the empty-group
  // pass in computeChildGroupIdsForGroup) contribute no members to the loop
  // above, so fold their placeholder shells in directly.
  if (childGroupIds.size > 0 && groupsById) {
    for (const childId of childGroupIds) {
      const childGroup = groupsById.get(childId);
      if (!childGroup) continue;
      if (childGroup.memberInstanceIds?.length > 0) continue;
      const nested = computeGroupLayout(childGroup, context);
      if (nested?.ok && nested.visualBounds) {
        const vb = nested.visualBounds;
        if (vb.x < minX) minX = vb.x;
        if (vb.y < minY) minY = vb.y;
        if (vb.x + vb.w > maxX) maxX = vb.x + vb.w;
        if (vb.y + vb.h > maxY) maxY = vb.y + vb.h;
        nestedContributors.push({
          memberId: childGroup.anchorInstanceId || null,
          nestedGroupId: childId,
          contributedMinY: vb.y,
        });
      }
    }
  }

  if (!isFinite(minX) && group.linkedNodePrototypeId) {
    // Empty node-group placeholder (no members yet): hold open a box the size of a
    // default node. Deliberately keyed off a synthetic `__placeholder__<groupId>` id
    // rather than the anchor's own position/dims — the anchor's position is a
    // *different* thing (it gets synced to sit at this layout's own computed
    // title-tab spot, for edge-routing, exactly like a populated group's anchor
    // does), and reading it back in here would make the box's output feed its own
    // input. `nodesById.get(placeholderId)` resolves during an active drag of this
    // placeholder (see NodeCanvas.jsx's group-drag-start handlers); otherwise it
    // falls back to the frozen `group.emptyPlaceholderOrigin`, persisted by
    // updateMultipleNodeInstancePositions when the placeholder is dragged. Once a
    // real member is added this whole branch stops applying — the member loop
    // above takes over and behaves exactly as it always has.
    const placeholderId = placeholderIdForGroup(group.id);
    const origin = nodesById.get(placeholderId) || group.emptyPlaceholderOrigin;
    if (origin) {
      const dims = dimsById.get(placeholderId) || dimsById.get(group.anchorInstanceId) || FALLBACK_DIMS;
      minX = origin.x;
      minY = origin.y;
      maxX = origin.x + dims.currentWidth;
      maxY = origin.y + dims.currentHeight;
    }
  }

  if (!isFinite(minX)) {
    return { ok: false, reason: 'no-resolvable-members', droppedOrphanIds };
  }

  const C = GROUP_LAYOUT_CONSTANTS;
  const margin = memberBoundaryPaddingFor(gridSize) + C.innerCanvasBorder;
  let rectX = minX - margin;
  const rectY = minY - margin;
  let rectW = (maxX - minX) + margin * 2;
  const rectH = (maxY - minY) + margin * 2;

  const labelText = group.name || 'Group';
  const labelWidth = labelWidthFor(labelText, measureLabelWidth, labelScale);
  const labelHeight = labelHeightConst(labelScale, labelFontSize);

  // The background band must be at least as wide as the title plus its own
  // breathing room, or the title spills past the band on narrow groups (few/
  // small members with a long name). Grow symmetrically around the member
  // bbox's center so the members don't get pushed toward one edge.
  const minRectW = labelWidth + C.titlePaddingHorizontal * 2;
  if (minRectW > rectW) {
    const extra = minRectW - rectW;
    rectX -= extra / 2;
    rectW = minRectW;
  }

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
