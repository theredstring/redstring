/**
 * A formula in a selection of several, treated as a Thing: tapped into it and
 * out of it, boxed with a selection box, dragged, and deleted along with the
 * rest. It stands in the selection as its group's anchor (the equation's
 * Thing), so the panel shows it as that Thing, and Color, Save, Open and the
 * rest act on the equation. On its own it is selected as its group, with the
 * formula's own panel (canvasUIStore.withoutGroupAnchors).
 */
import useCanvasUIStore from '../../../../store/canvasUIStore.js';
import useGraphStore from '../../../../store/graphStore.js';
import { formatGroupOfAnchor, formatAnchorOfGroup, formatOfAnchor } from '../replaced.js';
import { deleteFormula } from './deleteFormula.js';

/** Select a group from the canvas, the way a click on its title does (groupInput.titleClick). */
function selectGroup(groupId) {
  const ui = useCanvasUIStore.getState();
  ui.setSelectedGroupId(groupId);
  ui.setSelectedInstanceIds(new Set());
  ui.setSelectedEdgeId(null);
  ui.clearSelectedEdgeIds();
  ui.setGroupControlPanelShouldShow(true);
  ui.setNodeControlPanelShouldShow(false);
  ui.setNodeControlPanelVisible(false);
  ui.setAbstractionControlPanelVisible(false);
  ui.setAbstractionControlPanelShouldShow(false);
  ui.setConnectionControlPanelVisible(false);
  ui.setConnectionControlPanelShouldShow(false);
}

/** `ids` with a formula selected on its own (as its group) added as its anchor: what a tap or a box adds to. */
export function withSelectedFormula(ids) {
  const next = new Set(ids);
  const anchorId = formatAnchorOfGroup(useCanvasUIStore.getState().selectedGroupId);
  if (anchorId) next.add(anchorId);
  return next;
}

/**
 * A tap on a formula. Alone, or onto a selection that is only it, it selects
 * the formula. With anything else selected it joins them, as a tapped Thing
 * does, and a tap on it there takes it back out, unless that tap switches a
 * token (`keep`), which is about the formula, not the selection.
 */
export function tapFormula(groupId, anchorId, { keep = false } = {}) {
  const ui = useCanvasUIStore.getState();
  const current = withSelectedFormula(ui.selectedInstanceIds);
  const alone = current.size === 0 || (current.size === 1 && current.has(anchorId));
  if (!anchorId || alone) {
    selectGroup(groupId);
    return;
  }
  if (current.has(anchorId)) {
    if (keep) return;
    current.delete(anchorId);
  } else {
    current.add(anchorId);
  }
  ui.setSelectedGroupId(null);
  ui.setSelectedInstanceIds(current);
}

/** `ids` with every selected formula's Things too: what a drag of the selection moves. */
export function withFormulaParts(ids) {
  let next = null;
  for (const id of ids) {
    const memberIds = formatOfAnchor(id)?.memberIds;
    if (!memberIds?.length) continue;
    next = next || new Set(ids);
    memberIds.forEach(m => next.add(m));
  }
  return next || ids;
}

/**
 * Delete a selection: its Things through `removeThings(ids)` (the caller's own
 * removal and shrink ghosts), its formulas with their exit (deleteFormula), as
 * one undo step.
 */
export function deleteSelection(graphId, ids, removeThings) {
  const formulaGroupIds = [];
  const things = [];
  for (const id of ids) {
    const groupId = formatGroupOfAnchor(id);
    if (groupId) formulaGroupIds.push(groupId); else things.push(id);
  }
  if (!formulaGroupIds.length) { removeThings(things); return; }
  useGraphStore.getState().withHistoryTransaction('Deleted selection', () => {
    if (things.length) removeThings(things);
    formulaGroupIds.forEach(groupId => deleteFormula(graphId, groupId));
  });
}
