/**
 * A lifted Thing-group: while one is dragged, it and everything in it (nested
 * groups, their Things, formulas, and every connection that touches any of
 * them) paints above the rest of the canvas — other groups and Things
 * included. LiftedGroupLayer draws it; the ordinary layers skip what it holds.
 *
 * The lift outlasts the drop by LIFT_SETTLE_MS, so the box settles from its
 * lift scale in the stack it was carried in. Moving its elements back is a
 * remount, and doing that at the drop would cut the settle short.
 */
import { useEffect, useMemo, useState } from 'react';

export const LIFT_SETTLE_MS = 250;

/**
 * @param {string|null} groupId the dragged group
 * @param {{ groupsById: Map, childGroupIds: Map<string, Set<string>> }} groupStructure
 * @returns {{ groupId: string, groupIds: Set<string>, instanceIds: Set<string> }|null}
 *   null unless `groupId` is a Thing-group.
 */
export function collectLiftedGroup(groupId, { groupsById, childGroupIds }) {
  const root = groupId ? groupsById?.get(groupId) : null;
  if (!root?.linkedNodePrototypeId) return null;
  const groupIds = new Set();
  const instanceIds = new Set();
  const visit = (id) => {
    if (groupIds.has(id)) return;
    const group = groupsById.get(id);
    if (!group) return;
    groupIds.add(id);
    if (group.anchorInstanceId) instanceIds.add(group.anchorInstanceId);
    (group.memberInstanceIds || []).forEach(m => instanceIds.add(m));
    childGroupIds?.get(id)?.forEach(visit);
  };
  visit(groupId);
  return { groupId, groupIds, instanceIds };
}

/**
 * The lift for the group being dragged, held LIFT_SETTLE_MS past the drop.
 * @param {string|null} draggingGroupId
 * @param {object} groupStructure NodeCanvas's groupStructure
 */
export function useGroupLift(draggingGroupId, groupStructure) {
  const [settlingId, setSettlingId] = useState(null);
  const [lastDraggedId, setLastDraggedId] = useState(draggingGroupId);
  // Adjusted during render (React's "storing information from previous
  // renders"), so the drop's own commit still carries the lift.
  if (draggingGroupId !== lastDraggedId) {
    setLastDraggedId(draggingGroupId);
    setSettlingId(draggingGroupId ? null : lastDraggedId);
  }
  useEffect(() => {
    if (!settlingId) return undefined;
    const timer = setTimeout(() => setSettlingId(null), LIFT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settlingId]);
  const liftedId = draggingGroupId || settlingId;
  return useMemo(() => collectLiftedGroup(liftedId, groupStructure), [liftedId, groupStructure]);
}
