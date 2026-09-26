/**
 * Keeping node-group anchor instances where their title pills are drawn (moved
 * verbatim from NodeCanvas's anchor flush).
 */
import useGraphStore from '../../../store/graphStore.js';
import { projectGraphView } from '../../../core/openDefinitions.js';

/** Write anchor instances to the store where their title pills are drawn (skipped mid-drag). */
export function flushAnchorPositions(ctx) {
  const { draggingNodeInfo, anchorPositionUpdatesRef, activeGraphId, storeActions } = ctx;
  if (draggingNodeInfo) return; // Don't trigger store updates during drag — use ref positions for rendering
  const updates = anchorPositionUpdatesRef.current;
  if (updates.size === 0) return;

  const rafId = requestAnimationFrame(() => {
    // As viewed: an open box's node is an anchor only in the view, and keeping it under
    // the box's title is what makes it close where the box was.
    const graph = projectGraphView(useGraphStore.getState(), activeGraphId);
    if (!graph?.instances) return;

    const positionUpdates = [];
    for (const [anchorId, pos] of updates.entries()) {
      const inst = graph.instances.get(anchorId);
      // Drop stale entries whose instance is gone or no longer an anchor (e.g. the group
      // was combined into a node or deleted). Otherwise this keeps snapping a now-free
      // node back to where its old group title sat — the "pinned" bug.
      if (!inst || !inst.isGroupAnchor) {
        updates.delete(anchorId);
        continue;
      }
      if (Math.abs((inst.x ?? 0) - pos.x) > 1 || Math.abs((inst.y ?? 0) - pos.y) > 1) {
        positionUpdates.push({ instanceId: anchorId, x: pos.x, y: pos.y });
      }
    }
    if (positionUpdates.length > 0) {
      // This runs when NOT dragging (see the early return above), so it must
      // NOT pass a drag context — `isDragging: true` here latched the save
      // gate with no matching end signal, and if this was the session's last
      // mutation, autosave never fired again. `phase: 'end'` marks it as a
      // finalizing, non-gating change so the queued state actually saves.
      storeActions.updateMultipleNodeInstancePositions(activeGraphId, positionUpdates, { phase: 'end' });
    }
  });
  return () => cancelAnimationFrame(rafId);
}
