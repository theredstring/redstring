/**
 * Delete a Thing-group from its web: the group, its Things, every group
 * inside it and every connection touching them, as one undo step
 * (graphStore.deleteGroupAndContents). It leaves the way a deleted selection
 * does: its shell shrinks away under its Things' shrink ghosts
 * (DeletionGhostLayer). A Thing opened in place is the view of one node, so
 * deleting it deletes that node.
 */
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { anchorIdFromOpenGroupId, projectGraphView } from '../../../core/openDefinitions.js';

const esc = (value) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&'));

/** The shell's ghost, read off the drawn band and interior so it leaves looking as it was. */
function shellGhost(groupId) {
  const shell = typeof document !== 'undefined'
    && document.querySelector(`svg.canvas .node-group-bg[data-group-id="${esc(groupId)}"]`);
  const [band, interior] = shell ? shell.querySelectorAll(':scope > rect') : [];
  if (!band) return null;
  const rect = (el) => ({
    x: parseFloat(el.getAttribute('x')) || 0,
    y: parseFloat(el.getAttribute('y')) || 0,
    width: parseFloat(el.getAttribute('width')) || 0,
    height: parseFloat(el.getAttribute('height')) || 0,
    rx: parseFloat(el.getAttribute('rx')) || 0,
    color: el.getAttribute('fill'),
  });
  return { id: `group-${groupId}`, ...rect(band), inner: interior ? rect(interior) : null, delay: 0 };
}

/**
 * @param {(ids: Iterable<string>) => void} captureDeletionGhosts NodeCanvas's
 *   ghost capture for instances, so the Things shrink as any deleted Thing does
 */
export function deleteNodeGroup(graphId, groupId, captureDeletionGhosts) {
  const st = useGraphStore.getState();
  const openAnchorId = anchorIdFromOpenGroupId(groupId);
  const group = openAnchorId
    ? projectGraphView(st, graphId)?.groups?.get(groupId)
    : st.graphs.get(graphId)?.groups?.get(groupId);
  if (!group) return false;

  // The shell first, so the Things' ghosts shrink on top of it.
  const shell = shellGhost(groupId);
  if (shell) useCanvasUIStore.getState().addDeletionGhosts([shell]);
  captureDeletionGhosts?.(group.memberInstanceIds || []);

  if (openAnchorId) st.removeNodeInstance(graphId, openAnchorId);
  else st.deleteGroupAndContents(graphId, groupId);
  return true;
}
