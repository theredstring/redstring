/**
 * Which connections a node drag owns.
 *
 * A drag moves its nodes by writing the DOM directly, and rewrites only the
 * connections those moves can change: every connection touching a dragged
 * node, every connection touching the anchor of a thing-group a dragged node
 * sits in (the group's box moves as its member does), and under Lombardi the
 * connections two hops out, because Lombardi's fan is solved per node. Every
 * other connection stands still for the whole drag.
 *
 * That split has to be the SAME one in two places, which is why it lives here:
 *
 * - useNodeDrag caches and rewrites exactly these connections each frame.
 * - renderConnectionEdge gives exactly these connections the drag's form (live
 *   <text> labels it can re-cut, no cached label placement) and lets every
 *   other connection keep its settled form: sprite labels and cached
 *   placements.
 *
 * The second one used to be "everything, while anything is dragged". That cost
 * nothing until a render landed mid-drag, and the drag zoom-out guarantees
 * several: culling mounts what the zoom-out reveals, and the zoom settle
 * re-renders the canvas. Each of those re-solved every label on screen and
 * mounted every one of them as two stroked <text>s, which a plain zoom never
 * pays, and which is why the drag zoom-out choked on whatever it revealed.
 */

/**
 * The instance ids a drag moves, read off draggingNodeInfo in any of its three
 * shapes: a multi-select drag, a single node, or a group's members.
 * @param {object|null} info draggingNodeInfo
 * @returns {string[]}
 */
export function dragNodeIdsOf(info) {
  if (!info) return [];
  if (info.relativeOffsets) return [info.primaryId, ...Object.keys(info.relativeOffsets)];
  if (info.instanceId) return [info.instanceId];
  if (info.memberOffsets) return info.memberOffsets.map(m => m.id);
  return [];
}

/**
 * @param {Iterable<string>} nodeIds the dragged instance ids
 * @param {object} indexes
 * @param {Map<string, Iterable<string>>} indexes.edgesByNode instance id → edge ids
 * @param {Map<string, Array<{groupId: string}>>} [indexes.groupsByNode] instance id → groups it sits in
 * @param {Map<string, {anchorInstanceId?: string}>} [indexes.groupsById]
 * @param {Iterable<string>} [indexes.affectedGroupIds] every group whose box the
 *   drag moves, ancestors included (collectAffectedGroupIds in groupLayout.js).
 *   Without it, only the dragged nodes' own groups count.
 * @param {Array<{id: string, sourceId: string, destinationId: string}>} indexes.allEdges
 * @param {boolean} indexes.lombardi whether Lombardi routing is active
 * @returns {{ edgeIds: Set<string>, lombardiExtraEdgeIds: Set<string>, movedAnchorIds: Set<string> }}
 *   `edgeIds` includes the Lombardi extras.
 */
export function collectDragOwnedEdges(nodeIds, { edgesByNode, groupsByNode, groupsById, affectedGroupIds, allEdges, lombardi }) {
  const nodeIdSet = nodeIds instanceof Set ? nodeIds : new Set(nodeIds);
  const edgeIds = new Set();
  nodeIdSet.forEach(nodeId => {
    const edges = edgesByNode?.get(nodeId);
    if (edges) edges.forEach(eid => edgeIds.add(eid));
  });

  // A dragged member can resize its containing thing-group, which moves the
  // group's outer box. External connections attach to the group's ANCHOR (not
  // the dragged member), so the anchor's connections move too.
  //
  // So does every group ABOVE that one. A group can sit inside another by its
  // anchor alone (the outer group holds the inner one's Thing, not its
  // members), and the drag's box pass moves that outer group too. Taking only
  // the dragged node's own groups here left the outer group's connections out:
  // never cached, never rewritten, standing at the pre-drag box until the drop.
  const movedAnchorIds = new Set();
  const addAnchorOf = (groupId) => {
    const anchorId = groupsById.get(groupId)?.anchorInstanceId;
    if (!anchorId || nodeIdSet.has(anchorId) || movedAnchorIds.has(anchorId)) return;
    movedAnchorIds.add(anchorId);
    const anchorEdges = edgesByNode?.get(anchorId);
    if (anchorEdges) anchorEdges.forEach(eid => edgeIds.add(eid));
  };
  if (groupsById && affectedGroupIds) {
    for (const groupId of affectedGroupIds) addAnchorOf(groupId);
  } else if (groupsById && groupsByNode) {
    nodeIdSet.forEach(nodeId => {
      const groups = groupsByNode.get(nodeId);
      if (groups) groups.forEach(({ groupId }) => addAnchorOf(groupId));
    });
  }

  // LOMBARDI IS NOT LOCAL. Every other routing style recomputes a connection
  // from its own two endpoints. Lombardi's fan is a per-NODE solve over that
  // node's bearings, so moving one node re-solves the fan at each of its
  // NEIGHBOURS, which moves every connection those neighbours touch. A moved
  // group anchor counts as a moved node here too.
  const lombardiExtraEdgeIds = new Set();
  if (lombardi) {
    const movedIds = movedAnchorIds.size > 0 ? new Set([...nodeIdSet, ...movedAnchorIds]) : nodeIdSet;
    const neighbors = new Set();
    for (let i = 0; i < allEdges.length; i++) {
      const e = allEdges[i];
      if (movedIds.has(e.sourceId)) neighbors.add(e.destinationId);
      if (movedIds.has(e.destinationId)) neighbors.add(e.sourceId);
    }
    neighbors.forEach(id => {
      const es = edgesByNode?.get(id);
      if (es) es.forEach(eid => { if (!edgeIds.has(eid)) lombardiExtraEdgeIds.add(eid); });
    });
    lombardiExtraEdgeIds.forEach(eid => edgeIds.add(eid));
  }

  return { edgeIds, lombardiExtraEdgeIds, movedAnchorIds };
}
